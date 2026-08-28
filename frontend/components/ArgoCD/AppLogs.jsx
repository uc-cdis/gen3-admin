import { useMemo, useState } from 'react';

import {
  Button,
  Code,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  TextInput,
} from '@mantine/core';
import { IconRefresh, IconSearch } from '@tabler/icons-react';

import { QueryState } from '@/components/ui';
import { useArgoLogs } from '@/hooks/useArgoCD';

/**
 * Aggregated pod logs for an application.
 *
 * Deliberately not following: streaming would need a second streaming-aware path
 * through the agent tunnel, which buffers until END and would never return on an
 * infinite stream. A bounded tail plus an explicit refresh covers the debugging
 * case without that complexity.
 */
export default function AppLogs({ cluster, name, appNamespace, tree }) {
  const [podName, setPodName] = useState('');
  const [container, setContainer] = useState('');
  const [tailLines, setTailLines] = useState(500);
  const [filter, setFilter] = useState('');

  // Pod choices come from the resource tree we already fetched.
  const pods = useMemo(() => {
    const nodes = tree?.nodes || [];
    return nodes
      .filter((node) => node.kind === 'Pod')
      .map((node) => ({ value: node.name, label: node.name, namespace: node.namespace }));
  }, [tree]);

  const selectedPod = pods.find((pod) => pod.value === podName);

  const logs = useArgoLogs(
    cluster,
    name,
    {
      appNamespace,
      namespace: selectedPod?.namespace,
      podName: podName || undefined,
      container: container || undefined,
      tailLines,
      filter: filter || undefined,
    },
    Boolean(cluster && name)
  );

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label="Pod"
          placeholder="All pods"
          data={pods}
          value={podName || null}
          onChange={(value) => setPodName(value || '')}
          clearable
          searchable
          w={280}
        />
        <TextInput
          label="Container"
          placeholder="All containers"
          value={container}
          onChange={(event) => setContainer(event.currentTarget.value)}
          w={180}
        />
        <NumberInput
          label="Tail lines"
          min={100}
          max={10000}
          step={100}
          value={tailLines}
          onChange={(value) => setTailLines(Number(value) || 500)}
          w={130}
        />
        <TextInput
          label="Filter"
          placeholder="substring match"
          leftSection={<IconSearch size={14} />}
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          w={220}
        />
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          onClick={() => logs.refresh()}
          loading={logs.isValidating}
        >
          Refresh
        </Button>
      </Group>

      <QueryState
        loading={logs.isLoading}
        error={logs.error}
        data={logs.data}
        onRetry={logs.refresh}
        loadingLabel="Loading logs..."
        emptyTitle="No log output"
        emptyDescription="No lines matched. Try a different pod, a larger tail, or clear the filter."
      >
        {(lines) => (
          <Paper withBorder radius="md" p="xs">
            <ScrollArea.Autosize mah={560}>
              <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {lines.join('\n')}
              </Code>
            </ScrollArea.Autosize>
          </Paper>
        )}
      </QueryState>
    </Stack>
  );
}
