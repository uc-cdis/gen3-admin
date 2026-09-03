import { useState, useEffect, useCallback } from 'react';
import {
  Paper, Stack, Group, Text, Badge, SimpleGrid, Loader, Alert, Tooltip, Table,
  SegmentedControl, useComputedColorScheme,
} from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import { AreaChart, BarChart } from '@mantine/charts';

import { queryMetric, queryMetricRange, scalarFrom } from '@/lib/observability';
import { palette, STATUS, healthColor } from './palette';

/**
 * Workload health for the selected environment, from Mimir.
 *
 * Scoped to `cluster` + `namespace` throughout: the centralized Mimir holds ~29
 * clusters, so an unscoped query is both meaningless and expensive.
 *
 * Deliberately about workload health rather than resource utilisation. cAdvisor
 * is not scraped for these clusters (container_cpu_* / container_memory_* return
 * nothing), so CPU and memory *usage* are unavailable; what exists is
 * kube-state-metrics. Showing empty CPU charts would be worse than omitting them,
 * so the resource section reports declared *requests* and says so.
 */

const RANGES = {
  '1h': { seconds: 3600, step: 60 },
  '6h': { seconds: 21600, step: 300 },
  '24h': { seconds: 86400, step: 900 },
  '7d': { seconds: 604800, step: 3600 },
};

/**
 * Format a metric that may be absent.
 *
 * A tile renders before the first query resolves, and a metric can also be
 * genuinely missing (Mimir returns no series rather than a zero). Both arrive
 * here as null/undefined, so guard once rather than at each call site.
 */
const fmt = (value, render) =>
  value === null || value === undefined || Number.isNaN(value) ? null : render(value);

const StatTile = ({ label, value, hint, color, icon }) => (
  <Paper withBorder radius="md" p="md">
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed">{label}</Text>
        <Text fw={700} size="xl" style={{ color, lineHeight: 1.1 }}>
          {value === null || value === undefined ? '—' : value}
        </Text>
        {hint && <Text size="xs" c="dimmed">{hint}</Text>}
      </Stack>
      {icon}
    </Group>
  </Paper>
);

export default function MetricsPanel({ cluster, namespace }) {
  const scheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const isDark = scheme === 'dark';
  const colors = palette(isDark);

  const [range, setRange] = useState('6h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({});
  const [podSeries, setPodSeries] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [restarts, setRestarts] = useState([]);

  const sel = `cluster="${cluster}", namespace="${namespace}"`;

  const load = useCallback(async () => {
    if (!cluster || !namespace) return;
    setLoading(true);
    setError(null);

    const { seconds, step } = RANGES[range];
    const end = new Date();
    const start = new Date(end.getTime() - seconds * 1000);

    try {
      // Job-owned pods are excluded from health counts. Completed cronjob and
      // dbcreate pods are legitimately "not ready" forever, and counting them
      // makes the tile read as a permanent outage (60 vs the real 2).
      const notReadyQ =
        `count(kube_pod_status_ready{${sel}, condition="false"} == 1 ` +
        `unless on(pod) kube_pod_owner{${sel}, owner_kind="Job"}) or vector(0)`;

      const [total, running, notReady, unavailable, restartTotal, requestedCpu, requestedMem] =
        await Promise.all([
          queryMetric(`count(kube_pod_info{${sel}})`),
          queryMetric(`count(kube_pod_status_phase{${sel}, phase="Running"} == 1) or vector(0)`),
          queryMetric(notReadyQ),
          queryMetric(`sum(kube_deployment_status_replicas_unavailable{${sel}}) or vector(0)`),
          queryMetric(
            `sum(increase(kube_pod_container_status_restarts_total{${sel}}[${range === '1h' ? '1h' : '24h'}])) or vector(0)`
          ),
          queryMetric(`sum(kube_pod_container_resource_requests{${sel}, resource="cpu"}) or vector(0)`),
          queryMetric(`sum(kube_pod_container_resource_requests{${sel}, resource="memory"}) or vector(0)`),
        ]);

      setStats({
        total: scalarFrom(total),
        running: scalarFrom(running),
        notReady: scalarFrom(notReady),
        unavailable: scalarFrom(unavailable),
        restarts: scalarFrom(restartTotal),
        cpuRequested: scalarFrom(requestedCpu),
        memRequested: scalarFrom(requestedMem),
      });

      // Pod phases over time.
      const phases = await queryMetricRange(
        `sum by (phase) (kube_pod_status_phase{${sel}} == 1)`,
        { start, end, step }
      );
      const buckets = new Map();
      for (const series of phases?.data?.result || []) {
        const phase = series.metric.phase || 'Unknown';
        for (const [t, v] of series.values) {
          const key = t * 1000;
          if (!buckets.has(key)) buckets.set(key, { time: key });
          buckets.get(key)[phase] = Number(v);
        }
      }
      setPodSeries(
        [...buckets.values()]
          .sort((a, b) => a.time - b.time)
          .map((row) => ({
            ...row,
            label: new Date(row.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }))
      );

      // Deployment replica health, worst first.
      const deploys = await queryMetric(
        `kube_deployment_status_replicas_available{${sel}} / kube_deployment_spec_replicas{${sel}}`
      );
      setDeployments(
        (deploys?.data?.result || [])
          .map((r) => ({
            name: r.metric.deployment,
            ratio: Number(r.value[1]),
          }))
          .filter((d) => d.name && Number.isFinite(d.ratio))
          .sort((a, b) => a.ratio - b.ratio)
      );

      // Containers that have actually restarted, worst first.
      const rs = await queryMetric(
        `topk(8, sum by (container) (increase(kube_pod_container_status_restarts_total{${sel}}[24h])) > 0)`
      );
      setRestarts(
        (rs?.data?.result || []).map((r) => ({
          container: r.metric.container || 'unknown',
          restarts: Math.round(Number(r.value[1])),
        }))
      );
    } catch (err) {
      setError(err.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [cluster, namespace, range, sel]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const healthy = stats.notReady === 0 && stats.unavailable === 0;
  const phaseKeys = [...new Set(podSeries.flatMap((r) => Object.keys(r)))]
    .filter((k) => k !== 'time' && k !== 'label');

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Text fw={600}>Workload health</Text>
          <Badge size="sm" variant="light">{cluster}/{namespace}</Badge>
          {loading && <Loader size="xs" />}
        </Group>
        <SegmentedControl
          size="xs"
          value={range}
          onChange={setRange}
          data={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
        />
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Metrics unavailable">
          {error}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
        <StatTile
          label="Pods"
          value={stats.total}
          hint={`${stats.running ?? 0} running`}
        />
        <StatTile
          label="Not ready"
          value={stats.notReady}
          hint="excludes completed jobs"
          color={stats.notReady > 0 ? STATUS.critical : STATUS.good}
          icon={stats.notReady > 0
            ? <IconAlertTriangle size={18} color={STATUS.critical} />
            : <IconCircleCheck size={18} color={STATUS.good} />}
        />
        <StatTile
          label="Replicas unavailable"
          value={stats.unavailable}
          hint="across deployments"
          color={stats.unavailable > 0 ? STATUS.serious : STATUS.good}
        />
        <StatTile
          label="Restarts (24h)"
          value={fmt(stats.restarts, (v) => Math.round(v))}
          color={stats.restarts > 0 ? STATUS.warning : undefined}
        />
        <StatTile
          label="CPU requested"
          value={fmt(stats.cpuRequested, (v) => `${v.toFixed(1)} cores`)}
          hint="declared, not used"
        />
      </SimpleGrid>

      {/* Pod phase over time. Stacked area: the parts sum to a meaningful whole
          (every pod is in exactly one phase). */}
      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" mb="xs">
          <Text fw={600} size="sm">Pod phase over time</Text>
          <Text size="xs" c="dimmed">{range}</Text>
        </Group>
        {podSeries.length === 0 ? (
          <Text size="sm" c="dimmed">No data for this range.</Text>
        ) : (
          <AreaChart
            h={220}
            data={podSeries}
            dataKey="label"
            type="stacked"
            withLegend
            withDots={false}
            strokeWidth={2}
            series={phaseKeys.map((k, i) => ({ name: k, color: colors[i % colors.length] }))}
          />
        )}
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {/* Deployment availability. A table rather than a chart: the useful
            question is "which deployment is short of replicas", which is a
            lookup, not a comparison of magnitudes. */}
        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="xs">Deployment availability</Text>
          {deployments.length === 0 ? (
            <Text size="sm" c="dimmed">No deployments reporting.</Text>
          ) : (
            <Table highlightOnHover verticalSpacing={4} fz="xs">
              <Table.Tbody>
                {deployments.slice(0, 12).map((d) => (
                  <Table.Tr key={d.name}>
                    <Table.Td>{d.name}</Table.Td>
                    <Table.Td w={90} ta="right">
                      <Badge
                        size="xs"
                        variant="light"
                        // Icon-free, so the label carries the meaning: the
                        // percentage is always readable without the colour.
                        color={d.ratio >= 0.999 ? 'green' : d.ratio > 0 ? 'yellow' : 'red'}
                      >
                        {Math.round(d.ratio * 100)}%
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Paper>

        {/* Restart counts: magnitude comparison across a handful of containers. */}
        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="xs">Container restarts (24h)</Text>
          {restarts.length === 0 ? (
            <Group gap="xs">
              <IconCircleCheck size={16} color={STATUS.good} />
              <Text size="sm" c="dimmed">No restarts in the last 24 hours.</Text>
            </Group>
          ) : (
            <BarChart
              h={200}
              data={restarts}
              dataKey="container"
              orientation="vertical"
              withLegend={false}
              barProps={{ radius: 4 }}
              series={[{ name: 'restarts', color: STATUS.warning }]}
            />
          )}
        </Paper>
      </SimpleGrid>

      <Text size="xs" c="dimmed">
        Resource figures are declared requests. Live CPU and memory usage need cAdvisor
        metrics, which are not currently scraped for these clusters.
      </Text>
    </Stack>
  );
}
