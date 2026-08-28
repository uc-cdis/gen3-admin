import { Badge, Code, Group, Paper, Stack, Table, Text } from '@mantine/core';

import { ArgoAvailabilityGate } from '@/components/ArgoCD/ArgoAvailabilityGate';
import { PageHeader, QueryState, StatusBadge } from '@/components/ui';
import { useArgoClusters } from '@/hooks/useArgoCD';
import { useResolvedCluster } from '@/hooks/useResolvedCluster';

/**
 * Clusters ArgoCD can deploy to.
 *
 * Note these are ArgoCD's own deployment targets, which are not the same thing as
 * the clusters this console has agents for.
 */
export default function ArgoCDClustersPage() {
  const cluster = useResolvedCluster();

  return (
    <ArgoAvailabilityGate cluster={cluster}>
      <ClustersList cluster={cluster} />
    </ArgoAvailabilityGate>
  );
}

function ClustersList({ cluster }) {
  const clusters = useArgoClusters(cluster);

  return (
    <Stack gap="lg">
      <PageHeader
        title="ArgoCD Clusters"
        subtitle={`Deployment targets registered with ArgoCD on ${cluster}`}
      />

      <QueryState
        loading={clusters.isLoading}
        error={clusters.error}
        data={clusters.data?.items}
        onRetry={clusters.refresh}
        loadingLabel="Loading clusters..."
        skeleton="table"
        emptyTitle="No clusters registered"
      >
        {(items) => (
          <Paper radius="md">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Server</Table.Th>
                  <Table.Th>Kubernetes</Table.Th>
                  <Table.Th>Namespaces</Table.Th>
                  <Table.Th>Connection</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((entry) => (
                  <Table.Tr key={entry.server}>
                    <Table.Td>
                      <Group gap="xs">
                        <Text size="sm" fw={500}>{entry.name || 'in-cluster'}</Text>
                        {entry.server === 'https://kubernetes.default.svc' && (
                          <Badge size="xs" variant="light">local</Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Code>{entry.server}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{entry.serverVersion || '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={entry.namespaces?.length ? undefined : 'dimmed'}>
                        {entry.namespaces?.length ? entry.namespaces.join(', ') : 'all'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <StatusBadge
                          domain="generic"
                          value={entry.connectionState?.status === 'Successful' ? 'connected' : entry.connectionState?.status}
                          size="sm"
                        />
                        {entry.connectionState?.message && (
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {entry.connectionState.message}
                          </Text>
                        )}
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </QueryState>
    </Stack>
  );
}
