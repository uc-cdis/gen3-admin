import {
  Card,
  SimpleGrid,
  Group,
  Text,
  Badge,
  Stack,
  Loader,
  Title,
} from "@mantine/core";
import { useEffect, useState } from "react";
import callK8sApi from "@/lib/k8s";

type Service = {
  name: string;
  kind: "Deployment" | "StatefulSet";
  desired: number;
  ready: number;
};

function computeStatus(desired: number, ready: number) {
  if (ready === 0) {
    return { status: "down", color: "red", label: "Down" };
  }

  if (ready < desired) {
    return { status: "degraded", color: "yellow", label: "Degraded" };
  }

  return { status: "healthy", color: "green", label: "Healthy" };
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

  useEffect(() => {
    if (!env || !namespace || !accessToken) return;

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

        const deployments: Service[] =
          deploymentsRes?.items?.map((d: any) => ({
            name: d.metadata.name,
            kind: "Deployment",
            desired: d.spec?.replicas ?? 0,
            ready: d.status?.availableReplicas ?? 0,
          })) ?? [];

        const statefulSets: Service[] =
          statefulSetsRes?.items?.map((s: any) => ({
            name: s.metadata.name,
            kind: "StatefulSet",
            desired: s.spec?.replicas ?? 0,
            ready: s.status?.readyReplicas ?? 0,
          })) ?? [];

        setServices([...deployments, ...statefulSets]);
      } catch (err) {
        console.error("Failed to fetch services overview:", err);
        setServices([]);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, [env, namespace, accessToken]);

  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" mb="md">
        <Title order={4}>Services</Title>
        {loading && <Loader size="sm" />}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
        {services.map((svc) => {
          const health = computeStatus(svc.desired, svc.ready);

          return (
            <Card key={`${svc.kind}-${svc.name}`} withBorder radius="sm" p="md">
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

        {!loading && services.length === 0 && (
          <Text c="dimmed" size="sm">
            No deployments or statefulsets found in this namespace.
          </Text>
        )}
      </SimpleGrid>
    </Card>
  );
}
