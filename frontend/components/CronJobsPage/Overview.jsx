// Imports remain unchanged
import React, { useEffect, useState } from 'react';
import {
  Title, Text, Table, Button, Collapse, Container, Anchor,
  Group, Badge, TextInput, Select, Box, Stack, Card, Flex
} from '@mantine/core';
import { IconPlayerPlay, IconRefresh, IconSearch, IconFilter } from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';

import JobGrid from './JobGrid';
import {
  fetchCronJobs, triggerCronJob,
  getAllJobs
} from './functions';

const JobStatus = ({ status }) => {
  const colorMap = {
    Running: 'blue',
    Completed: 'green',
    Failed: 'red',
    Pending: 'yellow',
    Active: 'green',
    Suspended: 'orange'
  };
  return <Badge color={colorMap[status] || 'gray'}>{status}</Badge>;
};

import callK8sApi from '@/lib/k8s';

const Page = ({ namespace, hideSelect = false }) => {
  const [jobs, setJobs] = useState([]);
  const [allJobInstances, setAllJobInstances] = useState([]);
  const [filteredJobInstances, setFilteredJobInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [opened, setOpened] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [namespaces, setNamespaces] = useState([]);
  const [selectedNamespace, setSelectedNamespace] = useState(namespace);

  const router = useRouter();
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;
  const clusterName = useParams()?.clustername;

  useEffect(() => {
    if (!sessionData) return;
    fetchNamespaces();
  }, [sessionData]);

  const fetchNamespaces = async () => {
    try {
      const data = await callK8sApi(`/api/v1/namespaces`, 'GET', null, null, clusterName, accessToken);
      const ns = data.items.map(ns => ns.metadata.name);
      setNamespaces(ns);
      // if (ns.length) setSelectedNamespace(ns.includes('gen3') ? 'gen3' : ns[0]);
    } catch (error) {
      console.error('Error fetching namespaces:', error);
    }
  };

  const updateJobs = () => {
    setIsLoading(true);
    Promise.all([
      fetchCronJobs(clusterName, selectedNamespace, accessToken),
      getAllJobs(clusterName, selectedNamespace, accessToken)
    ])
      .then(([cronJobsData, jobInstancesData]) => {
        setJobs(cronJobsData || []);
        setAllJobInstances(jobInstancesData?.items || []);
      })
      .catch(error => {
        showNotification({
          title: 'Error',
          message: `Failed to fetch jobs: ${error.message}`,
          color: 'red'
        });
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (sessionData && selectedNamespace) {
      updateJobs();
    }
  }, [sessionData, selectedNamespace]);

  const toggleRow = (index) => {
    const jobName = jobs[index].metadata.name;
    setOpened(opened === index ? null : index);
    if (opened !== index) {
      const instances = allJobInstances?.filter(instance =>
        instance.metadata?.ownerReferences?.some(ref =>
          ref.name === jobName && ref.kind === 'CronJob'
        )
      );
      setFilteredJobInstances(instances);
    }
  };

  const handleJobTrigger = (jobName) => async () => {
    setIsLoading(true);
    try {
      const result = await triggerCronJob(jobName, selectedNamespace, clusterName, accessToken);
      updateJobs();
      showNotification({
        title: 'Success',
        message: `Job ${result?.metadata?.name} triggered!`,
        color: 'green'
      });
    } catch (error) {
      showNotification({
        title: 'Error',
        message: `Failed to trigger job: ${error.message}`,
        color: 'red'
      });
    }
    setIsLoading(false);
  };

  const filteredJobs = jobs.filter(job =>
    job.metadata.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (!filterStatus || (job.spec.suspended ? 'Suspended' : 'Active') === filterStatus)
  );

  return (
    <Container size="lg" pt="xl">
      <Stack spacing="lg">
        <Title align="center" order={2}>
          <Text inherit variant="gradient" component="span" gradient={{ from: 'gray', to: 'blue' }}>
            Kubernetes Job Dashboard {selectedNamespace}
          </Text>
        </Title>

        {!hideSelect && (
          <Card shadow="md" padding="md" radius="md" withBorder>
            <Flex gap="md" align="center" wrap="wrap">
              <TextInput
                placeholder="Search jobs..."
                icon={<IconSearch size={16} />}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.currentTarget.value)}
              />
              <Select
                placeholder="Filter by status"
                icon={<IconFilter size={16} />}
                value={filterStatus}
                onChange={setFilterStatus}
                data={[
                  { value: '', label: 'All' },
                  { value: 'Active', label: 'Active' },
                  { value: 'Suspended', label: 'Suspended' }
                ]}
              />
              <Select
                placeholder="Namespace"
                searchable
                value={selectedNamespace}
                onChange={setSelectedNamespace}
                data={[
                  { value: '', label: 'All Namespaces' },
                  ...namespaces.map(ns => ({ value: ns, label: ns }))
                ]}
              />

              <Button
                leftSection={<IconRefresh size={16} />}
                onClick={updateJobs}
                loading={isLoading}
              >
                Refresh
              </Button>
            </Flex>
          </Card>
        )
        }

        {filteredJobs.length > 0 ? (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Job Name</Table.Th>
                <Table.Th>Schedule</Table.Th>
                <Table.Th>Trigger</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredJobs.map((job, index) => {
                const { name, schedule, suspended } = {
                  name: job.metadata.name,
                  schedule: job.spec.schedule,
                  suspended: job.spec.suspended
                };
                return (
                  <React.Fragment key={index}>
                    <Table.Tr onClick={() => toggleRow(index)}>
                      <Table.Td><Anchor>{name}</Anchor></Table.Td>
                      <Table.Td>{schedule}</Table.Td>
                      <Table.Td>
                        <Button
                          loading={isLoading}
                          leftSection={<IconPlayerPlay size={20} />}
                          onClick={handleJobTrigger(name)}
                        >
                          Trigger
                        </Button>
                      </Table.Td>
                      <Table.Td><JobStatus status={suspended ? 'Suspended' : 'Active'} /></Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td colSpan={4}>
                        <Collapse in={opened === index}>
                          <Container><JobGrid data={filteredJobInstances} parent={name} /></Container>
                        </Collapse>
                      </Table.Td>
                    </Table.Tr>
                  </React.Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        ) : (
          <Text align="center" c="dimmed">
            {isLoading ? 'Loading jobs...' : 'No jobs found.'}
          </Text>
        )}
      </Stack>
    </Container>
  );
};

export default Page;
