import { useState, useEffect } from 'react';
import { useForm } from '@mantine/form';
import { IconRefresh, IconPencil, IconSend, IconCopy, IconCheck, IconHistory, IconTrendingUp, IconDatabase, IconChevronRight, IconExternalLink, IconMaximize, IconMinimize } from '@tabler/icons-react';
import {
  Paper,
  Stack,
  Group,
  Text,
  Select,
  Divider,
  TextInput,
  Container,
  Grid,
  ActionIcon,
  Tooltip,
  Button,
  Code,
  Textarea,
  Alert,
  Loader,
  Badge,
  JsonInput,
  Card,
  SimpleGrid,
  RingProgress,
  ThemeIcon,
  Box,
  Tabs,
  Timeline,
  CopyButton,
  ScrollArea,
  Anchor,
  Modal,
  Kbd
} from '@mantine/core';

import { callGoApi } from '@/lib/k8s';
import { useSession } from 'next-auth/react';
import { Editor } from '@monaco-editor/react';

import { useGlobalState } from '@/contexts/global';

const httpMethods = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'DELETE', label: 'DELETE' },
  { value: 'HEAD', label: 'HEAD' },
  { value: 'PATCH', label: 'PATCH' }
];

const commonEndpoints = [
  { value: '/_cluster/health', label: '🏥 Cluster Health', category: 'Cluster' },
  { value: '/_cluster/stats', label: '📊 Cluster Stats', category: 'Cluster' },
  { value: '/_cluster/state', label: '🔄 Cluster State', category: 'Cluster' },
  { value: '/_nodes', label: '🖥️ Node Info', category: 'Nodes' },
  { value: '/_nodes/stats', label: '📈 Node Stats', category: 'Nodes' },
  { value: '/_cat/indices?v', label: '📋 List Indices', category: 'Catalog' },
  { value: '/_cat/aliases?v', label: '🔗 List Aliases', category: 'Catalog' },
  { value: '/_cat/shards?v', label: '🗂️ List Shards', category: 'Catalog' },
  { value: '/_cat/nodes?v', label: '💻 List Nodes', category: 'Catalog' },
  { value: '/your-index/_search', label: '🔍 Search Index', category: 'Index Operations' },
  { value: '/your-index/_mapping', label: '🗺️ Index Mapping', category: 'Index Operations' },
  { value: '/your-index/_settings', label: '⚙️ Index Settings', category: 'Index Operations' }
];

const requestTemplates = {
  search: {
    name: 'Basic Search',
    body: JSON.stringify({
      query: {
        match_all: {}
      },
      size: 10
    }, null, 2)
  },
  termSearch: {
    name: 'Term Search',
    body: JSON.stringify({
      query: {
        term: {
          "field_name": "value"
        }
      }
    }, null, 2)
  },
  aggregation: {
    name: 'Aggregation',
    body: JSON.stringify({
      aggs: {
        my_aggregation: {
          terms: {
            field: "field_name",
            size: 10
          }
        }
      }
    }, null, 2)
  },
  bulkIndex: {
    name: 'Bulk Index',
    body: JSON.stringify({
      index: {
        _index: "my-index",
        _id: "1"
      }
    }, null, 2)
  }
};

export default function Elasticsearch() {
  const { activeCluster, setActiveCluster, activeGlobalEnv, setActiveGlobalEnv } = useGlobalState();
  const [cluster, namespace] = activeGlobalEnv.split('/');

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);
  const [responseTime, setResponseTime] = useState(null);
  const [requestHistory, setRequestHistory] = useState([]);
  const [clusterHealth, setClusterHealth] = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [indices, setIndices] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [loadingIndices, setLoadingIndices] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [proxyMode, setProxyMode] = useState("auto");
  // "auto" | "k8s" | "agent"

  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const form = useForm({
    initialValues: {
      method: 'GET',
      url: '/_cluster/health',
      body: ''
    },
    validate: {
      url: (value) => (!value ? 'URL is required' : null),
      body: (value, values) => {
        if (['POST', 'PUT', 'PATCH'].includes(values.method) && value) {
          try {
            JSON.parse(value);
            return null;
          } catch (e) {
            return 'Body must be valid JSON';
          }
        }
        return null;
      }
    }
  });

  // Fetch cluster health and indices on mount
  useEffect(() => {
    if (cluster && namespace) {
      fetchClusterHealth();
      fetchIndices();
    }
  }, [cluster, namespace]);


  const parseMaybeJson = (res) => (typeof res === "string" ? JSON.parse(res) : res);

  const callEs = async (esPath, method = "GET", body = null) => {
    if (!cluster || !namespace) throw new Error("Missing cluster or namespace");

    const doCall = (proxyPath) =>
      callGoApi(proxyPath, method, body, null, accessToken, "text");

    if (proxyMode === "auto") {
      try {
        return await doCall(buildK8sProxyPath(esPath));
      } catch (err) {
        console.warn("K8s proxy failed — falling back to agent proxy", err);
        return await doCall(buildAgentProxyPath(esPath));
      }
    }

    const proxyPath =
      proxyMode === "agent"
        ? buildAgentProxyPath(esPath)
        : buildK8sProxyPath(esPath);

    return await doCall(proxyPath);
  };

  const fetchIndices = async () => {
    if (!cluster || !namespace) return;

    setLoadingIndices(true);
    try {
      const response = await callEs("/_cat/indices?format=json", "GET");
      const parsed = parseMaybeJson(response);

      if (Array.isArray(parsed)) {
        const indexList = parsed
          .map((idx) => ({
            value: idx.index,
            label: `${idx.index} (${idx["docs.count"] || 0} docs)`,
            health: idx.health,
            status: idx.status,
            docsCount: idx["docs.count"],
          }))
          .filter((idx) => idx.value && !idx.value.startsWith("."))
          .sort((a, b) => a.value.localeCompare(b.value));

        setIndices(indexList);
      }
    } catch (error) {
      console.error("Failed to fetch indices:", error);
    } finally {
      setLoadingIndices(false);
    }
  };

  const fetchClusterHealth = async () => {
    if (!cluster || !namespace) return;

    try {
      const health = await callEs("/_cluster/health", "GET");
      setClusterHealth(parseMaybeJson(health));
    } catch (error) {
      console.error("Failed to fetch cluster health:", error);
    }
  };

  const executeElasticsearchRequest = async (values) => {
    if (!cluster || !namespace) {
      setError("Please select a cluster and namespace");
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    const startTime = Date.now();

    try {
      let requestBody = null;

      if (["POST", "PUT", "PATCH"].includes(values.method) && values.body) {
        try {
          requestBody = JSON.parse(values.body);
        } catch {
          throw new Error("Invalid JSON in request body");
        }
      }

      // IMPORTANT: values.url should be an Elasticsearch path like "/_search" etc.
      const rawResponse = await callEs(values.url, values.method, requestBody);

      const endTime = Date.now();
      const responseTimeMs = endTime - startTime;

      setResponseTime(responseTimeMs);
      setResponse(rawResponse);

      const historyEntry = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        method: values.method,
        url: values.url,
        responseTime: responseTimeMs,
        status: "success",
      };

      setRequestHistory((prev) => [historyEntry, ...prev.slice(0, 9)]);
    } catch (error) {
      console.error("Elasticsearch request failed:", error);
      setError(error.message || "Request failed");

      const historyEntry = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        method: values.method,
        url: values.url,
        status: "error",
      };

      setRequestHistory((prev) => [historyEntry, ...prev.slice(0, 9)]);
    } finally {
      setLoading(false);
    }
  };

  const formatResponse = (data) => {
    if (typeof data === 'string') {
      try {
        return JSON.stringify(JSON.parse(data), null, 2);
      } catch {
        return data;
      }
    }
    return JSON.stringify(data, null, 2);
  };

  const getStatusColor = (status) => {
    if (!status) return 'gray';
    const statusLower = status.toLowerCase();
    if (statusLower === 'green') return 'green';
    if (statusLower === 'yellow') return 'yellow';
    if (statusLower === 'red') return 'red';
    return 'blue';
  };

  const loadHistoryItem = (item) => {
    form.setValues({
      method: item.method,
      url: item.url,
      body: form.values.body
    });
  };

  const handleViewUnassignedShards = () => {
    form.setFieldValue('url', '/_cat/shards?v&h=index,shard,prirep,state,unassigned.reason&s=state');
    form.setFieldValue('method', 'GET');
  };


  const applyTemplate = (template) => {
    form.setFieldValue('body', template.body);
    setShowTemplates(false);
  };

  const applyIndexToUrl = (index) => {
    setSelectedIndex(index);
    const currentUrl = form.values.url;

    if (currentUrl.includes('your-index')) {
      form.setFieldValue('url', currentUrl.replace('your-index', index));
    } else if (currentUrl.startsWith('/') && !currentUrl.startsWith('/_')) {
      const parts = currentUrl.split('/');
      if (parts.length > 1) {
        parts[1] = index;
        form.setFieldValue('url', parts.join('/'));
      }
    } else {
      form.setFieldValue('url', `/${index}/_search`);
    }
  };

  const buildK8sProxyPath = (url) =>
    `/k8s/${cluster}/proxy/api/v1/namespaces/${namespace}/services/gen3-elasticsearch-master:9200/proxy${url}`;

  const buildAgentProxyPath = (url) => {
    const target = `http://gen3-elasticsearch-master.${namespace}.svc:9200${url}`;
    return `/agents/${cluster}/http?url=${encodeURIComponent(target)}`;
  };

  const parseResponseForLinks = (responseData) => {
    try {
      const parsed = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
      const links = [];

      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          if (item.index) {
            links.push({ type: 'index', value: item.index });
          }
        });
      } else if (parsed.indices) {
        Object.keys(parsed.indices).forEach(index => {
          links.push({ type: 'index', value: index });
        });
      }

      return links;
    } catch {
      return [];
    }
  };

  const links = response ? parseResponseForLinks(response) : [];

  return (
    <div>
      <Group position="apart" mb="xl">
        <div>
          <Group spacing="xs" mb={4}>
            <Text size="xl" weight={700}>Elasticsearch Dashboard</Text>
            <Badge size="lg" variant="dot" color={clusterHealth ? getStatusColor(clusterHealth.status) : 'gray'}>
              {clusterHealth?.status || 'Unknown'}
            </Badge>
          </Group>
          <Group spacing={8}>
            <Text size="sm" c="dimmed">{cluster}</Text>
            <IconChevronRight size={14} color="gray" />
            <Text size="sm" c="dimmed">{namespace}</Text>
          </Group>
        </div>

        <Button
          leftIcon={<IconRefresh size={16} />}
          variant="light"
          onClick={() => {
            fetchClusterHealth();
            fetchIndices();
          }}
        >
          Refresh
        </Button>
      </Group>

      {/* Cluster Health Overview Cards */}
      {clusterHealth && (
        <SimpleGrid cols={4} mb="xl" breakpoints={[{ maxWidth: 'md', cols: 2 }]}>
          <Card withBorder padding="lg">
            <Group position="apart">
              <div>
                <Text size="xs" color="dimmed" weight={500} transform="uppercase">
                  Cluster Status
                </Text>
                <Text size="xl" weight={700} mt={4}>
                  {clusterHealth.status}
                </Text>
              </div>
              <RingProgress
                size={60}
                thickness={6}
                sections={[
                  {
                    value: clusterHealth.status === 'green' ? 100 : clusterHealth.status === 'yellow' ? 75 : 50,
                    color: getStatusColor(clusterHealth.status)
                  }
                ]}
              />
            </Group>
          </Card>

          <Card withBorder padding="lg">
            <Group position="apart">
              <div>
                <Text size="xs" color="dimmed" weight={500} transform="uppercase">
                  Nodes
                </Text>
                <Text size="xl" weight={700} mt={4}>
                  {clusterHealth.number_of_nodes}
                </Text>
                <Text size="xs" color="dimmed" mt={2}>
                  {clusterHealth.number_of_data_nodes} data nodes
                </Text>
              </div>
              <ThemeIcon size={50} radius="md" variant="light">
                <IconDatabase size={26} />
              </ThemeIcon>
            </Group>
          </Card>

          <Card withBorder padding="lg">
            <Group position="apart">
              <div>
                <Text size="xs" color="dimmed" weight={500} transform="uppercase">
                  Active Shards
                </Text>
                <Text size="xl" weight={700} mt={4}>
                  {clusterHealth.active_shards}
                </Text>
                <Text size="xs" color="dimmed" mt={2}>
                  {clusterHealth.active_primary_shards} primary
                </Text>
              </div>
              <ThemeIcon size={50} radius="md" variant="light" color="blue">
                <IconTrendingUp size={26} />
              </ThemeIcon>
            </Group>
          </Card>

          <Card
            withBorder
            padding="lg"
            style={{ cursor: clusterHealth.unassigned_shards > 0 ? 'pointer' : 'default' }}
            onClick={clusterHealth.unassigned_shards > 0 ? handleViewUnassignedShards : undefined}
          >
            <Group position="apart">
              <div>
                <Text size="xs" color="dimmed" weight={500} transform="uppercase">
                  Unassigned
                </Text>
                <Text size="xl" weight={700} mt={4} color={clusterHealth.unassigned_shards > 0 ? 'orange' : 'green'}>
                  {clusterHealth.unassigned_shards}
                </Text>
                <Text size="xs" color="dimmed" mt={2}>
                  {clusterHealth.unassigned_shards > 0 ? 'Click to view' : 'shards'}
                </Text>
              </div>
              <ThemeIcon size={50} radius="md" variant="light" color={clusterHealth.unassigned_shards > 0 ? 'orange' : 'green'}>
                <Text size="xl" weight={700}>{clusterHealth.unassigned_shards}</Text>
              </ThemeIcon>
            </Group>
          </Card>

        </SimpleGrid>
      )}

      {/* Main Interface */}
      <Paper p="md" radius="md" withBorder>
        <Container fluid>
          <Grid gutter="xl">
            <Grid.Col span={5}>
              <Stack spacing="lg">
                <Group position="apart">
                  <Text weight={600} size="lg">Request Builder</Text>
                  <Group spacing="xs">
                    <Kbd size="xs">Ctrl</Kbd>
                    <Text size="xs" c="dimmed">+</Text>
                    <Kbd size="xs">Enter</Kbd>
                  </Group>
                  <Select
                    label="Proxy Mode"
                    value={proxyMode}
                    onChange={setProxyMode}
                    data={[
                      { value: "auto", label: "Auto (fallback)" },
                      { value: "k8s", label: "Kubernetes API Proxy" },
                      { value: "agent", label: "Agent HTTP Proxy" }
                    ]}
                  />
                </Group>

                <form onSubmit={form.onSubmit(executeElasticsearchRequest)}>
                  <Stack spacing="md">
                    {/* Index Selector */}
                    <Stack spacing="sm">
                      <Group position="apart">
                        <Text size="sm" weight={600}>Index Operations</Text>
                        <ActionIcon
                          size="sm"
                          variant="light"
                          loading={loadingIndices}
                          onClick={fetchIndices}
                        >
                          <IconRefresh size={14} />
                        </ActionIcon>
                      </Group>

                      <Select
                        placeholder="Select an index"
                        data={indices}
                        value={selectedIndex}
                        onChange={applyIndexToUrl}
                        searchable
                        clearable
                        disabled={loadingIndices}
                        icon={<IconDatabase size={16} />}
                        rightSection={loadingIndices ? <Loader size="xs" /> : undefined}
                      />

                      {selectedIndex && (
                        <Group spacing="xs">
                          <Button
                            size="xs"
                            variant="default"
                            compact
                            leftIcon={<IconExternalLink size={12} />}
                            onClick={() => form.setFieldValue('url', `/${selectedIndex}/_search`)}
                          >
                            Search
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            compact
                            onClick={() => form.setFieldValue('url', `/${selectedIndex}/_mapping`)}
                          >
                            Mapping
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            compact
                            onClick={() => form.setFieldValue('url', `/${selectedIndex}/_settings`)}
                          >
                            Settings
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            compact
                            onClick={() => form.setFieldValue('url', `/${selectedIndex}/_count`)}
                          >
                            Count
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            compact
                            onClick={() => {
                              form.setFieldValue('url', `/${selectedIndex}/_refresh`);
                              form.setFieldValue('method', 'POST');
                            }}
                          >
                            Refresh
                          </Button>
                        </Group>
                      )}
                    </Stack>

                    <Divider />

                    <Group grow>
                      <Select
                        label="Method"
                        placeholder="Select HTTP method"
                        data={httpMethods}
                        {...form.getInputProps('method')}
                      />
                      <Select
                        label="Quick Select"
                        placeholder="Choose endpoint"
                        data={commonEndpoints}
                        searchable
                        clearable
                        onChange={(value) => {
                          if (value) form.setFieldValue('url', value);
                        }}
                      />
                    </Group>

                    <TextInput
                      label="Endpoint URL"
                      placeholder="e.g., /_cluster/health"
                      withAsterisk
                      rightSection={
                        <Tooltip label="Copy URL">
                          <CopyButton value={form.values.url}>
                            {({ copied, copy }) => (
                              <ActionIcon onClick={copy} size="sm">
                                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                              </ActionIcon>
                            )}
                          </CopyButton>
                        </Tooltip>
                      }
                      {...form.getInputProps('url')}
                    />

                    {['POST', 'PUT', 'PATCH'].includes(form.values.method) && (
                      <>
                        <Group position="apart">
                          <Text size="sm" weight={500}>Request Body</Text>
                          <Button
                            size="xs"
                            variant="subtle"
                            compact
                            onClick={() => setShowTemplates(true)}
                          >
                            Load Template
                          </Button>
                        </Group>
                        <JsonInput
                          placeholder='{"query": {"match_all": {}}}'
                          minRows={10}
                          maxRows={15}
                          formatOnBlur
                          autosize
                          {...form.getInputProps('body')}
                        />
                      </>
                    )}

                    <Button
                      type="submit"
                      leftIcon={<IconSend size={16} />}
                      loading={loading}
                      disabled={!cluster || !namespace}
                      fullWidth
                      size="md"
                    >
                      Execute Request
                    </Button>
                  </Stack>
                </form>

                {/* Request History */}
                <Paper p="md" withBorder mt="md">
                  <Group position="apart" mb="xs">
                    <Text size="sm" weight={600}>Recent Requests</Text>
                    <IconHistory size={18} />
                  </Group>
                  <ScrollArea h={250}>
                    {requestHistory.length === 0 ? (
                      <Text size="sm" c="dimmed" align="center" py="xl">
                        No request history yet
                      </Text>
                    ) : (
                      <Timeline active={-1} bulletSize={20} lineWidth={2}>
                        {requestHistory.map((item) => (
                          <Timeline.Item
                            key={item.id}
                            bullet={
                              <Badge
                                size="xs"
                                color={item.status === 'success' ? 'green' : 'red'}
                                variant="filled"
                              >
                                {item.method}
                              </Badge>
                            }
                          >
                            <Group position="apart">
                              <div style={{ flex: 1 }}>
                                <Anchor
                                  size="sm"
                                  onClick={() => loadHistoryItem(item)}
                                  style={{ cursor: 'pointer' }}
                                >
                                  {item.url}
                                </Anchor>
                                <Group spacing={4} mt={2}>
                                  <Text size="xs" c="dimmed">{item.timestamp}</Text>
                                  {item.responseTime && (
                                    <>
                                      <Text size="xs" c="dimmed">•</Text>
                                      <Text size="xs" c="dimmed">{item.responseTime}ms</Text>
                                    </>
                                  )}
                                </Group>
                              </div>
                            </Group>
                          </Timeline.Item>
                        ))}
                      </Timeline>
                    )}
                  </ScrollArea>
                </Paper>
              </Stack>
            </Grid.Col>

            <Grid.Col span={7}>
              <Box
                style={{
                  position: isFullscreen ? 'fixed' : 'relative',
                  top: isFullscreen ? 0 : 'auto',
                  left: isFullscreen ? 0 : 'auto',
                  right: isFullscreen ? 0 : 'auto',
                  bottom: isFullscreen ? 0 : 'auto',
                  zIndex: isFullscreen ? 1000 : 'auto',
                  background: isFullscreen ? 'var(--mantine-color-body)' : 'transparent',
                  padding: isFullscreen ? '20px' : 0,
                  overflow: isFullscreen ? 'auto' : 'visible',
                  transition: 'all 0.3s ease-in-out',
                }}
              >
                <Stack spacing="md">
                  <Group position="apart">
                    <Text weight={600} size="lg">Response</Text>
                    <Group spacing="xs">
                      {responseTime && (
                        <Badge color="gray" variant="light" size="lg">
                          ⚡ {responseTime}ms
                        </Badge>
                      )}
                      {response && (
                        <Badge
                          color={getStatusColor(
                            typeof response === 'object' && response.status
                              ? response.status
                              : 'success'
                          )}
                          variant="light"
                          size="lg"
                        >
                          {typeof response === 'object' && response.status
                            ? response.status
                            : 'Success'}
                        </Badge>
                      )}
                      {response && (
                        <>
                          <Tooltip label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                            <ActionIcon onClick={() => setIsFullscreen(!isFullscreen)} variant="light" size="lg">
                              {isFullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
                            </ActionIcon>
                          </Tooltip>
                          <CopyButton value={formatResponse(response)}>
                            {({ copied, copy }) => (
                              <Tooltip label={copied ? 'Copied!' : 'Copy response'}>
                                <ActionIcon onClick={copy} variant="light" size="lg">
                                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </CopyButton>
                        </>
                      )}
                    </Group>
                  </Group>

                  {loading && (
                    <Card withBorder p="xl">
                      <Group position="center" direction="column" spacing="md">
                        <Loader size="lg" variant="dots" />
                        <Text size="sm" c="dimmed">Executing request...</Text>
                      </Group>
                    </Card>
                  )}

                  {error && (
                    <Alert color="red" title="Request Failed" icon={<IconExternalLink size={16} />}>
                      {error}
                    </Alert>
                  )}

                  {response && !loading && (
                    <Tabs defaultValue="formatted">
                      <Tabs.List>
                        <Tabs.Tab value="formatted">Formatted</Tabs.Tab>
                        <Tabs.Tab value="raw">Raw</Tabs.Tab>
                        {links.length > 0 && <Tabs.Tab value="links">Quick Actions</Tabs.Tab>}
                      </Tabs.List>

                      <Tabs.Panel value="formatted" pt="md">
                        <Paper withBorder>
                          <Editor
                            value={formatResponse(response)}
                            height={isFullscreen ? "calc(100vh - 200px)" : "600px"}
                            defaultLanguage="json"
                            theme="vs-dark"
                            options={{
                              readOnly: true,
                              minimap: { enabled: isFullscreen },
                              fontSize: 13,
                              lineNumbers: 'on',
                              scrollBeyondLastLine: false,
                              automaticLayout: true
                            }}
                          />
                        </Paper>
                      </Tabs.Panel>

                      <Tabs.Panel value="raw" pt="md">
                        <Paper withBorder p="md">
                          <ScrollArea h={isFullscreen ? "calc(100vh - 200px)" : 600}>
                            <Code block>
                              {formatResponse(response)}
                            </Code>
                          </ScrollArea>
                        </Paper>
                      </Tabs.Panel>

                      {links.length > 0 && (
                        <Tabs.Panel value="links" pt="md">
                          <Paper withBorder p="md">
                            <Text size="sm" weight={500} mb="md">
                              Detected Resources
                            </Text>
                            <Stack spacing="xs">
                              {links.map((link, idx) => (
                                <Card key={idx} withBorder p="xs">
                                  <Group position="apart">
                                    <Group spacing="xs">
                                      <Badge size="sm">{link.type}</Badge>
                                      <Code>{link.value}</Code>
                                    </Group>
                                    <Group spacing="xs">
                                      <Button
                                        size="xs"
                                        variant="subtle"
                                        compact
                                        onClick={() => {
                                          setSelectedIndex(link.value);
                                          form.setFieldValue('url', `/${link.value}/_search`);
                                          setIsFullscreen(false);
                                        }}
                                      >
                                        Search
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="subtle"
                                        compact
                                        onClick={() => {
                                          setSelectedIndex(link.value);
                                          form.setFieldValue('url', `/${link.value}/_mapping`);
                                          setIsFullscreen(false);
                                        }}
                                      >
                                        Mapping
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="subtle"
                                        compact
                                        onClick={() => {
                                          setSelectedIndex(link.value);
                                          form.setFieldValue('url', `/${link.value}/_settings`);
                                          setIsFullscreen(false);
                                        }}
                                      >
                                        Settings
                                      </Button>
                                    </Group>
                                  </Group>
                                </Card>
                              ))}
                            </Stack>
                          </Paper>
                        </Tabs.Panel>
                      )}
                    </Tabs>
                  )}

                  {!response && !loading && !error && (
                    <Card withBorder p="xl" style={{ minHeight: isFullscreen ? 'calc(100vh - 200px)' : 600 }}>
                      <Stack align="center" justify="center" style={{ height: '100%' }}>
                        <ThemeIcon size={80} radius="xl" variant="light">
                          <IconSend size={40} />
                        </ThemeIcon>
                        <Text size="lg" weight={500} align="center">
                          Ready to execute
                        </Text>
                        <Text size="sm" c="dimmed" align="center" maw={400}>
                          Configure your request on the left and click "Execute Request" to see the response here
                        </Text>
                      </Stack>
                    </Card>
                  )}
                </Stack>
              </Box>
            </Grid.Col>
          </Grid>
        </Container>
      </Paper>

      {/* Templates Modal */}
      <Modal
        opened={showTemplates}
        onClose={() => setShowTemplates(false)}
        title="Request Body Templates"
        size="lg"
      >
        <Stack spacing="md">
          {Object.entries(requestTemplates).map(([key, template]) => (
            <Card key={key} withBorder p="md" style={{ cursor: 'pointer' }} onClick={() => applyTemplate(template)}>
              <Group position="apart">
                <div>
                  <Text weight={500}>{template.name}</Text>
                  <Code block mt="xs" style={{ fontSize: 11 }}>
                    {template.body.split('\n').slice(0, 3).join('\n')}...
                  </Code>
                </div>
                <Button size="xs" variant="light">
                  Use Template
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      </Modal>
    </div>
  );
}
