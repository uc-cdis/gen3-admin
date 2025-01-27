// import { } from @mantine
import { useState } from 'react';
import { useForm } from '@mantine/form';

import { IconRefresh, IconPencil } from '@tabler/icons-react';
import { Paper, Stack, Group, Text, Select, Divider, TextInput, Container, Grid, ActionIcon, Tooltip, Button, Code, Textarea } from '@mantine/core';


import Editor from "@monaco-editor/react";

const clusters = [
  { label: 'my-cluster', value: 'my-cluster' },
  { label: 'my-cluster-2', value: 'my-cluster-2' },
];

import { callGoApi } from '@/lib/k8s';

import { useSession } from 'next-auth/react';

export default function Elasticsearch() {
  const [clusters, setClusters] = useState([]);
  const [activeCluster, setActiveCluster] = useState(0);
  const [cluster, setCluster] = useState('');
  const [namespace, setNamespace] = useState('my-namespace');
  const [useCustomNs, setUseCustomNs] = useState(false);

  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const fetchClusters = async () => {
    try {
      const data = await callGoApi('/agents', 'GET', null, null, accessToken)
      // Only show clusters that are active
      setClusters(data.filter(cluster => cluster.connected))
      setActiveCluster(data.filter(cluster => cluster.connected)[0].name)
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
    }
  };

  const codeString = `{
    "cluster_name" : "813684607867:midrcprod-gen3-metadata-2",
    "status" : "green",
    "timed_out" : false,
    "number_of_nodes" : 2,
    "number_of_data_nodes" : 2,
    "discovered_master" : true,
    "active_primary_shards" : 201,
    "active_shards" : 402,
    "relocating_shards" : 0,
    "initializing_shards" : 0,
    "unassigned_shards" : 0,
    "delayed_unassigned_shards" : 0,
    "number_of_pending_tasks" : 0,
    "number_of_in_flight_fetch" : 0,
    "task_max_waiting_in_queue_millis" : 0,
    "active_shards_percent_as_number" : 100.0
  }`;


  return (
    <div>
      <h1>Elasticsearch</h1>

      {/* Cluster Selection */}
      <Paper p="md" radius="md" withBorder>
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
            <Select label="Namespace" placeholder="e.g., my-namespace" onChange={(value) => setNamespace(value)} />
          </Group>


        </Stack>
      </Paper>
      <Paper p="md" spacing="xl" mt="lg" radius="md" withBorder>
        <Container fluid>
          <Grid gutter="xl">
            <Grid.Col span={6}>
              {/* <Paper shadow="md" p="md" radius="md" withBorder> Added Paper for visual grouping */}
              <Stack spacing="xl"> {/* Use Stack for vertical spacing */}
                <Divider label="Create Request" labelPosition="center" />
                <Group direction="column" spacing="sm"> {/* Group for tighter spacing within form elements */}
                  <Select
                    label="Method"
                    placeholder="e.g., GET"
                    data={['GET', 'POST', 'PUT', 'DELETE']}
                    clearable
                    searchable
                  />
                  <TextInput
                    label="URL"
                    placeholder="e.g., /_cluster/health"
                    withAsterisk
                    required
                  />
                </Group>
                <Textarea
                  label="Body"
                  placeholder="e.g., { query: { match_all: {} } }"
                  withAsterisk
                  minRows={20} // Sets a minimum number of visible rows
                  required
                />
                <Group position="right"> {/* Align the button to the right */}
                  <Button type="submit">Send</Button> {/* Added type="submit" for form submission */}
                </Group>
              </Stack>
              {/* </Paper> */}
            </Grid.Col>
            <Grid.Col span={6}>
              {/* </Flex> */}
              <Divider label="Response" labelPosition="center" />
              <Code block size="sm">
                {codeString}
              </Code>
            </Grid.Col>
          </Grid>

        </Container>
      </Paper>
    </div>
  );
}