import { useState, useEffect } from 'react';
import { useForm } from '@mantine/form';
import { IconRefresh, IconPencil, IconSend } from '@tabler/icons-react';
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
  JsonInput
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
  { value: '/_cluster/health', label: 'Cluster Health' },
  { value: '/_cluster/stats', label: 'Cluster Stats' },
  { value: '/_nodes', label: 'Node Info' },
  { value: '/_cat/indices', label: 'List Indices' },
  { value: '/_cat/aliases', label: 'List Aliases' },
  { value: '/_cat/shards', label: 'List Shards' },
  { value: '/your-index/_search', label: 'Search Index' },
  { value: '/your-index/_mapping', label: 'Index Mapping' },
  { value: '/your-index/_settings', label: 'Index Settings' }
];

export default function Elasticsearch() {

  const { activeCluster, setActiveCluster, activeGlobalEnv, setActiveGlobalEnv } = useGlobalState();

  const [cluster, namespace] = activeGlobalEnv.split('/')

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);
  const [responseTime, setResponseTime] = useState(null);

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

  const executeElasticsearchRequest = async (values) => {
    if (!cluster || !namespace) {
      setError('Please select a cluster and namespace');
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    const startTime = Date.now();

    try {
      // Construct the proxy URL
      const proxyPath = `/k8s/${cluster}/proxy/api/v1/namespaces/${namespace}/services/elasticsearch:9200/proxy${values.url}`;

      let requestBody = null;
      if (['POST', 'PUT', 'PATCH'].includes(values.method) && values.body) {
        try {
          requestBody = JSON.parse(values.body);
        } catch (e) {
          throw new Error('Invalid JSON in request body');
        }
      }

      const response = await callGoApi(
        proxyPath,
        values.method,
        requestBody,
        null,
        accessToken,
        "text"
      );

      const endTime = Date.now();
      setResponseTime(endTime - startTime);
      setResponse(response);
    } catch (error) {
      console.error('Elasticsearch request failed:', error);
      setError(error.message || 'Request failed');
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

  const getStatusColor = (response) => {
    if (!response) return 'gray';
    if (typeof response === 'object' && response.status) {
      const status = response.status.toLowerCase();
      if (status === 'green') return 'green';
      if (status === 'yellow') return 'yellow';
      if (status === 'red') return 'red';
    }
    return 'blue';
  };

  return (
    <div>
      <h1>Elasticsearch {cluster} / {namespace} </h1>

      {/* Cluster Selection */}
      {/* <Paper p="md" radius="md" withBorder>
        <Stack spacing="md">
          <Divider label="Elasticsearch Context" labelPosition="center" />
          <Text size="sm" c="dimmed" mt={4}>
            Configure the Elasticsearch context for your Gen3 deployment. This will rely on talking to the aws-es-proxy or the elasticsearch cluster running in that namespace.
          </Text>
          <Group position="apart" align="flex-end">
            <Select
              label="Cluster"
              description="Select your Kubernetes cluster"
              placeholder="e.g., my-cluster"
              data={clusters}
              value={cluster}
              sx={{ flexGrow: 1 }}
              onChange={(value) => setCluster(value)}
            />
            <Tooltip label="Refresh clusters list">
              <ActionIcon
                onClick={fetchClusters}
                variant="light"
                size="lg"
                color="blue"
              >
                <IconRefresh size={20} />
              </ActionIcon>
            </Tooltip>
            <TextInput
              label="Namespace"
              placeholder="e.g., gen3-test"
              value={namespace}
              onChange={(event) => setNamespace(event.currentTarget.value)}
            />
          </Group>
        </Stack>
      </Paper> */}

      {/* Main Interface */}
      <Paper p="md" mt="lg" radius="md" withBorder>
        <Container fluid>
          <Grid gutter="xl">
            <Grid.Col span={6}>
              <form onSubmit={form.onSubmit(executeElasticsearchRequest)}>
                <Stack spacing="xl">
                  <Divider label="Create Request" labelPosition="center" />

                  <Group grow>
                    <Select
                      label="Method"
                      placeholder="Select HTTP method"
                      data={httpMethods}
                      {...form.getInputProps('method')}
                    />
                    <Select
                      label="Common Endpoints"
                      placeholder="Select or type custom"
                      data={commonEndpoints}
                      searchable
                      creatable
                      getCreateLabel={(query) => `+ Use "${query}"`}
                      onCreate={(query) => {
                        form.setFieldValue('url', query);
                        return query;
                      }}
                      onChange={(value) => {
                        if (value) form.setFieldValue('url', value);
                      }}
                    />
                  </Group>

                  <TextInput
                    label="URL Path"
                    placeholder="e.g., /_cluster/health"
                    withAsterisk
                    {...form.getInputProps('url')}
                  />

                  {['POST', 'PUT', 'PATCH'].includes(form.values.method) && (
                    <JsonInput
                      label="Request Body"
                      placeholder='{"query": {"match_all": {}}}'
                      minRows={8}
                      maxRows={15}
                      {...form.getInputProps('body')}
                    />
                  )}

                  <Group position="right">
                    <Button
                      type="submit"
                      leftIcon={<IconSend size={16} />}
                      loading={loading}
                      disabled={!cluster || !namespace}
                    >
                      Send Request
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Grid.Col>

            <Grid.Col span={6}>
              <Stack spacing="md">
                <Group position="apart">
                  <Divider label="Response" labelPosition="center" style={{ flex: 1 }} />
                  {responseTime && (
                    <Badge color="gray" variant="light">
                      {responseTime}ms
                    </Badge>
                  )}
                  {response && (
                    <Badge color={getStatusColor(response)} variant="light">
                      {response.status || 'Success'}
                    </Badge>
                  )}
                </Group>

                {loading && (
                  <Group position="center" p="xl">
                    <Loader size="md" />
                    <Text size="sm" c="dimmed">Sending request...</Text>
                  </Group>
                )}

                {error && (
                  <Alert color="red" title="Request Failed">
                    {error}
                  </Alert>
                )}

                {response && !loading && (
                  <>
                    <Editor
                      value={formatResponse(response)}
                      height="600px"
                      defaultLanguage='json'
                      language='text'
                    />
                  </>
                )}

                {!response && !loading && !error && (
                  <>
                    <Paper p="xl" style={{ textAlign: 'center' }}>
                      <Text size="sm" c="dimmed">
                        Response will appear here after sending a request
                      </Text>
                    </Paper>
                  </>
                )}
              </Stack>
            </Grid.Col>
          </Grid>
        </Container>
      </Paper>
    </div>
  );
}
