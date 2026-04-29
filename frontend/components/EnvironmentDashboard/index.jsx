import { AreaChart, BarChart } from "@mantine/charts";
import { useGlobalState } from '@/contexts/global';
import { syncArgoCD, waitForArgoSync } from '@/lib/argocd';
import { notifications } from '@mantine/notifications';
import { useRef } from "react";


import {
  Badge,
  Container,
  Group,
  Text,
  Title,
  Card,
  Table,
  Stack,
  ScrollArea,
  Progress,
  Box,
  LoadingOverlay,
  Button,
  Tooltip,
  ActionIcon,
  Divider,
  ThemeIcon,
  Flex,
  Paper,
  Anchor,
} from "@mantine/core";
import {
  IconCircleFilled,
  IconAlertCircle,
  IconServer,
  IconCpu,
  IconMemory,
  IconDatabase,
  IconDeviceSdCard,
  IconRefresh,
  IconCircleCheck,
  IconClock,
  IconInfoCircle,
  IconExclamationMark,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { callGoApi } from "@/lib/k8s";
import EventsCards from "./EventsData";
import callK8sApi from "@/lib/k8s";

import JobsPage from '@/components/CronJobsPage/Overview';

import LogViewer from '@/components/LokiLogViewer'

import CoreServicesOverview from '@/components/CoreServicesOverview'
import { active } from "d3";

export default function EnvironmentDashboardComp({
  env,
  namespace,
  status = "healthy",
  hostname: hostnameProp,
  test,
}) {
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const [hostname, setHostname] = useState(hostnameProp)
  const [loading, setLoading] = useState(false)
  const { useActiveEnvManager, useActiveEnvAppName, activeEnvManager, activeClusterProvider, activeClusterK8sVersion, activeEnvAppName } = useGlobalState();
  const isArgoEnv = activeEnvManager === 'argocd';

  const [syncingArgo, setSyncingArgo] = useState(false);
  const [argoStatus, setArgoStatus] = useState(null);




  useEffect(() => {
    const fetchHostname = async () => {
      try {
        const configMapResponse = await callK8sApi(
          `/api/v1/namespaces/${namespace}/configmaps/manifest-global`,
          'GET',
          null,
          null,
          env,
          accessToken
        );

        const retrievedHostname = configMapResponse?.data?.hostname || env;
        setHostname(retrievedHostname);
      } catch (error) {
        console.error('Error fetching hostname:', error);
        setHostname(env); // fallback to environment name
      } finally {
        setLoading(false);
      }
    };

    // if (sessionData?.error) {
    //   console.log('Session error detected, signing out:', sessionData.error);
    //   signOut({ callbackUrl: '/' });
    //   return;
    // }

    if (namespace && accessToken) {
      fetchHostname();
    }
  }, [namespace, env, accessToken]);

  // State for storing fetched data
  const [cpuData, setCpuData] = useState([]);
  const [memoryData, setMemoryData] = useState([]);
  const [networkData, setNetworkData] = useState([]);
  const [nodeStatusData, setNodeStatusData] = useState([]);
  const [namespaceStatusData, setNamespaceStatusData] = useState([]);
  const [eventsData, setEventsData] = useState([]);
  const [metricsData, setMetricsData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);


  const [rawNodes, setRawNodes] = useState(null);
  const [rawNamespaces, setRawNamespaces] = useState(null);
  const [rawMetrics, setRawMetrics] = useState(null);
  const [rawEvents, setRawEvents] = useState(null);

  const requestIdRef = useRef(0);


  const colors = {
    healthy: "green",
    warning: "yellow",
    critical: "red",
    offline: "gray",
  };

  // Helper functions
  const calculateAge = (creationTimestamp) => {
    if (!creationTimestamp) return "Unknown";
    const created = new Date(creationTimestamp);
    const now = new Date();
    const diff = now - created;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  };

  const parseCpu = (cpuString) => {
    if (!cpuString) return 0;
    if (cpuString.endsWith("n")) return parseFloat(cpuString) / 1000000000;
    if (cpuString.endsWith("m")) return parseFloat(cpuString) / 1000;
    return parseFloat(cpuString);
  };

  const parseMemory = (memoryString) => {
    if (!memoryString) return 0;
    if (memoryString.endsWith("Ki")) return parseFloat(memoryString) * 1024;
    if (memoryString.endsWith("Mi"))
      return parseFloat(memoryString) * 1024 * 1024;
    if (memoryString.endsWith("Gi"))
      return parseFloat(memoryString) * 1024 * 1024 * 1024;
    return parseFloat(memoryString);
  };

  const formatMemoryUsage = (bytes) => {
    if (bytes >= 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
    if (bytes >= 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
    return `${(bytes / 1024).toFixed(2)} KiB`;
  };

  // Data processing functions
  const processNodesData = (nodesResponse, metricsMap = {}) => {
    if (!nodesResponse?.items) return [];

    return nodesResponse.items.map((node) => {
      const conditions = node.status?.conditions || [];
      const readyCondition = conditions.find((c) => c.type === "Ready");
      const nodeMetrics = metricsMap[node.metadata.name];

      const cpuCapacity = parseCpu(node.status?.capacity?.cpu || "0");
      const memoryCapacity = parseMemory(node.status?.capacity?.memory || "0");
      const memoryInMB = memoryCapacity / (1024 * 1024);

      const cpuUsage = nodeMetrics
        ? Math.round((parseCpu(nodeMetrics.cpu) / cpuCapacity) * 100)
        : 0;

      const memoryUsage = nodeMetrics
        ? Math.round((parseMemory(nodeMetrics.memory) / memoryCapacity) * 100)
        : 0;

      return {
        node: node.metadata.name,
        status: readyCondition?.status === "True" ? "Ready" : "NotReady",
        cpu: cpuUsage,
        memory: memoryUsage,
        pods: node.status?.allocatable?.pods || 0,
        age: calculateAge(node.metadata.creationTimestamp),
        capacity: {
          cpu: `${cpuCapacity.toFixed(1)} cores`,
          memory: `${memoryInMB.toFixed(0)} MB`,
          pods: node.status?.capacity?.pods || "0",
        },
        rawMetrics: nodeMetrics || null,
      };
    });
  };

  const processNamespaceData = (namespaceResponse, podsResponse) => {
    if (!namespaceResponse?.items) return [];

    // Count pods per namespace and calculate resource usage
    const namespaceMetrics = {};
    if (podsResponse?.items) {
      podsResponse.items.forEach((pod) => {
        const ns = pod.metadata.namespace;
        if (!namespaceMetrics[ns]) {
          namespaceMetrics[ns] = {
            podCount: 0,
            cpuRequest: 0,
            memoryRequest: 0,
          };
        }
        namespaceMetrics[ns].podCount++;

        // Calculate resource requests
        pod.spec?.containers?.forEach((container) => {
          namespaceMetrics[ns].cpuRequest += parseCpu(
            container.resources?.requests?.cpu || "0"
          );
          namespaceMetrics[ns].memoryRequest += parseMemory(
            container.resources?.requests?.memory || "0"
          );
        });
      });
    }

    return namespaceResponse.items.map((namespace) => {
      const metrics = namespaceMetrics[namespace.metadata.name] || {};
      return {
        namespace: namespace.metadata.name,
        status: namespace.status?.phase === "Active" ? "Ready" : "NotReady",
        pods: metrics.podCount || 0,
        cpu: metrics.cpuRequest || 0,
        memory: metrics.memoryRequest || 0,
        age: calculateAge(namespace.metadata.creationTimestamp),
      };
    });
  };

  const processPodData = (podsResponse) => {
    if (!podsResponse?.items) return [];

    return podsResponse.items.map((pod) => {
      const conditions = pod.status?.conditions || [];
      const readyCondition = conditions.find((c) => c.type === "Ready");
      const containerStatuses = pod.status?.containerStatuses || [];

      // Calculate resource requests
      let cpuRequest = 0;
      let memoryRequest = 0;
      pod.spec?.containers?.forEach((container) => {
        cpuRequest += parseCpu(container.resources?.requests?.cpu || "0");
        memoryRequest += parseMemory(
          container.resources?.requests?.memory || "0"
        );
      });

      // Determine pod status
      let podStatus = pod.status?.phase || "Unknown";
      if (podStatus === "Pending") {
        const containerWaiting = containerStatuses.find(
          (cs) => cs.state?.waiting?.reason
        );
        if (containerWaiting) {
          podStatus = containerWaiting.state.waiting.reason;
        }
      } else if (podStatus === "Running") {
        podStatus = containerStatuses.every((cs) => cs.ready)
          ? "Running"
          : "NotReady";
      }

      return {
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        status: podStatus,
        node: pod.spec?.nodeName || "N/A",
        restarts: containerStatuses.reduce(
          (sum, cs) => sum + cs.restartCount,
          0
        ),
        age: calculateAge(pod.metadata.creationTimestamp),
        ip: pod.status?.podIP || "N/A",
        containers: pod.spec?.containers?.map((c) => c.name) || [],
        labels: pod.metadata.labels || {},
        resourceUsage: {
          cpu: cpuRequest,
          memory: memoryRequest,
        },
      };
    });
  };

  const processMetricsData = (metricsResponse, nodesResponse) => {
    if (!metricsResponse?.items) return null;

    // Process node metrics
    const nodeMetricsMap = metricsResponse.items.reduce((acc, nodeMetrics) => {
      acc[nodeMetrics.metadata.name] = {
        cpu: nodeMetrics.usage.cpu,
        memory: nodeMetrics.usage.memory,
        timestamp: nodeMetrics.timestamp,
      };
      return acc;
    }, {});

    // Calculate cluster-wide metrics
    let totalCpu = 0;
    let totalMemory = 0;
    let usedCpu = 0;
    let usedMemory = 0;

    nodesResponse?.items?.forEach((node) => {
      const nodeCpu = parseCpu(node.status?.capacity?.cpu || "0");
      const nodeMemory = parseMemory(node.status?.capacity?.memory || "0");
      totalCpu += nodeCpu;
      totalMemory += totalMemory;

      const nodeMetric = nodeMetricsMap[node.metadata.name];
      if (nodeMetric) {
        usedCpu += parseCpu(nodeMetric.cpu);
        usedMemory += parseMemory(nodeMetric.memory);
      }
    });

    return {
      nodes: nodeMetricsMap,
      cluster: {
        totalCpu: `${totalCpu.toFixed(1)} cores`,
        totalMemory: `${(totalMemory / (1024 * 1024 * 1024)).toFixed(1)} GB`,
        usedCpu: `${usedCpu.toFixed(1)} cores`,
        usedMemory: `${(usedMemory / (1024 * 1024 * 1024)).toFixed(1)} GB`,
        cpuPercentage:
          totalCpu > 0 ? Math.round((usedCpu / totalCpu) * 100) : 0,
        memoryPercentage:
          totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 100) : 0,
      },
    };
  };

  const fetchDashboardData = async () => {
    if (!env || !namespace || !accessToken) return;

    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    const safeSet = (setter) => (data) => {
      if (requestIdRef.current === requestId) {
        setter(data);
      }
    };

    const requests = {
      nodes: callGoApi(`/k8s/${env}/proxy/api/v1/nodes`, "GET", null, null, accessToken),
      namespaces: callGoApi(`/k8s/${env}/proxy/api/v1/namespaces`, "GET", null, null, accessToken),
      metrics: callGoApi(`/k8s/${env}/proxy/apis/metrics.k8s.io/v1beta1/nodes`, "GET", null, null, accessToken),
      events: callGoApi(`/k8s/${env}/proxy/api/v1/namespaces/${namespace}/events`, "GET", null, null, accessToken),
    };

    const results = await Promise.allSettled(Object.values(requests));
    const keys = Object.keys(requests);

    results.forEach((result, i) => {
      const key = keys[i];

      console.log("", key, result);

      if (result.status === "fulfilled") {
        if (key === "nodes") safeSet(setRawNodes)(result.value);
        if (key === "namespaces") safeSet(setRawNamespaces)(result.value);
        if (key === "metrics") safeSet(setRawMetrics)(result.value);
        if (key === "events") safeSet(setRawEvents)(result.value);
      } else {
        console.error(`${key} failed`, result.reason);
      }
    });

    const failures = results.filter(r => r.status === "rejected").length;
    if (failures) {
      setError(`${failures} data sources failed to load`);
      setIsLoading(false);
    }

    setIsLoading(false);
  };


  useEffect(() => {
    // Process data if at least some of it is available (not all null)
    const hasData = rawNodes || rawMetrics || rawNamespaces;
    if (!hasData) return;

    console.log("Processing data with", { rawNodes, rawMetrics, rawNamespaces });

    const processedMetrics = processMetricsData(rawMetrics, rawNodes);
    const processedNodes = processNodesData(rawNodes, processedMetrics?.nodes);

    setMetricsData(processedMetrics);
    setNodeStatusData(processedNodes);

    setEventsData(rawEvents?.items ?? []);


  }, [rawNodes, rawMetrics, rawEvents, rawNamespaces]);


  useEffect(() => {
    if (!env || !namespace || !accessToken) return;
    fetchDashboardData();
  }, [env, namespace, accessToken]);


  // Dynamic metrics cards
  const dynamicMetrics = [
    {
      title: "Nodes",
      value: metricsData
        ? `${nodeStatusData.filter((n) => n.status === "Ready").length}/${nodeStatusData.length}`
        : "0/0",
      subtitle: metricsData
        ? `${nodeStatusData.filter((n) => n.status !== "Ready").length} not ready`
        : "0 not ready",
      progress: metricsData
        ? Math.round(
          (nodeStatusData.filter((n) => n.status === "Ready").length /
            nodeStatusData.length) *
          100
        )
        : 0,
      icon: IconServer,
    },
    {
      title: "Pods",
      value: metricsData
        ? `${metricsData.cluster.runningPods}/${metricsData.cluster.totalPods}`
        : "0/0",
      subtitle: metricsData
        ? `${metricsData.cluster.totalPods - metricsData.cluster.runningPods} not running`
        : "0 not running",
      progress: metricsData ? metricsData.cluster.podPercentage : 0,
      icon: IconDatabase,
    },
    {
      title: "CPU Usage",
      value: metricsData ? `${metricsData.cluster.cpuPercentage}%` : "0%",
      subtitle: metricsData
        ? `${metricsData.cluster.usedCpu} of ${metricsData.cluster.totalCpu}`
        : "0 of 0 cores",
      progress: metricsData ? metricsData.cluster.cpuPercentage : 0,
      icon: IconCpu,
    },
    {
      title: "Memory Usage",
      value: metricsData ? `${metricsData.cluster.memoryPercentage}%` : "0%",
      subtitle: metricsData
        ? `${metricsData.cluster.usedMemory} of ${metricsData.cluster.totalMemory}`
        : "0 of 0 GB",
      progress: metricsData ? metricsData.cluster.memoryPercentage : 0,
      icon: IconDeviceSdCard,
    },
  ];

  const PodMemoryBarChart = ({ podData }) => {
    // Sort pods by memory usage (descending)
    const sortedPods = [...podData].sort((a, b) => b.resourceUsage.memory - a.resourceUsage.memory);

    const chartData = sortedPods.map(pod => ({
      pod: pod.name,
      memory: pod.resourceUsage.memory / (1024 * 1024 * 1024), // Convert to GB
      formattedMemory: formatMemoryUsage(pod.resourceUsage.memory),
      status: pod.status,
      // Add truncated version for display
      podShort: pod.name.length > 20 ? `${pod.name.substring(0, 18)}...` : pod.name
    }));

    return (
      <Card withBorder>
        <Title order={4} mb="sm">Memory Usage per Pod</Title>
        <Text c="dimmed" mb="sm">Memory allocation by pod (GiB)</Text>
        <ScrollArea h={350} w="100%" type="always">
          <Box style={{ minWidth: 400 }}>
            <BarChart
              h={300}
              data={chartData}
              dataKey="pod"
              series={[
                {
                  name: 'memory',
                  color: 'blue',
                  label: (value) => `${value.toFixed(2)} GB`
                }
              ]}
              orientation="vertical"
              tickLine="y"
              withXAxis={false}
              withLegend={false}
              barProps={{ radius: 4 }}
              margin={{ left: 150, right: 20, top: 20, bottom: 20 }}
              yAxisProps={{
                width: 140,
                tickMargin: 10,
                // Return string instead of React component
                tickFormatter: (value) => {
                  const pod = chartData.find(p => p.pod === value);
                  return pod?.podShort || value;
                }
              }}
              tooltipProps={{
                content: ({ payload }) => {
                  if (!payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <Paper p="sm" shadow="md">
                      <Text size="sm" fw={500}>{data.pod}</Text>
                      <Text size="sm">Memory: {data.formattedMemory}</Text>
                      <Text size="sm">Status: {data.status}</Text>
                    </Paper>
                  );
                }
              }}
            />
          </Box>
        </ScrollArea>
      </Card>
    );
  };


  const PodCpuBarChart = ({ podData }) => {
    // Sort pods by CPU usage (descending)
    const sortedPods = [...podData].sort((a, b) => b.resourceUsage.cpu - a.resourceUsage.cpu);

    const chartData = sortedPods.map(pod => ({
      pod: pod.name,
      cpu: pod.resourceUsage.cpu,
      status: pod.status,
      // Add truncated version for display
      podShort: pod.name.length > 20 ? `${pod.name.substring(0, 18)}...` : pod.name
    }));

    return (
      <Card withBorder>
        <Title order={4} mb="sm">CPU Usage per Pod</Title>
        <Text c="dimmed" mb="sm">CPU allocation by pod (cores)</Text>
        <ScrollArea h={350} w="100%" type="always">
          <Box style={{ minWidth: 400 }}>
            <BarChart
              h={300}
              data={chartData}
              dataKey="pod"
              series={[
                {
                  name: 'cpu',
                  color: 'green',
                  label: (value) => `${value.toFixed(2)} cores`
                }
              ]}
              orientation="vertical"
              tickLine="y"
              withXAxis={false}
              withLegend={false}
              barProps={{ radius: 4 }}
              margin={{ left: 150, right: 20, top: 20, bottom: 20 }}
              yAxisProps={{
                width: 140,
                tickMargin: 10,
                // Return string instead of React component
                tickFormatter: (value) => {
                  const pod = chartData.find(p => p.pod === value);
                  return pod?.podShort || value;
                }
              }}
              tooltipProps={{
                content: ({ payload }) => {
                  if (!payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <Paper p="sm" shadow="md">
                      <Text size="sm" fw={500}>{data.pod}</Text>
                      <Text size="sm">CPU: {data.cpu.toFixed(2)} cores</Text>
                      <Text size="sm">Status: {data.status}</Text>
                    </Paper>
                  );
                }
              }}
            />
          </Box>
        </ScrollArea>
      </Card>
    );
  };

  return (
    <Container size="xl" mt="xl" pos="relative">
      <LoadingOverlay visible={isLoading || !env || !namespace} overlayBlur={2} />

      {/* Header Section */}
      <Group justify="space-between" mb="md">
        <Title order={1}>{hostname || namespace} Dashboard</Title>
        <Group>
          <Button onClick={fetchDashboardData} loading={isLoading}>
            <IconRefresh />
          </Button>
          {isArgoEnv && (
            <Group>
              <Button
                loading={syncingArgo}
                leftSection={<img src="/images/icons/argocd.png" width={18} />}
                onClick={async () => {
                  setSyncingArgo(true);
                  setArgoStatus('Starting sync...');

                  try {
                    await syncArgoCD({
                      cluster: env,
                      appName: activeEnvAppName,
                      accessToken,
                    });

                    notifications.show({
                      title: 'Sync started',
                      message: 'Waiting for ArgoCD to finish syncing...',
                      color: 'blue',
                    });

                    const finalStatus = await waitForArgoSync({
                      cluster: env,
                      appName: activeEnvAppName,
                      accessToken,
                      onUpdate: (status) => {
                        setArgoStatus(
                          `${status.sync.status} / ${status.health.status} (${status.operationState?.phase || 'Running'})`
                        );
                      },
                    });

                    notifications.show({
                      title: 'Sync complete',
                      message: `Status: ${finalStatus.sync.status}, Health: ${finalStatus.health.status}`,
                      color: 'green',
                    });
                  } catch (err) {
                    notifications.show({
                      title: 'Sync failed',
                      message: err?.message || 'ArgoCD sync failed',
                      color: 'red',
                    });
                  } finally {
                    setSyncingArgo(false);
                  }
                }}
              >
                Sync ArgoCD
              </Button>
              {argoStatus && (
                <Text size="xs" c="dimmed">
                  ArgoCD: {argoStatus}
                </Text>
              )}

            </Group>
          )}

          {/* <Card radius="md">
            <Group gap="sm">
              <Box style={{ position: "relative", width: 16, height: 16, display:'flex', alignItems: 'center', justifyContent:'center' }}>
                <IconCircleFilled color={colors[status]} size={10} style={{ position: "relative", zIndex: 2 }} />
                <Box style={{
                  position: "absolute",
                  borderRadius: "50%",
                  backgroundColor: colors[status],
                  width: 16,
                  height: 16,
                  animation: "pulse 1.5s infinite",
                  opacity: 0,
                  zIndex: 1,
                }} />
              </Box>
              <Text>Cluster {status.charAt(0).toUpperCase() + status.slice(1)}</Text>
            </Group>
          </Card> */}
        </Group>
      </Group>

      <Group gap="sm" mb="xl">
        <Badge color="green" size="sm">
          {namespace}
        </Badge>
        <Badge color="blue">{activeClusterProvider || "—"}</Badge>
        <Badge color="yellow">{activeClusterK8sVersion || "—"}</Badge>
      </Group>

      {
        error && (
          <Card withBorder mb="md" bg="red.1">
            <Text c="red" fw={500}>
              {error}
            </Text>
          </Card>
        )
      }

      <Divider my="lg" />

      {/* Main metrics */}
      {/* <Group align="flex-start" gap="md" mb="xl" grow>
        {dynamicMetrics.map((metric) => (
          <Card
            key={metric.title}
            shadow="sm"
            padding="lg"
            radius="md"
            withBorder
            style={{ flex: 1, minWidth: 280 }}
          >
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="sm" c="dimmed" fw={500}>
                    {metric.title}
                  </Text>
                  <Text size="xl" fw={700} mt={4}>
                    {metric.value}
                  </Text>
                  <Text size="xs" c="dimmed" mt={2}>
                    {metric.subtitle}
                  </Text>
                </div>
                <metric.icon size={20} color="#868E96" />
              </Group>
              <Progress value={metric.progress} size="sm" radius="xs" mt={8} />
            </Stack>
          </Card>
        ))}
      </Group> */}

      <CoreServicesOverview
        env={env}
        namespace={namespace}
        accessToken={accessToken}
      />

      {/* <LogViewer hostname={hostname} /> */}

      <Divider my="lg" />

      <JobsPage namespace={namespace} hideSelect={true} cluster={env} />

      <Divider my="lg" />

      {/* Pod Status Table */}
      {/* <Group align="flex-start" gap="md" mb="xl" grow>
        <Card withBorder>
          <Title order={4} mb="sm">
            Pod Status
          </Title>
          <Text c="dimmed" mb="sm">
            Current Status of All Pods in the {namespace} Namespace
          </Text>
          <ScrollArea h={500}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Namespace</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Node</Table.Th>
                  <Table.Th>Restarts</Table.Th>
                  <Table.Th>Age</Table.Th>
                  <Table.Th>CPU Request</Table.Th>
                  <Table.Th>Memory Request</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {podData.map((pod) => (
                  <Table.Tr key={`${pod.namespace}-${pod.name}`}>
                    <Table.Td><Anchor href={`/clusters/${env}/workloads/pods/${namespace}/${pod.name}`}>{pod.name}</Anchor></Table.Td>
                    <Table.Td>{pod.namespace}</Table.Td>
                    <Table.Td>
                      <Group gap="sm">
                        {pod.status === "Running" ? (
                          <Box
                            style={{
                              position: "relative",
                              width: 16,
                              height: 16,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <IconCircleFilled
                              color={colors[status]}
                              size={10}
                              style={{ position: "relative", zIndex: 2 }}
                            />
                            <Box
                              style={{
                                position: "absolute",
                                borderRadius: "50%",
                                backgroundColor: colors[status],
                                width: 16,
                                height: 16,
                                animation: "pulse 1.5s infinite",
                                opacity: 0,
                                zIndex: 1,
                              }}
                            />
                          </Box>
                        ) : (
                          <IconAlertCircle color="red" size={14} />
                        )}
                        <Text>{pod.status}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>{pod.node}</Table.Td>
                    <Table.Td>{pod.restarts}</Table.Td>
                    <Table.Td>{pod.age}</Table.Td>
                    <Table.Td>
                      {pod.resourceUsage.cpu.toFixed(2)} cores
                    </Table.Td>
                    <Table.Td>
                      {formatMemoryUsage(pod.resourceUsage.memory)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      </Group> */}


      <Divider my="lg" />

      {/* Pod Resource Usage Charts */}
      <Group align="flex-start" gap="md" mb="xl" grow>
        {/* <PodMemoryBarChart podData={podData} />
        <PodCpuBarChart podData={podData} /> */}
      </Group>

      <Divider my="lg" />

      <EventsCards
        eventsData={eventsData}
      />

      {/* Node Status Table */}
      {/* <Group align="flex-start" gap="md" grow>
        <Card withBorder mb="xl">
          <Title order={4} mb="sm">Node Status</Title>
          <Text c="dimmed" mb="sm">Individual node health and resource usage</Text>
          <ScrollArea h={500}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Node</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>CPU %</Table.Th>
                  <Table.Th>Memory</Table.Th>
                  <Table.Th>Pods</Table.Th>
                  <Table.Th>Age</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {nodeStatusData.map((node) => (
                  <Table.Tr key={node.node}>
                    <Table.Td>{node.node}</Table.Td>
                    <Table.Td>
                      <Group gap="sm">
                        {node.status === "Ready" ? (
                          <Box style={{ position: "relative", width: 16, height: 16, display:'flex', alignItems: 'center', justifyContent:'center'  }}>
                            <IconCircleFilled color={colors[status]} size={10} style={{ position: "relative", zIndex: 2 }} />
                            <Box style={{
                              position: "absolute",
                              borderRadius: "50%",
                              backgroundColor: colors[status],
                              width: 16,
                              height: 16,
                              animation: "pulse 2s infinite",
                              opacity: 0,
                              zIndex: 1,
                            }} />
                          </Box>
                        ) : (
                          <IconAlertCircle color="red" size={14} />
                        )}
                        <Text size="sm">{node.status}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="sm">{node.cpu}%</Text></Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Group>
                          <Text size="xs">{node.memory}%</Text>
                          <Text size="xs" style={{fontFamily:'monospace'}}>
                            {node.rawMetrics ?
                              `${formatMemoryUsage(node.rawMetrics.memory)} / ${node.capacity.memory}` :
                              node.capacity.memory}
                          </Text>
                        </Group>
                        <Progress
                          value={node.memory}
                          size="sm"
                          color={node.memory > 80 ? "red" : node.memory > 60 ? "yellow" : "green"}
                          style={{ width: 100 }}
                          sections={[{
                            value: node.memory,
                            color: node.memory > 80 ? "red" : node.memory > 60 ? "yellow" : "green",
                            tooltip: `${node.memory}% memory used`,
                            label: node.memory > 10 ? `${node.memory}%` : undefined,
                          }]}
                          animate={node.memory > 80}
                        />
                      </Stack>
                    </Table.Td>
                    <Table.Td>{node.pods}</Table.Td>
                    <Table.Td>{node.age}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      </Group> */}

      {/* Namespace Overview */}
      {/* <Group align="flex-start" gap="md" mb="xl" grow>
        <Card withBorder mb="xl">
          <Title order={4} mb="sm">Namespace Overview</Title>
          <Text c="dimmed" mb="sm">Resource usage by namespace</Text>
          <ScrollArea h={500}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Namespace</Table.Th>
                  <Table.Th>Pods</Table.Th>
                  <Table.Th>CPU Request</Table.Th>
                  <Table.Th>Memory Request</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {namespaceStatusData.map((ns) => (
                  <Table.Tr key={ns.namespace}>
                    <Table.Td>{ns.namespace}</Table.Td>
                    <Table.Td>{ns.pods}</Table.Td>
                    <Table.Td>{ns.cpu.toFixed(2)} cores</Table.Td>
                    <Table.Td>{formatMemoryUsage(ns.memory)}</Table.Td>
                    <Table.Td>
                      <Group gap="sm">
                        {ns.status === "Ready" ? (
                          <Box style={{ position: "relative", width: 16, height: 16, display:'flex', alignItems: 'center', justifyContent:'center'  }}>
                            <IconCircleFilled color={colors[status]} size={10} style={{ position: "relative", zIndex: 2 }} />
                            <Box style={{
                              position: "absolute",
                              borderRadius: "50%",
                              backgroundColor: colors[status],
                              width: 16,
                              height: 16,
                              animation: "pulse 2s infinite",
                              opacity: 0,
                              zIndex: 1,
                            }} />
                          </Box>
                        ) : (
                          <IconAlertCircle color="red" size={14} />
                        )}
                        <Text>{ns.status}</Text>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      </Group> */}



      {/* Network Traffic */}
      {/* <Group align="flex-start" gap="md" mb="xl" grow>
        <Card withBorder>
          <Title order={4} mb="sm">
            Network Traffic
          </Title>
          <Text c="dimmed" mb="sm">
            Ingress and egress traffic
          </Text>
          <BarChart
            h={200}
            data={networkData}
            dataKey="time"
            series={[{ name: "traffic", color: "violet" }]}
            withYAxis={false}
          />
        </Card>
      </Group> */}

      <style jsx>{`
        @keyframes pulse {
          0% {
            transform: scale(1);
            opacity: 0.7;
          }
          70% {
            transform: scale(1.5);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 0;
          }
        }
      `}</style>
    </Container >
  );
}
