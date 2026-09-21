import React, { useEffect, useState } from "react";
import {
  Title,
  Text,
  Button,
  Container,
  Group,
  Badge,
  TextInput,
  Select,
  Stack,
  Card,
  Flex,
  Modal,
  ScrollArea,
  Divider,
  Switch,
  Tooltip,
} from "@mantine/core";
import {
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { showNotification } from "@mantine/notifications";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";

import {
  fetchCronJobs,
  triggerCronJob,
  getAllJobs,
} from "./functions";

import JobGrid from "./JobGrid";
import callK8sApi from "@/lib/k8s";
import { isSuspended, useSuspendCronJob } from "@/hooks/useSuspendCronJob";
import { useRoles, writeRoleFor } from "@/hooks/useRoles";

function deriveJobStatus(cronJob, jobInstances) {
  // The field is `spec.suspend`. This read `spec.suspended`, which does not
  // exist on the object, so a suspended CronJob always rendered as active.
  if (isSuspended(cronJob)) {
    return { label: "Suspended", color: "statusNeutral" };
  }

  if (!jobInstances.length) {
    return { label: "Never run", color: "yellow" };
  }

  const lastJob = jobInstances[0];
  const succeeded = lastJob.status?.succeeded > 0;
  const failed = lastJob.status?.failed > 0;

  if (failed) return { label: "Failed", color: "red" };
  if (succeeded) return { label: "Healthy", color: "green" };

  return { label: "Running", color: "blue" };
}

export default function JobsPage({
  namespace,
  hideSelect = false,
  cluster,
}) {
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;
  const clusterName = useParams()?.clustername || cluster;

  const { setSuspended, pending: suspendPending } = useSuspendCronJob();
  const { canWrite } = useRoles();

  const [cronJobs, setCronJobs] = useState([]);
  const [jobInstances, setJobInstances] = useState([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [namespaces, setNamespaces] = useState([]);
  const [selectedNamespace, setSelectedNamespace] = useState(namespace);

  const [historyModal, setHistoryModal] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    fetchNamespaces();
  }, [accessToken]);

  const fetchNamespaces = async () => {
    const data = await callK8sApi(
      `/api/v1/namespaces`,
      "GET",
      null,
      null,
      clusterName,
      accessToken
    );
    setNamespaces(data.items.map((n) => n.metadata.name));
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [cron, jobs] = await Promise.all([
        fetchCronJobs(clusterName, selectedNamespace, accessToken),
        getAllJobs(clusterName, selectedNamespace, accessToken),
      ]);
      setCronJobs(cron || []);
      setJobInstances(jobs?.items || []);
    } catch (e) {
      showNotification({
        title: "Error",
        message: "Failed to fetch jobs",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken && selectedNamespace) refresh();
  }, [accessToken, selectedNamespace]);

  const filtered = cronJobs.filter((cj) => {
    if (!cj.metadata.name.includes(search)) return false;
    if (!filter) return true;
    return isSuspended(cj) ? filter === "Suspended" : filter === "Active";
  });

  return (
    <Container size="lg" pt="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={2}>Background Jobs</Title>
          <Button
            leftSection={<IconRefresh size={16} />}
            onClick={refresh}
            loading={loading}
          >
            Refresh
          </Button>
        </Group>

        {!hideSelect && (
          <Card withBorder>
            <Flex gap="md" wrap="wrap">
              <TextInput
                placeholder="Search jobs…"
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
              />
              <Select
                placeholder="Status"
                value={filter}
                onChange={setFilter}
                data={[
                  { value: "", label: "All" },
                  { value: "Active", label: "Active" },
                  { value: "Suspended", label: "Suspended" },
                ]}
              />
              <Select
                searchable
                placeholder="Namespace"
                value={selectedNamespace}
                onChange={setSelectedNamespace}
                data={namespaces.map((n) => ({
                  value: n,
                  label: n,
                }))}
              />
            </Flex>
          </Card>
        )}

        <Stack gap="sm">
          {filtered.map((cronJob) => {
            const name = cronJob.metadata.name;
            const instances = jobInstances
              .filter((j) =>
                j.metadata.ownerReferences?.some(
                  (r) => r.kind === "CronJob" && r.name === name
                )
              )
              .sort(
                (a, b) =>
                  new Date(b.metadata.creationTimestamp).getTime() -
                  new Date(a.metadata.creationTimestamp).getTime()
              );

            const status = deriveJobStatus(cronJob, instances);

            return (
              <Card key={name} withBorder radius="md">
                <Group justify="space-between" mb={6}>
                  <Text fw={600}>{name}</Text>
                  <Badge color={status.color} variant="light">
                    {status.label}
                  </Badge>
                </Group>

                <Group gap="xs" mb={4}>
                  <Text size="sm" c="dimmed">
                    Schedule:
                  </Text>
                  <Text size="sm" c="dimmed" ff="monospace">
                    {cronJob.spec.schedule}
                  </Text>
                  {/* The schedule stays visible when suspended: it is what
                      the job will resume to, and hiding it made a suspended
                      job look like it had no schedule at all. */}
                  {isSuspended(cronJob) && (
                    <Badge size="sm" color="statusWarn" variant="light">
                      Not scheduling
                    </Badge>
                  )}
                </Group>

                <Group mt="sm">
                  <Button
                    size="xs"
                    leftSection={<IconPlayerPlay size={14} />}
                    onClick={async () => {
                      try {
                        await triggerCronJob(
                          name,
                          selectedNamespace,
                          clusterName,
                          accessToken
                        );
                        refresh();
                        showNotification({
                          title: "Triggered",
                          message: `Job ${name} started`,
                          color: "green",
                        });
                      } catch {
                        showNotification({
                          title: "Error",
                          message: "Failed to trigger job",
                          color: "red",
                        });
                      }
                    }}
                  >
                    Run now
                  </Button>

                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => setHistoryModal({ name, instances })}
                  >
                    View history
                  </Button>

                  <Tooltip
                    label={
                      canWrite(clusterName)
                        ? isSuspended(cronJob)
                          ? "Resume the schedule"
                          : "Stop starting new runs. Anything already running continues."
                        : `Requires the ${writeRoleFor(clusterName)} role`
                    }
                  >
                    <Switch
                      ml="auto"
                      size="sm"
                      labelPosition="left"
                      label={isSuspended(cronJob) ? "Suspended" : "Active"}
                      checked={!isSuspended(cronJob)}
                      disabled={!canWrite(clusterName) || suspendPending}
                      onChange={async (e) => {
                        const ok = await setSuspended(
                          { namespace: selectedNamespace, name, cluster: clusterName },
                          !e.currentTarget.checked
                        );
                        if (ok) refresh();
                      }}
                    />
                  </Tooltip>
                </Group>
              </Card>
            );
          })}
        </Stack>
      </Stack>

      {/* History Modal */}
      <Modal
        opened={!!historyModal}
        onClose={() => setHistoryModal(null)}
        title={`Job history: ${historyModal?.name}`}
        size="lg"
      >
        <ScrollArea h={400}>
          <JobGrid
            data={historyModal?.instances || []}
            parent={historyModal?.name}
          />
        </ScrollArea>
      </Modal>
    </Container>
  );
}
