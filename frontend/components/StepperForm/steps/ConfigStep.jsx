import { useState } from 'react';
import { Stack, Paper, TextInput, Text, Divider, Group, Card, Title, Switch, Button, NumberInput, Collapse, Accordion, Textarea, Select, PasswordInput } from '@mantine/core';
import { IconArrowBackUp, IconPlus, IconTrash } from '@tabler/icons-react';

import { notifications } from '@mantine/notifications';

const ConfigStep = ({ form }) => {
  const [lastDeletedContainer, setLastDeletedContainer] = useState(null);

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
    <Stack spacing="lg">

      {/* ── Hatchery / Workspace Configuration ── */}
      {(v?.hatchery?.enabled || v?.hatchery === true) && (
        <Accordion variant="separated" defaultValue="hatchery">
          <Accordion.Item value="hatchery">
            <Accordion.Control>
              <Text fw={600}>Hatchery (Workspaces)</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack spacing="lg">
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
              <Stack spacing="md">
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
              <Stack spacing="md">
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
              <Stack spacing="md">
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
              <Stack spacing="md">
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

    </Stack>
  );
};

export default ConfigStep;
