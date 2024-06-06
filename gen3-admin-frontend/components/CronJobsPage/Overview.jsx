// JobsPage.jsx
import React, { useEffect, useState } from 'react';
import { Title, Text, Table, Button, Collapse, Container, Anchor } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import JobGrid from './JobGrid';
import { fetchCronJobs, triggerCronJob, getJobInstances, getAllJobs } from './functions';

import { useRouter } from 'next/router';


// import notification
import { showNotification } from '@mantine/notifications';

// import axios

const Page = () => {
    const [jobs, setJobs] = useState([]);
    const [allJobInstances, setAllJobInstances] = useState([]);
    const [filteredJobInstances, setFilteredJobInstances] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [opened, setOpened] = useState(null);
    const router = useRouter();

    useEffect(() => {
        setIsLoading(true);
        fetchCronJobs().then(cronJobsData => {
            if (cronJobsData) {
                setJobs(cronJobsData);
            }
            setIsLoading(false);
        }).catch(error => {
            showNotification({
                title: 'Error',
                message: `Failed to fetch cronjobs: ${error.message}`,
                color: 'red',
            });
            setIsLoading(false);
        });

        getAllJobs().then(jobInstancesData => {
            if (jobInstancesData) {
                setAllJobInstances(jobInstancesData.items);
            }
        }).catch(error => {
            showNotification({
                title: 'Error',
                message: `Failed to fetch job instances: ${error.message}`,
                color: 'red',
            });
        });
    }, []);

    const toggleRow = (index) => {
        const jobName = jobs[index].metadata.name;
        setOpened(opened === index ? null : index);
        if (opened !== index) {
            // Filter job instances from all fetched instances
            const instances = allJobInstances?.filter(instance => {
                // First, ensure that metadata and ownerReferences exist
                if (!instance.metadata || !instance.metadata.ownerReferences) {
                    return false;
                }
            
                // Now check if any ownerReference matches the jobName
                const hasMatchingOwnerRef = instance.metadata.ownerReferences.some(ref => {
                    return ref.name === jobName && ref.kind === "CronJob";
                });
            
                return hasMatchingOwnerRef;
            });
            
            setFilteredJobInstances(instances);
        }
    };


    const handleJobTrigger = (jobName) => async () => {
        setIsLoading(true);
        try {
            const result = await triggerCronJob(jobName);
            if (result) {
                showNotification({
                    title: 'Success',
                    message: 'Job was successfully triggered!',
                    color: 'green',
                });
            } else {
                // Handle cases where the function might return null but without throwing an error
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
    

    const Body = jobs.map((job, index) => {
        let name = job.metadata.name;
        let schedule = job.spec.schedule;
        let suspended = job.spec.suspended;

        let href = router.asPath + "/" + name

        return (
        <React.Fragment key={index}>
            <Table.Tr key={name} onClick={() => toggleRow(index)}>
                <Table.Td key={name}><Anchor href={href}>{name}</Anchor> </Table.Td>
                <Table.Td key={schedule}>{schedule}</Table.Td>
                <Table.Td key={job.trigger}>
                    <Button
                        loading={isLoading}
                        leftSection={<IconPlayerPlay size={20} />}
                        onClick={handleJobTrigger(name)}
                    >
                        Trigger
                    </Button>
                </Table.Td>
                <Table.Td key={suspended}>{suspended ? 'Yes' : 'No'}</Table.Td>
            </Table.Tr>
            <Table.Tr key={`collapse-${index}`}>
                <Table.Td colSpan="3">
                    <Collapse in={opened === index}>
                        <Container>
                            <JobGrid data={filteredJobInstances} parent={name} />
                        </Container>
                    </Collapse>
                </Table.Td>
            </Table.Tr>
        </React.Fragment>
    )});

    return (
        <>
            <Title align="center" mt={10}>
                <Text inherit variant="gradient" component="span" gradient={{ from: 'gray', to: 'blue' }}>
                    This is the Jobs Page
                </Text>
            </Title>
            {jobs.length > 0 ? (
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Job Name</Table.Th>
                            <Table.Th>Schedule</Table.Th>
                            <Table.Th>Trigger</Table.Th>
                            <Table.Th>Suspended</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {Body}
                    </Table.Tbody>
                </Table>
            ) : (
                !isLoading ? <p>No jobs found.</p> : <p>Loading jobs...</p>
            )}
        </>
    );
};

export default Page;
