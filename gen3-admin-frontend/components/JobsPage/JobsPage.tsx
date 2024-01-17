import { Title, Text, Grid, Badge, Card, Modal, Container, Table, Button, Collapse, useMantineTheme } from '@mantine/core';
import { useEffect, useState } from 'react';
import { IconPlayerPlay } from '@tabler/icons-react';
import { IconCheck, IconX, IconClock } from '@tabler/icons-react';
import JobsDetailsModal from '../JobsDetailsModal/JobsDetailsModal';
import { notifications, Notifications } from '@mantine/notifications';
import { Fragment } from 'react';

const DataCard = ({ item, onOpenModal }) => {
    const theme = useMantineTheme();

    // You can add more conditions for different statuses
    const statusColors = {
        'Succeeded': { color: 'green', icon: <IconCheck size={16} /> },
        'Failed': { color: 'red', icon: <IconX size={16} /> },
        'Running': { color: 'blue', icon: <IconClock size={16} /> }
    };

    const status = statusColors[item.status] || statusColors['Failed']; // Default to 'Failed' look for undefined statuses

    return (
        <Card
            shadow="sm"
            p="md"
            style={{
                //   backgroundColor: theme.white,
                borderColor: theme.colors.gray[2],
                borderWidth: 1,
                borderStyle: 'solid',
                borderRadius: theme.radius.md,
                marginBottom: theme.spacing.lg,
                transition: 'box-shadow 0.3s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = theme.shadows.md}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
        >
            <Text fw={500} style={{ marginBottom: theme.spacing.xs, fontSize: theme.fontSizes.lg }}>
                {item.name}
            </Text>
            <Badge color={status.color} variant="light" leftSection={status.icon} style={{ marginBottom: theme.spacing.sm }}>
                {item.status}
            </Badge>
            <Text size="sm" style={{ color: theme.colors.gray[7], marginBottom: theme.spacing.xs }}>
                Created: {new Date(item.date_created).toLocaleString()}
            </Text>
            <Text size="sm" style={{ color: theme.colors.gray[7], marginBottom: theme.spacing.xs }}>
                Finished: {new Date(item.date_finished).toLocaleString()}
            </Text>
            <Button
                variant="light"
                color={status.color}
                fullWidth
                style={{ marginTop: theme.spacing.md }}
                onClick={() => onOpenModal(item)}
            >

                View Details
            </Button>
        </Card>
    );
};



const ResponsiveCards = ({ data }) => {
    const [selectedItem, setSelectedItem] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [details, setDetails] = useState(null);

    const handleOpenModal = async (item) => {
        setSelectedItem(item);
        setIsModalOpen(true);

        // Replace '/api/job-details' with the correct endpoint and pass the item identifier as needed
        const response = await fetch(`/admin-api/jobs/status/${item.name}`);
        const detailsData = await response.json();
        setDetails(detailsData);
    };

    return (
        <>
            <Grid>
                {data.map((item, index) => (
                    <Grid.Col key={index} span={{ base: 12, md: 6, lg: 4, xl: 3 }}>
                        <DataCard item={item} onOpenModal={handleOpenModal} />
                    </Grid.Col>

                ))}
            </Grid>

            <Modal
                opened={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={`Details for ${selectedItem?.name}`}
            >
                {details ? (
                    <div>
                        {/* Render your details here */}
                        <p>{details.someDetail}</p>
                    </div>
                ) : (
                    <div>Loading...</div>
                )}
            </Modal>

            {/* Replace the previous Modal with the JobDetailsModal component */}
            {selectedItem && (
                <JobsDetailsModal
                    details={details}
                    opened={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                />
            )}

        </>

    );
};



async function fetchJobs() {
    try {
        const response = await fetch('/admin-api/jobs/options'); // This endpoint will be redirected by your proxy
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch jobs:', error);
        return null;
    }
}

async function triggerJobApi(job: string) {
    try {
        const response = await fetch('/admin-api' + job, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('API request failed:', error);
        return null;
    }
}



async function getJobInstances(job: string) {
    try {
        const response = await fetch('/admin-api/jobs/cron/status/' + job, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('API request failed:', error);
        return null;
    }
}

export function JobsPage() {
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [opened, setOpened] = useState(null);
    const [jobInstances, setJobInstances] = useState([{}]);

    const toggleRow = (index) => {
        setOpened(opened === index ? null : index);
        // Only run if the row is being opened
        if (opened !== index) {
            getJobInstances(jobs[index].name).then(data => {
                if (data) {
                    console.log(data)
                    setJobInstances(data);
                }
            });
        }
    };

    const handleJobTrigger = (job: string) => () => {
        setIsLoading(true);
        triggerJobApi(job).then(result => {
            console.log('API Response:', result);
            setIsLoading(false);
        });
    };

    useEffect(() => {
        fetchJobs().then(data => {
            if (data) {
                console.log(data)
                setJobs(data);
            }
        });
    }, []);

    const Body = jobs.map((job, index) => (
        <Fragment key={index}>
            <Table.Tr key={job.name} onClick={() => toggleRow(index)}>
                <Table.Td key={job.name}>{job.name}</Table.Td>
                <Table.Td key={job.schedule}>{job.schedule}</Table.Td>
                <Table.Td key={job.trigger}>
                    <Button
                        loading={isLoading}
                        leftSection={<IconPlayerPlay size={20} />}
                        onClick={handleJobTrigger(job.trigger)}
                    >
                        Trigger
                    </Button>
                </Table.Td>
                {/* <Table.Td><Button
                    onClick={() =>
                        notifications.show({
                            title: 'Notification with custom styles',
                            message: 'It is default blue',
                            // classNames: classes,
                        })
                    }
                >
                    Custom styles
                </Button>
                </Table.Td> */}
            </Table.Tr>
            <Table.Tr key={index} >
                <Table.Td key={index}>
                    <Collapse key={index} in={opened === index}>
                        <Container>
                            <ResponsiveCards data={jobInstances} />
                        </Container>
                    </Collapse>
                </Table.Td>
            </Table.Tr>
        </Fragment>
    ))

    return (
        <>

            <Title ta="center" mt={10}>
                <Text inherit variant="gradient" component="span" gradient={{ from: 'gray', to: 'blue' }}>
                    This is the {' '}
                    Jobs
                    {' '}Page
                </Text>
            </Title>
            {/* <Container mt={25}> */}
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
                <p>Loading jobs...</p>
            )}
        </>
    )
}