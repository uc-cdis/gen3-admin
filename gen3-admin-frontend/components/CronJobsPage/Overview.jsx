import React, { useEffect, useState } from 'react';
import { Title, Text, Table, Button, Collapse, Container, Anchor, Group, Badge, TextInput, Select, Box } from '@mantine/core';
import { IconPlayerPlay, IconRefresh, IconSearch, IconFilter } from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import { useRouter } from 'next/router';
import JobGrid from './JobGrid';
import { fetchCronJobs, triggerCronJob, getAllJobs } from './functions';

const JobStatus = ({ status }) => {
  const colorMap = {
    'Running': 'blue',
    'Completed': 'green',
    'Failed': 'red',
    'Pending': 'yellow'
  };

  return (
    <Badge color={colorMap[status] || 'gray'}>
      {status}
    </Badge>
  );
};

const Page = () => {
  const [jobs, setJobs] = useState([]);
  const [allJobInstances, setAllJobInstances] = useState([]);
  const [filteredJobInstances, setFilteredJobInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [opened, setOpened] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const router = useRouter();

  const updateJobs = () => {
    setIsLoading(true);
    Promise.all([fetchCronJobs(), getAllJobs()])
      .then(([cronJobsData, jobInstancesData]) => {
        setJobs(cronJobsData || []);
        setAllJobInstances(jobInstancesData?.items || []);
        setIsLoading(false);
      })
      .catch(error => {
        showNotification({
          title: 'Error',
          message: `Failed to fetch jobs: ${error.message}`,
          color: 'red',
        });
        setIsLoading(false);
      });
  };

  useEffect(() => {
    updateJobs();
  }, []);

  const toggleRow = (index) => {
    const jobName = jobs[index].metadata.name;
    setOpened(opened === index ? null : index);
    if (opened !== index) {
      const instances = allJobInstances?.filter(instance => 
        instance.metadata?.ownerReferences?.some(ref => 
          ref.name === jobName && ref.kind === "CronJob"
        )
      );
      setFilteredJobInstances(instances);
    }
  };

  const handleJobTrigger = (jobName) => async () => {
    setIsLoading(true);
    try {
      const result = await triggerCronJob(jobName);
      if (result) {
        updateJobs();
        showNotification({
          title: 'Success',
          message: `Job ${result?.metadata?.name} was successfully triggered!`,
          color: 'green',
        });
      } else {
        showNotification({
          title: 'Failed',
          message: 'Job triggering failed without an error message.',
          color: 'red',
        });
      }
    } catch (error) {
      showNotification({
        title: 'Error',
        message: `Failed to trigger job: ${error.message}`,
        color: 'red',
      });
    }
    setIsLoading(false);
  };

  const filteredJobs = jobs.filter(job => 
    job.metadata.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (!filterStatus || job.status === filterStatus)
  );

  const Body = filteredJobs.map((job, index) => {
    const { name, schedule, suspended } = {
      name: job.metadata.name,
      schedule: job.spec.schedule,
      suspended: job.spec.suspended
    };
    const href = `${router.asPath}/${name}`;

    return (
      <React.Fragment key={index}>
        <Table.Tr onClick={() => toggleRow(index)}>
          <Table.Td><Anchor href={href}>{name}</Anchor></Table.Td>
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
              <Container>
                <JobGrid data={filteredJobInstances} parent={name} />
              </Container>
            </Collapse>
          </Table.Td>
        </Table.Tr>
      </React.Fragment>
    );
  });

  return (
    <Box p="md">
      <Title align="center" mb="xl">
        <Text inherit variant="gradient" component="span" gradient={{ from: 'gray', to: 'blue' }}>
          Jobs Dashboard
        </Text>
      </Title>
      
      <Group mb="md">
        <TextInput
          placeholder="Search jobs..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.currentTarget.value)}
          icon={<IconSearch size={16} />}
        />
        <Select
          placeholder="Filter by status"
          value={filterStatus}
          onChange={setFilterStatus}
          data={[
            { value: '', label: 'All' },
            { value: 'Active', label: 'Active' },
            { value: 'Suspended', label: 'Suspended' },
          ]}
          icon={<IconFilter size={16} />}
        />
        <Button
          leftSection={<IconRefresh size={20} />}
          onClick={updateJobs}
          loading={isLoading}
        >
          Refresh
        </Button>
      </Group>

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
          <Table.Tbody>{Body}</Table.Tbody>
        </Table>
      ) : (
        <Text align="center" c="dimmed">
          {isLoading ? 'Loading jobs...' : 'No jobs found.'}
        </Text>
      )}
    </Box>
  );
};

export default Page;