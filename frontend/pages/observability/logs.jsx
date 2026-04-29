import { useCallback, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Flex,
  Group,
  Loader,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import {
  IconAlertCircle,
  IconClock,
  IconDatabase,
  IconFilter,
  IconRefresh,
  IconSearch,
  IconX,
} from '@tabler/icons-react';

const QUICK_RANGES = [
  { value: '60', label: '1h' },
  { value: '360', label: '6h' },
  { value: '1440', label: '24h' },
  { value: '10080', label: '7d' },
  { value: '20160', label: '14d' },
  { value: '43200', label: '30d' },
  { value: 'custom', label: 'Custom' },
];

const DEFAULT_QUERY = '{namespace=~".+"}';

const toNanoString = (date) => String(date.getTime() * 1000000);

const formatTimestamp = (timestampNs) => {
  const millis = Number(BigInt(timestampNs) / 1000000n);
  return new Date(millis).toLocaleString();
};

const labelsToString = (labels = {}) => (
  Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${value}"`)
    .join(', ')
);

const tryFormatJson = (line) => {
  try {
    return JSON.stringify(JSON.parse(line), null, 2);
  } catch {
    return line;
  }
};

export default function ObservabilityLogsPage() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [range, setRange] = useState('1440');
  const [endDate, setEndDate] = useState(new Date());
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date;
  });
  const [limit, setLimit] = useState(1000);
  const [filter, setFilter] = useState('');
  const [logs, setLogs] = useState([]);
  const [streamCount, setStreamCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const applyRange = (value) => {
    setRange(value);
    if (value === 'custom') return;

    const minutes = Number(value);
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000);
    setStartDate(start);
    setEndDate(end);
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        query,
        start: toNanoString(startDate),
        end: toNanoString(endDate),
        limit: String(limit),
        direction: 'backward',
      });

      const response = await fetch(`/api/loki/proxy?path=/loki/api/v1/query_range&${params.toString()}`);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${message}`);
      }

      const data = await response.json();
      if (data.status !== 'success') {
        throw new Error(data.error || 'Loki query failed');
      }

      const streams = data.data?.result || [];
      const nextLogs = streams.flatMap((stream) => (
        (stream.values || []).map(([timestamp, line]) => ({
          id: `${timestamp}-${labelsToString(stream.stream)}-${line}`,
          timestamp,
          line,
          formattedLine: tryFormatJson(line),
          labels: stream.stream || {},
        }))
      ));

      setStreamCount(streams.length);
      setLogs(nextLogs);
    } catch (err) {
      console.error('Failed to query Loki:', err);
      setError(err.message || 'Failed to query Loki');
      setLogs([]);
      setStreamCount(0);
    } finally {
      setLoading(false);
    }
  }, [endDate, limit, query, startDate]);

  const filteredLogs = useMemo(() => {
    const value = filter.trim().toLowerCase();
    if (!value) return logs;

    return logs.filter((entry) => (
      entry.line.toLowerCase().includes(value) ||
      labelsToString(entry.labels).toLowerCase().includes(value)
    ));
  }, [filter, logs]);

  return (
    <Stack gap="md">
      <Flex justify="space-between" align="center" gap="md" wrap="wrap">
        <Group gap="sm">
          <IconDatabase size={24} />
          <div>
            <Title order={2}>Logs</Title>
            <Text size="sm" c="dimmed">Loki query explorer</Text>
          </div>
        </Group>
        <Group gap="xs">
          <Badge variant="light" color="blue">{streamCount} streams</Badge>
          <Badge variant="light" color="gray">{logs.length} entries</Badge>
        </Group>
      </Flex>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Textarea
            label="LogQL"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={5}
          />

          <Flex gap="sm" wrap="wrap" align="flex-end">
            <Select
              label="Range"
              value={range}
              onChange={applyRange}
              data={QUICK_RANGES}
              leftSection={<IconClock size={16} />}
              w={130}
            />
            <DateTimePicker
              label="Start"
              value={startDate}
              onChange={(value) => {
                setRange('custom');
                if (value) setStartDate(value);
              }}
              maxDate={endDate}
              clearable={false}
              w={220}
            />
            <DateTimePicker
              label="End"
              value={endDate}
              onChange={(value) => {
                setRange('custom');
                if (value) setEndDate(value);
              }}
              minDate={startDate}
              maxDate={new Date()}
              clearable={false}
              w={220}
            />
            <NumberInput
              label="Limit"
              value={limit}
              onChange={(value) => setLimit(Number(value) || 1000)}
              min={1}
              max={10000}
              step={100}
              w={120}
            />
            <Button
              onClick={fetchLogs}
              loading={loading}
              leftSection={<IconSearch size={16} />}
              disabled={!query.trim() || startDate >= endDate}
            >
              Query
            </Button>
            <Tooltip label="Refresh">
              <ActionIcon
                variant="default"
                size="lg"
                onClick={fetchLogs}
                loading={loading}
                disabled={!query.trim() || startDate >= endDate}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Stack>
      </Paper>

      <Flex justify="space-between" align="center" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Filter returned logs"
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          leftSection={<IconFilter size={16} />}
          rightSection={filter ? (
            <ActionIcon variant="subtle" onClick={() => setFilter('')}>
              <IconX size={14} />
            </ActionIcon>
          ) : null}
          maw={520}
          style={{ flex: 1 }}
        />
        <Text size="sm" c="dimmed">{filteredLogs.length}/{logs.length} visible</Text>
      </Flex>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Loki query failed"
          color="red"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      <Paper withBorder radius="md">
        <ScrollArea h="calc(100vh - 390px)" mah={760} mih={360}>
          {loading && logs.length === 0 ? (
            <Flex align="center" justify="center" h={320} gap="sm">
              <Loader size="sm" />
              <Text c="dimmed">Loading logs...</Text>
            </Flex>
          ) : filteredLogs.length === 0 ? (
            <Flex align="center" justify="center" h={320}>
              <Text c="dimmed">{logs.length === 0 ? 'No logs returned.' : 'No logs match the filter.'}</Text>
            </Flex>
          ) : (
            <Stack gap={0}>
              {filteredLogs.map((entry) => (
                <Box
                  key={entry.id}
                  px="sm"
                  py="xs"
                  style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}
                >
                  <Group gap="xs" mb={4} wrap="nowrap">
                    <Text size="xs" c="dimmed" style={{ minWidth: 170 }}>
                      {formatTimestamp(entry.timestamp)}
                    </Text>
                    <Code fz="xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {labelsToString(entry.labels)}
                    </Code>
                  </Group>
                  <Code block fz="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {entry.formattedLine}
                  </Code>
                </Box>
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Paper>
    </Stack>
  );
}
