import { Alert, Badge, Code, Paper, Stack, Table, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

import { ArgoAvailabilityGate } from '@/components/ArgoCD/ArgoAvailabilityGate';
import { PageHeader, QueryState, StatusBadge } from '@/components/ui';
import { useArgoRepositories } from '@/hooks/useArgoCD';
import { useResolvedCluster } from '@/hooks/useResolvedCluster';

/**
 * Configured repositories, read-only.
 *
 * Adding a repository means handling credentials (SSH keys, tokens), which
 * deserves its own security review rather than being bolted on here.
 */
export default function ArgoCDRepositoriesPage() {
  const cluster = useResolvedCluster();

  return (
    <ArgoAvailabilityGate cluster={cluster}>
      <RepositoriesList cluster={cluster} />
    </ArgoAvailabilityGate>
  );
}

function RepositoriesList({ cluster }) {
  const repos = useArgoRepositories(cluster);

  return (
    <Stack gap="lg">
      <PageHeader title="ArgoCD Repositories" subtitle={`Git and Helm sources configured on ${cluster}`} />

      <Alert variant="light" color="statusNeutral" icon={<IconInfoCircle size={16} />}>
        Read-only. Add or edit repositories with the ArgoCD CLI or UI, since doing so involves
        credentials.
      </Alert>

      <QueryState
        loading={repos.isLoading}
        error={repos.error}
        data={repos.data?.items}
        onRetry={repos.refresh}
        loadingLabel="Loading repositories..."
        skeleton="table"
        emptyTitle="No repositories configured"
        emptyDescription="Applications may still reference public repositories that need no explicit configuration."
      >
        {(items) => (
          <Paper radius="md">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Repository</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Project</Table.Th>
                  <Table.Th>Credentials</Table.Th>
                  <Table.Th>Connection</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((repo) => (
                  <Table.Tr key={repo.repo}>
                    <Table.Td>
                      <Stack gap={0}>
                        {repo.name && <Text size="sm" fw={500}>{repo.name}</Text>}
                        <Code>{repo.repo}</Code>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light">{repo.type || 'git'}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{repo.project || 'all'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={repo.username ? undefined : 'dimmed'}>
                        {repo.username ? `user: ${repo.username}` : 'none / anonymous'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <StatusBadge
                          domain="generic"
                          value={repo.connectionState?.status === 'Successful' ? 'connected' : repo.connectionState?.status}
                          size="sm"
                        />
                        {repo.connectionState?.message && (
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {repo.connectionState.message}
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
