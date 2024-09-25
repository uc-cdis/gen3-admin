import React, { useEffect, useState } from 'react';
import { Card, Text, Group, Badge, TextInput, Button, Switch, Table, ScrollArea, Box, Loader, Tooltip, Drawer } from '@mantine/core';
import { IconFilter, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

import { DataTable } from 'mantine-datatable';

import { useDisclosure } from '@mantine/hooks';

import { callGoApi } from '@/lib/k8s';

import { useSession } from 'next-auth/react';


import NestedCollapses from '@/components/NestedCollapse';

const ClusterDashboard = () => {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [currentCluster, setCurrentCluster] = useState(null);

  const [currentValues, setCurrentValues] = useState(null);
  const [openValuesModal, setOpenValuesModal] = useState(false);

  const [opened, { open, close }] = useDisclosure(false);



  const { data: sessionData } = useSession();
  const accessToken = sessionData;

  const fetchClustersAndCharts = async () => {
    if (!accessToken) return;
    try {
      setLoading(true);
      const clustersData = await callGoApi('/agents', 'GET', null, null, accessToken);

      const clustersWithCharts = await Promise.all(
        clustersData.map(async (cluster) => {
          try {
            if (cluster.connected) {
              const chartsData = await callGoApi(`/agents/${cluster.name}/helm/list`, 'GET', null, null, accessToken);
              return { ...cluster, charts: chartsData };
            } else {
              return { ...cluster, charts: [] };
            }
          } catch (error) {
            console.error(`Failed to fetch charts for cluster ${cluster.name}:`, error);
            return { ...cluster, charts: [] };
          }
        })
      );
      setClusters(clustersWithCharts);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setError('Failed to load data. Please try again later.');
      setLoading(false);
    }
  };
  useEffect(() => {
    console.log('sessionData', sessionData);
    if (sessionData) {
      fetchClustersAndCharts(sessionData.accessToken);
    }
  }, [sessionData]);

  const filteredCharts = clusters.flatMap(cluster =>
    cluster.charts.map(chart => ({ ...chart, clusterName: cluster.name }))
  ).filter(chart =>
    chart.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    chart.clusterName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredCharts.length / itemsPerPage);
  const paginatedCharts = filteredCharts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const renderDeploymentStatus = (envData) => {
    if (!envData) return <Text color="dimmed">No Data</Text>;
    return (
      <Group spacing="xs">
        <Badge color={envData.status === 'Synced' ? 'green' : 'orange'} variant="filled">
          {envData.status === 'Synced' ? '✓' : '!'}
        </Badge>
        <Text size="sm">{envData.version}</Text>
      </Group>
    );
  };

  const viewValues = async (name, namespace, clusterName) => {
    console.log("viewing values for", name, namespace)
    // call go api to get the values
    // then open a modal with the values
    const values = await callGoApi(`/agent/${clusterName}/helm/values/${name}/${namespace}`, 'GET', null, null, accessToken);
    console.log("values", values)

    setCurrentValues(values)
    open()

  }

  if (error) return <Text color="red">{error}</Text>;

  return (
    <>
      <Drawer offset={8} radius="md" position="right" size="80%" opened={opened} onClose={close} title="Helm Values">
        <NestedCollapses data={currentValues} />
      </Drawer>

      <Box>
        <Group position="apart" mb="md">
          <Text size="xl" weight={700}>Helm Charts</Text>
          <Tooltip label="Not yet implemented">
            <Button variant="filled" color="blue" disabled>Deploy a new app</Button>
          </Tooltip>
        </Group>

        <Group mb="md">
          <TextInput
            placeholder="Find clusters or charts"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            style={{ flexGrow: 1 }}
          />
          <Tooltip label="Not yet implemented">
            <Switch label="Show system apps" disabled />
          </Tooltip>
          <Tooltip label="Not yet implemented">
            <Button leftSection={<IconFilter size={14} />} variant="light" disabled>Advanced filters</Button>
          </Tooltip>
          <Button onClick={fetchClustersAndCharts}>Refresh</Button>
        </Group>

        {/* <ScrollArea> */}
        <DataTable
          striped
          highlightOnHover
          records={paginatedCharts}
          fetching={loading}
          // filterable
          // selectedRecords={selection}
          // onSelectedRecordsChange={setSelection}
          columns={[
            { accessor: 'clusterName' },
            { accessor: 'name' },
            { accessor: 'namespace' },
            { accessor: 'status', render: ({ status }) => <Badge color={status === 'deployed' ? 'green' : 'orange'} variant="filled">{status}</Badge> },
            { accessor: 'chart' },
            {
              id: 'Development', header: 'Development', accessor: 'helm',
              render: ({ helm }) => {
                if (helm === 'true') {
                  return <img src="/images/icons/helm.svg" alt="Helm" width="20px" height="20px" />;
                } else {
                  return <img src="/images/icons/argocd.png" alt="ArgoCD" width="20px" height="20px" />;
                }
              }
            },
            {
              "accessor": "Edit",
              "id": "name",
              // Add a button to edit / view the values of the deployment
              render: ({ name, namespace, clusterName }) => (
                <Button
                  variant="outline"
                  size="sm"
                  color="blue"
                  onClick={() => viewValues(name, namespace, clusterName)}
                >
                  Edit
                </Button>
              )
            }
          ]}
          totalRecords={filteredCharts.length}
          // recordsPerPage={pageSize}
          // page={page}
          // onPageChange={(p) => setPage(p)}
          sortStatus={{ field: 'name', direction: 'asc' }}
          onSortStatusChange={console.log}
        // rowStyles={row => ({
        //   backgroundColor: row.index % 2 === 0 ? '#f9f9f9' : 'white'
        // })}
        />

        {/* <Table striped highlightOnHover>
          <thead>
            <tr>
              <th>Cluster / Chart</th>
              <th>Development</th>
              <th>Staging</th>
              <th>Production</th>
            </tr>
          </thead>
          <tbody>
            {paginatedCharts.map((chart, index) => (
              <tr key={`${chart.clusterName}-${chart.name}-${index}`}>
                <td>
                  <Group spacing="sm">
                    <Text size="sm" weight={500}>{chart.clusterName}</Text>
                    <Text size="sm">{chart.name}</Text>
                  </Group>
                </td>
                <td>{renderDeploymentStatus(chart.environments.development)}</td>
                <td>{renderDeploymentStatus(chart.environments.staging)}</td>
                <td>{renderDeploymentStatus(chart.environments.production)}</td>
              </tr>
            ))}
          </tbody>
        </Table> */}
        {/* </ScrollArea> */}

        <Group position="apart" mt="md">
          <Text>
            {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredCharts.length)} of {filteredCharts.length} Charts
          </Text>
          <Group spacing={8}>
            <Button
              variant="subtle"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <IconChevronLeft size={18} />
            </Button>
            <Button
              variant="subtle"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <IconChevronRight size={18} />
            </Button>
          </Group>
        </Group>
      </Box>
    </>
  );
};

export default ClusterDashboard;