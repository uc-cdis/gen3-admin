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
  // Button // Not used, remove if not needed
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconRefresh, IconClock, IconX, IconFilter, IconChevronDown, IconChevronRight, IconArrowRight, IconAlertCircle } from '@tabler/icons-react';

// Time formatting utility
const formatTimeAgo = (timestamp) => {
  const now = new Date();
  const time = new Date(timestamp);
  const diffSeconds = Math.floor((now.getTime() - time.getTime()) / 1000); // Use getTime() for reliable difference

  if (diffSeconds < 1) return 'just now'; // Handle very recent times
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  // For older logs, show date and time for clarity
  return time.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// Get color based on HTTP status code
const getStatusColor = (code) => {
  if (code === null || code === undefined) return 'gray'; // Handle null/undefined status
  const statusInt = parseInt(code, 10);
  if (isNaN(statusInt)) return 'gray';
  if (statusInt < 300) return 'green';
  if (statusInt < 400) return 'yellow';
  if (statusInt < 500) return 'red';
  return 'grape'; // 5xx errors
};

// Get color based on response time (in seconds)
const getResponseTimeColor = (time) => {
  if (time === null || time === undefined) return 'gray';
  const timeFloat = parseFloat(time);
  if (isNaN(timeFloat)) return 'gray';
  if (timeFloat < 0.1) return 'teal'; // Faster response color
  if (timeFloat < 0.5) return 'green';
  if (timeFloat < 1.0) return 'yellow';
  if (timeFloat < 3.0) return 'orange';
  return 'red'; // Slowest response color
};

// Calculate width for response time indicator (adjust scale for better visibility)
const getResponseTimeWidth = (time) => {
  if (time === null || time === undefined) return 5;
  const timeFloat = parseFloat(time);
  if (isNaN(timeFloat)) return 5;
  // Scale logarithmically or use defined steps for better visual differentiation
  if (timeFloat < 0.05) return 5;
  if (timeFloat < 0.1) return 10;
  if (timeFloat < 0.3) return 20;
  if (timeFloat < 0.7) return 35;
  if (timeFloat < 1.5) return 50;
  if (timeFloat < 3.0) return 70;
  return 90; // Max width
};


// Group similar log entries
const groupSimilarLogs = (logs) => {
  const groups = {};
  const result = [];

  logs.forEach((log, index) => { // Add index for unique key generation later if needed
    // Create a group key based on http_verb, http_request, and http_status_code
    // Use 'N/A' or consistent placeholders for missing values
    const verb = log.http_verb || 'N/A';
    const request = log.http_request || 'N/A';
    const status = log.http_status_code !== null ? log.http_status_code : 'N/A';
    const key = `${verb}-${request}-${status}`;

    if (!groups[key]) {
      groups[key] = {
        ...log, // Use the first log encountered as the representative
        id: `${log.timestamp}-${index}`, // Create a unique ID for the group head
        count: 1,
        items: [log], // Store all logs belonging to this group
        firstTimestamp: log.timestamp, // Keep track of the first occurrence
        lastTimestamp: log.timestamp,  // And the last occurrence
      };
      result.push(groups[key]);
    } else {
      groups[key].count += 1;
      groups[key].items.push(log);
      // Update representative log to the latest one (or keep the first one)
      // Let's keep the latest one for the main display timestamp
      if (log.timestamp > groups[key].timestamp) {
          groups[key].timestamp = log.timestamp; // Update displayed timestamp to latest
          groups[key].response_secs = log.response_secs; // Update displayed response time to latest
          // Note: Other fields like user_id might differ, decide how to represent this.
          // Current implementation shows details of the *latest* log in the collapsed view.
      }
      // Update lastTimestamp
      groups[key].lastTimestamp = Math.max(groups[key].lastTimestamp, log.timestamp);
      // Keep firstTimestamp as is
    }
  });

  // Sort groups by the timestamp of the latest log within each group (descending)
  result.sort((a, b) => b.timestamp - a.timestamp);

  return result;
};

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
        <ActionIcon size="xs" variant="subtle" mr={4}> {/* Added margin */}
          {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        </ActionIcon>

        {/* Use Tooltip for exact time on hover */}
        <Tooltip label={new Date(log.timestamp).toLocaleString()} position="top-start" openDelay={500}>
             <Text size="xs" style={{ width: '70px', whiteSpace: 'nowrap', textAlign: 'right' }} mr="sm"> {/* Right align time */}
                {formatTimeAgo(log.timestamp)}
             </Text>
        </Tooltip>

        {log.count > 1 && (
          <Tooltip label={`First: ${formatTimeAgo(log.firstTimestamp)}, Last: ${formatTimeAgo(log.lastTimestamp)}`} position="top" openDelay={300}>
            <Badge size="sm" variant="light" color="blue" mr="xs" style={{ minWidth: 45, textAlign: 'center' }}> {/* Ensure badge width */}
              {log.count}x
            </Badge>
          </Tooltip>
        )}

        <Badge size="sm" variant="filled" color={statusColor} style={{ minWidth: '40px', textAlign: 'center' }}>
          {log.http_status_code !== null ? log.http_status_code : 'N/A'}
        </Badge>

        <Tooltip label={log.response_secs !== null ? `${(log.response_secs * 1000).toFixed(1)}ms` : 'N/A'} position="top" openDelay={300}>
            <Box
              style={{
                width: `${responseTimeWidth}px`,
                height: '6px',
                backgroundColor: responseTimeColor, // Use backgroundColor
                marginRight: '8px',
                borderRadius: '3px',
                flexShrink: 0 // Prevent shrinking
              }}
            />
        </Tooltip>

        <Text size="xs" style={{ minWidth: '45px', textAlign: 'right' }} ml="xs">
          {log.user_id || '/'}
        </Text>

        <Text size="xs" color="dimmed" style={{ minWidth: '45px', textAlign: 'right' }}> {/* Right align verb */}
          {log.http_verb || 'GET'}
        </Text>
        
        <Text size="xs" style={{ minWidth: '45px', textAlign: 'right' }} ml="xs">
          {log.http_request || '/'}
        </Text>

        <Text size="xs" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} ml="xs">
          {log.proxy_service || '/'}
        </Text>

        
      </Flex>

      <Collapse in={expanded}>
        <Box mt="xs" pl={38}> {/* Indent details to align with content after icon+time */}
          <Divider my="xs" />
          {/* Display details of the representative log (latest in the group) */}
          <Text size="xs"><b>Time:</b> {new Date(log.timestamp).toLocaleString()}</Text>
          {log.user_id && <Text size="xs"><b>User ID:</b> {log.user_id}</Text>}
          {log.network_client_ip && <Text size="xs"><b>Client IP:</b> {log.network_client_ip}</Text>}
          <Text size="xs"><b>Response Time:</b> {log.response_secs !== null ? `${(log.response_secs * 1000).toFixed(1)}ms` : 'N/A'}</Text>
          {log.proxy_service && <Text size="xs"><b>Service:</b> {log.proxy_service}</Text>}
          {log.http_useragent && <Text size="xs" style={{ wordBreak: 'break-all' }}><b>User Agent:</b> {log.http_useragent}</Text>}

          {log.count > 1 && (
            <>
              <Divider my="xs" label={`Older occurrences (${log.count -1})`} labelPosition="center" />
              {/* Display older items, limit height */}
              <ScrollArea style={{ maxHeight: '150px' }}>
                {/* Show items excluding the representative one, sorted newest first */}
                {log.items
                   .filter(item => item.timestamp !== log.timestamp) // Exclude the representative item shown above
                   .sort((a, b) => b.timestamp - a.timestamp) // Sort remaining items newest first
                   .map((item, idx) => (
                      <Text key={idx} size="xs" mb={2} color="dimmed"> {/* Dim older entries */}
                         {new Date(item.timestamp).toLocaleTimeString()} - {item.http_verb} {item.http_request} ({item.response_secs !== null ? `${(item.response_secs * 1000).toFixed(0)}ms` : 'N/A'})
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
    setExpandedLogs(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Group similar logs - useMemo ensures this runs only when logs change
  const groupedLogs = useMemo(() => groupSimilarLogs(logs), [logs]);

  // Filter logs - useMemo ensures this runs only when groupedLogs or filter change
  const filteredLogs = useMemo(() => {
    if (!filter) return groupedLogs;

    const searchStr = filter.toLowerCase();

    return groupedLogs.filter(logGroup => {
      // Check the representative log first
      const representativeMatch = (
        (logGroup.http_request && logGroup.http_request.toLowerCase().includes(searchStr)) ||
        (logGroup.user_id && logGroup.user_id.toLowerCase().includes(searchStr)) ||
        (logGroup.http_useragent && logGroup.http_useragent.toLowerCase().includes(searchStr)) ||
        (logGroup.network_client_ip && logGroup.network_client_ip.toLowerCase().includes(searchStr)) ||
        (logGroup.proxy_service && logGroup.proxy_service.toLowerCase().includes(searchStr)) ||
        (logGroup.http_status_code !== null && logGroup.http_status_code.toString().includes(searchStr)) || // Allow filtering by status code
        (logGroup.http_verb && logGroup.http_verb.toLowerCase().includes(searchStr)) // Allow filtering by verb
      );

      if (representativeMatch) return true;

      // If representative doesn't match, check if any item *within* the group matches
      // This is useful if the representative item (e.g., latest) differs from older ones that might match
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

      return false; // No match in representative or items
    });
  }, [groupedLogs, filter]);

  if (filteredLogs.length === 0 && groupedLogs.length > 0) {
     return <Text align="center" mt="xl" color="dimmed">No logs match your filter.</Text>;
  }
  
  if (filteredLogs.length === 0) {
    return <Text align="center" mt="xl" color="dimmed">No logs found for the selected time range.</Text>;
  }

  // Adjust scroll area height - consider header, filter, summary heights
  // Approx heights: Header (60px) + Filter (50px) + Summary (70px) + Margins (30px) = ~210px
  // Subtract this from viewport height for the scroll area.
  return (
    <ScrollArea style={{ height: 'calc(100vh - 250px)' }} mt="md">
      {filteredLogs.map((log) => (
        <LogEntry
          key={log.id} // Use the unique ID generated during grouping
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

  // State for custom range pickers, initialized from props
  const [customStart, setCustomStart] = useState(currentStartDate);
  const [customEnd, setCustomEnd] = useState(currentEndDate);

  // Update local state if external dates change (e.g., quick range selected)
  useEffect(() => {
    setCustomStart(currentStartDate);
    setCustomEnd(currentEndDate);
  }, [currentStartDate, currentEndDate]);

  const jumpToTimepoint = (minutes) => {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000); // Calculate start time
    setStartDate(start);
    setEndDate(end);
    onChange(minutes.toString()); // Update the label (e.g., "15")
    setShowCustomRange(false); // Hide custom range if open
  };

  const handleApplyCustomRange = () => {
      if (customStart && customEnd && customStart < customEnd) {
          setStartDate(customStart);
          setEndDate(customEnd);
          onChange('Custom'); // Update label to indicate custom range
          setShowCustomRange(false); // Close picker after applying
      } else {
          // Maybe show an error if dates are invalid
          console.warn("Invalid custom date range selected.");
      }
  };

  const formatRangeLabel = (rangeValue) => {
      if (rangeValue === 'Custom') return "Custom Range";
      const minutes = parseInt(rangeValue, 10);
      if (isNaN(minutes)) return "Time Range"; // Default/fallback
      if (minutes < 60) return `Last ${minutes}m`;
      if (minutes === 60) return "Last 1h";
      return `Last ${minutes / 60}h`;
  }

  return (
    <Group spacing="xs">
      <Menu shadow="md" width={220} position="bottom-end" closeOnItemClick={false}>
        <Menu.Target>
          <Button variant="default" size="xs" leftSection={<IconClock size={16} />} rightSection={<IconChevronDown size={14} />}>
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
                      maxDate={customEnd || new Date()} // Prevent start date being after end date
                      mb="xs"
                  />
                  <DateTimePicker
                      label="End time"
                      value={customEnd}
                      onChange={setCustomEnd}
                      size="xs"
                      clearable={false}
                      minDate={customStart} // Prevent end date being before start date
                      maxDate={new Date()} // Prevent end date being in the future
                      mb="md"
                  />
                  <Button size="xs" fullWidth onClick={handleApplyCustomRange} disabled={!customStart || !customEnd || customStart >= customEnd}>
                      Apply Range
                  </Button>
              </Box>
          )}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
};

const LogSummary = ({ logs }) => { // Expects grouped logs
  if (!logs || logs.length === 0) return null;

  const totalRequests = logs.reduce((sum, logGroup) => sum + logGroup.count, 0);

  // Calculate status counts based on the representative status of each group
  const statusCounts = logs.reduce((acc, logGroup) => {
    const code = logGroup.http_status_code;
    if (code === null || code === undefined) {
        acc.na = (acc.na || 0) + logGroup.count;
    } else {
        const statusFamily = Math.floor(parseInt(code, 10) / 100);
        if (!isNaN(statusFamily) && statusFamily >= 1 && statusFamily <= 5) {
          acc[statusFamily] = (acc[statusFamily] || 0) + logGroup.count;
        } else {
          acc.other = (acc.other || 0) + logGroup.count; // Count unexpected statuses
        }
    }
    return acc;
  }, {});

  // Calculate weighted average response time across all individual log entries
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
    <Flex gap="md" mb="md" wrap="wrap"> {/* Allow wrapping on smaller screens */}
      <Card withBorder p="xs" shadow="xs">
        <Text size="xs" color="dimmed">Total Requests</Text>
        <Text size="lg" weight={700}>{totalRequests}</Text>
      </Card>

      {/* Display status counts - sort them for consistency */}
      {[2, 3, 4, 5, 'na', 'other'].map(statusKey => {
          const count = statusCounts[statusKey];
          if (!count) return null; // Don't display if count is zero

          const label = statusKey === 'na' ? 'N/A Status' : statusKey === 'other' ? 'Other Status' : `${statusKey}xx Responses`;
          const color = statusKey === 'na' ? 'gray' : statusKey === 'other' ? 'dark' : getStatusColor(statusKey * 100);

          return (
              <Card
                  key={statusKey}
                  withBorder
                  p="xs"
                  shadow="xs"
                  style={{
                      borderLeft: `3px solid var(--mantine-color-${color}-6)`, // Use theme color
                  }}
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


const LokiView = () => {
  const [hostnames, setHostnames] = useState([]);
  const [selectedHostname, setSelectedHostname] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingHostnames, setLoadingHostnames] = useState(true); // Separate loading state for hostnames
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [filterValue, setFilterValue] = useState('');
  const [timeRange, setTimeRange] = useState('15'); // Default to 15 minutes, used for label/quick select state

  // State for the actual date range used in queries
  const [endDate, setEndDate] = useState(new Date());
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - 15); // Initial range is last 15 minutes
    return date;
  });

  // Use useCallback for fetch functions to prevent recreation on every render
  const fetchHostnames = useCallback(async () => {
    setLoadingHostnames(true);
    setError(null); // Clear previous errors

    try {
      const response = await fetch('/api/loki/proxy?path=/loki/api/v1/label/hostname/values');

      if (!response.ok) {
        throw new Error(`Error fetching hostnames: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data && data.status === 'success' && Array.isArray(data.data)) {
        const hostnameOptions = data.data
            .sort() // Sort alphabetically
            .map(hostname => ({
                value: hostname,
                label: hostname
            }));
        setHostnames(hostnameOptions);
        // Optionally auto-select the first hostname if none is selected
        // if (!selectedHostname && hostnameOptions.length > 0) {
        //     setSelectedHostname(hostnameOptions[0].value);
        // }
      } else {
        throw new Error('Invalid data format received for hostnames');
      }
    } catch (err) {
      console.error('Failed to fetch hostnames:', err);
      setError(`Failed to fetch hostnames: ${err.message}.`);
      setHostnames([]); // Clear hostnames on error
    } finally {
      setLoadingHostnames(false);
    }
  }, []); // No dependencies, runs once

  const fetchLogs = useCallback(async () => {
    if (!selectedHostname) return;

    setLoading(true);
    setError(null); // Clear previous errors for log fetching
    // Keep existing logs while loading new ones for smoother experience? Or clear?
    // setLogs([]); // Clearing immediately can cause flickering. Update on success.

    try {
      // Loki query - ensure backticks are used correctly if needed by the proxy/API
      // Removed backticks around gen3log as it might not be standard LogQL, assuming it's a keyword filter
      const query = `{hostname="${selectedHostname}", app="revproxy"} |= "gen3log" | json | http_useragent !~ "Uptime-Kuma.*" | __error__="" | http_useragent != "ELB-HealthChecker/2.0" | http_useragent != "kube-probe/1.31+"`;

      // Use nanoseconds for Loki API query_range endpoint
      const startNs = startDate.getTime() * 1e6;
      const endNs = endDate.getTime() * 1e6;
      const limit = 1000; // Set a reasonable limit

      const queryParams = new URLSearchParams({
        query: query,
        start: startNs.toString(),
        end: endNs.toString(),
        limit: limit.toString(),
        direction: 'backward', // Fetch newest logs first within the time range
      });

      const apiUrl = `/api/loki/proxy?path=/loki/api/v1/query_range&${queryParams.toString()}`;
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
            // Convert timestamp from nanoseconds string to milliseconds number for JS Date objects
            const timestampMs = parseInt(timestampNs, 10) / 1e6;

            processedLogs.push({
              timestamp: timestampMs,
              // Safely extract fields, using null for missing values
              http_verb: logData.http_verb || null,
              http_request: logData.http_request || null,
              // Ensure status code is integer or null
              http_status_code: logData.http_status_code ? parseInt(logData.http_status_code, 10) : null,
              // Ensure response time is float or null
              response_secs: logData.response_secs ? parseFloat(logData.response_secs) : null,
              user_id: logData.user_id || null,
              network_client_ip: logData.network_client_ip || null,
              proxy_service: logData.proxy_service || null,
              http_useragent: logData.http_useragent || null,
              // raw_log: logLine // Optionally include raw log for debugging
            });
          } catch (parseError) {
            console.warn('Failed to parse log line JSON:', logLine, parseError);
            // Optionally push a placeholder log entry for unparsable lines
            // processedLogs.push({ timestamp: parseInt(timestampNs, 10) / 1e6, raw_log: logLine, error: 'Parse failed' });
          }
        });
      });

      // Sort logs by timestamp descending (newest first) - should be redundant due to direction=backward
      // processedLogs.sort((a, b) => b.timestamp - a.timestamp);

      setLogs(processedLogs); // Update logs state with new data
      setError(null); // Clear error on success

    } catch (err) {
      console.error('Failed to fetch or process logs:', err);
      setError(`Failed to retrieve logs: ${err.message}. Check console for details.`);
      setLogs([]); // Clear logs on error to avoid showing stale data
    } finally {
      setLoading(false); // Stop loading indicator
    }
  }, [selectedHostname, startDate, endDate]); // Dependencies for fetching logs

  // Fetch hostnames on component mount
  useEffect(() => {
    fetchHostnames();
  }, [fetchHostnames]);

  // Fetch logs when hostname or date range changes
  useEffect(() => {
    if (selectedHostname) {
      fetchLogs();
    } else {
      setLogs([]); // Clear logs if hostname is deselected
    }
  }, [selectedHostname, startDate, endDate, fetchLogs]); // Include fetchLogs in dependencies

  // Handler for the refresh button
  const handleRefresh = () => {
    if (selectedHostname) {
      fetchLogs(); // Manually trigger fetch
    }
  };

  // Handler for the filter input
  const handleFilterChange = (event) => {
    setFilterValue(event.currentTarget.value);
  };

  // Handler for TimeNavigation quick range selection - updates the label
  const handleTimeRangeChange = (newValue) => {
    setTimeRange(newValue);
    // Note: Actual date range update (startDate, endDate) is handled by jumpToTimepoint or custom range application
  };

  // Calculate grouped logs once for summary and list
  const groupedLogsForDisplay = useMemo(() => groupSimilarLogs(logs), [logs]);

  return (
    <Container fluid p="md">
      {/* Header Section */}
      <Flex justify="space-between" align="center" mb="md" wrap="wrap" gap="md">
        <Group>
          <Select
            label="Hostname"
            placeholder={loadingHostnames ? "Loading..." : "Select hostname"}
            data={hostnames}
            value={selectedHostname}
            onChange={setSelectedHostname}
            searchable
            clearable // Allow deselecting
            nothingFoundMessage="No hostnames found"
            disabled={loadingHostnames}
            style={{ minWidth: '250px' }}
            icon={loadingHostnames ? <Loader size="xs" /> : undefined}
          />
        </Group>

        {/* Right aligned controls */}
        <Group spacing="sm">
          <TimeNavigation
            value={timeRange} // Label state (e.g., "15", "Custom")
            onChange={handleTimeRangeChange} // Updates label state
            setStartDate={setStartDate} // Function to update start date
            setEndDate={setEndDate}     // Function to update end date
            currentStartDate={startDate} // Pass current dates for custom picker init
            currentEndDate={endDate}
          />
          <Tooltip label="Refresh Logs" openDelay={500}>
            <ActionIcon
              variant="default"
              onClick={handleRefresh}
              disabled={!selectedHostname || loading} // Disable if no host selected or already loading
              loading={loading && logs.length > 0} // Show loader only when refreshing existing logs
              size="lg" // Make button slightly larger
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Flex>

      {/* Filter Input */}
      {selectedHostname && ( // Only show filter if a hostname is selected
        <Flex justify="space-between" align="center" mb="md">
          <TextInput
            placeholder="Filter logs (by path, IP, user, status, etc...)"
            icon={<IconFilter size={16} />}
            value={filterValue}
            onChange={handleFilterChange}
            style={{ flexGrow: 1, maxWidth: '600px' }} // Allow more width for filter
            rightSection={filterValue ? <ActionIcon onClick={() => setFilterValue('')}><IconX size={14} /></ActionIcon> : null} // Clear button
          />
        </Flex>
      )}

      {/* Error Alert */}
      {error && (
        <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" withCloseButton onClose={() => setError(null)} mb="md">
          {error}
        </Alert>
      )}

      {/* Main Content Area */}
      {selectedHostname ? (
        <>
          {/* Loading indicator for initial load */}
          {loading && logs.length === 0 && !error && (
            <Flex justify="center" align="center" style={{ height: '50vh' }}>
              <Loader />
              <Text ml="sm">Loading logs...</Text>
            </Flex>
          )}

          {/* Log Summary - show even if loading new data, based on previously loaded logs */}
          {!loading || logs.length > 0 ? ( // Render summary if not initial load OR if logs exist
             <LogSummary logs={groupedLogsForDisplay} />
          ) : null}

          {/* Log List - show if logs exist OR if loading (to keep showing old logs while loading) */}
          {(!loading || logs.length > 0) && !error ? (
            <LogList logs={logs} filter={filterValue} />
          ) : (
            // Show specific message if loading finished but no logs found (and no error)
            !loading && logs.length === 0 && !error && (
                <Text align="center" mt="xl" color="dimmed">No logs found for the selected hostname and time range.</Text>
            )
          )}
        </>
      ) : (
         // Message when no hostname is selected
        !loadingHostnames && hostnames.length > 0 && ( // Only show if hostnames finished loading and exist
             <Text align="center" mt="xl" color="dimmed">
                Please select a hostname to view logs.
             </Text>
         )
      )}
       {/* Message if hostname loading failed or no hostnames available */}
       {!loadingHostnames && hostnames.length === 0 && !error && (
           <Text align="center" mt="xl" color="dimmed">
               No hostnames available or failed to load hostnames.
           </Text>
       )}
    </Container>
  );
};

export default LokiView; // Default export