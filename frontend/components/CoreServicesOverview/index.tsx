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
  Paper,
  UnstyledButton,
  Collapse,
  Tabs,
  ThemeIcon,
  Box,
  Anchor,
} from "@mantine/core";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  IconChevronDown,
  IconChevronRight,
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
import { CONVERGING_MS, SETTLED_MS } from "@/lib/workloadPolling";
import {
  formatCpu,
  formatMemory,
  rolloutColor,
  rolloutLabel,
  sumUsage,
  summarizeRollout,
  type Usage,
} from "@/lib/rolloutState";
import { resolveStatus } from "@/lib/status";
import ScaleControl from "@/components/ScaleControl";
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
  /** The workload's own pods, for live rollout state. Already fetched. */
  pods?: any[];
  /**
   * Deployment conditions, kept rather than collapsed into one reason
   * string. These carry their own timestamps and outlive both the pods and
   * the events, so they are the only thing left to show on a workload that
   * was stopped days ago.
   *
   * Optional because a Service object can outlive a refresh: the modal holds
   * the one it was opened with, which may predate this field.
   */
  conditions?: any[];
  /** Live CPU/memory, or null when metrics-server is unavailable. */
  usage?: Usage | null;
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




function buildLabelSelector(matchLabels: Record<string, string>) {
  return Object.entries(matchLabels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

/* ── Single Pod Tabbed Detail View ── */
/**
 * The workload detail view.
 *
 * This replaces two components -- `SinglePodDetailTabs` for exactly one pod
 * and `MultiPodDetailView` for none or several. They were alternatives on
 * `pods.length === 1`, so the same screen had two implementations that had
 * drifted: Running was green in one and teal in the other, only one had a
 * loading state, and the multi-pod one rendered its container list twice
 * under different tabs.
 *
 * One view, two levels. The deployment's own state at the top -- which was
 * absent entirely, so the modal title showed a stale "STOPPED" over a pod
 * reporting RUNNING -- then a row per pod that expands in place. No tabs:
 * with at most a handful of pods, five tabs to reach a container's logs was
 * more navigation than the content warranted.
 */
function WorkloadDetail({
  service,
  pods,
  podEvents,
  eventsLoadingFor,
  loading,
  namespace,
  cluster,
  onRefreshEvents,
  onOpenLogs,
  onOpenShell,
}: {
  service: Service | null;
  pods: Pod[];
  podEvents: Record<string, PodEvent[]>;
  /** Pod names with an events request in flight. */
  eventsLoadingFor: Set<string>;
  loading: boolean;
  namespace: string;
  cluster: string;
  onRefreshEvents: (name: string) => void;
  onOpenLogs: (p: Pod, c: string) => void;
  onOpenShell: (p: Pod, c: string) => void;
}) {
  // Which pods are expanded. A single pod opens by default, since there is
  // nothing to choose between and collapsing it would hide the only content.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (pods.length === 1) setExpanded(new Set([pods[0].name]));
  }, [pods]);

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const rollout = service
    ? summarizeRollout(service.pods, service.desired, service.ready)
    : null;

  // Keyed by object name, same store as pod events.
  const deploymentEvents = service ? podEvents[service.name] || [] : [];

  // `selectedService` is captured when the modal opens and survives across
  // refreshes, so it can be an object built before `conditions` existed on
  // the type. TypeScript cannot see that -- the field is declared required
  // -- so the access is guarded rather than trusted.
  const conditions: any[] = service?.conditions ?? [];

  return (
    <Stack gap="md">
      {/* Deployment state. Read from the same summary the card uses, so the
          two cannot disagree the way the old title did. */}
      {service && rollout && (
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={6} style={{ minWidth: 0 }}>
              <Group gap="xs">
                <Badge color={rolloutColor(rollout.phase)} variant="light">
                  {rolloutLabel(rollout.phase).toUpperCase()}
                </Badge>
                <Text size="sm" c="dimmed">
                  {service.ready}/{service.desired} ready
                </Text>
                {rollout.detail && (
                  <Text size="sm" c={rolloutColor(rollout.phase)}>
                    {rollout.detail}
                  </Text>
                )}
              </Group>

              {service.images.map((img) => (
                <Text key={img} size="xs" ff="monospace" c="dimmed" truncate="end">
                  {img}
                </Text>
              ))}

              <Text size="xs" c="dimmed">
                Created {service.age} ago
                {service.lastTransitionTime !== "N/A" &&
                  ` · last change ${service.lastTransitionTime} ago`}
              </Text>
            </Stack>

            <ScaleControl
              kind={service.kind}
              namespace={namespace}
              name={service.name}
              cluster={cluster}
              current={service.desired}
            />
          </Group>

          {service.podMessage && rollout.phase === "failing" && (
            <Text size="xs" c="statusError" mt="sm">
              {service.podMessage}
            </Text>
          )}
        </Paper>
      )}

      {/* Pods */}
      {loading && pods.length === 0 ? (
        <Group gap="xs" py="lg" justify="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading pods…
          </Text>
        </Group>
      ) : pods.length === 0 ? (
        // No pods, but not nothing to say. The workload's own events outlive
        // them, and for a stopped deployment they answer the only question
        // worth asking here: why is this off, and since when.
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            {service && service.desired === 0
              ? "Scaled to zero, so there are no pods to show."
              : "No pods found."}
          </Text>

          {/* Conditions rather than events. Kubernetes expires events after
              about an hour, so a workload stopped days ago has none left --
              the first version of this panel was reliably empty for exactly
              the case it was written for. Conditions carry their own
              timestamps and persist on the object. */}
          {conditions.length > 0 && (
            <>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="xs">
                Last known state
              </Text>
              {conditions.map((c: any) => (
                <Group key={c.type} gap="xs" wrap="nowrap" align="flex-start">
                  <Badge
                    size="xs"
                    variant="light"
                    color={c.status === "True" ? "statusOk" : "statusWarn"}
                    style={{ flexShrink: 0 }}
                  >
                    {c.type}
                  </Badge>
                  <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                    <Text size="xs">{c.reason || c.status}</Text>
                    {c.message && (
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {c.message}
                      </Text>
                    )}
                  </Stack>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {formatAge(c.lastUpdateTime || c.lastTransitionTime)}
                  </Text>
                </Group>
              ))}
            </>
          )}

          {/* Events when they happen to still exist -- a recent change. */}
          {deploymentEvents.length > 0 && (
            <>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="xs">
                Recent activity
              </Text>
              {deploymentEvents.slice(0, 6).map((e, i, shown) => (
                <EventTimelineItem
                  key={`${e.reason}-${i}`}
                  event={e}
                  index={i}
                  compact
                  isLast={i === shown.length - 1}
                />
              ))}
            </>
          )}
        </Stack>
      ) : (
        <Stack gap={4}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Pods ({pods.length})
          </Text>

          {pods.map((p) => (
            <PodRow
              key={p.name}
              pod={p}
              expanded={expanded.has(p.name)}
              onToggle={() => toggle(p.name)}
              events={podEvents[p.name] || []}
              eventsLoading={eventsLoadingFor.has(p.name)}
              onRefreshEvents={() => onRefreshEvents(p.name)}
              onOpenLogs={(c) => onOpenLogs(p, c)}
              onOpenShell={(c) => onOpenShell(p, c)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** One pod: a compact summary row that expands to containers and events. */
function PodRow({
  pod,
  expanded,
  onToggle,
  events,
  eventsLoading,
  onRefreshEvents,
  onOpenLogs,
  onOpenShell,
}: {
  pod: Pod;
  expanded: boolean;
  onToggle: () => void;
  events: PodEvent[];
  eventsLoading: boolean;
  onRefreshEvents: () => void;
  onOpenLogs: (container: string) => void;
  onOpenShell: (container: string) => void;
}) {
  const main = pod.containers.filter((c) => !c.isInit);
  const init = pod.containers.filter((c) => c.isInit);
  const ready = main.filter((c) => c.ready).length;
  const restarts = pod.containers.reduce((n, c) => n + (c.restartCount || 0), 0);

  // One resolver for the dot, rather than the phase ternary that was
  // duplicated three times and disagreed with itself.
  const status = resolveStatus("pod", pod.phase, {
    reason: pod.containers.find((c) => c.reason)?.reason,
    ready: main.length > 0 && main.every((c) => c.ready),
  });

  return (
    <Paper withBorder radius="sm">
      <UnstyledButton w="100%" p="xs" onClick={onToggle}>
        <Group gap="sm" wrap="nowrap">
          {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <Badge size="xs" variant="light" color={status.color}>
            {status.label}
          </Badge>
          <Text size="sm" ff="monospace" truncate="end" style={{ flex: 1, minWidth: 0 }}>
            {pod.name}
          </Text>
          <Text size="xs" c="dimmed">
            {ready}/{main.length}
          </Text>
          {restarts > 0 && (
            <Text size="xs" c={restarts > 5 ? "statusError" : "statusWarn"} fw={600}>
              {restarts}↺
            </Text>
          )}
        </Group>
      </UnstyledButton>

      <Collapse expanded={expanded}>
        <Stack gap="xs" p="xs" pt={0}>
          <Divider />

          {init.length > 0 && (
            <>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Init
              </Text>
              {init.map((c) => (
                <ContainerRow
                  key={c.name}
                  container={c}
                  onLogs={() => onOpenLogs(c.name)}
                  highlight={!c.ready && c.state !== "Terminated"}
                />
              ))}
            </>
          )}

          {main.map((c) => (
            <ContainerRow
              key={c.name}
              container={c}
              onLogs={() => onOpenLogs(c.name)}
              onShell={() => onOpenShell(c.name)}
              highlight={!c.ready}
            />
          ))}

          <Group justify="space-between" mt={4}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Recent events
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              loading={eventsLoading}
              onClick={onRefreshEvents}
            >
              Refresh
            </Button>
          </Group>

          {events.length === 0 ? (
            <Text size="xs" c="dimmed">
              {eventsLoading ? "Loading…" : "No events recorded."}
            </Text>
          ) : (
            events
              .slice(0, 8)
              .map((e, i, shown) => (
                <EventTimelineItem
                  key={`${e.reason}-${i}`}
                  event={e}
                  index={i}
                  compact
                  isLast={i === shown.length - 1}
                />
              ))
          )}
        </Stack>
      </Collapse>
    </Paper>
  );
}


function ContainerRow({
  container,
  onLogs,
  onShell,
  highlight = false,
}: {
  container: ContainerStatus;
  onLogs: () => void;
  onShell?: () => void;
  highlight?: boolean;
}) {
  const stateColor =
    container.state === "Running" ? "statusOk" :
    container.state === "Waiting" ? "statusPending" :
    container.state === "Terminated" ? "statusWarn" : "statusNeutral";

  return (
    <Card
      withBorder
      radius="sm"
      p="xs"
      // light-dark() rather than a fixed palette shade: red.0 is a
      // near-white tint that vanishes in light mode and glares in dark.
      bg={
        highlight
          ? "light-dark(var(--mantine-color-statusError-0), var(--mantine-color-statusError-9))"
          : undefined
      }
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
              <Text size="xs" c="statusError" td="underline">{container.reason}</Text>
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
function EventTimelineItem({
  event,
  index,
  compact = false,
  isLast = false,
}: {
  event: PodEvent;
  index: number;
  compact?: boolean;
  /** Suppresses the connector below the final item. Previously hardcoded to
      `index < 19`, which came from a 20-item slice -- so a longer list lost
      its connector partway down. */
  isLast?: boolean;
}) {
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
        {!isLast && (
          <Box
            w={1}
            h={28}
            style={{ minHeight: 28, background: "var(--mantine-color-default-border)" }}
          />
        )}
      </Box>

      {/* Content */}
      <Card
        withBorder
        radius="sm"
        p="xs"
        style={{ flex: 1 }}
        bg={
          isWarning
            ? "light-dark(var(--mantine-color-statusError-0), var(--mantine-color-statusError-9))"
            : undefined
        }
      >
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
        <Text size="sm" mt={4} c={isWarning ? "statusError" : "dimmed"} lineClamp={2}>
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
  const [autoRefresh, setAutoRefresh] = useState(true);
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

  // Per pod, not one shared boolean: opening the modal fires one events
  // request per pod, and a single flag meant the first response to land
  // cleared the spinner for all the others still in flight.
  const [eventsLoadingFor, setEventsLoadingFor] = useState<Set<string>>(new Set());
  const [podEvents, setPodEvents] = useState<Record<string, PodEvent[]>>({});

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const [deploymentsRes, statefulSetsRes, podsRes, metricsRes] = await Promise.all([
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
        // Live usage. metrics-server is frequently absent, so this must not
        // take the rest of the dashboard down with it -- a namespace with no
        // metrics still has workloads worth showing.
        callK8sApi(
          `/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods`,
          "GET",
          null,
          null,
          env,
          accessToken
        ).catch(() => null),
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

      // The pods for this namespace are already in hand. Grouping them by
      // owner costs nothing and is what lets a card show a rollout in
      // progress rather than a stale count.
      const podsByOwner: Record<string, any[]> = {};
      allPods.forEach((p: any) => {
        const ownerRef = p.metadata?.ownerReferences?.find(
          (o: any) => o.kind === "Deployment" || o.kind === "StatefulSet" || o.kind === "ReplicaSet"
        );
        // A Deployment owns a ReplicaSet which owns the pod, so the pod's
        // owner is the ReplicaSet: strip its generated suffix to recover the
        // Deployment name.
        let owner = ownerRef?.kind === "ReplicaSet"
          ? ownerRef.name.replace(/-[a-z0-9]+$/, "")
          : ownerRef?.name;
        if (!owner || !svcNames.has(owner)) {
          owner = Array.from(svcNames).find((n) => p.metadata.name.startsWith(n));
        }
        if (!owner) return;
        (podsByOwner[owner] ||= []).push(p);
      });

      // Usage, grouped by the owner each pod already resolved to. Keyed by
      // pod name so a metrics entry with no matching pod is simply skipped.
      const podToOwner: Record<string, string> = {};
      Object.entries(podsByOwner).forEach(([owner, list]) => {
        (list as any[]).forEach((p) => {
          podToOwner[p.metadata.name] = owner;
        });
      });

      const metricsByOwner: Record<string, any[]> = {};
      (metricsRes?.items ?? []).forEach((m: any) => {
        const owner = podToOwner[m?.metadata?.name];
        if (!owner) return;
        (metricsByOwner[owner] ||= []).push(m);
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
            pods: podsByOwner[d.metadata.name] ?? [],
            conditions: d.status?.conditions ?? [],
            usage: sumUsage(metricsByOwner[d.metadata.name]),
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
            pods: podsByOwner[s.metadata.name] ?? [],
            conditions: s.status?.conditions ?? [],
            usage: sumUsage(metricsByOwner[s.metadata.name]),
          };
        }) ?? [];

      setServices([...deployments, ...statefulSets]);
      setLastRefreshedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [env, namespace, accessToken]);

  // Auto-refresh.
  //
  // On by default and paced by what the data is doing, matching the workload
  // lists: this is the screen someone watches while a deploy rolls out, and
  // it previously sat frozen unless they found the toggle. Fast while
  // anything is converging, background once everything has settled.
  const anyConverging = services.some(
    (svc) => svc.desired > 0 && (svc.ready !== svc.desired || svc.updated !== svc.desired)
  );

  useEffect(() => {
    if (!autoRefresh) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    const period = anyConverging ? CONVERGING_MS : SETTLED_MS;
    refreshIntervalRef.current = setInterval(fetchServices, period);

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [autoRefresh, anyConverging, fetchServices]);

  // Initial fetch
  useEffect(() => {
    if (!env || !namespace || !accessToken) return;
    fetchServices();
  }, [env, namespace, accessToken, fetchServices]);

  /**
   * Events for one object, by name.
   *
   * The fieldSelector matches any involvedObject, so this serves Deployments
   * as well as pods -- which is how a scaled-to-zero workload can still
   * explain itself after its pods are gone.
   */
  const fetchPodEvents = async (podName: string) => {
    setEventsLoadingFor((prev) => new Set(prev).add(podName));
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
      setEventsLoadingFor((prev) => {
        const next = new Set(prev);
        next.delete(podName);
        return next;
      });
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
      // Also the workload's own events. These outlive its pods, so a
      // scaled-to-zero deployment can still say who scaled it and when --
      // otherwise the modal has nothing to show but an empty state.
      fetchPodEvents(svc.name);
    } finally {
      setPodsLoading(false);
    }
  };

  // ── Summary stats ──
  // Counted from the same rollout summary the cards use, so the header and
  // the grid below it cannot disagree.
  const phases = services.map((s) => summarizeRollout(s.pods, s.desired, s.ready).phase);
  const healthyCount = phases.filter((p) => p === "ready").length;
  const degradedCount = phases.filter(
    (p) => p === "pulling" || p === "starting" || p === "pending" || p === "terminating"
  ).length;
  const downCount = phases.filter((p) => p === "failing").length;
  const stoppedCount = phases.filter((p) => p === "stopped").length;
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
            <Text size="sm" fw={500} c="statusOk">{healthyCount} healthy</Text>
          </Group>
          {degradedCount > 0 && (
            <>
              <Divider orientation="vertical" />
              <Text size="sm" fw={500} c="statusPending">
                {degradedCount} rolling out
              </Text>
            </>
          )}
          {downCount > 0 && (
            <>
              <Divider orientation="vertical" />
              <Text size="sm" fw={500} c="statusError">
                {downCount} failing
              </Text>
            </>
          )}
          {/* Stopped is not an outage, so it is reported plainly rather than
              folded into the failing count. */}
          {stoppedCount > 0 && (
            <>
              <Divider orientation="vertical" />
              <Text size="sm" fw={500} c="dimmed">
                {stoppedCount} stopped
              </Text>
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
              color={replicaPct === 100 ? "statusOk" : replicaPct >= 50 ? "statusWarn" : "statusError"}
            />
          </Group>
        </Group>

        <Divider mb="md" />

        {/* Service Cards Grid */}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
          {services.map((svc) => {
            // Derived from the pods themselves rather than replica counts
            // alone, so the card says what is happening ("1 pulling image")
            // instead of only how far off it is.
            const rollout = summarizeRollout(svc.pods, svc.desired, svc.ready);
            const clr = rolloutColor(rollout.phase);
            const isUpdating = rollout.converging;

            return (
              <Card
                key={`${svc.kind}-${svc.name}`}
                withBorder
                radius="sm"
                p="sm"
                onClick={() => openPodsModal(svc)}
                style={{ cursor: "pointer" }}
              >
                {/* Fixed three-row structure so cards align down a column.
                    Previously the kind badge wrapped to a second line on
                    longer names and the progress bar only rendered above
                    zero replicas, so every card was a different height --
                    and healthy ones were the tallest, which is backwards. */}
                <Stack gap={8}>
                  {/* Name and state. Both single-line: the name truncates
                      rather than wrapping, and the status badge is fixed
                      width so the row never reflows. */}
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      <Text fw={600} size="sm" truncate="end" title={svc.name}>
                        {svc.name}
                      </Text>
                      {/* Only when it is not the common case. Every card
                          carrying a "DEPLOY" badge meant the badge carried
                          no information while costing a line of height. */}
                      {svc.kind === "StatefulSet" && (
                        <Badge size="xs" variant="default" style={{ flexShrink: 0 }}>
                          STS
                        </Badge>
                      )}
                    </Group>

                    <Tooltip
                      label={svc.podMessage || svc.podReason || rolloutLabel(rollout.phase)}
                      disabled={!svc.podMessage && !svc.podReason}
                      multiline
                      w={280}
                      withArrow
                    >
                      <Badge color={clr} variant="light" size="sm" style={{ flexShrink: 0 }}>
                        {rolloutLabel(rollout.phase)}
                      </Badge>
                    </Tooltip>
                  </Group>

                  {/* Replicas. The bar renders at every scale, empty when
                      stopped, so the row occupies the same height on every
                      card and the eye can track one line across the grid. */}
                  <Group gap="xs" align="center" wrap="nowrap">
                    <Progress.Root size={6} radius="xl" style={{ flex: 1 }}>
                      {svc.desired > 0 && (
                        <>
                          <Progress.Section
                            value={(svc.ready / svc.desired) * 100}
                            color={clr}
                          />
                          {/* Pods that exist but are not ready: striped and
                              animated, so a rollout visibly moves. Tied to
                              `converging`, so a crash loop holds still --
                              animation on a stuck workload would read as
                              progress that is not happening. */}
                          {rollout.converging && (
                            <Progress.Section
                              value={Math.max(
                                0,
                                ((Math.min(svc.pods?.length ?? 0, svc.desired) - svc.ready) /
                                  svc.desired) *
                                  100
                              )}
                              color={clr}
                              striped
                              animated
                            />
                          )}
                        </>
                      )}
                    </Progress.Root>

                    <Text
                      size="xs"
                      c={rollout.detail ? clr : "dimmed"}
                      ta="right"
                      style={{ flexShrink: 0, minWidth: 72 }}
                      truncate="end"
                      title={rollout.detail || undefined}
                    >
                      {/* ready/desired, not "N up" beside an input showing
                          the same figure -- two numbers that looked like
                          they might disagree. */}
                      {rollout.detail || `${svc.ready}/${svc.desired}`}
                    </Text>

                    <ScaleControl
                      compact
                      kind={svc.kind}
                      namespace={namespace}
                      name={svc.name}
                      cluster={env}
                      current={svc.desired}
                    />
                  </Group>

                  {/* Images and age on one line. The image was styled as a
                      blue link but is not one -- it competed with the name
                      for emphasis when the name is what you scan by. */}
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Tooltip
                      label={svc.images.join("\n")}
                      disabled={svc.images.length === 0}
                      multiline
                      withArrow
                    >
                      <Text size="xs" c="dimmed" ff="monospace" truncate="end" style={{ minWidth: 0 }}>
                        {svc.images[0] ?? "no image"}
                        {svc.images.length > 1 && ` +${svc.images.length - 1}`}
                      </Text>
                    </Tooltip>

                    <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
                      {/* Live usage when metrics-server has it. Omitted
                          rather than shown as zero when it does not: a
                          missing reading is unknown, and "0" would read as
                          an idle service. */}
                      {svc.usage && (
                        <Tooltip
                          label={`${formatCpu(svc.usage.cpuMillis)} CPU · ${formatMemory(
                            svc.usage.memoryMiB
                          )} memory, summed across containers`}
                          withArrow
                        >
                          <Text size="xs" c="dimmed" ff="monospace" style={{ cursor: "help" }}>
                            {formatCpu(svc.usage.cpuMillis)} · {formatMemory(svc.usage.memoryMiB)}
                          </Text>
                        </Tooltip>
                      )}
                      <Text size="xs" c="dimmed">
                        {isUpdating ? "rolling" : svc.lastTransitionTime}
                      </Text>
                    </Group>
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
        size="lg"
        title={
          <Group gap="sm">
            <Text fw={600}>{selectedService?.name}</Text>
            {/* Kind only. The status badge that used to sit here read the
                stale `selectedService` while the pods below reported
                something else -- a header saying STOPPED above a RUNNING
                pod. Live state now lives in the body, from one source. */}
            <Badge variant="outline" size="sm">
              {selectedService?.kind}
            </Badge>
          </Group>
        }
        keepMounted
      >
        <WorkloadDetail
          service={selectedService}
          pods={pods}
          podEvents={podEvents}
          eventsLoadingFor={eventsLoadingFor}
          loading={podsLoading}
          namespace={namespace}
          cluster={env}
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
        />

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
