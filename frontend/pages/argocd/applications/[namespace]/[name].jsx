import { useEffect, useMemo, useState } from 'react';

import Events from '@/components/ResourceDetails/Events';
import callK8sApi from '@/lib/k8s';
import { syncArgoCD, waitForArgoSync } from '@/lib/argocd';
import { useGlobalState } from '@/contexts/global';

import {
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconActivityHeartbeat, IconCode, IconEye, IconRefresh } from '@tabler/icons-react';
import Editor from '@monaco-editor/react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import YAML from 'yaml';

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

function FieldCard({ label, value, muted }) {
  return (
    <Card withBorder radius="md" p="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} c={muted ? 'dimmed' : undefined}>{value || '-'}</Text>
    </Card>
  );
}

export default function ArgoCDApplicationDetail() {
  const params = useParams();
  const namespace = params?.namespace;
  const name = params?.name;
  const { activeCluster, activeGlobalEnv } = useGlobalState();
  const [envCluster] = activeGlobalEnv ? activeGlobalEnv.split('/') : [];
  const clusterName = activeCluster || envCluster;
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [error, setError] = useState(null);

  const endpoint = `/apis/argoproj.io/v1alpha1/namespaces/${namespace}/applications/${name}`;

  const fetchApp = async () => {
    if (!clusterName || !namespace || !name || !accessToken) return;

    setLoading(true);
    setError(null);
    try {
      const response = await callK8sApi(endpoint, 'GET', null, null, clusterName, accessToken);
      setApp(response);
    } catch (err) {
      setError(err.message || 'Failed to load ArgoCD application');
      setApp(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApp();
  }, [clusterName, namespace, name, accessToken]);

  const syncStatus = app?.status?.sync?.status || 'Unknown';
  const healthStatus = app?.status?.health?.status || 'Unknown';
  const resources = app?.status?.resources || [];
  const conditions = app?.status?.conditions || [];
  const operationState = app?.status?.operationState;

  const source = useMemo(() => {
    const primary = app?.spec?.source || app?.spec?.sources?.[0] || {};
    return {
      repoURL: primary.repoURL,
      path: primary.path,
      chart: primary.chart,
      targetRevision: primary.targetRevision,
    };
  }, [app]);

  const triggerSync = async (wait = false) => {
    if (!clusterName || !name || !namespace) return;

    setSyncing(true);
    setSyncMessage('Starting sync...');

    try {
      await syncArgoCD({ cluster: clusterName, appName: name, namespace, accessToken });

      if (wait) {
        await waitForArgoSync({
          cluster: clusterName,
          appName: name,
          namespace,
          accessToken,
          onUpdate: (status) => {
            setSyncMessage(`${status.sync.status} / ${status.health.status} / ${status.operationState?.phase || 'Running'}`);
          },
        });
      }

      notifications.show({
        title: wait ? 'ArgoCD sync complete' : 'ArgoCD sync started',
        message: name,
        color: 'green',
      });

      await fetchApp();
    } catch (err) {
      notifications.show({
        title: 'ArgoCD sync failed',
        message: err.message || `Failed to sync ${name}.`,
        color: 'red',
      });
    } finally {
      setSyncing(false);
      setSyncMessage('');
    }
  };

  if (loading && !app) {
    return (
      <Center py="xl">
        <Stack align="center">
          <Loader />
          <Text c="dimmed">Loading ArgoCD application...</Text>
        </Stack>
      </Center>
    );
  }

  if (error || !app) {
    return (
      <Card withBorder radius="md" p="xl">
        <Text c="red" fw={600}>Failed to load ArgoCD application</Text>
        <Text c="dimmed" size="sm">{error || 'Application not found'}</Text>
      </Card>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={6}>
          <Group gap="sm" wrap="wrap">
            <Title order={2}>{name}</Title>
            <Badge size="lg" color={statusColor(syncStatus)} variant="light">{syncStatus}</Badge>
            <Badge size="lg" color={statusColor(healthStatus)} variant="light">{healthStatus}</Badge>
            <Badge size="lg" variant="outline">ns: {namespace}</Badge>
          </Group>
          <Text c="dimmed" size="sm">{app.spec?.project || 'default'} project on {clusterName}</Text>
          {syncMessage && <Text size="sm" c="dimmed">Sync: {syncMessage}</Text>}
        </Stack>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={fetchApp} loading={loading}>
            Refresh status
          </Button>
          <Button variant="light" onClick={() => triggerSync(false)} loading={syncing}>
            Sync
          </Button>
          <Button onClick={() => triggerSync(true)} loading={syncing}>
            Sync and wait
          </Button>
        </Group>
      </Group>

      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="overview" leftSection={<IconEye size={16} />}>Overview</Tabs.Tab>
          <Tabs.Tab value="resources" leftSection={<IconActivityHeartbeat size={16} />}>Resources</Tabs.Tab>
          <Tabs.Tab value="events" leftSection={<IconActivityHeartbeat size={16} />}>Events</Tabs.Tab>
          <Tabs.Tab value="yaml" leftSection={<IconCode size={16} />}>Yaml</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview">
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <FieldCard label="Repository" value={source.repoURL} />
              <FieldCard label="Path / Chart" value={source.chart || source.path} />
              <FieldCard label="Target revision" value={source.targetRevision} />
              <FieldCard label="Destination namespace" value={app.spec?.destination?.namespace} />
              <FieldCard label="Destination cluster" value={app.spec?.destination?.name || app.spec?.destination?.server} />
              <FieldCard label="Last reconciled" value={timeAgo(app.status?.reconciledAt)} />
              <FieldCard label="Last operation" value={operationState?.phase} muted={!operationState?.phase} />
              <FieldCard label="Managed resources" value={resources.length} />
            </SimpleGrid>

            {operationState && (
              <Card withBorder radius="md" p="md">
                <Group justify="space-between">
                  <Stack gap={2}>
                    <Text fw={700}>Last operation</Text>
                    <Text size="sm" c="dimmed">{operationState.message || 'No operation message'}</Text>
                  </Stack>
                  <Badge color={statusColor(operationState.phase)}>{operationState.phase || 'Unknown'}</Badge>
                </Group>
              </Card>
            )}

            {conditions.length > 0 && (
              <Card withBorder radius="md" p="md">
                <Text fw={700} mb="sm">Conditions</Text>
                <Stack gap="xs">
                  {conditions.map((condition, index) => (
                    <Group key={`${condition.type}-${index}`} align="flex-start">
                      <Badge color="orange" variant="light">{condition.type}</Badge>
                      <Text size="sm">{condition.message}</Text>
                    </Group>
                  ))}
                </Stack>
              </Card>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="resources">
          <Paper withBorder radius="md">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Namespace</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Health</Table.Th>
                  <Table.Th>Hook</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {resources.map((resource, index) => (
                  <Table.Tr key={`${resource.kind}-${resource.namespace}-${resource.name}-${index}`}>
                    <Table.Td>{resource.kind}</Table.Td>
                    <Table.Td>
                      <Text fw={500}>{resource.name}</Text>
                      <Text size="xs" c="dimmed">{resource.group || resource.version || '-'}</Text>
                    </Table.Td>
                    <Table.Td>{resource.namespace || '-'}</Table.Td>
                    <Table.Td><Badge variant="light" color={statusColor(resource.status)}>{resource.status || '-'}</Badge></Table.Td>
                    <Table.Td><Badge variant="light" color={statusColor(resource.health?.status)}>{resource.health?.status || '-'}</Badge></Table.Td>
                    <Table.Td>{resource.hook || '-'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {resources.length === 0 && (
              <Center py="xl"><Text c="dimmed">No managed resources reported yet.</Text></Center>
            )}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="events">
          <Events
            resource={name}
            namespace={namespace}
            type="Application"
            cluster={clusterName}
            accessToken={accessToken}
          />
        </Tabs.Panel>

        <Tabs.Panel value="yaml">
          <Paper withBorder radius="md" p={0}>
            <Editor
              value={YAML.stringify(app)}
              defaultLanguage="yaml"
              height={760}
              options={{
                minimap: { enabled: false },
                readOnly: true,
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
              }}
            />
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
