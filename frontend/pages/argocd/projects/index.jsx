import { Badge, Code, Group, Paper, Stack, Table, Text } from '@mantine/core';

import { ArgoAvailabilityGate } from '@/components/ArgoCD/ArgoAvailabilityGate';
import { EmptyState, PageHeader, QueryState } from '@/components/ui';
import { useArgoProjects } from '@/hooks/useArgoCD';
import { useResolvedCluster } from '@/hooks/useResolvedCluster';

/** AppProjects: the boundaries constraining what applications may deploy. */
export default function ArgoCDProjectsPage() {
  const cluster = useResolvedCluster();

  return (
    <ArgoAvailabilityGate cluster={cluster}>
      <ProjectsList cluster={cluster} />
    </ArgoAvailabilityGate>
  );
}

function ProjectsList({ cluster }) {
  const projects = useArgoProjects(cluster);

  return (
    <Stack gap="lg">
      <PageHeader title="ArgoCD Projects" subtitle={`Application boundaries on ${cluster}`} />

      <QueryState
        loading={projects.isLoading}
        error={projects.error}
        data={projects.data?.items}
        onRetry={projects.refresh}
        loadingLabel="Loading projects..."
        skeleton="table"
        emptyTitle="No projects"
        emptyDescription="Only the implicit default project exists on this cluster."
      >
        {(items) => (
          <Paper radius="md">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th>Source repositories</Table.Th>
                  <Table.Th>Destinations</Table.Th>
                  <Table.Th>Roles</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((project) => {
                  const spec = project.spec || {};
                  return (
                    <Table.Tr key={project.metadata?.name}>
                      <Table.Td>
                        <Text fw={600} size="sm">{project.metadata?.name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c={spec.description ? undefined : 'dimmed'}>
                          {spec.description || '-'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          {(spec.sourceRepos || ['-']).slice(0, 3).map((repo, index) => (
                            <Code key={`${repo}-${index}`}>{repo}</Code>
                          ))}
                          {(spec.sourceRepos || []).length > 3 && (
                            <Text size="xs" c="dimmed">
                              +{spec.sourceRepos.length - 3} more
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          {(spec.destinations || []).slice(0, 3).map((destination, index) => (
                            <Text key={index} size="xs">
                              {destination.namespace || '*'}
                              {destination.server ? ` @ ${destination.server}` : ''}
                            </Text>
                          ))}
                          {(spec.destinations || []).length === 0 && <Text size="xs" c="dimmed">-</Text>}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {(spec.roles || []).map((role) => (
                            <Badge key={role.name} size="xs" variant="light">
                              {role.name}
                            </Badge>
                          ))}
                          {(spec.roles || []).length === 0 && <Text size="xs" c="dimmed">-</Text>}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
            {items.length === 0 && <EmptyState title="No projects" />}
          </Paper>
        )}
      </QueryState>
    </Stack>
  );
}
