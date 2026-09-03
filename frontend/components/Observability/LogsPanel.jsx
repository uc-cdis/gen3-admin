import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Paper, Stack, Group, Text, Badge, Select, TextInput, Button, ScrollArea,
  Alert, Loader, SegmentedControl, Switch, Code, ActionIcon, Tooltip,
} from '@mantine/core';
import { IconSearch, IconAlertCircle, IconRefresh, IconX } from '@tabler/icons-react';

import { queryLogs, fetchLogLabelValues, buildLogSelector } from '@/lib/observability';
import { STATUS } from './palette';

/**
 * Logs for the selected environment, from the centralized Loki.
 *
 * Scoping is the whole point here. Loki holds ~29 clusters and ~181 namespaces,
 * so the previous default of `{namespace=~".+"}` returned an unusable firehose.
 * Every query is pinned to the selected cluster and namespace.
 */

const RANGES = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400 };

// Loki labels lines with the app name; matching on it is far cheaper than a
// full-text filter across every stream.
const LEVEL_FILTERS = {
  all: '',
  error: '|~ "(?i)(error|exception|fatal|panic)"',
  warn: '|~ "(?i)(warn|warning)"',
};

const levelOf = (line) => {
  const l = line.toLowerCase();
  if (/\b(error|exception|fatal|panic)\b/.test(l)) return 'error';
  if (/\bwarn(ing)?\b/.test(l)) return 'warn';
  return 'info';
};

const LEVEL_COLOR = {
  error: STATUS.critical,
  warn: STATUS.warning,
  info: undefined,
};

export default function LogsPanel({ cluster, namespace }) {
  const [range, setRange] = useState('1h');
  const [app, setApp] = useState(null);
  const [apps, setApps] = useState([]);
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(false);

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const viewport = useRef(null);

  // Apps present in this environment, so the picker only offers real choices.
  useEffect(() => {
    if (!cluster || !namespace) return;
    const end = new Date();
    const start = new Date(end.getTime() - 3600 * 1000);
    fetchLogLabelValues('app', {
      start,
      end,
      selector: buildLogSelector({ cluster, namespace }),
    })
      .then((values) => setApps(values.sort()))
      .catch(() => setApps([]));
  }, [cluster, namespace]);

  const load = useCallback(async () => {
    if (!cluster || !namespace) return;
    setLoading(true);
    setError(null);

    const end = new Date();
    const start = new Date(end.getTime() - RANGES[range] * 1000);

    // Filters are composed as LogQL pipeline stages so Loki does the work rather
    // than shipping everything to the browser to be filtered client-side.
    const stages = [LEVEL_FILTERS[level]];
    if (search.trim()) {
      stages.push(`|= ${JSON.stringify(search.trim())}`);
    }

    try {
      const res = await queryLogs({
        query: buildLogSelector({
          cluster,
          namespace,
          app: app || undefined,
          extra: stages.filter(Boolean).join(' '),
        }),
        start,
        end,
        limit: 300,
      });

      const rows = [];
      for (const stream of res?.data?.result || []) {
        for (const [ts, line] of stream.values || []) {
          rows.push({
            ts: Number(ts) / 1e6,
            line,
            app: stream.stream.app || stream.stream.container || '',
            pod: stream.stream.pod || stream.stream.instance || '',
            level: levelOf(line),
          });
        }
      }
      rows.sort((a, b) => b.ts - a.ts);
      setEntries(rows);
    } catch (err) {
      setError(err.message || 'Log query failed');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [cluster, namespace, range, app, level, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Live tail. Deliberately a poll rather than a websocket: the proxy is a plain
  // request/response route, and 5s is fresh enough for operational use.
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [live, load]);

  const errorCount = entries.filter((e) => e.level === 'error').length;

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Text fw={600}>Logs</Text>
          <Badge size="sm" variant="light">{cluster}/{namespace}</Badge>
          {loading && <Loader size="xs" />}
        </Group>
        <Group gap="xs">
          <Switch
            size="xs"
            label="Live"
            checked={live}
            onChange={(e) => setLive(e.currentTarget.checked)}
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

      <Group gap="xs" wrap="wrap">
        <Select
          size="xs"
          placeholder="All apps"
          data={apps}
          value={app}
          onChange={setApp}
          searchable
          clearable
          w={200}
        />
        <SegmentedControl
          size="xs"
          value={level}
          onChange={setLevel}
          data={[
            { value: 'all', label: 'All' },
            { value: 'error', label: 'Errors' },
            { value: 'warn', label: 'Warnings' },
          ]}
        />
        <TextInput
          size="xs"
          placeholder="Contains text…"
          leftSection={<IconSearch size={12} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          rightSection={
            search ? (
              <ActionIcon size="xs" variant="subtle" onClick={() => setSearch('')}>
                <IconX size={12} />
              </ActionIcon>
            ) : null
          }
          w={260}
        />
        <Button size="xs" variant="light" onClick={load} loading={loading}>Search</Button>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Log query failed">
          <Code block>{error}</Code>
        </Alert>
      )}

      <Paper withBorder radius="md" p="xs">
        <Group justify="space-between" mb="xs" px="xs">
          <Text size="xs" c="dimmed">
            {entries.length} lines
            {errorCount > 0 && (
              <Text span c={STATUS.critical} fw={600}> · {errorCount} errors</Text>
            )}
          </Text>
          {live && <Badge size="xs" color="green" variant="dot">tailing</Badge>}
        </Group>

        <ScrollArea h={520} viewportRef={viewport}>
          {entries.length === 0 && !loading ? (
            <Text size="sm" c="dimmed" p="md">
              No log lines matched. Try widening the time range or clearing filters.
            </Text>
          ) : (
            <Stack gap={0}>
              {entries.map((e, i) => (
                <Group
                  key={`${e.ts}-${i}`}
                  gap="xs"
                  wrap="nowrap"
                  align="flex-start"
                  style={{
                    padding: '2px 8px',
                    borderLeft: `2px solid ${LEVEL_COLOR[e.level] || 'transparent'}`,
                    fontFamily: 'var(--mantine-font-family-monospace)',
                    fontSize: 11,
                  }}
                >
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0, width: 62 }}>
                    {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
                  </Text>
                  {!app && (
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0, width: 90 }} truncate>
                      {e.app}
                    </Text>
                  )}
                  <Text
                    size="xs"
                    style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', minWidth: 0 }}
                    c={e.level === 'error' ? STATUS.critical : undefined}
                  >
                    {e.line}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Paper>
    </Stack>
  );
}
