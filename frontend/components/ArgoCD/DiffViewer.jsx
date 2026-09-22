import { useMemo, useState } from 'react';

import {
  Badge,
  Group,
  NavLink,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Text,
  useMantineColorScheme,
} from '@mantine/core';
import { MonacoDiffEditor as DiffEditor } from '@/components/MonacoEditor';
import YAML from 'yaml';

import { EmptyState } from '@/components/ui';

/**
 * Live vs desired diff for an application's managed resources.
 *
 * Data comes from ArgoCD's managed-resources endpoint, which is the only source
 * for this -- the Application CRD does not carry live manifests.
 *
 * Two details worth knowing: targetState and liveState arrive as JSON *strings*
 * (not nested objects), and they are re-serialised to YAML here because a
 * side-by-side YAML diff is far easier to read than JSON. Each resource is
 * converted only when selected, since a large app can carry multi-MB payloads.
 */

function parseState(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * Drop fields that always differ and would drown the real diff: server-assigned
 * metadata and status, which ArgoCD does not manage.
 */
function normalise(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = JSON.parse(JSON.stringify(obj));

  if (clone.metadata) {
    [
      'resourceVersion',
      'uid',
      'generation',
      'creationTimestamp',
      'managedFields',
      'selfLink',
    ].forEach((field) => delete clone.metadata[field]);

    if (clone.metadata.annotations) {
      delete clone.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
      if (!Object.keys(clone.metadata.annotations).length) delete clone.metadata.annotations;
    }
  }
  delete clone.status;
  return clone;
}

function toYaml(obj) {
  if (!obj) return '';
  try {
    return YAML.stringify(obj);
  } catch {
    return JSON.stringify(obj, null, 2);
  }
}

function resourceLabel(item) {
  return `${item.kind}/${item.name}`;
}

function resourceId(item, index) {
  return `${item.group || ''}:${item.kind}:${item.namespace || ''}:${item.name}:${index}`;
}

export default function DiffViewer({ items, height = 620 }) {
  const { colorScheme } = useMantineColorScheme();
  const [selectedId, setSelectedId] = useState(null);
  const [hideUnchanged, setHideUnchanged] = useState(true);
  const [onlyChanged, setOnlyChanged] = useState(true);

  // Compare normalised forms so cosmetic server fields do not mark everything
  // as changed.
  const analysed = useMemo(() => {
    return (items || []).map((item, index) => {
      const live = normalise(parseState(item.liveState));
      const target = normalise(parseState(item.targetState));
      const liveYaml = toYaml(live);
      const targetYaml = toYaml(target);

      let state = 'in-sync';
      if (!live && target) state = 'missing';
      else if (live && !target) state = 'extra';
      else if (liveYaml !== targetYaml) state = 'changed';

      return { ...item, id: resourceId(item, index), liveYaml, targetYaml, state };
    });
  }, [items]);

  const visible = useMemo(
    () => (onlyChanged ? analysed.filter((item) => item.state !== 'in-sync') : analysed),
    [analysed, onlyChanged]
  );

  const selected = useMemo(
    () => visible.find((item) => item.id === selectedId) ?? visible[0],
    [visible, selectedId]
  );

  const changedCount = analysed.filter((item) => item.state !== 'in-sync').length;

  if (!analysed.length) {
    return <EmptyState title="No managed resources" description="ArgoCD reports no resources for this application." />;
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {changedCount === 0
              ? `All ${analysed.length} resources match the desired state`
              : `${changedCount} of ${analysed.length} resources differ`}
          </Text>
        </Group>
        <Group gap="md">
          <Switch
            size="xs"
            label="Only differences"
            checked={onlyChanged}
            onChange={(event) => setOnlyChanged(event.currentTarget.checked)}
          />
          <Switch
            size="xs"
            label="Collapse unchanged lines"
            checked={hideUnchanged}
            onChange={(event) => setHideUnchanged(event.currentTarget.checked)}
          />
        </Group>
      </Group>

      {visible.length === 0 ? (
        <EmptyState
          title="Everything is in sync"
          description="No differences between the live cluster state and the desired state in Git."
        />
      ) : (
        <Group align="flex-start" gap="md" wrap="nowrap">
          <Paper withBorder radius="md" style={{ width: 280, flexShrink: 0 }}>
            <ScrollArea.Autosize mah={height}>
              <Stack gap={0} p={4}>
                {visible.map((item) => (
                  <NavLink
                    key={item.id}
                    active={selected?.id === item.id}
                    onClick={() => setSelectedId(item.id)}
                    label={
                      <Text size="sm" truncate title={resourceLabel(item)}>
                        {item.name}
                      </Text>
                    }
                    description={
                      <Group gap={4} wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          {item.kind}
                        </Text>
                        {item.namespace && (
                          <Text size="xs" c="dimmed">
                            · {item.namespace}
                          </Text>
                        )}
                      </Group>
                    }
                    rightSection={<DiffStateBadge state={item.state} />}
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Paper>

          <Paper withBorder radius="md" p={0} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {selected && (
              <>
                <Group justify="space-between" p="xs" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={500} truncate>
                      {resourceLabel(selected)}
                    </Text>
                    <DiffStateBadge state={selected.state} />
                  </Group>
                  <Text size="xs" c="dimmed">
                    left: live · right: desired
                  </Text>
                </Group>
                <DiffEditor
                  height={height}
                  language="yaml"
                  original={selected.liveYaml}
                  modified={selected.targetYaml}
                  theme={colorScheme === 'dark' ? 'vs-dark' : 'light'}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    scrollBeyondLastLine: false,
                    hideUnchangedRegions: { enabled: hideUnchanged },
                  }}
                />
              </>
            )}
          </Paper>
        </Group>
      )}
    </Stack>
  );
}

function DiffStateBadge({ state }) {
  if (state === 'changed') {
    return <Badge size="xs" color="statusWarn">changed</Badge>;
  }
  if (state === 'missing') {
    return <Badge size="xs" color="statusError">missing</Badge>;
  }
  if (state === 'extra') {
    return <Badge size="xs" color="statusInfo">extra</Badge>;
  }
  return <Badge size="xs" color="statusOk">in sync</Badge>;
}
