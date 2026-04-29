import { useEffect, useMemo, useState } from 'react';

import callK8sApi from '@/lib/k8s';
import { syncArgoCD } from '@/lib/argocd';
import { useGlobalState } from '@/contexts/global';

import {
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconGitBranch, IconRefresh, IconSearch } from '@tabler/icons-react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

function statusColor(status) {
  const value = String(status || '').toLowerCase();
  if (['synced', 'healthy', 'succeeded'].includes(value)) return 'teal';
  if (['outofsync', 'progressing', 'running'].includes(value)) return 'orange';
  if (['degraded', 'failed', 'error', 'missing'].includes(value)) return 'red';
  return 'gray';
}

function timeAgo(ts) {
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.max(minutes, 0)}m ago`;
}

function appSearchText(app) {
  return [
    app.metadata?.name,
    app.metadata?.namespace,
    app.spec?.project,
    app.spec?.source?.repoURL,
    app.spec?.source?.path,
    app.spec?.source?.chart,
    app.spec?.destination?.namespace,
    app.status?.sync?.status,
    app.status?.health?.status,
  ].filter(Boolean).join(' ').toLowerCase();
}

export default function ArgoCDApplications() {
  const { activeCluster, activeGlobalEnv } = useGlobalState();
  const [envCluster] = activeGlobalEnv ? activeGlobalEnv.split('/') : [];
  const clusterName = activeCluster || envCluster;
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  const fetchApps = async () => {
    if (!clusterName || !accessToken) return;

    setLoading(true);
    setError(null);

    try {
      let response = null;

      try {
        response = await callK8sApi(
          '/apis/argoproj.io/v1alpha1/applications',
          'GET',
          null,
          null,
          clusterName,
          accessToken
        );
      } catch (clusterWideError) {
        console.warn('Cluster-wide ArgoCD application list failed, falling back to argocd namespace:', clusterWideError);
      }

      if (!response?.items) {
        response = await callK8sApi(
          '/apis/argoproj.io/v1alpha1/namespaces/argocd/applications',
          'GET',
          null,
          null,
          clusterName,
          accessToken
        );
      }

      setApps(response?.items || []);
    } catch (err) {
      setError(err.message || 'Failed to load ArgoCD applications');
      setApps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApps();
  }, [clusterName, accessToken]);

  const filteredApps = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return apps;
    return apps.filter((app) => appSearchText(app).includes(needle));
  }, [apps, query]);

  const counts = useMemo(() => {
    return apps.reduce((acc, app) => {
      const sync = app.status?.sync?.status || 'Unknown';
      const health = app.status?.health?.status || 'Unknown';
      acc.total += 1;
      acc[sync] = (acc[sync] || 0) + 1;
      acc[health] = (acc[health] || 0) + 1;
      return acc;
    }, { total: 0 });
  }, [apps]);

  const triggerSync = async (app) => {
    const name = app.metadata?.name;
    const namespace = app.metadata?.namespace || 'argocd';
    if (!name || !clusterName) return;

    setSyncing(name);
    try {
      await syncArgoCD({ cluster: clusterName, appName: name, namespace, accessToken });
      notifications.show({
        title: 'ArgoCD sync started',
        message: `${name} is syncing.`,
        color: 'blue',
      });
      fetchApps();
    } catch (err) {
      notifications.show({
        title: 'ArgoCD sync failed',
        message: err.message || `Failed to sync ${name}.`,
        color: 'red',
      });
    } finally {
      setSyncing(null);
    }
  };

  if (!clusterName) {
    return (
      <Center py="xl">
        <Text c="dimmed">Select a cluster to view ArgoCD applications.</Text>
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="sm">
            <IconGitBranch size={28} />
            <Title order={2}>ArgoCD Applications</Title>
          </Group>
          <Text c="dimmed" size="sm">
            Native GitOps view for applications running in {clusterName}.
          </Text>
        </Stack>
        <Button leftSection={<IconRefresh size={16} />} onClick={fetchApps} loading={loading}>
          Refresh
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Card withBorder radius="md" p="md">
          <Text size="xs" c="dimmed">Applications</Text>
          <Text size="xl" fw={700}>{counts.total}</Text>
        </Card>
        <Card withBorder radius="md" p="md">
          <Text size="xs" c="dimmed">Synced</Text>
          <Text size="xl" fw={700}>{counts.Synced || 0}</Text>
        </Card>
        <Card withBorder radius="md" p="md">
          <Text size="xs" c="dimmed">Out of sync</Text>
          <Text size="xl" fw={700}>{counts.OutOfSync || 0}</Text>
        </Card>
        <Card withBorder radius="md" p="md">
          <Text size="xs" c="dimmed">Healthy</Text>
          <Text size="xl" fw={700}>{counts.Healthy || 0}</Text>
        </Card>
      </SimpleGrid>

      <Card withBorder radius="md" p="md">
        <Group justify="space-between" mb="md">
          <TextInput
            leftSection={<IconSearch size={16} />}
            placeholder="Search applications, project, repo, namespace, status..."
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            style={{ flex: 1, maxWidth: 520 }}
          />
          {error && <Text c="red" size="sm">{error}</Text>}
        </Group>

        {loading ? (
          <Center py="xl"><Loader /></Center>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Project</Table.Th>
                <Table.Th>Sync</Table.Th>
                <Table.Th>Health</Table.Th>
                <Table.Th>Destination</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th>Last sync</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredApps.map((app) => {
                const name = app.metadata?.name;
                const namespace = app.metadata?.namespace || 'argocd';
                const syncStatus = app.status?.sync?.status || 'Unknown';
                const healthStatus = app.status?.health?.status || 'Unknown';
                const repo = app.spec?.source?.repoURL || app.spec?.sources?.[0]?.repoURL || '-';
                const sourceLabel = app.spec?.source?.chart || app.spec?.source?.path || app.spec?.sources?.[0]?.path || '-';
                const lastSync = app.status?.operationState?.finishedAt || app.status?.reconciledAt;

                return (
                  <Table.Tr key={`${namespace}-${name}`}>
                    <Table.Td>
                      <Anchor component={Link} href={`/argocd/applications/${namespace}/${name}`}>
                        <Text fw={600}>{name}</Text>
                      </Anchor>
                      <Text size="xs" c="dimmed">{namespace}</Text>
                    </Table.Td>
                    <Table.Td>{app.spec?.project || '-'}</Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(syncStatus)} variant="light">{syncStatus}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(healthStatus)} variant="light">{healthStatus}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{app.spec?.destination?.namespace || '-'}</Text>
                      <Text size="xs" c="dimmed">{app.spec?.destination?.name || app.spec?.destination?.server || '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={repo} disabled={repo === '-'}>
                        <Text size="sm" truncate maw={260}>{sourceLabel}</Text>
                      </Tooltip>
                      <Text size="xs" c="dimmed">{app.spec?.source?.targetRevision || app.spec?.sources?.[0]?.targetRevision || '-'}</Text>
                    </Table.Td>
                    <Table.Td>{timeAgo(lastSync)}</Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="light"
                        color="blue"
                        loading={syncing === name}
                        onClick={() => triggerSync(app)}
                      >
                        Sync
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}

        {!loading && filteredApps.length === 0 && (
          <Center py="xl">
            <Text c="dimmed">No ArgoCD applications found.</Text>
          </Center>
        )}
      </Card>
    </Stack>
  );
}
