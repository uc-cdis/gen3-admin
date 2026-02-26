import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Select,
  Button,
  Group,
  Container,
  Text,
  Loader,
  Alert,
  TextInput,
  ActionIcon,
  Flex,
  Menu,
  Box,
  Badge,
  Collapse,
  Divider,
  Card,
  ScrollArea,
  Tooltip,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import {
  IconRefresh,
  IconClock,
  IconX,
  IconFilter,
  IconChevronDown,
  IconChevronRight,
  IconAlertCircle
} from '@tabler/icons-react';

// Utility functions
const formatTimeAgo = (timestamp) => {
  const now = new Date();
  const time = new Date(timestamp);
  const diffSeconds = Math.floor((now.getTime() - time.getTime()) / 1000);

  if (diffSeconds < 1) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;

  return time.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const getStatusColor = (code) => {
  if (code === null || code === undefined) return 'gray';
  const statusInt = parseInt(code, 10);
  if (isNaN(statusInt)) return 'gray';
  if (statusInt < 300) return 'green';
  if (statusInt < 400) return 'yellow';
  if (statusInt < 500) return 'red';
  return 'grape';
};

const getResponseTimeColor = (time) => {
  if (time === null || time === undefined) return 'gray';
  const timeFloat = parseFloat(time);
  if (isNaN(timeFloat)) return 'gray';
  if (timeFloat < 0.1) return 'teal';
  if (timeFloat < 0.5) return 'green';
  if (timeFloat < 1.0) return 'yellow';
  if (timeFloat < 3.0) return 'orange';
  return 'red';
};

const getResponseTimeWidth = (time) => {
  if (time === null || time === undefined) return 5;
  const timeFloat = parseFloat(time);
  if (isNaN(timeFloat)) return 5;
  if (timeFloat < 0.05) return 5;
  if (timeFloat < 0.1) return 10;
  if (timeFloat < 0.3) return 20;
  if (timeFloat < 0.7) return 35;
  if (timeFloat < 1.5) return 50;
  if (timeFloat < 3.0) return 70;
  return 90;
};

const groupSimilarLogs = (logs) => {
  const groups = {};
  const result = [];

  logs.forEach((log, index) => {
    const verb = log.http_verb || 'N/A';
    const request = log.http_request || 'N/A';
    const status = log.http_status_code !== null ? log.http_status_code : 'N/A';
    const key = `${verb}-${request}-${status}`;

    if (!groups[key]) {
      groups[key] = {
        ...log,
        id: `${log.timestamp}-${index}`,
        count: 1,
        items: [log],
        firstTimestamp: log.timestamp,
        lastTimestamp: log.timestamp,
      };
      result.push(groups[key]);
    } else {
      groups[key].count += 1;
      groups[key].items.push(log);

      if (log.timestamp > groups[key].timestamp) {
        groups[key].timestamp = log.timestamp;
        groups[key].response_secs = log.response_secs;
      }

      groups[key].lastTimestamp = Math.max(groups[key].lastTimestamp, log.timestamp);
    }
  });

  result.sort((a, b) => b.timestamp - a.timestamp);
  return result;
};

// Components
const LogEntry = ({ log, expanded, toggleExpand }) => {
  const statusColor = getStatusColor(log.http_status_code);
  const responseTimeColor = getResponseTimeColor(log.response_secs);
  const responseTimeWidth = getResponseTimeWidth(log.response_secs);

  return (
    <Card
      p="xs"
      mb="xs"
      withBorder
      radius="sm"
      style={{ cursor: 'pointer', transition: 'background-color 0.1s ease' }}
      onClick={toggleExpand}
      sx={(theme) => ({
        '&:hover': {
          backgroundColor: theme.colorScheme === 'dark' ? theme.colors.dark[6] : theme.colors.gray[0],
        },
      })}
    >
      <Flex align="center" gap="xs">
        <ActionIcon size="xs" variant="subtle" mr={4}>
          {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        </ActionIcon>

        <Tooltip label={new Date(log.timestamp).toLocaleString()} position="top-start" openDelay={500}>
          <Text size="xs" style={{ width: '70px', whiteSpace: 'nowrap', textAlign: 'right' }} mr="sm">
            {formatTimeAgo(log.timestamp)}
          </Text>
        </Tooltip>

        {log.count > 1 && (
          <Tooltip
            label={`First: ${formatTimeAgo(log.firstTimestamp)}, Last: ${formatTimeAgo(log.lastTimestamp)}`}
            position="top"
            openDelay={300}
          >
            <Badge size="sm" variant="light" color="blue" mr="xs" style={{ minWidth: 45, textAlign: 'center' }}>
              {log.count}x
            </Badge>
          </Tooltip>
        )}

        <Badge size="sm" variant="filled" color={statusColor} style={{ minWidth: '40px', textAlign: 'center' }}>
          {log.http_status_code !== null ? log.http_status_code : 'N/A'}
        </Badge>

        <Tooltip
          label={log.response_secs !== null ? `${(log.response_secs * 1000).toFixed(1)}ms` : 'N/A'}
          position="top"
          openDelay={300}
        >
          <Box
            style={{
              width: `${responseTimeWidth}px`,
              height: '6px',
              backgroundColor: responseTimeColor,
              marginRight: '8px',
              borderRadius: '3px',
              flexShrink: 0
            }}
          />
        </Tooltip>

        <Text size="xs" style={{ minWidth: '45px', textAlign: 'right' }} ml="xs">
          {log.user_id || '/'}
        </Text>

        <Text size="xs" color="dimmed" style={{ minWidth: '45px', textAlign: 'right' }}>
          {log.http_verb || 'GET'}
        </Text>

        <Text size="xs" style={{ minWidth: '45px', textAlign: 'right' }} ml="xs">
          {log.http_request || '/'}
        </Text>

        <Text
          size="xs"
          style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          ml="xs"
        >
          {log.proxy_service || '/'}
        </Text>
      </Flex>

      <Collapse in={expanded}>
        <Box mt="xs" pl={38}>
          <Divider my="xs" />
          <Text size="xs"><b>Time:</b> {new Date(log.timestamp).toLocaleString()}</Text>
          {log.user_id && <Text size="xs"><b>User ID:</b> {log.user_id}</Text>}
          {log.network_client_ip && <Text size="xs"><b>Client IP:</b> {log.network_client_ip}</Text>}
          <Text size="xs">
            <b>Response Time:</b> {log.response_secs !== null ? `${(log.response_secs * 1000).toFixed(1)}ms` : 'N/A'}
          </Text>
          {log.proxy_service && <Text size="xs"><b>Service:</b> {log.proxy_service}</Text>}
          {log.http_useragent && (
            <Text size="xs" style={{ wordBreak: 'break-all' }}>
              <b>User Agent:</b> {log.http_useragent}
            </Text>
          )}

          {log.count > 1 && (
            <>
              <Divider my="xs" label={`Older occurrences (${log.count - 1})`} labelPosition="center" />
              <ScrollArea style={{ maxHeight: '150px' }}>
                {log.items
                  .filter(item => item.timestamp !== log.timestamp)
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .map((item, idx) => (
                    <Text key={idx} size="xs" mb={2} color="dimmed">
                      {new Date(item.timestamp).toLocaleTimeString()} - {item.http_verb} {item.http_request}
                      ({item.response_secs !== null ? `${(item.response_secs * 1000).toFixed(0)}ms` : 'N/A'})
                    </Text>
                  ))}
              </ScrollArea>
            </>
          )}
        </Box>
      </Collapse>
    </Card>
  );
};

const LogList = ({ logs, filter }) => {
  const [expandedLogs, setExpandedLogs] = useState({});

  const toggleExpand = (id) => {
    setExpandedLogs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const groupedLogs = useMemo(() => groupSimilarLogs(logs), [logs]);

  const filteredLogs = useMemo(() => {
    if (!filter) return groupedLogs;

    const searchStr = filter.toLowerCase();

    return groupedLogs.filter(logGroup => {
      const representativeMatch = (
        (logGroup.http_request && logGroup.http_request.toLowerCase().includes(searchStr)) ||
        (logGroup.user_id && logGroup.user_id.toLowerCase().includes(searchStr)) ||
        (logGroup.http_useragent && logGroup.http_useragent.toLowerCase().includes(searchStr)) ||
        (logGroup.network_client_ip && logGroup.network_client_ip.toLowerCase().includes(searchStr)) ||
        (logGroup.proxy_service && logGroup.proxy_service.toLowerCase().includes(searchStr)) ||
        (logGroup.http_status_code !== null && logGroup.http_status_code.toString().includes(searchStr)) ||
        (logGroup.http_verb && logGroup.http_verb.toLowerCase().includes(searchStr))
      );

      if (representativeMatch) return true;

      if (logGroup.items && logGroup.items.length > 1) {
        return logGroup.items.some(item =>
          (item.http_request && item.http_request.toLowerCase().includes(searchStr)) ||
          (item.user_id && item.user_id.toLowerCase().includes(searchStr)) ||
          (item.http_useragent && item.http_useragent.toLowerCase().includes(searchStr)) ||
          (item.network_client_ip && item.network_client_ip.toLowerCase().includes(searchStr)) ||
          (item.proxy_service && item.proxy_service.toLowerCase().includes(searchStr)) ||
          (item.http_status_code !== null && item.http_status_code.toString().includes(searchStr)) ||
          (item.http_verb && item.http_verb.toLowerCase().includes(searchStr))
        );
      }

      return false;
    });
  }, [groupedLogs, filter]);

  if (filteredLogs.length === 0 && groupedLogs.length > 0) {
    return <Text align="center" mt="xl" color="dimmed">No logs match your filter.</Text>;
  }

  if (filteredLogs.length === 0) {
    return <Text align="center" mt="xl" color="dimmed">No logs found for the selected time range.</Text>;
  }

  return (
    <ScrollArea style={{ height: 'calc(100vh - 250px)' }} mt="md">
      {filteredLogs.map((log) => (
        <LogEntry
          key={log.id}
          log={log}
          expanded={!!expandedLogs[log.id]}
          toggleExpand={() => toggleExpand(log.id)}
        />
      ))}
    </ScrollArea>
  );
};

const TimeNavigation = ({ onChange, value, setStartDate, setEndDate, currentStartDate, currentEndDate }) => {
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(currentStartDate);
  const [customEnd, setCustomEnd] = useState(currentEndDate);

  useEffect(() => {
    setCustomStart(currentStartDate);
    setCustomEnd(currentEndDate);
  }, [currentStartDate, currentEndDate]);

  const jumpToTimepoint = (minutes) => {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000);
    setStartDate(start);
    setEndDate(end);
    onChange(minutes.toString());
    setShowCustomRange(false);
  };

  const handleApplyCustomRange = () => {
    if (customStart && customEnd && customStart < customEnd) {
      setStartDate(customStart);
      setEndDate(customEnd);
      onChange('Custom');
      setShowCustomRange(false);
    }
  };

  const formatRangeLabel = (rangeValue) => {
    if (rangeValue === 'Custom') return "Custom Range";
    const minutes = parseInt(rangeValue, 10);
    if (isNaN(minutes)) return "Time Range";
    if (minutes < 60) return `Last ${minutes}m`;
    if (minutes === 60) return "Last 1h";
    return `Last ${minutes / 60}h`;
  };

  return (
    <Group spacing="xs">
      <Menu shadow="md" width={220} position="bottom-end" closeOnItemClick={false}>
        <Menu.Target>
          <Button
            variant="default"
            size="xs"
            leftSection={<IconClock size={16} />}
            rightSection={<IconChevronDown size={14} />}
          >
            {formatRangeLabel(value)}
          </Button>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>Quick Ranges</Menu.Label>
          <Menu.Item onClick={() => jumpToTimepoint(5)} closeMenuOnClick>Last 5 minutes</Menu.Item>
          <Menu.Item onClick={() => jumpToTimepoint(15)} closeMenuOnClick>Last 15 minutes</Menu.Item>
          <Menu.Item onClick={() => jumpToTimepoint(30)} closeMenuOnClick>Last 30 minutes</Menu.Item>
          <Menu.Item onClick={() => jumpToTimepoint(60)} closeMenuOnClick>Last 1 hour</Menu.Item>
          <Menu.Item onClick={() => jumpToTimepoint(180)} closeMenuOnClick>Last 3 hours</Menu.Item>
          <Menu.Item onClick={() => jumpToTimepoint(360)} closeMenuOnClick>Last 6 hours</Menu.Item>
          <Menu.Divider />
          <Menu.Item onClick={() => setShowCustomRange(s => !s)}>
            {showCustomRange ? 'Hide Custom Range' : 'Custom Range...'}
          </Menu.Item>

          {showCustomRange && (
            <Box p="xs" mt="xs">
              <DateTimePicker
                label="Start time"
                value={customStart}
                onChange={setCustomStart}
                size="xs"
                clearable={false}
                maxDate={customEnd || new Date()}
                mb="xs"
              />
              <DateTimePicker
                label="End time"
                value={customEnd}
                onChange={setCustomEnd}
                size="xs"
                clearable={false}
                minDate={customStart}
                maxDate={new Date()}
                mb="md"
              />
              <Button
                size="xs"
                fullWidth
                onClick={handleApplyCustomRange}
                disabled={!customStart || !customEnd || customStart >= customEnd}
              >
                Apply Range
              </Button>
            </Box>
          )}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
};

const LogSummary = ({ logs }) => {
  if (!logs || logs.length === 0) return null;

  const totalRequests = logs.reduce((sum, logGroup) => sum + logGroup.count, 0);

  const statusCounts = logs.reduce((acc, logGroup) => {
    const code = logGroup.http_status_code;
    if (code === null || code === undefined) {
      acc.na = (acc.na || 0) + logGroup.count;
    } else {
      const statusFamily = Math.floor(parseInt(code, 10) / 100);
      if (!isNaN(statusFamily) && statusFamily >= 1 && statusFamily <= 5) {
        acc[statusFamily] = (acc[statusFamily] || 0) + logGroup.count;
      } else {
        acc.other = (acc.other || 0) + logGroup.count;
      }
    }
    return acc;
  }, {});

  let totalResponseTime = 0;
  let validResponseCount = 0;
  logs.forEach(logGroup => {
    logGroup.items.forEach(item => {
      if (item.response_secs !== null && !isNaN(parseFloat(item.response_secs))) {
        totalResponseTime += parseFloat(item.response_secs);
        validResponseCount++;
      }
    });
  });
  const avgResponseTime = validResponseCount > 0 ? totalResponseTime / validResponseCount : 0;

  return (
    <Flex gap="md" mb="md" wrap="wrap">
      <Card withBorder p="xs" shadow="xs">
        <Text size="xs" color="dimmed">Total Requests</Text>
        <Text size="lg" weight={700}>{totalRequests}</Text>
      </Card>

      {[2, 3, 4, 5, 'na', 'other'].map(statusKey => {
        const count = statusCounts[statusKey];
        if (!count) return null;

        const label = statusKey === 'na' ? 'N/A Status' :
                     statusKey === 'other' ? 'Other Status' :
                     `${statusKey}xx Responses`;
        const color = statusKey === 'na' ? 'gray' :
                     statusKey === 'other' ? 'dark' :
                     getStatusColor(statusKey * 100);

        return (
          <Card
            key={statusKey}
            withBorder
            p="xs"
            shadow="xs"
            style={{ borderLeft: `3px solid var(--mantine-color-${color}-6)` }}
          >
            <Text size="xs" color="dimmed">{label}</Text>
            <Text size="lg" weight={700}>{count}</Text>
          </Card>
        );
      })}

      <Card withBorder p="xs" shadow="xs">
        <Text size="xs" color="dimmed">Avg Response</Text>
        <Text size="lg" weight={700} color={getResponseTimeColor(avgResponseTime)}>
          {validResponseCount > 0 ? `${(avgResponseTime * 1000).toFixed(1)}ms` : 'N/A'}
        </Text>
      </Card>
    </Flex>
  );
};

// Main LogViewer component
const LogViewer = ({
  hostname,
  showHostnameSelector = false,
  apiBasePath = '/api/loki/proxy',
  containerProps = {},
  onError = null
}) => {
  const [hostnames, setHostnames] = useState([]);
  const [selectedHostname, setSelectedHostname] = useState(hostname);
  const [loading, setLoading] = useState(false);
  const [loadingHostnames, setLoadingHostnames] = useState(showHostnameSelector);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [filterValue, setFilterValue] = useState('');
  const [timeRange, setTimeRange] = useState('15');

  const [endDate, setEndDate] = useState(new Date());
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - 15);
    return date;
  });

  // Update selected hostname when prop changes
  useEffect(() => {
    setSelectedHostname(hostname);
  }, [hostname]);

  const fetchHostnames = useCallback(async () => {
    if (!showHostnameSelector) return;

    setLoadingHostnames(true);
    setError(null);

    try {
      const response = await fetch(`${apiBasePath}?path=/loki/api/v1/label/hostname/values`);

      if (!response.ok) {
        throw new Error(`Error fetching hostnames: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data && data.status === 'success' && Array.isArray(data.data)) {
        const hostnameOptions = data.data
          .sort()
          .map(hostname => ({ value: hostname, label: hostname }));
        setHostnames(hostnameOptions);
      } else {
        throw new Error('Invalid data format received for hostnames');
      }
    } catch (err) {
      console.error('Failed to fetch hostnames:', err);
      setError(`Failed to fetch hostnames: ${err.message}.`);
      if (onError) onError(err);
      setHostnames([]);
    } finally {
      setLoadingHostnames(false);
    }
  }, [showHostnameSelector, apiBasePath, onError]);

  const fetchLogs = useCallback(async () => {
    if (!selectedHostname) return;

    setLoading(true);
    setError(null);

    try {
      const query = `{hostname="${selectedHostname}", app="revproxy"} |= "gen3log" | json | http_useragent !~ "Uptime-Kuma.*" | __error__="" | http_useragent != "ELB-HealthChecker/2.0" | http_useragent != "kube-probe/1.31+" | http_request != "/metrics"`;

      const startNs = startDate.getTime() * 1e6;
      const endNs = endDate.getTime() * 1e6;
      const limit = 1000;

      const queryParams = new URLSearchParams({
        query: query,
        start: startNs.toString(),
        end: endNs.toString(),
        limit: limit.toString(),
        direction: 'backward',
      });

      const apiUrl = `${apiBasePath}?path=/loki/api/v1/query_range&${queryParams.toString()}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Loki API Error Response:', errorText);
        throw new Error(`Loki API Error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      const data = await response.json();

      if (data.status !== 'success') {
        throw new Error(`Loki query failed: ${JSON.stringify(data)}`);
      }

      if (data.data.resultType !== 'streams') {
        throw new Error(`Unexpected Loki result type: ${data.data.resultType}`);
      }

      let processedLogs = [];
      data.data.result.forEach(stream => {
        stream.values.forEach(([timestampNs, logLine]) => {
          try {
            const logData = JSON.parse(logLine);
            const timestampMs = parseInt(timestampNs, 10) / 1e6;

            processedLogs.push({
              timestamp: timestampMs,
              http_verb: logData.http_verb || null,
              http_request: logData.http_request || null,
              http_status_code: logData.http_status_code ? parseInt(logData.http_status_code, 10) : null,
              response_secs: logData.response_secs ? parseFloat(logData.response_secs) : null,
              user_id: logData.user_id || null,
              network_client_ip: logData.network_client_ip || null,
              proxy_service: logData.proxy_service || null,
              http_useragent: logData.http_useragent || null,
            });
          } catch (parseError) {
            console.warn('Failed to parse log line JSON:', logLine, parseError);
          }
        });
      });

      setLogs(processedLogs);
      setError(null);

    } catch (err) {
      console.error('Failed to fetch or process logs:', err);
      const errorMessage = `Failed to retrieve logs: ${err.message}`;
      setError(errorMessage);
      if (onError) onError(err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [selectedHostname, startDate, endDate, apiBasePath, onError]);

  useEffect(() => {
    if (showHostnameSelector) {
      fetchHostnames();
    }
  }, [fetchHostnames, showHostnameSelector]);

  useEffect(() => {
    if (selectedHostname) {
      fetchLogs();
    } else {
      setLogs([]);
    }
  }, [selectedHostname, startDate, endDate, fetchLogs]);

  const handleRefresh = () => {
    if (selectedHostname) {
      fetchLogs();
    }
  };

  const handleFilterChange = (event) => {
    setFilterValue(event.currentTarget.value);
  };

  const handleTimeRangeChange = (newValue) => {
    setTimeRange(newValue);
  };

  const groupedLogsForDisplay = useMemo(() => groupSimilarLogs(logs), [logs]);

  return (
    <Container fluid p="md" {...containerProps}>
      {/* Header Section */}
      <Flex justify="space-between" align="center" mb="md" wrap="wrap" gap="md">
        <Group>
          {showHostnameSelector && (
            <Select
              label="Hostname"
              placeholder={loadingHostnames ? "Loading..." : "Select hostname"}
              data={hostnames}
              value={selectedHostname}
              onChange={setSelectedHostname}
              searchable
              clearable
              nothingFoundMessage="No hostnames found"
              disabled={loadingHostnames}
              style={{ minWidth: '250px' }}
              icon={loadingHostnames ? <Loader size="xs" /> : undefined}
            />
          )}
          {!showHostnameSelector && selectedHostname && (
            <Text size="lg" weight={500}>Logs for: {selectedHostname}</Text>
          )}
        </Group>

        <Group spacing="sm">
          <TimeNavigation
            value={timeRange}
            onChange={handleTimeRangeChange}
            setStartDate={setStartDate}
            setEndDate={setEndDate}
            currentStartDate={startDate}
            currentEndDate={endDate}
          />
          <Tooltip label="Refresh Logs" openDelay={500}>
            <ActionIcon
              variant="default"
              onClick={handleRefresh}
              disabled={!selectedHostname || loading}
              loading={loading && logs.length > 0}
              size="lg"
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Flex>

      {/* Filter Input */}
      {selectedHostname && (
        <Flex justify="space-between" align="center" mb="md">
          <TextInput
            placeholder="Filter logs (by path, IP, user, status, etc...)"
            icon={<IconFilter size={16} />}
            value={filterValue}
            onChange={handleFilterChange}
            style={{ flexGrow: 1, maxWidth: '600px' }}
            rightSection={
              filterValue ? (
                <ActionIcon onClick={() => setFilterValue('')}>
                  <IconX size={14} />
                </ActionIcon>
              ) : null
            }
          />
        </Flex>
      )}

      {/* Error Alert */}
      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="red"
          withCloseButton
          onClose={() => setError(null)}
          mb="md"
        >
          {error}
        </Alert>
      )}

      {/* Main Content Area */}
      {selectedHostname ? (
        <>
          {loading && logs.length === 0 && !error && (
            <Flex justify="center" align="center" style={{ height: '50vh' }}>
              <Loader />
              <Text ml="sm">Loading logs...</Text>
            </Flex>
          )}

          {(!loading || logs.length > 0) && <LogSummary logs={groupedLogsForDisplay} />}

          {(!loading || logs.length > 0) && !error ? (
            <LogList logs={logs} filter={filterValue} />
          ) : (
            !loading && logs.length === 0 && !error && (
              <Text align="center" mt="xl" color="dimmed">
                No logs found for the selected hostname and time range.
              </Text>
            )
          )}
        </>
      ) : (
        !loadingHostnames && (!showHostnameSelector || hostnames.length > 0) && (
          <Text align="center" mt="xl" color="dimmed">
            {showHostnameSelector ? 'Please select a hostname to view logs.' : 'No hostname provided.'}
          </Text>
        )
      )}

      {!loadingHostnames && showHostnameSelector && hostnames.length === 0 && !error && (
        <Text align="center" mt="xl" color="dimmed">
          No hostnames available or failed to load hostnames.
        </Text>
      )}
    </Container>
  );
};

export default LogViewer;
