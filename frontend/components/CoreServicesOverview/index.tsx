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
} from "@mantine/core";
import { useEffect, useState } from "react";
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
  updated: number; // To track rolling update progress
  age: string;
  lastTransitionTime?: string;
  images: string[]; // Container images
};

// Helper to format Kubernetes timestamps into human-readable age (e.g., "5d", "2h", "45m")
function formatAge(timestamp: string | undefined) {
  if (!timestamp) return "Unknown";
  const diffMin = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  return `${Math.floor(diffMin / 1440)}d`;
}

// Helper to strip long registry URLs and just get "image:tag"
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

  const fetchServices = async () => {
    setLoading(true);
    try {
      const [deploymentsRes, statefulSetsRes] = await Promise.all([
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
      ]);

      const deployments =
        deploymentsRes?.items?.map((d: any) => {
          // Find the latest condition transition time
          const availableCondition = d.status?.conditions?.find((c: any) => c.type === "Available");
          const progressingCondition = d.status?.conditions?.find((c: any) => c.type === "Progressing");
          const lastTransition = availableCondition?.lastTransitionTime || progressingCondition?.lastTransitionTime;

          return {
            name: d.metadata.name,
            kind: "Deployment",
            desired: d.spec?.replicas ?? 0,
            ready: d.status?.readyReplicas ?? 0,
            updated: d.status?.updatedReplicas ?? 0,
            age: formatAge(d.metadata.creationTimestamp),
            lastTransitionTime: formatAge(lastTransition),
            images: d.spec?.template?.spec?.containers?.map((c: any) => formatImageName(c.image)) ?? [],
          };
        }) ?? [];

      const statefulSets =
        statefulSetsRes?.items?.map((s: any) => ({
          name: s.metadata.name,
          kind: "StatefulSet",
          desired: s.spec?.replicas ?? 0,
          ready: s.status?.readyReplicas ?? 0,
          updated: s.status?.updatedReplicas ?? 0,
          age: formatAge(s.metadata.creationTimestamp),
          lastTransitionTime: "N/A", // StatefulSets track conditions slightly differently
          images: s.spec?.template?.spec?.containers?.map((c: any) => formatImageName(c.image)) ?? [],
        })) ?? [];

      setServices([...deployments, ...statefulSets]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!env || !namespace || !accessToken) return;

    fetchServices();
  }, [env, namespace, accessToken]);

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

  return (
    <>
      {/* SERVICES */}
      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>Services</Title>
          {loading && <Loader size="sm" />}
          <Button onClick={fetchServices}>
            Refresh
          </Button>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
          {services.map((svc) => {
            const health = computeStatus(svc.desired, svc.ready);
            const isUpdating = svc.updated < svc.desired && svc.desired > 0;

            return (
              <Card
                key={`${svc.kind}-${svc.name}`}
                withBorder
                radius="md"
                p="md"
                onClick={() => openPodsModal(svc)}
                style={{ cursor: "pointer" }}
              >
                <Stack gap="sm" h="100%">
                  {/* Top Section: Title, Age, and Status Badge */}
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Stack gap={0} style={{ overflow: "hidden" }}>
                      <Text fw={600} truncate="end" title={svc.name}>
                        {svc.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {svc.kind} • Age: {svc.age}
                      </Text>
                    </Stack>
                    <Badge
                      color={health.color}
                      variant="light"
                      size="sm"
                      style={{ flexShrink: 0 }}
                    >
                      {health.label}
                    </Badge>
                  </Group>

                  {/* Middle Section: Image Tags */}
                  <Group gap={6} mt="xs" style={{ flexGrow: 1 }}>
                    {svc.images.map((img, idx) => (
                      <Tooltip key={idx} label="Container Image" withArrow>
                        <Badge
                          size="xs"
                          variant="default"
                          style={{ textTransform: "none", fontWeight: 400 }}
                        >
                          {img}
                        </Badge>
                      </Tooltip>
                    ))}
                  </Group>

                  {/* Bottom Section: Replicas and Last Updated */}
                  <Group justify="space-between" mt="xs">
                    <Text size="sm" fw={600}>
                      {svc.ready} <Text span size="sm" c="dimmed" fw={400}>/ {svc.desired} ready</Text>
                    </Text>

                    {isUpdating ? (
                      <Badge size="xs" color="blue" variant="dot">
                        Updating ({svc.updated}/{svc.desired})
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">
                        Updated {svc.lastTransitionTime} ago
                      </Text>
                    )}
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      </Card>

      {/* PODS MODAL */}
      <Modal
        opened={podsOpened}
        onClose={() => setPodsOpened(false)}
        size="95vw"
        title={selectedService?.name}
        keepMounted
      >
        <ScrollArea h="75vh">
          {podsLoading && <Loader size="sm" />}

          {pods.map((pod) => (
            <Card key={pod.name} withBorder radius="sm" mb="sm">
              <Group justify="space-between">
                <Group>
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
                      <Badge size="xs" color="gray">
                        init
                      </Badge>
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
                      <Text size="xs" c="red">
                        {c.reason}
                      </Text>
                    )}
                    {c.restartCount > 0 && (
                      <Text size="xs" c="dimmed">
                        🔁 {c.restartCount}
                      </Text>
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
                    <Text size="xs" c="dimmed">
                      {e.message}
                    </Text>
                  </Group>
                ))}
                {!podEvents[pod.name]?.length && (
                  <Text size="xs" c="dimmed">
                    No events
                  </Text>
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
