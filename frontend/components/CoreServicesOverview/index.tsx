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
  Table,
} from "@mantine/core";
import { useEffect, useState } from "react";
import callK8sApi from "@/lib/k8s";
import LogWindow from "@/components/Logs/LogWindowAgent";

type Service = {
  name: string;
  kind: "Deployment" | "StatefulSet";
  desired: number;
  ready: number;
};

type Pod = {
  name: string;
  phase: string;
  containers: string[];
};

function computeStatus(desired: number, ready: number) {
  if (ready === 0) return { status: "down", color: "red", label: "Down" };
  if (ready < desired) return { status: "degraded", color: "yellow", label: "Degraded" };
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

  // Pods modal
  const [podsOpened, setPodsOpened] = useState(false);
  const [podsLoading, setPodsLoading] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [pods, setPods] = useState<Pod[]>([]);

  // Logs modal
  const [logsOpened, setLogsOpened] = useState(false);
  const [selectedPod, setSelectedPod] = useState<Pod | null>(null);

  useEffect(() => {
    if (!env || !namespace || !accessToken) return;

    const fetchServices = async () => {
      setLoading(true);
      try {
        const [deploymentsRes, statefulSetsRes] = await Promise.all([
          callK8sApi(`/apis/apps/v1/namespaces/${namespace}/deployments`, "GET", null, null, env, accessToken),
          callK8sApi(`/apis/apps/v1/namespaces/${namespace}/statefulsets`, "GET", null, null, env, accessToken),
        ]);

        const deployments =
          deploymentsRes?.items?.map((d: any) => ({
            name: d.metadata.name,
            kind: "Deployment",
            desired: d.spec?.replicas ?? 0,
            ready: d.status?.availableReplicas ?? 0,
          })) ?? [];

        const statefulSets =
          statefulSetsRes?.items?.map((s: any) => ({
            name: s.metadata.name,
            kind: "StatefulSet",
            desired: s.spec?.replicas ?? 0,
            ready: s.status?.readyReplicas ?? 0,
          })) ?? [];

        setServices([...deployments, ...statefulSets]);
      } catch (err) {
        console.error("Failed to fetch services:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, [env, namespace, accessToken]);

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

      const workload = await callK8sApi(resourcePath, "GET", null, null, env, accessToken);
      const matchLabels = workload?.spec?.selector?.matchLabels;

      if (!matchLabels) {
        throw new Error("No selector on workload");
      }

      const labelSelector = buildLabelSelector(matchLabels);

      const podsRes = await callK8sApi(
        `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(labelSelector)}`,
        "GET",
        null,
        null,
        env,
        accessToken
      );

      const parsed: Pod[] =
        podsRes?.items?.map((p: any) => ({
          name: p.metadata.name,
          phase: p.status.phase,
          containers: p.spec?.containers?.map((c: any) => c.name) ?? [],
        })) ?? [];

      setPods(parsed);
    } catch (e) {
      console.error("Failed to load pods:", e);
      setPods([]);
    } finally {
      setPodsLoading(false);
    }
  };

  const openLogsModal = (pod: Pod) => {
    setSelectedPod(pod);
    setLogsOpened(true);
  };

  return (
    <>
      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>Services</Title>
          {loading && <Loader size="sm" />}
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
          {services.map((svc) => {
            const health = computeStatus(svc.desired, svc.ready);

            return (
              <Card
                key={`${svc.kind}-${svc.name}`}
                withBorder
                radius="sm"
                p="md"
                onClick={() => openPodsModal(svc)}
                style={{ cursor: "pointer" }}
              >
                <Stack gap={6}>
                  <Group justify="space-between">
                    <Text fw={600}>{svc.name}</Text>
                    <Badge color={health.color} variant="light">
                      {health.label}
                    </Badge>
                  </Group>

                  <Text size="sm" c="dimmed">
                    {svc.kind}
                  </Text>

                  <Text size="sm">
                    {svc.ready} / {svc.desired} replicas ready
                  </Text>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      </Card>

      {/* Pods modal */}
      <Modal
        opened={podsOpened}
        onClose={() => setPodsOpened(false)}
        size="lg"
        title={selectedService?.name}
        keepMounted
      >
        <Stack>
          <Title order={5}>Pods</Title>

          {podsLoading && <Loader size="sm" />}

          {!podsLoading && pods.length === 0 && (
            <Text size="sm" c="dimmed">
              No pods found for this service.
            </Text>
          )}

          {pods.length > 0 && (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pod</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Containers</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pods.map((pod) => (
                  <Table.Tr key={pod.name}>
                    <Table.Td>{pod.name}</Table.Td>
                    <Table.Td>{pod.phase}</Table.Td>
                    <Table.Td>{pod.containers.length}</Table.Td>
                    <Table.Td>
                      <Button size="xs" onClick={() => openLogsModal(pod)}>
                        Logs
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Modal>

      {/* Logs modal */}
      <Modal
        opened={logsOpened}
        onClose={() => setLogsOpened(false)}
        size="95vw"
        title={selectedPod ? `Logs — ${selectedPod.name}` : "Logs"}
        keepMounted
      >
        {selectedPod && (
          <LogWindow
            namespace={namespace}
            pod={selectedPod.name}
            cluster={env}
            containers={selectedPod.containers}
          />
        )}
      </Modal>
    </>
  );
}
