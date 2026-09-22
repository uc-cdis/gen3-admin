import { useState } from 'react';
import { Stack, Paper, TextInput, Text, Divider, Group, Card, Title, Switch, Button, NumberInput, Collapse, Accordion, Textarea, Select, PasswordInput, Alert, Code, useComputedColorScheme } from '@mantine/core';
import { IconArrowBackUp, IconPlus, IconTrash, IconAlertCircle } from '@tabler/icons-react';
import { MonacoEditor as Editor } from '@/components/MonacoEditor';
import YAML from 'yaml';

import { notifications } from '@mantine/notifications';

// Starter etlMapping, matching the shape the upstream etl chart writes into the
// `etl-mapping` ConfigMap (helm/etl/values.yaml -> .Values.etlMapping).
const ETL_MAPPING_EXAMPLE = `mappings:
  - name: ${'${environment}'}_case
    doc_type: case
    type: aggregator
    root: case
    props:
      - name: submitter_id
      - name: project_id
`;

// Prop blocks Tube understands. Anything else ending in `_props` is a typo that
// would fail at ETL time, so we surface it here instead.
const VALID_PROP_KEYS = new Set([
  'props', 'flatten_props', 'parent_props', 'nested_props',
  'joining_props', 'aggregated_props', 'injecting_props', 'special_props',
]);

// Non-prop keys a mapping may legitimately carry.
const KNOWN_MAPPING_KEYS = new Set([
  'name', 'doc_type', 'type', 'root', 'category', 'target_nodes', 'filter',
]);

/**
 * Structural check for an etlMapping document.
 *
 * There is no published JSON Schema for this format upstream; these rules mirror
 * what uc-cdis/tube's parsers require at runtime (name / doc_type / type / root)
 * plus the prop-key whitelist that gen3utils enforces. Dictionary-aware checks
 * (does this path resolve to a real backref?) need the commons' schema.json and
 * are deliberately out of scope here.
 *
 * @returns {string|null} an error message, or null when the document looks valid.
 */
const validateEtlMapping = (parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Expected a mapping document with a top-level "mappings:" list.';
  }
  if (!Array.isArray(parsed.mappings)) {
    return 'Expected a top-level "mappings:" list.';
  }
  if (parsed.mappings.length === 0) {
    return '"mappings" is empty — add at least one index mapping.';
  }

  const seenNames = new Set();
  for (let i = 0; i < parsed.mappings.length; i += 1) {
    const m = parsed.mappings[i];
    const where = `mappings[${i}]`;
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      return `${where} must be a mapping object.`;
    }
    for (const key of ['name', 'doc_type', 'type', 'root']) {
      if (!m[key]) return `${where} is missing required key "${key}".`;
    }
    if (!['aggregator', 'collector'].includes(m.type)) {
      return `${where}.type must be "aggregator" or "collector" (got "${m.type}").`;
    }
    if (seenNames.has(m.name)) {
      return `Duplicate index name "${m.name}" — each mapping needs a unique "name".`;
    }
    seenNames.add(m.name);

    if (m.type === 'collector' && !Array.isArray(m.props)) {
      return `${where} is a collector, so it needs a "props" list.`;
    }
    // Catch near-misses like `flatten_propz` / `parent_prop` too, not just keys
    // that happen to end in exactly "props".
    const badKey = Object.keys(m).find(
      (k) => !VALID_PROP_KEYS.has(k) && !KNOWN_MAPPING_KEYS.has(k) && /prop/i.test(k)
    );
    if (badKey) {
      return `${where} has unknown property block "${badKey}".`;
    }
  }
  return null;
};

const ConfigStep = ({ form }) => {
  const [lastDeletedContainer, setLastDeletedContainer] = useState(null);
  const colorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const editorTheme = colorScheme === 'dark' ? 'vs-dark' : 'light';

  // Raw editor buffers. We keep the text the user is typing separate from parsed
  // form state so a transient syntax error doesn't destroy their input.
  const [etlMappingText, setEtlMappingText] = useState(() => {
    const existing = form.values.values?.etlMapping;
    return existing ? YAML.stringify(existing, null, 2) : '';
  });
  const [etlMappingError, setEtlMappingError] = useState(null);

  const [guppyIndicesText, setGuppyIndicesText] = useState(() => {
    const existing = form.values.values?.guppy?.indices;
    return existing?.length ? YAML.stringify(existing, null, 2) : '';
  });
  const [guppyIndicesError, setGuppyIndicesError] = useState(null);

  const handleEtlMappingChange = (text) => {
    setEtlMappingText(text ?? '');
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      setEtlMappingError(null);
      form.setFieldValue('values.etlMapping', undefined);
      return;
    }
    try {
      const parsed = YAML.parse(trimmed);
      const problem = validateEtlMapping(parsed);
      if (problem) {
        setEtlMappingError(problem);
        return;
      }
      setEtlMappingError(null);
      form.setFieldValue('values.etlMapping', parsed);
    } catch (err) {
      setEtlMappingError(err.message);
    }
  };

  const handleGuppyIndicesChange = (text) => {
    setGuppyIndicesText(text ?? '');
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      setGuppyIndicesError(null);
      form.setFieldValue('values.guppy.indices', undefined);
      return;
    }
    try {
      const parsed = YAML.parse(trimmed);
      if (!Array.isArray(parsed)) {
        setGuppyIndicesError('Expected a list of { index, type } entries.');
        return;
      }
      const bad = parsed.find((e) => !e || typeof e !== 'object' || !e.index || !e.type);
      if (bad) {
        setGuppyIndicesError('Every entry needs both an "index" and a "type".');
        return;
      }
      // Guppy resolves documents by matching index/type against what the ETL wrote.
      // A mismatch here yields an empty data explorer at runtime, so warn early.
      const mappings = form.values.values?.etlMapping?.mappings;
      if (Array.isArray(mappings) && mappings.length) {
        const known = new Set(mappings.map((m) => `${m?.name} ${m?.doc_type}`));
        const mismatch = parsed.find((e) => !known.has(`${e.index} ${e.type}`));
        if (mismatch) {
          setGuppyIndicesError(
            `"${mismatch.index}" / "${mismatch.type}" does not match any ETL mapping (expected an entry whose name is the index and doc_type is the type).`
          );
          return;
        }
      }
      setGuppyIndicesError(null);
      form.setFieldValue('values.guppy.indices', parsed);
    } catch (err) {
      setGuppyIndicesError(err.message);
    }
  };

  const addContainer = () => {
    const last = form.values.values.hatchery?.hatchery?.containers?.at(-1);
    if (!last) return;
    const newContainer = { ...last };
    form.insertListItem('values.hatchery.hatchery.containers', newContainer);
  };

  const removeContainer = (index) => {
    const containers = form.values.values?.hatchery?.hatchery?.containers;
    if (!containers || containers.length <= 1) return;

    const removed = containers[index];
    setLastDeletedContainer({ container: removed, index });
    form.removeListItem('values.hatchery.hatchery.containers', index);

    notifications.show({
      id: 'undo-delete',
      title: 'Container removed',
      message: (
        <Button
          size="xs"
          variant="light"
          onClick={undoRemove}
          leftSection={<IconArrowBackUp size={14} />}
        >
          Undo
        </Button>
      ),
      color: 'yellow',
      autoClose: 5000,
      withCloseButton: true,
    });
  };

  const undoRemove = () => {
    if (lastDeletedContainer) {
      form.insertListItem('values.hatchery.hatchery.containers', lastDeletedContainer.container, lastDeletedContainer.index);
      setLastDeletedContainer(null);
      notifications.clean();
    }
  };

  const v = form.values.values; // shorthand

  return (
    <Stack gap="lg">

      {/* ── Hatchery / Workspace Configuration ── */}
      {(v?.hatchery?.enabled || v?.hatchery === true) && (
        <Accordion variant="separated" defaultValue="hatchery">
          <Accordion.Item value="hatchery">
            <Accordion.Control>
              <Text fw={600}>Hatchery (Workspaces)</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="lg">
                {/* Reaper Configuration */}
                <Paper p="md" radius="md" withBorder>
                  <Text fw={500} mb="sm">Workspace Reaper</Text>
                  <Text size="xs" c="dimmed" mb="md">Automatically cleans up idle workspace pods.</Text>
                  <Group grow>
                    <Switch
                      label="Enable Reaper"
                      checked={Boolean(v.hatchery?.hatchery?.reaper?.enabled)}
                      onChange={(e) => form.setFieldValue('values.hatchery.hatchery.reaper.enabled', e.currentTarget.checked)}
                    />
                    <Switch
                      label="Suspend CronJob"
                      checked={Boolean(v.hatchery?.hatchery?.reaper?.suspendCronjob)}
                      onChange={(e) => form.setFieldValue('values.hatchery.hatchery.reaper.suspendCronjob', e.currentTarget.checked)}
                    />
                  </Group>
                  {v.hatchery?.hatchery?.reaper?.enabled && (
                    <Group grow mt="md">
                      <TextInput label="Schedule" {...form.getInputProps('values.hatchery.hatchery.reaper.schedule')} />
                      <NumberInput label="Idle Timeout (seconds)" {...form.getInputProps('values.hatchery.hatchery.reaper.idleTimeoutSeconds')} />
                    </Group>
                  )}
                </Paper>

                {/* Sidecar Configuration */}
                <Paper p="md" radius="md" withBorder>
                  <Text fw={500} mb="sm">Sidecar Configuration</Text>
                  <Divider mb="sm" />
                  <Text size="sm" c="dimmed" mb="md">A sidecar runs alongside your main container (Jupyter, RStudio) for data operations.</Text>
                  <Group grow>
                    <TextInput label="Sidecar Image" {...form.getInputProps('values.hatchery.hatchery.sidecarContainer.image')} />
                  </Group>
                  <Group grow mt="md">
                    <NumberInput label="CPU Limit" precision={2} step={0.1} min={0} {...form.getInputProps('values.hatchery.hatchery.sidecarContainer.cpu-limit')} />
                    <TextInput label="Memory Limit" placeholder="256Mi" {...form.getInputProps('values.hatchery.hatchery.sidecarContainer.memory-limit')} />
                  </Group>
                </Paper>

                {/* Workspace Containers */}
                <Text fw={500}>Workspace Containers</Text>
                {v.hatchery?.hatchery?.containers?.map((container, index) => (
                  <Card key={index} withBorder shadow="sm" p="md" radius="lg" mb="md">
                    <Group grow>
                      <TextInput label="Container Name" {...form.getInputProps(`values.hatchery.hatchery.containers.${index}.name`)} />
                      <TextInput label="Image" {...form.getInputProps(`values.hatchery.hatchery.containers.${index}.image`)} />
                    </Group>
                    <Group grow mt="md">
                      <NumberInput label="CPU Limit" precision={1} step={0.1} min={0} {...form.getInputProps(`values.hatchery.hatchery.containers.${index}.cpu-limit`)} />
                      <TextInput label="Memory Limit" placeholder="2Gi" {...form.getInputProps(`values.hatchery.hatchery.containers.${index}.memory-limit`)} />
                    </Group>
                    <Group grow mt="md">
                      <NumberInput label="Port" precision={1} min={0} {...form.getInputProps(`values.hatchery.hatchery.containers.${index}.target-port`)} />
                    </Group>
                    <Group justify="right" mt="md">
                      <Button variant="light" color="red" leftSection={<IconTrash size={16} />} onClick={() => removeContainer(index)}>
                        Remove
                      </Button>
                    </Group>
                  </Card>
                ))}

                <Group justify="center" mt="lg">
                  <Button leftSection={<IconPlus size={18} />} onClick={addContainer} variant="outline">
                    Add New Container
                  </Button>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── Guppy Configuration ── */}
      {v?.guppy?.enabled && (
        <Accordion variant="separated" defaultValue="guppy">
          <Accordion.Item value="guppy">
            <Accordion.Control><Text fw={600}>Guppy</Text></Accordion.Control>
            <Accordion.Panel>
              <TextInput
                label="Elasticsearch Endpoint"
                placeholder="http://elasticsearch:9200"
                {...form.getInputProps('values.guppy.esEndpoint')}
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── Portal Configuration ── */}
      {v?.portal?.enabled && (
        <Accordion variant="separated" defaultValue="portal">
          <Accordion.Item value="portal">
            <Accordion.Control><Text fw={600}>Portal</Text></Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <Textarea
                  label="Portal gitops.json"
                  description='Navigation, explorer, and feature flag configuration'
                  placeholder='{"navTabs": [...]}'
                  minRows={4}
                  {...form.getInputProps('values.portal.gitops')}
                />
                <Group grow>
                  <TextInput label="Favicon URL" {...form.getInputProps('values.portal.favicon')} />
                  <TextInput label="Custom CSS URL" {...form.getInputProps('values.portal.css')} />
                  <TextInput label="Logo URL" {...form.getInputProps('values.portal.logo')} />
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── Revproxy Ingress Configuration ── */}
      {v?.revproxy?.enabled && (
        <Accordion variant="separated" defaultValue="revproxy">
          <Accordion.Item value="revproxy">
            <Accordion.Control><Text fw={600}>Revproxy (Ingress)</Text></Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <Switch
                  label="Custom Ingress"
                  checked={Boolean(v.revproxy?.ingress?.enabled)}
                  onChange={(e) => form.setFieldValue('values.revproxy.ingress.enabled', e.currentTarget.checked)}
                />
                {v.revproxy?.ingress?.enabled && (
                  <>
                    <TextInput label="Ingress Class" placeholder="nginx" {...form.getInputProps('values.revproxy.ingress.className')} />
                    <Textarea label="Hosts (one per line)" placeholder="gen3.example.com" minRows={2}
                      {...form.getInputProps('values.revproxy.ingress.hosts')} />
                    <Textarea label="TLS Secrets" minRows={2} {...form.getInputProps('values.revproxy.ingress.tls')} />
                  </>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── Indexd Configuration ── */}
      {v?.indexd?.enabled && (
        <Accordion variant="separated" defaultValue="indexd">
          <Accordion.Item value="indexd">
            <Accordion.Control><Text fw={600}>Indexd</Text></Accordion.Control>
            <Accordion.Panel>
              <Group grow>
                <TextInput label="Default Prefix" placeholder="PREFIX/" {...form.getInputProps('values.indexd.defaultPrefix')} />
                <Switch
                  label="Use Single Table"
                  checked={String(v.indexd?.useSingleTable).toLowerCase() === 'true'}
                  onChange={(e) => form.setFieldValue('values.indexd.useSingleTable', e.currentTarget.checked)}
                />
              </Group>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── Dashboard Configuration ── */}
      {v?.dashboard?.enabled && (
        <Accordion variant="separated" defaultValue="dashboard">
          <Accordion.Item value="dashboard">
            <Accordion.Control><Text fw={600}>Dashboard</Text></Accordion.Control>
            <Accordion.Panel>
              <Group grow>
                <TextInput label="S3 Bucket" {...form.getInputProps('values.dashboard.dashboardConfig.bucket')} />
                <TextInput label="Prefix" {...form.getInputProps('values.dashboard.dashboardConfig.prefix')} />
              </Group>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── AWS ES Proxy Configuration ── */}
      {v?.['aws-es-proxy']?.enabled && (
        <Accordion variant="separated" defaultValue="aws-es-proxy">
          <Accordion.Item value="aws-es-proxy">
            <Accordion.Control><Text fw={600}>AWS ES Proxy</Text></Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <TextInput label="Elasticsearch Endpoint" placeholder="test.us-east-1.es.amazonaws.com" {...form.getInputProps('values.aws-es-proxy.esEndpoint')} />
                <Group grow>
                  <TextInput label="AWS Access Key ID" {...form.getInputProps('values.aws-es-proxy.secrets.awsAccessKeyId')} />
                  <PasswordInput label="AWS Secret Access Key" {...form.getInputProps('values.aws-es-proxy.secrets.awsSecretAccessKey')} />
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── NeuVector Configuration ── */}
      {v?.neuvector?.enabled && (
        <Accordion variant="separated" defaultValue="neuvector">
          <Accordion.Item value="neuvector">
            <Accordion.Control><Text fw={600}>NeuVector Security</Text></Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <Switch
                  label="Include Predefined Policies"
                  checked={Boolean(v.neuvector?.policies?.include)}
                  onChange={(e) => form.setFieldValue('values.neuvector.policies.include', e.currentTarget.checked)}
                />
                <Select
                  label="Policy Mode"
                  data={[
                    { value: 'Discover', label: 'Discover' },
                    { value: 'Monitor', label: 'Monitor' },
                    { value: 'Protect', label: 'Protect' },
                  ]}
                  {...form.getInputProps('values.neuvector.policies.policyMode')}
                />
                <Divider my="sm" />
                <Text size="sm" c="dimmed">Ingress Controller Info</Text>
                <Group grow>
                  <TextInput label="Controller Service" {...form.getInputProps('values.neuvector.ingress.controller')} />
                  <TextInput label="Namespace" {...form.getInputProps('values.neuvector.ingress.namespace')} />
                  <TextInput label="Class" {...form.getInputProps('values.neuvector.ingress.class')} />
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── ETL Mapping ── */}
      {v?.etl?.enabled && (
        <Accordion variant="separated">
          <Accordion.Item value="etl-mapping">
            <Accordion.Control><Text fw={600}>ETL Mapping</Text></Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  Written to the <Code>etl-mapping</Code> ConfigMap as <Code>etlMapping.yaml</Code> and
                  consumed by Tube. Leave empty to use the chart default.
                </Text>
                {etlMappingError && (
                  <Alert color="red" icon={<IconAlertCircle size={16} />} title="Invalid ETL mapping">
                    {etlMappingError}
                  </Alert>
                )}
                <Editor
                  className="border rounded-lg"
                  value={etlMappingText}
                  defaultLanguage="yaml"
                  height="300px"
                  theme={editorTheme}
                  onChange={handleEtlMappingChange}
                  options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12 }}
                />
                <Group>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => handleEtlMappingChange(ETL_MAPPING_EXAMPLE)}
                    disabled={Boolean(etlMappingText.trim())}
                  >
                    Insert example
                  </Button>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {/* ── Guppy Configuration ── */}
      {v?.guppy?.enabled && (
        <Accordion variant="separated">
          <Accordion.Item value="guppy-config">
            <Accordion.Control><Text fw={600}>Guppy Configuration</Text></Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  Written to the <Code>manifest-guppy</Code> ConfigMap. Index names must match the
                  ETL mapping above. Leave empty to use the chart defaults.
                </Text>
                <TextInput
                  label="Config Index"
                  description="Elasticsearch index holding the array-config document"
                  placeholder="dev_array-config"
                  {...form.getInputProps('values.guppy.configIndex')}
                />
                <TextInput
                  label="Auth Filter Field"
                  description="Field used for access control / authorization filters"
                  placeholder="auth_resource_path"
                  {...form.getInputProps('values.guppy.authFilterField')}
                />
                <Text size="sm" fw={500} mt="xs">Indices</Text>
                {guppyIndicesError && (
                  <Alert color="red" icon={<IconAlertCircle size={16} />} title="Invalid indices">
                    {guppyIndicesError}
                  </Alert>
                )}
                <Editor
                  className="border rounded-lg"
                  value={guppyIndicesText}
                  defaultLanguage="yaml"
                  height="200px"
                  theme={editorTheme}
                  onChange={handleGuppyIndicesChange}
                  options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12 }}
                />
                <Group>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => handleGuppyIndicesChange('- index: dev_case\n  type: case\n- index: dev_file\n  type: file\n')}
                    disabled={Boolean(guppyIndicesText.trim())}
                  >
                    Insert example
                  </Button>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

    </Stack>
  );
};

export default ConfigStep;
