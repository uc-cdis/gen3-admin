import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Menu,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconActivityHeartbeat,
  IconChevronDown,
  IconCode,
  IconGitCompare,
  IconEye,
  IconFileText,
  IconGitBranch,
  IconHierarchy,
  IconHistory,
  IconPlayerStop,
  IconRefresh,
  IconTerminal2,
} from '@tabler/icons-react';
import Editor from '@monaco-editor/react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import YAML from 'yaml';

import Events from '@/components/ResourceDetails/Events';
import AppLogs from '@/components/ArgoCD/AppLogs';
import {
  ArgoAvailabilityGate,
  ArgoFeatureUnavailable,
  useArgoMode,
} from '@/components/ArgoCD/ArgoAvailabilityGate';
import DiffViewer from '@/components/ArgoCD/DiffViewer';
import HistoryTable from '@/components/ArgoCD/HistoryTable';
import SourceEditor from '@/components/ArgoCD/SourceEditor';
import SyncDialog from '@/components/ArgoCD/SyncDialog';
import { EmptyState, PageHeader, QueryState, StatusBadge } from '@/components/ui';
import { useAccessToken } from '@/hooks/useK8s';
import { useResolvedCluster } from '@/hooks/useResolvedCluster';
import {
  useArgoApplication,
  useArgoHistory,
  useArgoInvalidate,
  useArgoManagedResources,
  useArgoManifests,
  useArgoResourceTree,
} from '@/hooks/useArgoCD';
import {
  isOurOperation,
  isTerminalPhase,
  refreshApplication,
  rollbackApplication,
  syncApplication,
  syncViaCRDFallback,
  terminateOperation,
  updateApplicationSpec,
} from '@/lib/argocd';

// reactflow needs the DOM, and the canvas is heavy enough to be worth keeping out
// of the initial bundle.
const ResourceTree = dynamic(() => import('@/components/ArgoCD/ResourceTree'), {
  ssr: false,
  loading: () => <Text c="dimmed" size="sm">Loading topology…</Text>,
});

function timeAgo(timestamp) {
  if (!timestamp) return '-';
  const diff = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(diff)) return '-';
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.max(minutes, 0)}m ago`;
}

function FieldCard({ label, value }) {
  return (
    <Card>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={600} style={{ wordBreak: 'break-word' }}>{value || '-'}</Text>
    </Card>
  );
}

/** Primary source, handling both single- and multi-source specs. */
function primarySource(spec) {
  if (spec?.source) return spec.source;
  return spec?.sources?.[0] || {};
}

export default function ArgoCDApplicationDetailPage() {
  const params = useParams();
  const namespace = params?.namespace;
  const name = params?.name;
  const cluster = useResolvedCluster();

  return (
    <ArgoAvailabilityGate cluster={cluster}>
      <ApplicationDetail cluster={cluster} name={name} appNamespace={namespace} />
    </ArgoAvailabilityGate>
  );
}

function ApplicationDetail({ cluster, name, appNamespace }) {
  const mode = useArgoMode();
  const token = useAccessToken();
  const invalidate = useArgoInvalidate();

  const [activeTab, setActiveTab] = useState('overview');
  const [syncOpen, setSyncOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [dryRun, setDryRun] = useState({ result: null, error: null, loading: false });
  const [sourceError, setSourceError] = useState(null);

  const app = useArgoApplication(cluster, name, appNamespace);

  // Only fetch a tab's data once it is opened; the diff and manifests payloads
  // are large.
  const tree = useArgoResourceTree(cluster, name, appNamespace, mode.full && ['tree', 'logs'].includes(activeTab));
  const managed = useArgoManagedResources(cluster, name, appNamespace, mode.full && activeTab === 'diff');
  const history = useArgoHistory(cluster, name, appNamespace, mode.full && activeTab === 'history');
  const manifests = useArgoManifests(cluster, name, appNamespace, undefined, mode.full && activeTab === 'manifests');

  const data = app.data;
  const status = data?.status || {};
  const operation = status.operationState;
  const running = operation?.phase === 'Running' || operation?.phase === 'Terminating';
  const source = primarySource(data?.spec);
  const appKey = `${cluster}/${appNamespace}/${name}`;

  const notifyError = (title, error) =>
    notifications.show({
      title,
      message: error?.message || String(error),
      color: 'red',
    });

  const handleSync = async (flags) => {
    setBusy('sync');
    // Captured before submitting so completion can be attributed to *this* sync
    // rather than a previous one -- the old false-success bug.
    const submittedAt = new Date().toISOString();
    try {
      if (mode.degraded) {
        await syncViaCRDFallback(cluster, name, appNamespace, flags, token);
        notifications.show({
          title: 'Sync requested',
          message: 'Requested via the Application resource. Progress cannot be tracked reliably.',
          color: 'yellow',
        });
      } else {
        await syncApplication(cluster, name, flags, appNamespace, token);
        notifications.show({
          title: flags.dryRun ? 'Dry run started' : 'Sync started',
          message: name,
          color: 'blue',
        });
      }
      setSyncOpen(false);
      await invalidate(cluster);
      pollUntilDone(submittedAt);
    } catch (error) {
      notifyError('Sync failed', error);
    } finally {
      setBusy(null);
    }
  };

  /** Watch for the operation *we* started to reach a terminal phase. */
  const pollUntilDone = (submittedAt) => {
    let elapsed = 0;
    const interval = setInterval(async () => {
      elapsed += 4000;
      const latest = await app.refresh();
      const state = latest?.status?.operationState;

      if (isOurOperation(state, submittedAt) && isTerminalPhase(state?.phase)) {
        clearInterval(interval);
        notifications.show({
          title: `Sync ${String(state.phase).toLowerCase()}`,
          message: state.message || name,
          color: state.phase === 'Succeeded' ? 'green' : 'red',
        });
        invalidate(cluster);
      } else if (elapsed > 300000) {
        clearInterval(interval);
      }
    }, 4000);
  };

  const handleDryRun = async (flags) => {
    setDryRun({ result: null, error: null, loading: true });
    try {
      const result = await syncApplication(cluster, name, { ...flags, dryRun: true }, appNamespace, token);
      setDryRun({ result, error: null, loading: false });
      // Refresh the diff so the user can inspect what would change.
      managed.refresh();
    } catch (error) {
      setDryRun({ result: null, error, loading: false });
    }
  };

  const handleRollback = async (entry) => {
    setBusy('rollback');
    try {
      await rollbackApplication(cluster, name, entry.id, appNamespace, token);
      notifications.show({ title: 'Rollback started', message: `Revision ${entry.id}`, color: 'blue' });
      await invalidate(cluster);
    } catch (error) {
      notifyError('Rollback failed', error);
    } finally {
      setBusy(null);
    }
  };

  const handleTerminate = async () => {
    setBusy('terminate');
    try {
      await terminateOperation(cluster, name, appNamespace, token);
      notifications.show({ title: 'Operation terminated', message: name, color: 'yellow' });
      await invalidate(cluster);
    } catch (error) {
      notifyError('Could not terminate the operation', error);
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async (hard) => {
    setBusy('refresh');
    try {
      await refreshApplication(cluster, name, appNamespace, hard, token);
      await invalidate(cluster);
    } catch (error) {
      notifyError('Refresh failed', error);
    } finally {
      setBusy(null);
    }
  };

  const handleSaveSource = async (spec) => {
    setBusy('source');
    setSourceError(null);
    try {
      await updateApplicationSpec(cluster, name, appNamespace, spec, token);
      notifications.show({ title: 'Source updated', message: name, color: 'green' });
      setSourceOpen(false);
      await invalidate(cluster);
    } catch (error) {
      setSourceError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap="lg">
      <PageHeader
        title={name}
        subtitle={
          <>
            {data?.spec?.project || 'default'} project on {cluster}
            {data?.spec?.destination?.namespace ? ` → ${data.spec.destination.namespace}` : ''}
          </>
        }
        backHref="/argocd/applications"
        backLabel="All applications"
        badges={
          <Group gap="xs">
            <StatusBadge domain="argoSync" value={status.sync?.status} size="lg" />
            <StatusBadge domain="argoHealth" value={status.health?.status} size="lg" />
            {operation?.phase && <StatusBadge domain="argoOp" value={operation.phase} size="lg" />}
          </Group>
        }
        actions={
          <>
            {running && (
              <Button
                variant="light"
                color="statusWarn"
                leftSection={<IconPlayerStop size={16} />}
                onClick={handleTerminate}
                loading={busy === 'terminate'}
              >
                Terminate
              </Button>
            )}
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" rightSection={<IconChevronDown size={14} />} loading={busy === 'refresh'}>
                  Refresh
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconRefresh size={14} />} onClick={() => handleRefresh(false)}>
                  Refresh
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconRefresh size={14} />}
                  onClick={() => handleRefresh(true)}
                  disabled={mode.degraded}
                >
                  Hard refresh
                  <Text size="xs" c="dimmed">Invalidates the repo cache</Text>
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button
              variant="default"
              leftSection={<IconGitBranch size={16} />}
              onClick={() => setSourceOpen(true)}
            >
              Edit source
            </Button>
            <Button leftSection={<IconRefresh size={16} />} onClick={() => setSyncOpen(true)}>
              Sync
            </Button>
          </>
        }
      />

      <QueryState
        loading={app.isLoading}
        error={app.error}
        data={data}
        onRetry={app.refresh}
        loadingLabel="Loading application..."
        errorTitle="Could not load this application"
      >
        {(application) => (
          <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
            <Tabs.List mb="md">
              <Tabs.Tab value="overview" leftSection={<IconEye size={16} />}>Overview</Tabs.Tab>
              <Tabs.Tab value="tree" leftSection={<IconHierarchy size={16} />}>Tree</Tabs.Tab>
              <Tabs.Tab value="diff" leftSection={<IconGitCompare size={16} />}>Diff</Tabs.Tab>
              <Tabs.Tab value="resources" leftSection={<IconActivityHeartbeat size={16} />}>Resources</Tabs.Tab>
              <Tabs.Tab value="history" leftSection={<IconHistory size={16} />}>History</Tabs.Tab>
              <Tabs.Tab value="events" leftSection={<IconActivityHeartbeat size={16} />}>Events</Tabs.Tab>
              <Tabs.Tab value="logs" leftSection={<IconTerminal2 size={16} />}>Logs</Tabs.Tab>
              <Tabs.Tab value="manifests" leftSection={<IconFileText size={16} />}>Manifests</Tabs.Tab>
              <Tabs.Tab value="yaml" leftSection={<IconCode size={16} />}>YAML</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="overview">
              <Stack gap="md">
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <FieldCard label="Repository" value={source.repoURL} />
                  <FieldCard label="Path / chart" value={source.chart || source.path} />
                  <FieldCard label="Target revision" value={source.targetRevision} />
                  <FieldCard label="Destination namespace" value={application.spec?.destination?.namespace} />
                  <FieldCard label="Destination cluster" value={application.spec?.destination?.name || application.spec?.destination?.server} />
                  <FieldCard label="Last reconciled" value={timeAgo(status.reconciledAt)} />
                  <FieldCard label="Synced revision" value={status.sync?.revision?.slice(0, 12)} />
                  <FieldCard label="Managed resources" value={String((status.resources || []).length)} />
                </SimpleGrid>

                {operation && (
                  <Card>
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={2}>
                        <Text fw={600}>Last operation</Text>
                        <Text size="sm" c="dimmed">{operation.message || 'No message'}</Text>
                        <Text size="xs" c="dimmed">
                          started {timeAgo(operation.startedAt)}
                          {operation.finishedAt ? ` · finished ${timeAgo(operation.finishedAt)}` : ''}
                          {operation.operation?.sync?.dryRun ? ' · dry run' : ''}
                        </Text>
                      </Stack>
                      <StatusBadge domain="argoOp" value={operation.phase} />
                    </Group>
                  </Card>
                )}

                {(status.conditions || []).length > 0 && (
                  <Card>
                    <Text fw={600} mb="sm">Conditions</Text>
                    <Stack gap="xs">
                      {status.conditions.map((condition, index) => (
                        <Group key={`${condition.type}-${index}`} align="flex-start" wrap="nowrap">
                          <Badge color="statusWarn">{condition.type}</Badge>
                          <Text size="sm">{condition.message}</Text>
                        </Group>
                      ))}
                    </Stack>
                  </Card>
                )}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="tree">
              {mode.degraded ? (
                <ArgoFeatureUnavailable feature="Resource topology" />
              ) : (
                <QueryState
                  loading={tree.isLoading}
                  error={tree.error}
                  data={tree.data}
                  onRetry={tree.refresh}
                  loadingLabel="Loading resource topology..."
                  detectEmpty={false}
                >
                  {(treeData) => <ResourceTree tree={treeData} />}
                </QueryState>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="diff">
              {mode.degraded ? (
                <ArgoFeatureUnavailable feature="Live diff" />
              ) : (
                <QueryState
                  loading={managed.isLoading}
                  error={managed.error}
                  data={managed.data?.items}
                  onRetry={managed.refresh}
                  loadingLabel="Comparing live and desired state..."
                  emptyTitle="No managed resources"
                >
                  {(items) => <DiffViewer items={items} />}
                </QueryState>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="resources">
              <Paper radius="md">
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Kind</Table.Th>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Namespace</Table.Th>
                      <Table.Th>Sync</Table.Th>
                      <Table.Th>Health</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(status.resources || []).map((resource, index) => (
                      <Table.Tr key={`${resource.kind}-${resource.name}-${index}`}>
                        <Table.Td>{resource.kind}</Table.Td>
                        <Table.Td>
                          <Text fw={500} size="sm">{resource.name}</Text>
                          {resource.group && <Text size="xs" c="dimmed">{resource.group}</Text>}
                        </Table.Td>
                        <Table.Td>{resource.namespace || '-'}</Table.Td>
                        <Table.Td><StatusBadge domain="argoSync" value={resource.status} size="sm" /></Table.Td>
                        <Table.Td><StatusBadge domain="argoHealth" value={resource.health?.status} size="sm" /></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                {(status.resources || []).length === 0 && (
                  <EmptyState title="No resources reported" />
                )}
              </Paper>
            </Tabs.Panel>

            <Tabs.Panel value="history">
              {mode.degraded ? (
                <ArgoFeatureUnavailable feature="Deployment history" />
              ) : (
                <QueryState
                  loading={history.isLoading}
                  error={history.error}
                  data={history.data}
                  onRetry={history.refresh}
                  loadingLabel="Loading deployment history..."
                  detectEmpty={false}
                >
                  {(historyData) => (
                    <HistoryTable
                      items={historyData.items}
                      automatedSyncEnabled={historyData.automatedSyncEnabled}
                      ownedByApplicationSet={historyData.ownedByApplicationSet}
                      currentRevision={status.sync?.revision}
                      onRollback={handleRollback}
                      rollingBack={busy === 'rollback'}
                      degraded={mode.degraded}
                    />
                  )}
                </QueryState>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="events">
              <Events
                resource={name}
                namespace={appNamespace}
                type="Application"
                cluster={cluster}
                accessToken={token}
              />
            </Tabs.Panel>

            <Tabs.Panel value="logs">
              {mode.degraded ? (
                <ArgoFeatureUnavailable feature="Application logs" />
              ) : (
                <AppLogs cluster={cluster} name={name} appNamespace={appNamespace} tree={tree.data} />
              )}
            </Tabs.Panel>

            <Tabs.Panel value="manifests">
              {mode.degraded ? (
                <ArgoFeatureUnavailable feature="Rendered manifests" />
              ) : (
                <QueryState
                  loading={manifests.isLoading}
                  error={manifests.error}
                  data={manifests.data?.manifests}
                  onRetry={manifests.refresh}
                  loadingLabel="Rendering manifests..."
                  emptyTitle="No manifests returned"
                >
                  {(list) => (
                    <Stack gap="xs">
                      <Text size="sm" c="dimmed">
                        {list.length} rendered {list.length === 1 ? 'manifest' : 'manifests'}
                        {manifests.data?.revision ? ` at ${String(manifests.data.revision).slice(0, 12)}` : ''}
                      </Text>
                      <Paper radius="md" p={0}>
                        <Editor
                          height={620}
                          defaultLanguage="yaml"
                          value={list.map((item) => YAML.stringify(JSON.parse(item))).join('---\n')}
                          options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: 'on' }}
                        />
                      </Paper>
                    </Stack>
                  )}
                </QueryState>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="yaml">
              <Paper radius="md" p={0}>
                <Editor
                  height={760}
                  defaultLanguage="yaml"
                  value={YAML.stringify(application)}
                  options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, wordWrap: 'on' }}
                />
              </Paper>
            </Tabs.Panel>
          </Tabs>
        )}
      </QueryState>

      <SyncDialog
        opened={syncOpen}
        onClose={() => setSyncOpen(false)}
        app={data}
        appKey={appKey}
        degraded={mode.degraded}
        onSync={handleSync}
        onDryRun={handleDryRun}
        dryRunResult={dryRun.result}
        dryRunError={dryRun.error}
        dryRunLoading={dryRun.loading}
        syncing={busy === 'sync'}
      />

      <SourceEditor
        opened={sourceOpen}
        onClose={() => setSourceOpen(false)}
        app={data}
        ownedByApplicationSet={(data?.metadata?.ownerReferences || []).some((ref) => ref.kind === 'ApplicationSet')}
        onSave={handleSaveSource}
        saving={busy === 'source'}
        error={sourceError}
        degraded={mode.degraded}
      />
    </Stack>
  );
}
