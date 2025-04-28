
"use client";

import React, { useEffect, useState } from 'react';
import { Card, Modal, Stack, Text, Group, Badge, TextInput, Button, Switch, Table, ScrollArea, Box, Loader, Tooltip, Drawer, Container } from '@mantine/core';
import { IconFilter, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

import { DataTable } from 'mantine-datatable';

import { useDisclosure } from '@mantine/hooks';

import { callGoApi } from '@/lib/k8s';

import Link from 'next/link';

import { useSession } from 'next-auth/react';
import { Tabs } from '@mantine/core';
import YamlEditor from '@/components/YamlEditor/YamlEditor';

import NestedCollapses from '@/components/NestedCollapse';

const ClusterDashboard = () => {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [currentCluster, setCurrentCluster] = useState(null);

  const [filteredCharts, setFilteredCharts] = useState([])


  const [currentValues, setCurrentValues] = useState(null);
  const [openValuesModal, setOpenValuesModal] = useState(false);

  const [opened, { open, close }] = useDisclosure(false);

  const [nonGen3, setNonGen3] = useState(true);

  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const [inputClusterName, setInputClusterName] = useState('');
  const [inputReleaseName, setInputReleaseName] = useState('');
  const [inputNamespace, setInputNamespace] = useState('');

  const [deleteCluster, setDeleteCluster] = useState('');
  const [deleteRelease, setDeleteRelease] = useState('');
  const [deleteNamespace, setDeleteNamespace] = useState('');

  const deleteValidate = inputClusterName === deleteCluster && inputReleaseName === deleteRelease && inputNamespace === deleteNamespace;

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

              const gen3Charts = chartsData  //.filter(chart => chart.name.includes('gen3'))

              return { ...cluster, charts: gen3Charts };
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

  useEffect(() => {
    if (nonGen3) {
      console.log(clusters[0])
      setFilteredCharts(clusters.flatMap(cluster =>
        cluster.charts.map(chart => ({ ...chart, clusterName: cluster.name }))
      ).filter(chart =>
        chart.name.toLowerCase().includes("gen3")
        // ||
      ));
    } else {
      const filteredChartsTmp = clusters.flatMap(cluster =>
        cluster.charts.map(chart => ({ ...chart, clusterName: cluster.name }))
      ).filter(chart =>
        chart.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        chart.clusterName.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredCharts(filteredChartsTmp);
    }
  }, [nonGen3, sessionData, clusters]);


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

  const openDeleteModal = async (name, namespace, clusterName) => {
    console.log("open delete modal", name, namespace, clusterName)


    setDeleteCluster(clusterName);
    setDeleteRelease(name);
    setDeleteNamespace(namespace);
    setDeleteModalOpened(true);
  }

  const uninstallHelm = async (name, namespace, clusterName) => {
    console.log("uninstalling helm", name, namespace)
    // call go api to get the values
    // then open a modal with the values
    const response = await callGoApi(`/agent/${clusterName}/helm/delete/${name}/${namespace}`, 'DELETE', null, null, accessToken);
    console.log("values", response)

    alert("Uninstalled")

  }

  const handleDelete = (name, namespace, clusterName) => {
    console.log("handle delete", name, namespace, clusterName)

    uninstallHelm(name, namespace, clusterName);
    setDeleteModalOpened(false);
    setInputClusterName('');
    setInputReleaseName('');
  };

  if (error) return <Text color="red">{error}</Text>;

  return (
    <>
      <Drawer offset={8} radius="md" position="right" size="80%" opened={opened} onClose={close} title="Helm Values">
        <>
          <Tabs defaultValue="Yaml Editor" size="sm">
            <Tabs.List>
              <Tabs.Tab value="Visual Editor"> Visual Editor</Tabs.Tab>
              <Tabs.Tab value="Yaml Editor">Yaml Editor</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="Visual Editor">
              <NestedCollapses data={currentValues} />
            </Tabs.Panel>
            <Tabs.Panel value="Yaml Editor">
              <YamlEditor data={currentValues} setData={setCurrentValues} />
            </Tabs.Panel>
          </Tabs>
        </>
      </Drawer >

      <Box>
        <Group position="apart" mb="md">
          <Text size="xl" weight={700}>Helm Charts</Text>
          {/* <Tooltip label="Not yet implemented"> */}
          <Button variant="filled" color="blue" component={Link} href="/helm/repo">Deploy a new app</Button>
          {/* </Tooltip> */}
        </Group>

        <Group mb="md">
          <TextInput
            placeholder="Find clusters or charts"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            style={{ flexGrow: 1 }}
          />
          <Tooltip label="Not yet implemented">
            <Switch label="Gen3 only" checked={nonGen3} defaultChecked onChange={(event) => setNonGen3(event.currentTarget.checked)} />
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
            { accessor: 'status', render: ({ status }) => <Badge color={status === 'deployed' || status === 'Healthy' ? 'green' : 'orange'} variant="filled">{status}</Badge> },
            { accessor: 'chart' },
            {
              id: 'Development', header: 'Development', accessor: 'helm',
              render: ({ helm }) => {
                if (helm === 'true') {
                  return <img src="/images/icons/helm.svg" alt="Helm" width="20px" height="20px" style={{ border: '1px white', filter: 'drop-shadow(0px 0px 5px white)' }} />;
                } else {
                  return <img src="/images/icons/argocd.png" alt="ArgoCD" width="20px" height="20px" style={{ filter: 'drop-shadow(0px 0px 5px white)' }} />;
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
            },
            {
              accessor: 'delete',
              id: 'delete',
              render: ({ name, namespace, clusterName }) => (
                <>
                  <Button
                    variant="outline"
                    m="md"
                    size="sm"
                    color="red"
                    onClick={() => openDeleteModal(name, namespace, clusterName)}
                  >
                    Delete
                  </Button>

                  <Modal
                    opened={deleteModalOpened}
                    onClose={() => {
                      setDeleteModalOpened(false);
                      setInputClusterName('');
                      setInputReleaseName('');
                    }}
                    title="Confirm Helm Release Deletion"
                    centered
                  >
                    <Stack spacing="md">
                      <Text size="sm">
                        To confirm deletion, please enter both the cluster name and release name.
                        Both must match exactly.
                      </Text>

                      <TextInput
                        label="Cluster Name"
                        placeholder={`Enter cluster name: ${deleteCluster}`}
                        value={inputClusterName}
                        onChange={(event) => setInputClusterName(event.currentTarget.value)}
                      />

                      <TextInput
                        label="Release Name"
                        placeholder={`Enter release name: ${deleteRelease}`}
                        value={inputReleaseName}
                        onChange={(event) => setInputReleaseName(event.currentTarget.value)}
                      />


                      <TextInput
                        label="Namespace"
                        placeholder={`Enter namespace: ${deleteNamespace}`}
                        value={inputNamespace}
                        onChange={(event) => setInputNamespace(event.currentTarget.value)}
                      />

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="subtle"
                          onClick={() => {
                            setDeleteModalOpened(false);
                            setInputClusterName('');
                            setInputReleaseName('');
                            setInputNamespace('');
                          }}
                        >
                          Cancel
                        </Button>

                        <Button
                          color="red"
                          disabled={!deleteValidate}
                          onClick={() => handleDelete(deleteRelease, deleteNamespace, deleteCluster)}
                        >
                          Delete Release
                        </Button>
                      </div>
                    </Stack>
                  </Modal>
                </>

              )
            },
            {
              "accessor": "Sync",
              "id": "tests",
              render: ({ helm }) => (
                helm ? null :
                <Button
                  variant="outline"
                  size="sm"
                  color="green"
                >
                  Sync app
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
