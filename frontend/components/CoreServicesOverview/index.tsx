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
} from "@mantine/core";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  IconRefresh,
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
                    <Text fw={550} size="sm" truncate="end" title={svc.name} style={{ maxWidth: "65%" }}>
                      {svc.name}
                    </Text>
                    <Badge
                      color={clr}
                      variant="light"
                      size="xs"
                    >
                      {health.label.toLowerCase()}
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

      {/* PODS MODAL */}
      <Modal
        opened={podsOpened}
        onClose={() => setPodsOpened(false)}
        size="95vw"
        title={
          <Group gap="sm">
            <Text fw={600}>{selectedService?.name}</Text>
            <Badge color={computeStatus(selectedService?.desired ?? 0, selectedService?.ready ?? 0).color}>
              {computeStatus(selectedService?.desired ?? 0, selectedService?.ready ?? 0).label}
            </Badge>
          </Group>
        }
        keepMounted
      >
        <ScrollArea h="75vh">
          {podsLoading && <Loader size="sm" />}

          {pods.map((pod) => (
            <Card key={pod.name} withBorder radius="sm" mb="sm">
              <Group justify="space-between">
                <Group gap="sm">
                  <Text fw={600}>{pod.name}</Text>
                  <Badge
                    color={
                      pod.phase === "Running"
                        ? "green"
                        : pod.phase === "Pending"
                          ? "yellow"
                          : "red"
                    }
                  >
                    {pod.phase}
                  </Badge>
                </Group>

                <Button
                  size="xs"
                  variant="light"
                  loading={eventsLoading}
                  onClick={() => fetchPodEvents(pod.name)}
                >
                  Refresh Events
                </Button>
              </Group>

              <Divider my="sm" />

              {/* CONTAINERS */}
              <Stack gap={6}>
                {pod.containers.map((c) => (
                  <Group key={c.name} gap="xs">
                    {c.isInit && (
                      <Badge size="xs" color="gray">init</Badge>
                    )}
                    <Badge size="xs" color={c.ready ? "green" : "red"}>
                      {c.ready ? "Ready" : "Not Ready"}
                    </Badge>
                    <Text size="xs">{c.name}</Text>
                    <Badge
                      size="xs"
                      variant="outline"
                      color={c.state === "Running" ? "green" : "orange"}
                    >
                      {c.state}
                    </Badge>
                    {c.reason && (
                      <Text size="xs" c="red">{c.reason}</Text>
                    )}
                    {c.restartCount > 0 && (
                      <Text size="xs" c="dimmed">{c.restartCount} restarts</Text>
                    )}

                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => {
                        setSelectedPod(pod);
                        setSelectedContainer(c.name);
                        setLogsOpened(true);
                      }}
                    >
                      Logs
                    </Button>

                    {!c.isInit && (
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => {
                          setSelectedPod(pod);
                          setSelectedContainer(c.name);
                          setShellOpened(true);
                        }}
                      >
                        Shell
                      </Button>
                    )}
                  </Group>
                ))}
              </Stack>

              <Divider my="sm" />

              {/* EVENTS */}
              <Stack gap={4}>
                {(podEvents[pod.name] || []).slice(0, 6).map((e, i) => (
                  <Group key={i} gap="xs">
                    <Badge size="xs" color={e.type === "Warning" ? "red" : "blue"}>
                      {e.reason}
                    </Badge>
                    <Text size="xs" c="dimmed">{e.message}</Text>
                  </Group>
                ))}
                {!podEvents[pod.name]?.length && (
                  <Text size="xs" c="dimmed">No events</Text>
                )}
              </Stack>
            </Card>
          ))}
        </ScrollArea>
      </Modal>

      {/* LOGS MODAL */}
      <Modal
        opened={logsOpened}
        onClose={() => setLogsOpened(false)}
        size="95vw"
        title={
          selectedPod
            ? `Logs — ${selectedPod.name} / ${selectedContainer}`
            : "Logs"
        }
        keepMounted
      >
        {selectedPod && selectedContainer && (
          <LogWindow
            namespace={namespace}
            pod={selectedPod.name}
            cluster={env}
            containers={[selectedContainer]}
          />
        )}
      </Modal>

      {/* SHELL MODAL */}
      <Modal
        opened={shellOpened}
        onClose={() => setShellOpened(false)}
        size="95vw"
        title={
          selectedPod
            ? `Shell — ${selectedPod.name} / ${selectedContainer}`
            : "Shell"
        }
        keepMounted
      >
        {selectedPod && selectedContainer && (
          <TerminalComponent
            namespace={namespace}
            pod={selectedPod.name}
            container={selectedContainer}
            cluster={env}
          />
        )}
      </Modal>
    </>
  );
}
