import { useState, useEffect } from 'react';

import { Box, Group, Button, Badge, Anchor, TextInput, Text, Drawer, Title, Tooltip, Container, Code, Menu, MenuItem, rem, Modal } from '@mantine/core';
import { IconChevronDown, IconSearch, IconTrash } from '@tabler/icons-react';

import { CopyButton } from '@mantine/core';

import { DataTable } from 'mantine-datatable';
import { useForm } from '@mantine/form';

import { callGoApi } from '@/lib/k8s';

import Link from 'next/link';

import { useSession, signIn, signOut } from "next-auth/react";

import { useRouter } from 'next/router';

import { useDisclosure } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';

function Clusters() {
  const session = useSession();
  const { data: sessionData } = session;

  const [modalOpened, setModalOpened] = useState(false);
  const [clusterName, setClusterName] = useState('');

  const handleDeleteModal = async () => {
    setModalOpened(true);
  };

  const [clusters, setClusters] = useState([
    {
      id: 1,
      connected: 'Active',
      name: 'local',
      provider: 'Local',
      distro: 'K3s',
      k8sVersion: 'v1.30.2+k3s2',
      architecture: 'Arm64',
      cpuUsage: '8 cores',
      memoryUsage: '6.83 GiB',
      pods: '2/110'
    },
    {
      id: 2,
      connected: 'Active',
      name: 'staging',
      provider: 'AWS',
      distro: 'K3s',
      k8sVersion: 'v1.30.2+k3s2',
      architecture: 'Arm64',
      cpuUsage: '8 cores',
      memoryUsage: '6.83 GiB',
      pods: '2/110'
    },
    {
      id: 3,
      connected: 'Active',
      name: 'production',
      provider: 'AWS',
      distro: 'EKS',
      k8sVersion: 'v1.30.2+k3s2',
      architecture: 'Arm64',
      cpuUsage: '8 cores',
      memoryUsage: '6.83 GiB',
      pods: '2/110'
    },
  ]);

  const [clusterLoading, setClusterLoading] = useState(false)
  const [error, setError] = useState(false)

  const [filteredClusters, setFilteredClusters] = useState(clusters);


  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [searchQuery, setSearchQuery] = useState('');
  const [selection, setSelection] = useState([]);

  const [opened, { open, close }] = useDisclosure(false);

  const [createClusterOpened, { open: createClusterOpen, close: createClusterClose }] = useDisclosure(false);

  const [submitResponse, setSubmitResponse] = useState(null);


  const router = useRouter();
  const { query } = router;

  useEffect(() => {
    if (query.import === 'true') {
      open();
    } else {
      close();
    }
  }, [query.import]);


  const handleOpenDrawer = () => {
    open();
    router.push(
      { pathname: router.pathname, query: { ...query, import: 'true' } },
      undefined,
      { shallow: true }
    );
  };

  const handleCloseDrawer = () => {
    close();
    router.push(
      { pathname: router.pathname, query: { ...query, import: 'closed' } },
      undefined,
      { shallow: true }
    );
  };


  useEffect(() => {
    const filtered = clusters.filter(cluster =>
      cluster.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cluster.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cluster.k8sVersion.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredClusters(filtered);
    setPage(1);
  }, [searchQuery, clusters]);

  // Query for the api for active clusters/agents 
  const fetchClusters = async () => {
    if (!sessionData) {
      console.log("returning")
      // Use this token for your API calls
      return;
    }
    setClusterLoading(true)
    try {
      console.log("sessionData", sessionData)
      const data = await callGoApi('/agents', 'GET', null, null, sessionData?.accessToken)
      setClusters(data);
      setError(false)
    } catch (error) {
      setError(true)
      setClusters([])
      console.error('Failed to fetch clusters:', error);
    }
    setClusterLoading(false)
  };

  useEffect(() => {
    fetchClusters();
  }, [sessionData]);



  const deleteCluster = async () => {
    try {
      const response = await callGoApi('/agents/' + selection[0].name, 'DELETE', null, null, sessionData?.accessToken);
      // check for error
      if (response.error) {
        showNotification({
          title: 'Error',
          message: 'An error occurred while deleting the cluster.' + response.error,
          color: 'red',
        });
        return;
      }
      // Notify with success
      showNotification({
        title: 'Success',
        message: 'Cluster ' + clusterName + ' deleted successfully.',
        color: 'green',
      });
      setModalOpened(false);
      fetchClusters();

    } catch (error) {
      console.error('Error importing cluster:', error);
      // Notify with error 
      showNotification({
        title: 'Error',
        message: 'An error occurred while deleting the cluster.' + error.message,
        color: 'red',
      });
    }
  };

  const createCluster = async (data) => {
    try {
      const responseData = await callGoApi('/agents', 'POST', { name: data.clusterName }, null, sessionData.accessToken, 'text');
      setSubmitResponse(responseData);
      fetchClusters();
    } catch (error) {
      console.error('Error importingt cluster:', error);
      setSubmitResponse({ error: 'An error occurred while importing the cluster.' });
    }
  };

  const form = useForm({
    mode: 'uncontrolled',
    defaultValues: {
      clusterName: 'cluster-name',
    },
  });

  return (
    <>
      <Drawer
        offset={8} radius="md" opened={opened} onClose={handleCloseDrawer} position="right" size="80%" title=""
        overlayProps={{ backgroundOpacity: 0.5, blur: 4 }}
      >

        <Container>
          <Title order={1} my="xl">Import Existing Cluster</Title>

          <Text>Import an existing cluster to manage it in the dashboard. This will generate configuration that you can deploy to your existing cluster to show up on this dashboard</Text>

          <Box mt="md">

            <form onSubmit={form.onSubmit(createCluster)}>
              <TextInput
                label="Cluster Name"
                placeholder="Enter cluster name"
                {...form.getInputProps('clusterName')}
              />

              <Button type="submit" mt="md">
                Import
              </Button>
            </form>

            {submitResponse && (
              submitResponse.error ? (
                <Box mt="xl">
                  <Title order={3}>Error:</Title>
                  <Text c="red">{submitResponse.error}</Text>
                </Box>
              ) : (
                <Box mt="xl">
                  <Title order={3}>Configuration:</Title>
                  <Code block>
                    {submitResponse}
                  </Code>
                  <CopyButton value={submitResponse}>
                    {({ copied, copy }) => (
                      <Button color={copied ? 'teal' : 'blue'} onClick={copy} mt="sm">
                        {copied ? 'Copied' : 'Copy configuration'}
                      </Button>
                    )}
                  </CopyButton>
                </Box>
              ))}

          </Box>
        </Container>
      </Drawer>

      <Drawer
        opened={createClusterOpened} onClose={createClusterClose} position="right" size="80%" title="Create Cluster"
        overlayProps={{ backgroundOpacity: 0.5, blur: 4 }} radius="md"
      >
        {/* Drawer content */}
        <Text>Drawer content</Text>
      </Drawer>


      {/* Confirmation Modal */}
      <Modal
        opened={modalOpened}
        onClose={() => setModalOpened(false)}
        title="Confirm Deletion"
        centered
      >
        <Text>Type in cluster name to confirm deletion</Text>
        <TextInput
          placeholder="Enter cluster name"
          value={clusterName}
          onChange={(event) => setClusterName(event.currentTarget.value)}
          style={{ marginBottom: '1rem' }}
        />

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          {/* Cancel Button */}
          <Button variant="outline" onClick={() => setModalOpened(false)} style={{ marginRight: '0.5rem' }}>
            Cancel
          </Button>

          {/* Confirm Delete Button */}
          <Button disabled={clusterName !== selection[0]?.name} onClick={deleteCluster} style={{ marginRight: '0.5rem' }}>
            Delete
          </Button>
        </div>
      </Modal>


      <Title order={1} my="xl">Clusters</Title>
      <Text mb="xl">
        This is the clusters dashboard. It will list all clusters you have access to.
      </Text>

      <Box sx={{ backgroundColor: '#1A1B1E', color: 'white', padding: '20px' }}>
        <Group position="apart" mb="md">
          <Group>
            <Text size="xl" weight={700}>Clusters</Text>
            <Badge size="lg" variant="filled" color="blue">{clusters.length}</Badge>
          </Group>
          <Group>
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <Button disabled={selection.length === 0} variant="outline" color="blue">Manage</Button>
              </Menu.Target>
              <Menu.Dropdown>

                <Menu.Divider />
                <Menu.Label>Danger zone</Menu.Label>
                <Menu.Item onClick={handleDeleteModal} >
                  <MenuItem color="red" leftSection={<IconTrash style={{ width: rem(14), height: rem(14) }} />}>
                    Delete
                  </MenuItem>
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>

            {/* <Button variant="filled" color="blue">Import Existing</Button> */}
            <Tooltip label="Not yet implemented">
              <Button disabled > Create</Button>
              {/* variant="filled" color="blue" onClick={createClusterOpen}>Create</Button> */}
            </Tooltip>

            <Button onClick={handleOpenDrawer}>Import Existing</Button>
            {/* refresh button */}
            <Button onClick={fetchClusters}>Refresh</Button>
            <TextInput
              placeholder="Filter"
              leftSection={<IconSearch size={14} />}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              sx={{ width: '200px' }}
            />
          </Group>
        </Group>

        {error && <Text color="red">Error fetching clusters</Text>}



        <DataTable
          striped
          highlightOnHover
          records={filteredClusters}
          // filterable
          fetching={clusterLoading}
          selectedRecords={selection}
          onSelectedRecordsChange={setSelection}
          columns={[
            {
              accessor: 'connected',
              title: 'State',
              render: ({ connected }) => (connected ? <Badge color="green" variant="light">Active</Badge> : <Badge color="red" variant="light">Disconnected</Badge>)
            },
            {
              accessor: 'name',
              title: 'Agent Name',
              render: ({ name, connected }) => connected ? (<Link passHref legacyBehavior href="/clusters/[name]" as={`/clusters/${name}`}><Anchor color="dodgerblue">{name}</Anchor></Link>) : (<Text c="">{name}</Text>)
            },
            {
              accessor: 'provider',
              title: 'Provider',
              render: ({ provider, distro }) => (
                <>
                  <Text>{provider}</Text>
                  <Text size="xs" color="dimmed">{distro}</Text>
                </>
              )
            },
            {
              accessor: 'k8sVersion',
              title: 'Kubernetes Version',
              render: ({ k8sVersion, architecture }) => (
                <>
                  <Text>{k8sVersion}</Text>
                  <Text size="xs" c="dimmed">{architecture}</Text>
                </>
              )
            },
            { accessor: 'cpuUsage', title: 'Agent CPUUsage', render: ({ cpuUsage }) => <Text>{parseInt(cpuUsage)}%</Text> },
            { accessor: 'memoryUsage', title: 'Agent MemoryUsage', render: ({ memoryUsage }) => <Text>{parseInt(memoryUsage)}%</Text> },
            { accessor: 'pods', title: 'Pods' },
          ]}
          totalRecords={filteredClusters.length}
          recordsPerPage={pageSize}
          page={page}
          onPageChange={(p) => setPage(p)}
          sortStatus={{ field: 'name', direction: 'asc' }}
          onSortStatusChange={console.log}
        />
      </Box>
    </>
  );
}

export default Clusters;