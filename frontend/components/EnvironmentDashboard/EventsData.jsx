import React from "react";
import {
  Group,
  Card,
  Title,
  Text,
  ScrollArea,
  Stack,
  Box,
  Badge,
  Tooltip,
  ActionIcon,
  Divider,
  ThemeIcon,
  Flex,
  Paper,
  useMantineTheme,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconClock,
  IconRefresh,
  IconInfoCircle,
  IconExclamationMark,
  IconX,
} from "@tabler/icons-react";

// Enhanced calculateAge function with more precise time calculations
const calculateAge = (timestamp) => {
  if (!timestamp) return "Unknown";

  const now = new Date();
  const eventTime = new Date(timestamp);
  const diffMs = now - eventTime;

  if (diffMs < 0) return "Just now";

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return eventTime.toLocaleDateString();
};

// Get event severity and styling
const getEventSeverity = (event) => {
  const type = event.type?.toLowerCase();
  const reason = event.reason?.toLowerCase();

  if (
    type === "warning" ||
    reason?.includes("fail") ||
    reason?.includes("error")
  ) {
    return { level: "warning", color: "orange", icon: IconAlertCircle };
  }

  if (type === "normal") {
    if (
      reason?.includes("creat") ||
      reason?.includes("start") ||
      reason?.includes("provision")
    ) {
      return { level: "success", color: "green", icon: IconCircleCheck };
    }
    return { level: "info", color: "blue", icon: IconInfoCircle };
  }

  return { level: "error", color: "red", icon: IconExclamationMark };
};

// Get background color based on event type and theme
const getEventBackground = (event, theme, isDark) => {
  const severity = getEventSeverity(event);

  if (isDark) {
    switch (severity.level) {
      case "warning":
        return theme.colors.dark[6];
      case "error":
        return theme.colors.dark[7];
      case "success":
        return theme.colors.dark[5];
      case "info":
        return theme.colors.dark[5];
      default:
        return theme.colors.dark[6];
    }
  }

  switch (severity.level) {
    case "warning":
      return theme.colors.yellow[0];
    case "error":
      return theme.colors.red[0];
    case "success":
      return theme.colors.green[0];
    case "info":
      return theme.colors.blue[0];
    default:
      return theme.colors.gray[0];
  }
};

// Get border color based on theme
const getEventBorderColor = (theme, isDark) => {
  return isDark ? theme.colors.dark[4] : theme.colors.gray[3];
};

// Format resource name for better display
const formatResourceName = (involvedObject) => {
  if (!involvedObject) return "Unknown Resource";

  const { kind, name, namespace } = involvedObject;
  const displayName = name?.length > 40 ? `${name.substring(0, 40)}...` : name;

  return namespace && namespace !== "default"
    ? `${kind}/${displayName} (${namespace})`
    : `${kind}/${displayName}`;
};

const EventCard = ({ event, showNamespace = false }) => {
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';
  const severity = getEventSeverity(event);
  const IconComponent = severity.icon;
  const timestamp =
    event.lastTimestamp || event.firstTimestamp || event.eventTime;

  return (
    <Paper
      p="sm"
      style={{
        border: `1px solid ${getEventBorderColor(theme, isDark)}`,
        borderRadius: theme.radius.md,
        backgroundColor: getEventBackground(event, theme, isDark),
        transition: 'background-color 150ms ease',
      }}
    >
      <Group align="flex-start" gap="sm">
        <ThemeIcon
          size="sm"
          variant={isDark ? 'filled' : 'light'}
          color={severity.color}
          style={{ marginTop: 2 }}
        >
          <IconComponent size={14} />
        </ThemeIcon>

        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" align="flex-start" mb={4}>
            <Text fw={500} size="sm" style={{ wordBreak: "break-word" }}>
              {formatResourceName(event.involvedObject)}
            </Text>
          </Group>
          <Badge
            size="xs"
            variant={isDark ? 'filled' : 'light'}
            color={severity.color}
            style={{ flexShrink: 0 }}
          >
            {event.reason || event.type}
          </Badge>

          <Text 
            size="xs" 
            color={isDark ? theme.colors.gray[5] : 'dimmed'} 
            mb={6} 
            my={10} 
            style={{ wordBreak: "break-word", fontFamily: 'monospace' }}
          >
            {event.message}
          </Text>

          <Group gap="xs" align="center">
            <IconClock size={12} color={isDark ? theme.colors.gray[6] : undefined} />
            <Text size="xs" color={isDark ? theme.colors.gray[6] : 'dimmed'}>
              {calculateAge(timestamp)}
            </Text>
            {event.count && event.count > 1 && (
              <>
                <Text size="xs" color={isDark ? theme.colors.gray[6] : 'dimmed'}>
                  •
                </Text>
                <Tooltip label="Event count">
                  <Text size="xs" color={isDark ? theme.colors.gray[6] : 'dimmed'} fw={500}>
                    {event.count}x
                  </Text>
                </Tooltip>
              </>
            )}
            {event.involvedObject?.namespace &&
              event.involvedObject.namespace !== "default" &&
              showNamespace && (
                <>
                  <Text size="xs" color={isDark ? theme.colors.gray[6] : 'dimmed'}>
                    •
                  </Text>
                  <Badge 
                    size="xs" 
                    variant={isDark ? 'filled' : 'outline'} 
                    color={isDark ? 'gray' : 'gray'}
                  >
                    {event.involvedObject.namespace}
                  </Badge>
                </>
              )}
          </Group>
        </Box>
      </Group>
    </Paper>
  );
};

const EventsCards = ({ eventsData, onRefresh }) => {
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  // Separate and sort events
  const warningEvents =
    eventsData?.items
      ?.filter((event) => {
        const severity = getEventSeverity(event);
        return severity.level === "warning" || severity.level === "error";
      })
      .sort((a, b) => {
        const timeA = new Date(
          a.lastTimestamp || a.firstTimestamp || a.eventTime || 0
        );
        const timeB = new Date(
          b.lastTimestamp || b.firstTimestamp || b.eventTime || 0
        );
        return timeB - timeA;
      }) || [];

  const allEvents =
    eventsData?.items?.sort((a, b) => {
      const timeA = new Date(
        a.lastTimestamp || a.firstTimestamp || a.eventTime || 0
      );
      const timeB = new Date(
        b.lastTimestamp || b.firstTimestamp || b.eventTime || 0
      );
      return timeB - timeA;
    }) || [];

  const warningCount = warningEvents.length;
  const totalCount = allEvents.length;

  return (
    <Group align="flex-start" gap="md" mb="xl" grow>
      {/* Active Alerts Card */}
      <Card withBorder shadow="sm">
        <Group justify="space-between" align="center" mb="sm">
          <div>
            <Title order={4}>
              Active Alerts
              {warningCount > 0 && (
                <Badge 
                  size="sm" 
                  color="orange" 
                  variant={isDark ? 'light' : 'filled'} 
                  ml="xs"
                >
                  {warningCount}
                </Badge>
              )}
            </Title>
            <Text color={isDark ? theme.colors.gray[6] : 'dimmed'} size="sm">
              Critical warnings and errors requiring attention
            </Text>
          </div>
          {onRefresh && (
            <Tooltip label="Refresh events">
              <ActionIcon 
                variant="subtle" 
                onClick={onRefresh}
                color={isDark ? 'gray' : undefined}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        <Divider mb="sm" color={isDark ? theme.colors.dark[5] : undefined} />

        <ScrollArea h={400}>
          <Stack gap="sm">
            {warningEvents.length > 0 ? (
              warningEvents
                .slice(0, 10)
                .map((event, index) => (
                  <EventCard
                    key={`warning-${index}`}
                    event={event}
                    showNamespace
                  />
                ))
            ) : (
              <Paper
                p="md"
                style={{ 
                  textAlign: "center", 
                  backgroundColor: isDark ? theme.colors.dark[5] : theme.colors.green[0],
                  border: `1px solid ${isDark ? theme.colors.dark[4] : theme.colors.green[2]}`,
                }}
              >
                <ThemeIcon
                  size="lg"
                  variant={isDark ? 'filled' : 'light'}
                  color="green"
                  mx="auto"
                  mb="xs"
                >
                  <IconCircleCheck size={20} />
                </ThemeIcon>
                <Text color={isDark ? theme.colors.green[4] : 'green'} fw={500}>
                  All systems operational
                </Text>
                <Text color={isDark ? theme.colors.dark[2] : 'dimmed'} size="sm">
                  No active alerts or warnings
                </Text>
              </Paper>
            )}
          </Stack>
        </ScrollArea>
      </Card>

      {/* Recent Events Card */}
      <Card withBorder shadow="sm">
        <Group justify="space-between" align="center" mb="sm">
          <div>
            <Title order={4}>
              Recent Events
              {totalCount > 0 && (
                <Badge 
                  size="sm" 
                  color="blue" 
                  variant={isDark ? 'light' : 'light'} 
                  ml="xs"
                >
                  {totalCount}
                </Badge>
              )}
            </Title>
            <Text color={isDark ? theme.colors.gray[6] : 'dimmed'} size="sm">
              Latest cluster activities and system events
            </Text>
          </div>
        </Group>

        <Divider mb="sm" color={isDark ? theme.colors.dark[5] : undefined} />

        <ScrollArea h={400} style={{ paddingRight: '1rem' }}>
          <Stack gap="sm">
            {allEvents.length > 0 ? (
              allEvents
                .slice(0, 12)
                .map((event, index) => (
                  <EventCard key={`recent-${index}`} event={event} />
                ))
            ) : (
              <Paper 
                p="md" 
                style={{ 
                  textAlign: "center",
                  backgroundColor: isDark ? theme.colors.dark[6] : theme.white,
                  border: `1px solid ${isDark ? theme.colors.dark[4] : theme.colors.gray[2]}`,
                }}
              >
                <ThemeIcon
                  size="lg"
                  variant={isDark ? 'filled' : 'light'}
                  color="gray"
                  mx="auto"
                  mb="xs"
                >
                  <IconInfoCircle size={20} />
                </ThemeIcon>
                <Text color={isDark ? theme.colors.dark[2] : 'dimmed'}>
                  No recent events
                </Text>
                <Text color={isDark ? theme.colors.dark[3] : 'dimmed'} size="sm">
                  Events will appear here as they occur
                </Text>
              </Paper>
            )}
          </Stack>
        </ScrollArea>
      </Card>
    </Group>
  );
};

export default EventsCards;