import { useState, useEffect, useCallback } from 'react';
import {
  Paper, Stack, Group, Text, Badge, Select, Button, Alert, Loader, Table,
  SegmentedControl, ScrollArea, Code, Collapse, ActionIcon, Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconRefresh, IconChevronRight, IconChevronDown } from '@tabler/icons-react';

import { searchTraces, fetchTraceServices, fetchTrace } from '@/lib/observability';
import { STATUS } from './palette';

/**
 * Distributed traces from Tempo.
 *
 * Tempo is not partitioned by cluster/namespace the way Loki and Mimir are --
 * traces are identified by service. The environment still matters for choosing
 * which services are relevant, but the filter is on `resource.service.name`
 * (the scoped attribute name; the unscoped `service.name` is rejected).
 */

const RANGES = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400 };

/** Colour a duration by how slow it is, so outliers stand out in a long list. */
const durationColor = (ms) => {
  if (ms >= 1000) return STATUS.critical;
  if (ms >= 500) return STATUS.serious;
  if (ms >= 200) return STATUS.warning;
  return undefined;
};

function SpanTree({ trace }) {
  // Tempo returns a batch-per-resource structure; flatten to spans with depth
  // inferred from parent links so the shape of the request is visible.
  const spans = [];
  for (const batch of trace?.batches || []) {
    const service =
      batch.resource?.attributes?.find((a) => a.key === 'service.name')?.value?.stringValue || '';
    for (const scope of batch.scopeSpans || batch.instrumentationLibrarySpans || []) {
      for (const s of scope.spans || []) {
        spans.push({
          id: s.spanId,
          parent: s.parentSpanId || null,
          name: s.name,
          service,
          start: Number(s.startTimeUnixNano),
          durationMs: (Number(s.endTimeUnixNano) - Number(s.startTimeUnixNano)) / 1e6,
          status: s.status?.code,
        });
      }
    }
  }
  if (spans.length === 0) return <Text size="xs" c="dimmed">No spans in this trace.</Text>;

  spans.sort((a, b) => a.start - b.start);
  const t0 = spans[0].start;
  const total = Math.max(...spans.map((s) => s.start + s.durationMs * 1e6)) - t0 || 1;

  const depthOf = (span, seen = 0) => {
    if (!span.parent || seen > 20) return 0;
    const parent = spans.find((s) => s.id === span.parent);
    return parent ? depthOf(parent, seen + 1) + 1 : 0;
  };

  return (
    <Stack gap={2}>
      {spans.map((s) => {
        const offset = ((s.start - t0) / total) * 100;
        const width = Math.max(((s.durationMs * 1e6) / total) * 100, 0.5);
        return (
          <Group key={s.id} gap="xs" wrap="nowrap" style={{ fontSize: 11 }}>
            <Text size="xs" style={{ width: 220, paddingLeft: depthOf(s) * 10 }} truncate>
              {s.name}
            </Text>
            <div style={{ flex: 1, position: 'relative', height: 14 }}>
              <div
                style={{
                  position: 'absolute',
                  left: `${offset}%`,
                  width: `${width}%`,
                  height: 10,
                  top: 2,
                  borderRadius: 4,
                  background: s.status === 2 ? STATUS.critical : 'var(--mantine-color-blue-5)',
                }}
              />
            </div>
            <Text size="xs" c="dimmed" style={{ width: 64 }} ta="right">
              {s.durationMs.toFixed(1)}ms
            </Text>
          </Group>
        );
      })}
    </Stack>
  );
}

export default function TracesPanel() {
  const [range, setRange] = useState('1h');
  const [service, setService] = useState(null);
  const [services, setServices] = useState([]);
  const [onlyErrors, setOnlyErrors] = useState('all');

  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    fetchTraceServices().then(setServices).catch(() => setServices([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const end = new Date();
    const start = new Date(end.getTime() - RANGES[range] * 1000);
    try {
      const res = await searchTraces({
        service: service || undefined,
        status: onlyErrors === 'errors' ? 'error' : undefined,
        start,
        end,
        limit: 50,
      });
      setTraces(res?.traces || []);
    } catch (err) {
      setError(err.message || 'Trace search failed');
      setTraces([]);
    } finally {
      setLoading(false);
    }
  }, [range, service, onlyErrors]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (traceId) => {
    if (expanded === traceId) {
      setExpanded(null);
      return;
    }
    setExpanded(traceId);
    setDetail(null);
    try {
      setDetail(await fetchTrace(traceId));
    } catch (err) {
      setDetail({ error: err.message });
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Text fw={600}>Traces</Text>
          <Badge size="sm" variant="light">{traces.length}</Badge>
          {loading && <Loader size="xs" />}
        </Group>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={onlyErrors}
            onChange={setOnlyErrors}
            data={[{ value: 'all', label: 'All' }, { value: 'errors', label: 'Errors' }]}
          />
          <SegmentedControl
            size="xs"
            value={range}
            onChange={setRange}
            data={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
          />
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={load} loading={loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Select
        size="xs"
        placeholder="All services"
        data={services}
        value={service}
        onChange={setService}
        searchable
        clearable
        w={280}
      />

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Trace search failed">
          <Code block>{error}</Code>
        </Alert>
      )}

      <Paper withBorder radius="md" p="xs">
        <ScrollArea h={520}>
          {traces.length === 0 && !loading ? (
            <Text size="sm" c="dimmed" p="md">
              No traces in this range. Only instrumented services report to Tempo.
            </Text>
          ) : (
            <Table highlightOnHover fz="xs" verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={28} />
                  <Table.Th>Service</Table.Th>
                  <Table.Th>Operation</Table.Th>
                  <Table.Th w={90} ta="right">Duration</Table.Th>
                  <Table.Th w={90}>Started</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {traces.map((t) => {
                  const ms = t.durationMs || 0;
                  const startedAt = new Date(Number(t.startTimeUnixNano) / 1e6);
                  return (
                    <>
                      <Table.Tr
                        key={t.traceID}
                        onClick={() => toggle(t.traceID)}
                        style={{ cursor: 'pointer' }}
                      >
                        <Table.Td>
                          {expanded === t.traceID
                            ? <IconChevronDown size={12} />
                            : <IconChevronRight size={12} />}
                        </Table.Td>
                        <Table.Td>{t.rootServiceName}</Table.Td>
                        <Table.Td>{t.rootTraceName}</Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs" fw={ms >= 500 ? 700 : 400} c={durationColor(ms)}>
                            {ms} ms
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {startedAt.toLocaleTimeString([], { hour12: false })}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      {expanded === t.traceID && (
                        <Table.Tr key={`${t.traceID}-detail`}>
                          <Table.Td colSpan={5}>
                            <Collapse in>
                              <Paper p="xs" radius="sm" withBorder>
                                {!detail && <Loader size="xs" />}
                                {detail?.error && (
                                  <Text size="xs" c="red">{detail.error}</Text>
                                )}
                                {detail && !detail.error && <SpanTree trace={detail} />}
                              </Paper>
                            </Collapse>
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      </Paper>
    </Stack>
  );
}
