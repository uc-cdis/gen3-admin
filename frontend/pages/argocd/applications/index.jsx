import { useMemo, useState } from 'react';

import {
  Anchor,
  Button,
  Card,
  Group,
  Menu,
  MultiSelect,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { DataTable } from 'mantine-datatable';
import { IconChevronDown, IconRefresh, IconSearch } from '@tabler/icons-react';
import Link from 'next/link';

import {
  ArgoAvailabilityGate,
  useArgoMode,
} from '@/components/ArgoCD/ArgoAvailabilityGate';
import { PageHeader, QueryState, RequireWrite, StatusBadge } from '@/components/ui';
import { useArgoApplications, useArgoInvalidate } from '@/hooks/useArgoCD';
import { useAccessToken } from '@/hooks/useK8s';
import { useResolvedClusterWithFallback } from '@/hooks/useResolvedCluster';
import { useRoles, writeRoleFor } from '@/hooks/useRoles';
import { syncApplication, syncViaCRDFallback } from '@/lib/argocd';

function timeAgo(timestamp) {
  if (!timestamp) return '-';
  const diff = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(diff)) return '-';
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${Math.max(minutes, 0)}m ago`;
}

function primarySource(spec) {
  if (spec?.source) return spec.source;
  return spec?.sources?.[0] || {};
}

function KpiCard({ label, value }) {
  return (
    <Card>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="xl" fw={700}>{value}</Text>
    </Card>
  );
}

export default function ArgoCDApplicationsPage() {
  // These routes do not name a cluster, so fall back to stored state or the
  // single connected agent rather than dead-ending a shared link.
  const { cluster, resolving } = useResolvedClusterWithFallback();
  const { canWrite } = useRoles();

  return (
    <ArgoAvailabilityGate cluster={cluster} resolving={resolving}>
      <ApplicationsList cluster={cluster} />
    </ArgoAvailabilityGate>
  );
}

function ApplicationsList({ cluster }) {
  const mode = useArgoMode();
  const token = useAccessToken();
  const invalidate = useArgoInvalidate();

  const [query, setQuery] = useState('');
  const [syncFilter, setSyncFilter] = useState([]);
  const [healthFilter, setHealthFilter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [selected, setSelected] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [sort, setSort] = useState({ columnAccessor: 'name', direction: 'asc' });

  const apps = useArgoApplications(cluster, { degraded: mode.degraded });
  const items = apps.data?.items ?? [];

  const projects = useMemo(
    () => Array.from(new Set(items.map((app) => app.spec?.project).filter(Boolean))).sort(),
    [items]
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    let result = items.map((app) => {
      const source = primarySource(app.spec);
      return {
        id: `${app.metadata?.namespace || 'argocd'}/${app.metadata?.name}`,
        name: app.metadata?.name,
        namespace: app.metadata?.namespace || 'argocd',
        project: app.spec?.project || 'default',
        sync: app.status?.sync?.status || 'Unknown',
        health: app.status?.health?.status || 'Unknown',
        phase: app.status?.operationState?.phase,
        destination: app.spec?.destination?.namespace || '-',
        repoURL: source.repoURL || '',
        sourceLabel: source.chart || source.path || '-',
        targetRevision: source.targetRevision || '-',
        lastSync: app.status?.operationState?.finishedAt || app.status?.reconciledAt,
        raw: app,
      };
    });

    if (needle) {
      result = result.filter((row) =>
        [row.name, row.namespace, row.project, row.repoURL, row.sourceLabel, row.destination, row.sync, row.health]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      );
    }
    if (syncFilter.length) result = result.filter((row) => syncFilter.includes(row.sync));
    if (healthFilter.length) result = result.filter((row) => healthFilter.includes(row.health));
    if (projectFilter.length) result = result.filter((row) => projectFilter.includes(row.project));

    const { columnAccessor, direction } = sort;
    result.sort((a, b) => {
      const left = String(a[columnAccessor] ?? '');
      const right = String(b[columnAccessor] ?? '');
      return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
    });

    return result;
  }, [items, query, syncFilter, healthFilter, projectFilter, sort]);

  const counts = useMemo(
    () => ({
      total: items.length,
      synced: items.filter((a) => a.status?.sync?.status === 'Synced').length,
      outOfSync: items.filter((a) => a.status?.sync?.status === 'OutOfSync').length,
      unhealthy: items.filter(
        (a) => a.status?.health?.status && !['Healthy', 'Progressing'].includes(a.status.health.status)
      ).length,
    }),
    [items]
  );

  const runSync = async (targets, flags = {}) => {
    setSyncing(true);
    let failures = 0;

    // Sequential on purpose: firing dozens of concurrent syncs at one ArgoCD
    // instance is a good way to overwhelm the repo-server.
    for (const row of targets) {
      try {
        if (mode.degraded) {
          await syncViaCRDFallback(cluster, row.name, row.namespace, flags, token);
        } else {
          await syncApplication(cluster, row.name, flags, row.namespace, token);
        }
      } catch (error) {
        failures += 1;
        notifications.show({
          title: `Sync failed: ${row.name}`,
          message: error?.message || String(error),
          color: 'red',
        });
      }
    }

    const succeeded = targets.length - failures;
    if (succeeded > 0) {
      notifications.show({
        title: 'Sync started',
        message: `${succeeded} of ${targets.length} ${targets.length === 1 ? 'application' : 'applications'}`,
        color: 'blue',
      });
    }
    setSelected([]);
    setSyncing(false);
    invalidate(cluster);
  };

  return (
    <Stack gap="lg">
      <PageHeader
        title="ArgoCD Applications"
        subtitle={
          <>
            GitOps applications on {cluster}
            {mode.version ? ` · ArgoCD ${mode.version}` : ''}
          </>
        }
        actions={
          <>
            {selected.length > 0 && (
              <Menu position="bottom-end">
                <Menu.Target>
                  {/* Not wrapped in RequireWrite: Menu.Target needs a direct
                      child it can attach a ref to, so the gate is inline. */}
                  <Button
                    variant="light"
                    rightSection={<IconChevronDown size={14} />}
                    loading={syncing}
                    disabled={!canWrite(cluster)}
                    title={
                      canWrite(cluster)
                        ? undefined
                        : `Requires the ${writeRoleFor(cluster)} role`
                    }
                  >
                    Sync {selected.length} selected
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => runSync(selected)}>Sync</Menu.Item>
                  <Menu.Item onClick={() => runSync(selected, { prune: true })} color="red">
                    Sync with prune
                    <Text size="xs" c="dimmed">Deletes resources removed from Git</Text>
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={() => apps.refresh()}
              loading={apps.isValidating}
            >
              Refresh
            </Button>
          </>
        }
      />

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <KpiCard label="Applications" value={counts.total} />
        <KpiCard label="Synced" value={counts.synced} />
        <KpiCard label="Out of sync" value={counts.outOfSync} />
        <KpiCard label="Unhealthy" value={counts.unhealthy} />
      </SimpleGrid>

      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          leftSection={<IconSearch size={16} />}
          placeholder="Search name, project, repo, namespace..."
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          style={{ flex: 1, minWidth: 260 }}
        />
        <MultiSelect
          placeholder="Sync status"
          data={['Synced', 'OutOfSync', 'Unknown']}
          value={syncFilter}
          onChange={setSyncFilter}
          clearable
          w={180}
        />
        <MultiSelect
          placeholder="Health"
          data={['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown']}
          value={healthFilter}
          onChange={setHealthFilter}
          clearable
          w={180}
        />
        {projects.length > 1 && (
          <MultiSelect
            placeholder="Project"
            data={projects}
            value={projectFilter}
            onChange={setProjectFilter}
            clearable
            w={180}
          />
        )}
      </Group>

      <QueryState
        loading={apps.isLoading}
        error={apps.error}
        data={items}
        onRetry={apps.refresh}
        loadingLabel="Loading applications..."
        skeleton="table"
        emptyTitle="No ArgoCD applications"
        emptyDescription="Nothing is deployed through ArgoCD on this cluster yet."
      >
        {() => (
          <DataTable
            withTableBorder
            borderRadius="md"
            striped
            highlightOnHover
            minHeight={160}
            records={rows}
            selectedRecords={selected}
            onSelectedRecordsChange={setSelected}
            sortStatus={sort}
            onSortStatusChange={setSort}
            noRecordsText={query || syncFilter.length || healthFilter.length ? 'No applications match the filters' : 'No applications'}
            columns={[
              {
                accessor: 'name',
                title: 'Name',
                sortable: true,
                render: (row) => (
                  <Stack gap={0}>
                    <Anchor component={Link} href={`/argocd/applications/${row.namespace}/${row.name}`} fw={600}>
                      {row.name}
                    </Anchor>
                    <Text size="xs" c="dimmed">{row.namespace}</Text>
                  </Stack>
                ),
              },
              { accessor: 'project', title: 'Project', sortable: true },
              {
                accessor: 'sync',
                title: 'Sync',
                sortable: true,
                render: (row) => <StatusBadge domain="argoSync" value={row.sync} size="sm" />,
              },
              {
                accessor: 'health',
                title: 'Health',
                sortable: true,
                render: (row) => <StatusBadge domain="argoHealth" value={row.health} size="sm" />,
              },
              {
                accessor: 'destination',
                title: 'Destination',
                sortable: true,
              },
              {
                accessor: 'sourceLabel',
                title: 'Source',
                render: (row) => (
                  <Tooltip label={row.repoURL} disabled={!row.repoURL} multiline w={320}>
                    <Stack gap={0}>
                      <Text size="sm" truncate maw={220}>{row.sourceLabel}</Text>
                      <Text size="xs" c="dimmed">{row.targetRevision}</Text>
                    </Stack>
                  </Tooltip>
                ),
              },
              {
                accessor: 'lastSync',
                title: 'Last sync',
                sortable: true,
                render: (row) => <Text size="sm">{timeAgo(row.lastSync)}</Text>,
              },
              {
                accessor: 'actions',
                title: '',
                textAlign: 'right',
                render: (row) => (
                  <RequireWrite cluster={cluster}>
                    <Button size="xs" variant="light" onClick={() => runSync([row])} loading={syncing}>
                      Sync
                    </Button>
                  </RequireWrite>
                ),
              },
            ]}
          />
        )}
      </QueryState>
    </Stack>
  );
}
