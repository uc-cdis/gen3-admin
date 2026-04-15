"use client";

import {
  Card,
  SimpleGrid,
  Group,
  Text,
  Badge,
  Stack,
  Loader,
  Title,
  Modal,
  Button,
  Divider,
  Tooltip,
  ScrollArea,
  Switch,
  Progress,
  Tabs,
  ThemeIcon,
  Box,
  Anchor,
} from "@mantine/core";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  IconRefresh,
  IconContainer,
  IconPlayerPlay,
  IconClock,
  IconAlertTriangle,
  IconBug,
  IconTerminal,
  IconFileText,
  IconCheck,
  IconLoader,
  IconCircleDot,
} from "@tabler/icons-react";
import callK8sApi from "@/lib/k8s";
import LogWindow from "@/components/Logs/LogWindowAgent";
import dynamic from 'next/dynamic'

const TerminalComponent = dynamic(() => import('@/components/Shell/Terminal'), {
  ssr: false
})

type Service = {
  name: string;
  kind: "Deployment" | "StatefulSet";
  desired: number;
  ready: number;
  updated: number;
  age: string;
  lastTransitionTime?: string;
  images: string[];
  podReason?: string;       // e.g. "CrashLoopBackOff", "ContainerCreating"
  podMessage?: string;     // human-readable detail from the pod status
};

function formatAge(timestamp: string | undefined) {
  if (!timestamp) return "Unknown";
  const diffMin = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  return `${Math.floor(diffMin / 1440)}d`;
}

function formatImageName(fullImage: string) {
  const parts = fullImage.split('/');
  return parts[parts.length - 1];
}

type ContainerStatus = {
  name: string;
  ready: boolean;
  state: string;
  reason?: string;
  restartCount: number;
  isInit?: boolean;
};

type Pod = {
  name: string;
  phase: string;
  containers: ContainerStatus[];
};

type PodEvent = {
  reason: string;
  message: string;
  type: string;
  lastTimestamp: string;
};

function computeStatus(desired: number, ready: number) {
  if (ready === 0) return { status: "down", color: "red", label: "Down" };
  if (ready < desired)
    return { status: "degraded", color: "yellow", label: "Degraded" };
  return { status: "healthy", color: "green", label: "Healthy" };
}

// Classify a pod reason into severity for visual treatment
const TRANSITIONAL_REASONS = new Set([
  "ContainerCreating", "PodInitializing", "Pending", "Waiting",
  "AttachVolume", "Pulling", "Created", "Scheduled",
]);
const WARNING_REASONS = new Set([
  "CrashLoopBackOff", "ImagePullBackOff", "Evicted", "NodeAffinity",
  "Unschedulable", "InsufficientCPU", "InsufficientMemory",
]);

function reasonSeverity(reason?: string): "transitional" | "warning" | "error" {
  if (!reason) return "error";
  const base = reason.split(" ")[0].replace(/[^a-zA-Z]/g, ""); // strip "(N restarts)" etc
  if (TRANSITIONAL_REASONS.has(base)) return "transitional";
  if (WARNING_REASONS.has(base)) return "warning";
  return "error";
}

function statusColor(health: ReturnType<typeof computeStatus>, podReason?: string): string {
  if (health.status === "healthy") return "teal";
  const sev = reasonSeverity(podReason);
  if (sev === "transitional") return "blue";
  if (sev === "warning") return "orange";
  return "red";
}

function buildLabelSelector(matchLabels: Record<string, string>) {
  return Object.entries(matchLabels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

/* ── Single Pod Tabbed Detail View ── */
function SinglePodDetailTabs({
  pod,
  events,
  eventsLoading,
  namespace,
  cluster,
  onRefreshEvents,
  onOpenLogs,
  onOpenShell,
  selectedContainer,
}: {
  pod: Pod;
  events: PodEvent[];
  eventsLoading: boolean;
  namespace: string;
  cluster: string;
  onRefreshEvents: () => void;
  onOpenLogs: (container: string) => void;
  onOpenShell: (container: string) => void;
  selectedContainer: string | null;
}) {
  const initContainers = pod.containers.filter((c) => c.isInit);
  const runningContainers = pod.containers.filter((c) => !c.isInit && c.state === "Running" && c.ready);
  const waitingContainers = pod.containers.filter((c) => !c.isInit && (c.state === "Waiting" || (c.state === "Running" && !c.ready)));
  const terminatedContainers = pod.containers.filter((c) => !c.isInit && c.state === "Terminated");

  const tabs = [
    ...(initContainers.length > 0 ? [{ value: "init", label: "INIT", icon: IconLoader, count: initContainers.length }] : []),
    { value: "ready", label: "Ready", icon: IconCheck, count: runningContainers.length },
    ...(waitingContainers.length > 0 ? [{ value: "waiting", label: "Waiting", icon: IconClock, count: waitingContainers.length }] : []),
    ...(terminatedContainers.length > 0 ? [{ value: "terminated", label: "Terminated", icon: IconAlertTriangle, count: terminatedContainers.length }] : []),
    { value: "events", label: "Events", icon: IconAlertTriangle, count: events.length },
    { value: "logs", label: "Logs", icon: IconFileText },
    { value: "shell", label: "Shell", icon: IconTerminal },
  ];

  return (
    <Tabs defaultValue={runningContainers.length > 0 ? "ready" : tabs[0]?.value ?? "ready"}>
      {/* Pod header row */}
      <Box py="xs" px="md">
        <Group justify="space-between">
          <Group gap="sm">
            <Text fw={600} size="lg">{pod.name}</Text>
            <Badge
              color={
                pod.phase === "Running" ? "green" :
                pod.phase === "Pending" ? "yellow" : "red"
              }
              variant="filled"
              size="lg"
            >
              {pod.phase.toUpperCase()}
            </Badge>
          </Group>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconRefresh size={12} />}
            loading={eventsLoading}
            onClick={onRefreshEvents}
          >
            Refresh Events
          </Button>
        </Group>
      </Box>

      <Tabs.List>
        {tabs.map((tab) => (
          <Tabs.Tab key={tab.value} value={tab.value} leftSection={<tab.icon size={14} />}>
            {tab.label}
            {"count" in tab ? (
              <Badge size="xs" ml={4} variant="filled">{tab.count as number}</Badge>
            ) : null}
          </Tabs.Tab>
        ))}
      </Tabs.List>

      {/* INIT containers */}
      {initContainers.length > 0 && (
        <Tabs.Panel value="init" p="md">
          <Stack gap="sm">
            {initContainers.map((c) => (
              <ContainerRow key={c.name} container={c} onLogs={() => onOpenLogs(c.name)} />
            ))}
          </Stack>
        </Tabs.Panel>
      )}

      {/* Ready / Running containers */}
      <Tabs.Panel value="ready" p="md">
        <Stack gap="sm">
          {runningContainers.length > 0 ? (
            runningContainers.map((c) => (
              <ContainerRow key={c.name} container={c} onLogs={() => onOpenLogs(c.name)} onShell={() => onOpenShell(c.name)} />
            ))
          ) : (
            <Text c="dimmed" ta="center" py="xl">No ready containers</Text>
          )}
        </Stack>
      </Tabs.Panel>

      {/* Waiting containers */}
      {waitingContainers.length > 0 && (
        <Tabs.Panel value="waiting" p="md">
          <Stack gap="sm">
            {waitingContainers.map((c) => (
              <ContainerRow key={c.name} container={c} onLogs={() => onOpenLogs(c.name)} highlight />
            ))}
          </Stack>
        </Tabs.Panel>
      )}

      {/* Terminated containers */}
      {terminatedContainers.length > 0 && (
        <Tabs.Panel value="terminated" p="md">
          <Stack gap="sm">
            {terminatedContainers.map((c) => (
              <ContainerRow key={c.name} container={c} onLogs={() => onOpenLogs(c.name)} />
            ))}
          </Stack>
        </Tabs.Panel>
      )}

      {/* Events timeline */}
      <Tabs.Panel value="events" p="md">
        <Stack gap="sm">
          {events.length > 0 ? (
            events.slice(0, 20).map((e, i) => (
              <EventTimelineItem key={i} event={e} index={i} />
            ))
          ) : eventsLoading ? (
            <Text c="dimmed" ta="center" py="xl"><Loader size="sm" /> Loading events...</Text>
          ) : (
            <Text c="dimmed" ta="center" py="xl">No events recorded</Text>
          )}
        </Stack>
      </Tabs.Panel>

      {/* Logs — opens sub-modal or inline */}
      <Tabs.Panel value="logs" p="md">
        {selectedContainer ? (
          <Box h="60vh">
            <LogWindow namespace={namespace} pod={pod.name} cluster={cluster} containers={[selectedContainer]} />
          </Box>
        ) : (
          <Stack align="center" gap="sm" py="xl">
            <Text c="dimmed">Select a container to view logs</Text>
            {[...initContainers, ...runningContainers, ...waitingContainers, ...terminatedContainers].map((c) => (
              <Button key={c.name} size="xs" variant="subtle" onClick={() => onOpenLogs(c.name)}>
                {c.name}{c.isInit ? " (init)" : ""}
              </Button>
            ))}
          </Stack>
        )}
      </Tabs.Panel>

      {/* Shell — opens sub-modal or inline */}
      <Tabs.Panel value="shell" p="md">
        {selectedContainer ? (
          <Box h="60vh">
            <TerminalComponent namespace={namespace} pod={pod.name} container={selectedContainer} cluster={cluster} />
          </Box>
        ) : (
          <Stack align="center" gap="sm" py="xl">
            <Text c="dimmed">Select a container to open shell</Text>
            {[...runningContainers, ...waitingContainers].filter((c) => !c.isInit).map((c) => (
              <Button key={c.name} size="xs" variant="subtle" onClick={() => onOpenShell(c.name)}>
                {c.name}
              </Button>
            ))}
          </Stack>
        )}
      </Tabs.Panel>
    </Tabs>
  );
}

/* ── Multi-Pod Detail View (pod selector + tabs for selected pod) ── */
function MultiPodDetailView({
  pods,
  podEvents,
  eventsLoading,
  loading,
  namespace,
  cluster,
  selectedPod,
  onSelectPod,
  onRefreshEvents,
  onOpenLogs,
  onOpenShell,
  selectedContainer,
}: {
  pods: Pod[];
  podEvents: Record<string, PodEvent[]>;
  eventsLoading: boolean;
  loading: boolean;
  namespace: string;
  cluster: string;
  selectedPod: Pod | null;
  onSelectPod: (p: Pod) => void;
  onRefreshEvents: (name: string) => void;
  onOpenLogs: (p: Pod, c: string) => void;
  onOpenShell: (p: Pod, c: string) => void;
  selectedContainer: string | null;
}) {
  const activePod = selectedPod || pods[0] || null;

  if (!activePod) {
    return <Text c="dimmed" ta="center" py="xl">No pods found</Text>;
  }

  return (
    <Tabs defaultValue="overview">
      {/* Pod selector bar */}
      <Box py="xs" px="md" bg="dark.6">
        <Group gap="sm">
          {loading ? (
            <Loader size="xs" />
          ) : (
            pods.map((p) => {
              const isActive = activePod.name === p.name;
              const hasIssues = p.phase !== "Running" ||
                p.containers.some((c) => !c.ready && !c.isInit);
              return (
                <Anchor
                  key={p.name}
                  onClick={() => onSelectPod(p)}
                  style={{
                    fontWeight: isActive ? 700 : 400,
                    opacity: isActive ? 1 : 0.6,
                    borderBottom: isActive ? "2px solid #228be6" : "none",
                    paddingBottom: 2,
                  }}
                  size={isActive ? "sm" : "xs"}
                >
                  <Group gap={4}>
                    <ThemeIcon
                      size="xs"
                      color={
                        p.phase === "Running" ? "teal" :
                        p.phase === "Pending" ? "yellow" : "red"
                      }
                      variant="filled"
                      radius="xl"
                    >
                      <IconCircleDot size={8} />
                    </ThemeIcon>
                    <span>{p.name}</span>
                    {hasIssues && !isActive && (
                      <Badge size="xs" color="red" variant="filled">!</Badge>
                    )}
                  </Group>
                </Anchor>
              );
            })
          )}
        </Group>
      </Box>

      <Tabs.List>
        <Tabs.Tab value="overview" leftSection={<IconContainer size={14} />}>Overview</Tabs.Tab>
        <Tabs.Tab value="containers" leftSection={<IconPlayerPlay size={14} />}>
          Containers
          <Badge size="xs" ml={4}>{activePod.containers.length}</Badge>
        </Tabs.Tab>
        <Tabs.Tab value="events" leftSection={<IconAlertTriangle size={14} />}>
          Events
          <Badge size="xs" ml={4}>{(podEvents[activePod.name] || []).length}</Badge>
        </Tabs.Tab>
        <Tabs.Tab value="logs" leftSection={<IconFileText size={14} />}>Logs</Tabs.Tab>
        <Tabs.Tab value="shell" leftSection={<IconTerminal size={14} />}>Shell</Tabs.Tab>
      </Tabs.List>

      {/* Overview panel */}
      <Tabs.Panel value="overview" p="md">
        <Card withBorder radius="sm">
          <Group justify="space-between" mb="sm">
            <Group gap="sm">
              <Text fw={700} size="lg">{activePod.name}</Text>
              <Badge
                color={
                  activePod.phase === "Running" ? "green" :
                  activePod.phase === "Pending" ? "yellow" : "red"
                }
                variant="filled"
                size="lg"
              >
                {activePod.phase.toUpperCase()}
              </Badge>
            </Group>
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconRefresh size={12} />}
              loading={eventsLoading}
              onClick={() => onRefreshEvents(activePod.name)}
            >
              Refresh Events
            </Button>
          </Group>

          <Divider my="sm" />

          <Stack gap="xs">
            {activePod.containers.map((c) => (
              <ContainerRow
                key={c.name}
                container={c}
                onLogs={() => onOpenLogs(activePod, c.name)}
                onShell={!c.isInit ? () => onOpenShell(activePod, c.name) : undefined}
                highlight={!c.ready}
              />
            ))}
          </Stack>

          <Divider my="sm" />

          {/* Event summary */}
          {(podEvents[activePod.name] || []).length > 0 && (
            <>
              <Text fw={600} size="sm" mb="xs">Recent Events</Text>
              <Stack gap={4}>
                {(podEvents[activePod.name] || []).slice(0, 5).map((e, i) => (
                  <EventTimelineItem key={i} event={e} index={i} compact />
                ))}
              </Stack>
            </>
          )}
        </Card>
      </Tabs.Panel>

      {/* Containers panel */}
      <Tabs.Panel value="containers" p="md">
        <Stack gap="sm">
          {activePod.containers.map((c) => (
            <ContainerRow
              key={c.name}
              container={c}
              onLogs={() => onOpenLogs(activePod, c.name)}
              onShell={!c.isInit ? () => onOpenShell(activePod, c.name) : undefined}
              expanded
            />
          ))}
        </Stack>
      </Tabs.Panel>

      {/* Events panel */}
      <Tabs.Panel value="events" p="md">
        <Stack gap="sm">
          {(podEvents[activePod.name] || []).length > 0 ? (
            (podEvents[activePod.name] || []).slice(0, 30).map((e, i) => (
              <EventTimelineItem key={i} event={e} index={i} />
            ))
          ) : (
            <Text c="dimmed" ta="center" py="xl">No events recorded for this pod</Text>
          )}
        </Stack>
      </Tabs.Panel>

      {/* Logs panel */}
      <Tabs.Panel value="logs" p="md">
        {selectedContainer ? (
          <Box h="60vh">
            <LogWindow namespace={namespace} pod={activePod.name} cluster={cluster} containers={[selectedContainer]} />
          </Box>
        ) : (
          <Stack align="center" gap="sm" py="xl">
            <Text c="dimmed">Select a container to view logs</Text>
            {activePod.containers.filter((c) => !c.isInit).map((c) => (
              <Button key={c.name} size="xs" variant="subtle" onClick={() => onOpenLogs(activePod, c.name)}>
                {c.name}
              </Button>
            ))}
          </Stack>
        )}
      </Tabs.Panel>

      {/* Shell panel */}
      <Tabs.Panel value="shell" p="md">
        {selectedContainer ? (
          <Box h="60vh">
            <TerminalComponent namespace={namespace} pod={activePod.name} container={selectedContainer} cluster={cluster} />
          </Box>
        ) : (
          <Stack align="center" gap="sm" py="xl">
            <Text c="dimmed">Select a container to open shell</Text>
            {activePod.containers.filter((c) => !c.isInit && c.state === "Running").map((c) => (
              <Button key={c.name} size="xs" variant="subtle" onClick={() => onOpenShell(activePod, c.name)}>
                {c.name}
              </Button>
            ))}
          </Stack>
        )}
      </Tabs.Panel>
    </Tabs>
  );
}

/* ── Container Row Component ── */
function ContainerRow({
  container,
  onLogs,
  onShell,
  highlight = false,
  expanded = false,
}: {
  container: ContainerStatus;
  onLogs: () => void;
  onShell?: () => void;
  highlight?: boolean;
  expanded?: boolean;
}) {
  const stateColor =
    container.state === "Running" ? "teal" :
    container.state === "Waiting" ? "blue" :
    container.state === "Terminated" ? "orange" : "gray";

  return (
    <Card
      withBorder
      radius="sm"
      p="xs"
      bg={highlight ? "red.0" : undefined}
    >
      <Group justify="space-between" align="center">
        <Group gap="xs">
          {container.isInit && (
            <Badge size="xs" color="gray" variant="filled">INIT</Badge>
          )}
          <ThemeIcon size="sm" color={stateColor} variant="light" radius="xl">
            {container.ready ? <IconCheck size={10} /> : <IconBug size={10} />}
          </ThemeIcon>
          <Text size="sm" fw={550}>{container.name}</Text>
          <Badge
            size="xs"
            color={stateColor}
            variant="light"
          >
            {container.state.toUpperCase()}
          </Badge>
          {container.reason && (
            <Tooltip label={container.reason} withArrow>
              <Text size="xs" c="red" td="underline">{container.reason}</Text>
            </Tooltip>
          )}
          {container.restartCount > 0 && (
            <Badge size="xs" color="orange" variant="outline">
              {container.restartCount} restart{container.restartCount > 1 ? "s" : ""}
            </Badge>
          )}
        </Group>

        <Group gap={4}>
          <Button size="compact-xs" variant="subtle" onClick={onLogs}>
            Logs
          </Button>
          {onShell && (
            <Button size="compact-xs" variant="subtle" onClick={onShell}>
              Shell
            </Button>
          )}
        </Group>
      </Group>
    </Card>
  );
}

/* ── Event Timeline Item ── */
function EventTimelineItem({ event, index, compact = false }: { event: PodEvent; index: number; compact?: boolean }) {
  const isWarning = event.type === "Warning";
  const isNormal = event.type === "Normal";

  // Classify reason for visual treatment
  const isPulling = event.reason === "Pulling" || event.reason === "Pulled";
  const isFailed = event.reason === "Failed" || event.reason === "FailedScheduling" || event.reason === "FailedMount";
  const isScheduled = event.reason === "Scheduled";
  const isStarted = event.reason === "Started";
  const isKilling = event.reason === "Killing";

  const dotColor =
    isWarning || isFailed ? "red" :
    isPulling ? "blue" :
    isScheduled || isStarted ? "green" :
    isKilling ? "orange" : "gray";

  if (compact) {
    return (
      <Group gap="xs">
        <ThemeIcon size="xs" color={dotColor} variant="filled" radius="xl">
          <IconCircleDot size={6} />
        </ThemeIcon>
        <Badge size="xs" color={isWarning ? "red" : "blue"} variant="light">
          {event.reason}
        </Badge>
        <Text size="xs" c="dimmed" truncate="end" style={{ flex: 1 }}>
          {event.message}
        </Text>
        <Text size="xs" c="dimmed">{formatAge(event.lastTimestamp)}</Text>
      </Group>
    );
  }

  return (
    <Group gap="sm" align="flex-start">
      {/* Timeline dot + line */}
      <Box style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 24 }}>
        <ThemeIcon size="sm" color={dotColor} variant="filled" radius="xl">
          <IconCircleDot size={8} />
        </ThemeIcon>
        {index < 19 && (
          <Box w={1} h={28} bg={`${dotColor}.3`} style={{ minHeight: 28 }} />
        )}
      </Box>

      {/* Content */}
      <Card withBorder radius="sm" p="xs" style={{ flex: 1 }} bg={isWarning ? "red.0" : undefined}>
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Badge
              size="sm"
              color={isWarning ? "red" : isPulling ? "blue" : isScheduled || isStarted ? "green" : "gray"}
              variant="light"
            >
              {event.reason}
            </Badge>
            {isWarning && (
              <Badge size="xs" color="red" variant="filled">WARNING</Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">{formatAge(event.lastTimestamp)}</Text>
        </Group>
        <Text size="sm" mt={4} c={isWarning ? "red.8" : "dimmed"} lineClamp={2}>
          {event.message}
        </Text>
      </Card>
    </Group>
  );
}

export default function CoreServicesOverview({
  env,
  namespace,
  accessToken,
}: {
  env: string;
  namespace: string;
  accessToken: string;
}) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [podsOpened, setPodsOpened] = useState(false);
  const [podsLoading, setPodsLoading] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [pods, setPods] = useState<Pod[]>([]);

  const [logsOpened, setLogsOpened] = useState(false);
  const [shellOpened, setShellOpened] = useState(false);

  const [selectedPod, setSelectedPod] = useState<Pod | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);

  const [eventsLoading, setEventsLoading] = useState(false);
  const [podEvents, setPodEvents] = useState<Record<string, PodEvent[]>>({});

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const [deploymentsRes, statefulSetsRes, podsRes] = await Promise.all([
        callK8sApi(
          `/apis/apps/v1/namespaces/${namespace}/deployments`,
          "GET",
          null,
          null,
          env,
          accessToken
        ),
        callK8sApi(
          `/apis/apps/v1/namespaces/${namespace}/statefulsets`,
          "GET",
          null,
          null,
          env,
          accessToken
        ),
        callK8sApi(
          `/api/v1/namespaces/${namespace}/pods`,
          "GET",
          null,
          null,
          env,
          accessToken
        ),
      ]);

      // Build a map of pod reasons by service name using multiple strategies
      const podReasonByOwner: Record<string, { reason: string; message: string }> = {};

      // Strategy 1: Match by ownerReferences
      // Strategy 2: Match by name prefix (pod name starts with deployment/sts name)
      const allPods = podsRes?.items || [];
      const svcNames = new Set<string>();

      // Pre-collect all deployment/sts names for name-prefix matching
      (deploymentsRes?.items || []).forEach((d: any) => svcNames.add(d.metadata.name));
      (statefulSetsRes?.items || []).forEach((s: any) => svcNames.add(s.metadata.name));

      allPods.forEach((p: any) => {
        if (p.status.phase === "Running" && !p.status.containerStatuses?.some((c: any) => !c.ready)) return;

        let ownerName: string | undefined;

        // Try owner reference first
        const ownerRef = p.metadata?.ownerReferences?.find(
          (o: any) => o.kind === "Deployment" || o.kind === "StatefulSet"
        );
        if (ownerRef) {
          ownerName = ownerRef.name;
        } else {
          // Fallback: match by name prefix (pod names usually start with owner name)
          for (const svcName of Array.from(svcNames)) {
            if (p.metadata.name.startsWith(svcName)) {
              ownerName = svcName;
              break;
            }
          }
        }

        if (!ownerName) return;
        if (podReasonByOwner[ownerName]) return; // already have a reason

        // Extract reason from container statuses
        let reason = p.status.phase;
        let message = "";

        const allContainers = [
          ...(p.status.initContainerStatuses || []),
          ...(p.status.containerStatuses || []),
        ];
        for (const cs of allContainers) {
          const stateObj = cs.state || {};
          if (stateObj.waiting) {
            reason = stateObj.waiting.reason || reason;
            message = stateObj.waiting.message || message;
            break;
          }
          if (stateObj.terminated && cs.restartCount > 3) {
            reason = `CrashLoopBackOff (${cs.restartCount} restarts)`;
            message = `Container ${cs.name} keeps restarting`;
            break;
          }
          if (stateObj.terminated && !cs.ready) {
            reason = stateObj.terminated.reason || "Terminated";
            message = stateObj.terminated.message || `Container ${cs.name} terminated`;
            break;
          }
        }

        // Fallback to pod conditions
        if (!message) {
          const cond = (p.status.conditions || []).find(
            (c: any) => c.status === "False"
          );
          if (cond) message = cond.message;
        }

        // If still nothing useful, use phase as reason
        if (!message && reason !== "Succeeded") {
          message = `Pod is in ${reason} state`;
        }

        podReasonByOwner[ownerName] = { reason, message };
      });

      const deployments =
        deploymentsRes?.items?.map((d: any) => {
          const availableCondition = d.status?.conditions?.find((c: any) => c.type === "Available");
          const progressingCondition = d.status?.conditions?.find((c: any) => c.type === "Progressing");
          const lastTransition = availableCondition?.lastTransitionTime || progressingCondition?.lastTransitionTime;
          const podInfo = podReasonByOwner[d.metadata.name];

          // Fallback: use deployment condition message if no pod reason found
          let reason = podInfo?.reason;
          let message = podInfo?.message;
          if (!reason && progressingCondition?.status === "False") {
            reason = progressingCondition.reason || "Progressing";
            message = progressingCondition.message;
          }
          if (!reason && availableCondition?.status === "False") {
            reason = availableCondition.reason || "Unavailable";
            message = availableCondition.message;
          }

          return {
            name: d.metadata.name,
            kind: "Deployment",
            desired: d.spec?.replicas ?? 0,
            ready: d.status?.readyReplicas ?? 0,
            updated: d.status?.updatedReplicas ?? 0,
            age: formatAge(d.metadata.creationTimestamp),
            lastTransitionTime: formatAge(lastTransition),
            images: d.spec?.template?.spec?.containers?.map((c: any) => formatImageName(c.image)) ?? [],
            podReason: reason,
            podMessage: message,
          };
        }) ?? [];

      const statefulSets =
        statefulSetsRes?.items?.map((s: any) => {
          const podInfo = podReasonByOwner[s.metadata.name];

          let reason = podInfo?.reason;
          let message = podInfo?.message;
          // StatefulSets don't have the same condition structure, rely on pod info

          return {
            name: s.metadata.name,
            kind: "StatefulSet",
            desired: s.spec?.replicas ?? 0,
            ready: s.status?.readyReplicas ?? 0,
            updated: s.status?.updatedReplicas ?? 0,
            age: formatAge(s.metadata.creationTimestamp),
            lastTransitionTime: "N/A",
            images: s.spec?.template?.spec?.containers?.map((c: any) => formatImageName(c.image)) ?? [],
            podReason: reason,
            podMessage: message,
          };
        }) ?? [];

      setServices([...deployments, ...statefulSets]);
      setLastRefreshedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [env, namespace, accessToken]);

  // Auto-refresh logic
  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(fetchServices, 15000);
    } else {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    }
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [autoRefresh, fetchServices]);

  // Initial fetch
  useEffect(() => {
    if (!env || !namespace || !accessToken) return;
    fetchServices();
  }, [env, namespace, accessToken, fetchServices]);

  const fetchPodEvents = async (podName: string) => {
    setEventsLoading(true);
    try {
      const res = await callK8sApi(
        `/api/v1/namespaces/${namespace}/events?fieldSelector=involvedObject.name=${podName}`,
        "GET",
        null,
        null,
        env,
        accessToken
      );

      const events =
        res?.items?.map((e: any) => ({
          reason: e.reason,
          message: e.message,
          type: e.type,
          lastTimestamp:
            e.lastTimestamp ||
            e.eventTime ||
            e.metadata.creationTimestamp,
        })) ?? [];

      setPodEvents((prev) => ({
        ...prev,
        [podName]: events.sort(
          (a: any, b: any) =>
            new Date(b.lastTimestamp).getTime() -
            new Date(a.lastTimestamp).getTime()
        ),
      }));
    } finally {
      setEventsLoading(false);
    }
  };

  const openPodsModal = async (svc: Service) => {
    setSelectedService(svc);
    setPodsOpened(true);
    setPods([]);
    setPodsLoading(true);

    try {
      const resourcePath =
        svc.kind === "Deployment"
          ? `/apis/apps/v1/namespaces/${namespace}/deployments/${svc.name}`
          : `/apis/apps/v1/namespaces/${namespace}/statefulsets/${svc.name}`;

      const workload = await callK8sApi(
        resourcePath,
        "GET",
        null,
        null,
        env,
        accessToken
      );

      const matchLabels = workload?.spec?.selector?.matchLabels;
      if (!matchLabels) throw new Error("No selector");

      const podsRes = await callK8sApi(
        `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(
          buildLabelSelector(matchLabels)
        )}`,
        "GET",
        null,
        null,
        env,
        accessToken
      );

      const parsed: Pod[] =
        podsRes?.items?.map((p: any) => {
          const initStatuses =
            p.status?.initContainerStatuses?.map((c: any) => {
              const stateObj = c.state || {};
              const state = stateObj.running
                ? "Running"
                : stateObj.waiting
                  ? "Waiting"
                  : stateObj.terminated
                    ? "Terminated"
                    : "Unknown";

              return {
                name: c.name,
                ready: c.ready ?? false,
                state,
                reason:
                  stateObj.waiting?.reason ||
                  stateObj.terminated?.reason,
                restartCount: c.restartCount ?? 0,
                isInit: true,
              };
            }) ?? [];

          const mainStatuses =
            p.status?.containerStatuses?.map((c: any) => {
              const stateObj = c.state || {};
              const state = stateObj.running
                ? "Running"
                : stateObj.waiting
                  ? "Waiting"
                  : stateObj.terminated
                    ? "Terminated"
                    : "Unknown";

              return {
                name: c.name,
                ready: c.ready,
                state,
                reason:
                  stateObj.waiting?.reason ||
                  stateObj.terminated?.reason,
                restartCount: c.restartCount ?? 0,
                isInit: false,
              };
            }) ?? [];

          return {
            name: p.metadata.name,
            phase: p.status.phase,
            containers: [...initStatuses, ...mainStatuses],
          };
        }) ?? [];

      setPods(parsed);
      parsed.forEach((p) => fetchPodEvents(p.name));
    } finally {
      setPodsLoading(false);
    }
  };

  // ── Summary stats ──
  const healthyCount = services.filter(s => computeStatus(s.desired, s.ready).status === "healthy").length;
  const degradedCount = services.filter(s => computeStatus(s.desired, s.ready).status === "degraded").length;
  const downCount = services.filter(s => computeStatus(s.desired, s.ready).status === "down").length;
  const totalReplicasReady = services.reduce((sum, s) => sum + s.ready, 0);
  const totalReplicasDesired = services.reduce((sum, s) => sum + s.desired, 0);
  const replicaPct = totalReplicasDesired > 0 ? Math.round((totalReplicasReady / totalReplicasDesired) * 100) : 0;

  const timeSinceRefresh = Math.floor((Date.now() - lastRefreshedAt.getTime()) / 1000);

  return (
    <>
      {/* SERVICES */}
      <Card withBorder radius="md" p="lg">
        {/* Header Row */}
        <Group justify="space-between" mb="xs">
          <Group gap="md">
            <Title order={4}>Services</Title>
            {loading && <Loader size="xs" />}
          </Group>

          <Group gap="xs">
            <Text size="xs" c="dimmed">
              Auto-refresh
            </Text>
            <Switch
              size="xs"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
            />
            {autoRefresh && (
              <Text size="xs" c="dimmed">• {timeSinceRefresh}s ago</Text>
            )}
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconRefresh size={12} />}
              onClick={fetchServices}
              loading={loading}
            >
              Refresh
            </Button>
          </Group>
        </Group>

        {/* Summary Stats Bar — subtle inline row */}
        <Group gap="lg" mb="md" py="sm">
          <Group gap={6}>
            <Text size="sm" c="dimmed">Services</Text>
            <Text size="sm" fw={600}>{services.length}</Text>
          </Group>
          <Divider orientation="vertical" />
          <Group gap={6}>
            <Text size="sm" fw={500} c="teal">{healthyCount} healthy</Text>
          </Group>
          {degradedCount > 0 && (
            <>
              <Divider orientation="vertical" />
              <Group gap={6}>
                <Text size="sm" fw={500} c="orange">{degradedCount} degraded</Text>
              </Group>
            </>
          )}
          {downCount > 0 && (
            <>
              <Divider orientation="vertical" />
              <Group gap={6}>
                <Text size="sm" fw={500} c="red">{downCount} down</Text>
              </Group>
            </>
          )}
          <div style={{ flex: 1 }} />
          <Group gap="xs">
            <Text size="xs" c="dimmed">Replicas</Text>
            <Text size="sm" fw={600}>{totalReplicasReady}/{totalReplicasDesired}</Text>
            <Progress
              value={replicaPct}
              size="xs"
              radius="xl"
              w={80}
              color={replicaPct === 100 ? "teal" : replicaPct >= 50 ? "orange" : "red"}
            />
          </Group>
        </Group>

        <Divider mb="md" />

        {/* Service Cards Grid */}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
          {services.map((svc) => {
            const health = computeStatus(svc.desired, svc.ready);
            const sev = reasonSeverity(svc.podReason);
            const clr = statusColor(health, svc.podReason);
            const isUpdating = svc.updated < svc.desired && svc.desired > 0;

            return (
              <Card
                key={`${svc.kind}-${svc.name}`}
                withBorder
                radius="sm"
                p="sm"
                onClick={() => openPodsModal(svc)}
                style={{ cursor: "pointer" }}
              >
                <Stack gap={6}>
                  {/* Top: Name + Status */}
                  <Group justify="space-between" align="center">
                    <Group gap={4} style={{ maxWidth: "65%" }}>
                      <Text fw={550} size="sm" truncate="end" title={svc.name}>
                        {svc.name}
                      </Text>
                      <Badge
                        size="xs"
                        variant="outline"
                        color="gray"
                      >
                        {svc.kind === "Deployment" ? "Deploy" : "STS"}
                      </Badge>
                    </Group>
                    <Badge
                      color={clr}
                      variant="filled"
                      size="xs"
                    >
                      {health.label.toUpperCase()}
                    </Badge>
                  </Group>

                  {/* Pod reason for unhealthy services */}
                  {health.status !== "healthy" && (svc.podReason || svc.podMessage) && (
                    <Tooltip
                      label={svc.podMessage || svc.podReason || "Service is not healthy"}
                      withArrow
                      multiline
                      w={280}
                    >
                      <Text size="xs" c={clr} truncate="end" td="underline" style={{ cursor: "help" }}>
                        {svc.podReason || svc.podMessage?.split("\n")[0] || "Issue"}
                      </Text>
                    </Tooltip>
                  )}

                  {/* Replica Progress Bar */}
                  {svc.desired > 0 && (
                    <Group gap={8} align="center">
                      <Progress
                        value={(svc.ready / svc.desired) * 100}
                        size="xs"
                        radius="xl"
                        color={clr}
                        style={{ flex: 1 }}
                      />
                      <Text size="xs" c="dimmed" miw={36} ta="right">
                        {svc.ready}/{svc.desired}
                      </Text>
                    </Group>
                  )}

                  {/* Images */}
                  <Group gap={4}>
                    {svc.images.slice(0, 2).map((img, idx) => (
                      <Tooltip key={idx} label={`Image: ${img}`} withArrow>
                        <Text size="xs" c="blue" style={{ fontFamily: "monospace" }}>
                          {img}
                        </Text>
                      </Tooltip>
                    ))}
                    {svc.images.length > 2 && (
                      <Text size="xs" c="dimmed">+{svc.images.length - 2} more</Text>
                    )}
                  </Group>

                  {/* Bottom: timestamp */}
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      {isUpdating ? (
                        <span>Rolling update...</span>
                      ) : (
                        <>Updated {svc.lastTransitionTime} ago</>
                      )}
                    </Text>
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>

        {services.length === 0 && !loading && (
          <Stack align="center" py="xl" gap="xs">
            <Text c="dimmed" size="lg">No deployments or StatefulSets found in this namespace</Text>
            <Text c="dimmed" size="sm">Services will appear here after deploying Gen3</Text>
          </Stack>
        )}
      </Card>

      {/* UNIFIED DETAIL MODAL — tabbed pods/events/logs/shell */}
      <Modal
        opened={podsOpened}
        onClose={() => {
          setPodsOpened(false);
          setSelectedPod(null);
          setSelectedContainer(null);
          setPodEvents({});
        }}
        size="95vw"
        title={
          <Group gap="sm">
            <Text fw={600}>{selectedService?.name}</Text>
            <Badge color={computeStatus(selectedService?.desired ?? 0, selectedService?.ready ?? 0).color} variant="filled" size="lg">
              {computeStatus(selectedService?.desired ?? 0, selectedService?.ready ?? 0).label.toUpperCase()}
            </Badge>
            <Badge variant="outline" size="lg">{selectedService?.kind}</Badge>
          </Group>
        }
        keepMounted
      >
        {pods.length === 1 ? (
          /* Single pod — show tabs directly */
          <SinglePodDetailTabs
            pod={pods[0]}
            events={podEvents[pods[0].name] || []}
            eventsLoading={eventsLoading}
            namespace={namespace}
            cluster={env}
            onRefreshEvents={() => fetchPodEvents(pods[0].name)}
            onOpenLogs={(container) => {
              setSelectedPod(pods[0]);
              setSelectedContainer(container);
              setLogsOpened(true);
            }}
            onOpenShell={(container) => {
              setSelectedPod(pods[0]);
              setSelectedContainer(container);
              setShellOpened(true);
            }}
            selectedContainer={selectedContainer}
          />
        ) : (
          /* Multi-pod — pod selector + tabs */
          <MultiPodDetailView
            pods={pods}
            podEvents={podEvents}
            eventsLoading={eventsLoading}
            loading={podsLoading}
            namespace={namespace}
            cluster={env}
            selectedPod={selectedPod}
            onSelectPod={setSelectedPod}
            onRefreshEvents={fetchPodEvents}
            onOpenLogs={(pod, container) => {
              setSelectedPod(pod);
              setSelectedContainer(container);
              setLogsOpened(true);
            }}
            onOpenShell={(pod, container) => {
              setSelectedPod(pod);
              setSelectedContainer(container);
              setShellOpened(true);
            }}
            selectedContainer={selectedContainer}
          />
        )}

        {/* Logs sub-modal (overlay) */}
        <Modal
          opened={logsOpened}
          onClose={() => setLogsOpened(false)}
          size="90vw"
          title={
            <Group gap="xs">
              <IconFileText size={16} />
              <Text fw={600}>Logs — {selectedPod?.name} / {selectedContainer}</Text>
            </Group>
          }
          keepMounted
        >
          {selectedPod && selectedContainer && (
            <Box h="70vh">
              <LogWindow
                namespace={namespace}
                pod={selectedPod.name}
                cluster={env}
                containers={[selectedContainer]}
              />
            </Box>
          )}
        </Modal>

        {/* Shell sub-modal (overlay) */}
        <Modal
          opened={shellOpened}
          onClose={() => setShellOpened(false)}
          size="90vw"
          title={
            <Group gap="xs">
              <IconTerminal size={16} />
              <Text fw={600}>Shell — {selectedPod?.name} / {selectedContainer}</Text>
            </Group>
          }
          keepMounted
        >
          {selectedPod && selectedContainer && (
            <Box h="70vh">
              <TerminalComponent
                namespace={namespace}
                pod={selectedPod.name}
                container={selectedContainer}
                cluster={env}
              />
            </Box>
          )}
        </Modal>
      </Modal>
    </>
  );
}
