import React, { useState, useEffect } from 'react';
import { Table, Badge, Text, Progress, Menu, Collapse, Box, Group, Card, SimpleGrid, RingProgress, ActionIcon, Title, Loader, Container } from '@mantine/core';
import { IconServer, IconAlertTriangle, IconChevronDown, IconChevronRight, IconChevronUp, IconDotsVertical, IconRefresh, IconSearch, IconSelector, IconTerminal } from '@tabler/icons-react';
import Link from 'next/link';
import { DataTable } from 'mantine-datatable';

import callK8sApi from '@/lib/k8s';
import { format } from 'date-fns';

import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';

async function fetchPods(clusterName, accessToken) {
    try {
        const data = await callK8sApi('/api/v1/namespaces/default/pods', 'GET', null, null, clusterName, accessToken);
        return data.items; // Kubernetes API returns a list of pods under 'items'
    } catch (error) {
        console.error('Failed to fetch pods:', error);
        return null;
    }
}



function calculateAge(created) {
    const now = new Date();
    const createdDate = new Date(created);
    const diffTime = Math.abs(now - createdDate);
    const diffMinutes = Math.ceil(diffTime / (1000 * 60));
    if (diffMinutes < 60) return `${diffMinutes}m`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h`;
    return `${Math.floor(diffHours / 24)}d`;
}


async function fetchEventsForPod(podName, clusterName, accessToken) {
    if (!accessToken) {
        return;
    }
    try {
        const data = await callK8sApi(`/api/v1/namespaces/default/events?fieldSelector=involvedObject.name=${podName}`, 'GET', null, null, clusterName, accessToken)
        return data.items;
    }
    catch (error) {
        console.error('Failed to fetch events for pod:', error);
        return null;
    }
}

function PodRow({ pod, isOpen, onToggle }) {
    const [isLoading, setIsLoading] = useState(false);  // TODO: Make this a spinner
    const [events, setEvents] = useState([]);
    const [filteredEvents, setFilteredEvents] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const clusterName = useParams()?.clustername;

    useEffect(() => {
        const filtered = events.filter(event =>
            event?.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            event?.metadata.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            event?.reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            event?.involvedObject.kind.toLowerCase().includes(searchQuery.toLowerCase()) ||
            event?.involvedObject.namespace.toLowerCase().includes(searchQuery.toLowerCase())
        );
        setFilteredEvents(filtered);
        setPage(1);
    }, [searchQuery, events]);

    const paginatedEvents = filteredEvents.slice((page - 1) * pageSize, page * pageSize);

    useEffect(() => {
        if (!sessionData) {
            return;
        }
        if (isOpen) {
            setIsLoading(true);
            setEvents([]);
            fetchEventsForPod(pod.name, clusterName, accessToken).then((data) => {
                if (data) {
                    setEvents(data);
                }
                setIsLoading(false);
            });
        }
    }, [isOpen, pod.name, sessionData]);

    const getColor = (pod) => {
        switch (getPodStatusText(pod)) {
            case 'Pending':
                return 'yellow';
            case 'Unknown':
                return 'red';
            case 'Succeeded':
                return 'grey';
            case 'Completed':
                return 'grey';
            case 'Running':
                if (!pod.ready) {
                    return 'red'; // Handle missing ready
                } else {
                    const [ready, total] = pod.ready.split('/').map(Number);
                    return ready === total ? 'green' : 'yellow';
                }
            default:
                return 'red';
        }
    };


    return (
        <>
            <Table.Tr>
                <Table.Td>
                    <Badge
                        color={getColor(pod)}
                        tt="none"
                        rightSection={pod.status === 'Running' && getColor(pod) === 'yellow' && (
                            <IconAlertTriangle size={16} ml="sm" />
                        )}
                    >
                        {getPodStatusText(pod)}
                    </Badge>
                </Table.Td>
                <Group spacing="xs">
                    <ActionIcon onClick={onToggle}>
                        {isOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    </ActionIcon>
                    <Text>{pod.name}</Text>
                </Group>
                <Table.Td>{pod.ready}</Table.Td>
                <Table.Td>{pod.restarts}</Table.Td>
                <Table.Td>{pod.age}</Table.Td>
                <Table.Td>{pod.ip}</Table.Td>
                <Table.Td>{pod.node}</Table.Td>
                <Table.Td>
                    <Group spacing="xs">
                        <Menu>
                            <Menu.Target>
                                <ActionIcon>
                                    <IconDotsVertical size={16} />
                                </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Item icon={<IconTerminal size={16} />}>
                                    <Text>Terminal</Text>
                                </Menu.Item>
                                <Menu.Item icon={<IconChevronDown size={16} />}>
                                    <Text>Logs</Text>
                                </Menu.Item>
                                <Menu.Item icon={<IconChevronDown size={16} />}>
                                    <Text>Events</Text>
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    </Group>
                </Table.Td>
            </Table.Tr>
            <Table.Tr>
                <Table.Td colSpan={7} style={{ padding: 0 }}>
                    <Collapse in={isOpen}>
                        <Box p="md">
                            {isLoading ? (
                                <Loader />
                            ) : (
                                <>
                                    <Table>
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>Init Containers</Table.Th>
                                                <Table.Th>Image</Table.Th>
                                                <Table.Th>Command</Table.Th>
                                                <Table.Th>Ready</Table.Th>
                                                <Table.Th>State</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {/* Get containerStatus from pod.status.containerStatuses */}
                                            {pod.initContainers?.map((container) => {
                                                const containerStatus = pod.containerStatuses?.find(status => status.name === container.name);
                                                let status = "Unknown";
                                                if (containerStatus?.state?.waiting?.reason) {
                                                    status = containerStatus?.state?.waiting?.reason;
                                                } else if (containerStatus?.state?.terminated?.reason) {
                                                    status = containerStatus?.state?.terminated?.reason;
                                                } else if (containerStatus?.state?.running) {
                                                    status = "Running";
                                                }

                                                return (
                                                    <Table.Tr key={container.name} >
                                                        <Table.Td>{container.name}</Table.Td>
                                                        <Table.Td>{container.image}</Table.Td>
                                                        <Table.Td>{container.command}</Table.Td>
                                                        <Table.Td>{containerStatus?.ready ? 'Yes' : 'No'}</Table.Td>
                                                        <Table.Td>{status}</Table.Td>
                                                        {/* <Table.Td>{container.restarts}</Table.Td>
                                                    <Table.Td>{container.age}</Table.Td>
                                                    <Table.Td>{container.ip}</Table.Td>
                                                    <Table.Td>{container.node}</Table.Td> */}
                                                    </Table.Tr>
                                                )
                                            }
                                            )}
                                        </Table.Tbody>
                                    </Table>
                                    <Table>
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>Containers</Table.Th>
                                                <Table.Th>Image</Table.Th>
                                                <Table.Th>Command</Table.Th>
                                                <Table.Th>Ready</Table.Th>
                                                <Table.Th>State</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {/* Get containerStatus from pod.status.containerStatuses */}
                                            {pod.containers.map((container) => {
                                                const containerStatus = pod.containerStatuses?.find(status => status.name === container.name);
                                                let status = "Unknown";
                                                if (containerStatus?.state?.waiting?.reason) {
                                                    status = containerStatus?.state?.waiting?.reason;
                                                } else if (containerStatus?.state?.terminated?.reason) {
                                                    status = containerStatus?.state?.terminated?.reason;
                                                } else if (containerStatus?.state?.running) {
                                                    status = "Running";
                                                }

                                                return (
                                                    <Table.Tr key={container.name} >
                                                        <Table.Td>{container.name}</Table.Td>
                                                        <Table.Td>{container.image}</Table.Td>
                                                        <Table.Td>{container.command}</Table.Td>
                                                        <Table.Td>{containerStatus?.ready ? 'Yes' : 'No'}</Table.Td>
                                                        <Table.Td>{status}</Table.Td>
                                                        {/* <Table.Td>{container.restarts}</Table.Td>
                                                    <Table.Td>{container.age}</Table.Td>
                                                    <Table.Td>{container.ip}</Table.Td>
                                                    <Table.Td>{container.node}</Table.Td> */}
                                                    </Table.Tr>
                                                )
                                            }
                                            )}
                                        </Table.Tbody>
                                    </Table>
                                    {/* Events for pod in a mantine-data-table */}
                                    <Container size="lg" p="md" radius="md" my="md">
                                        <Title order={3} mt="md">Events</Title>
                                        <DataTable
                                            // withBorder
                                            borderRadius="sm"
                                            withColumnBorders
                                            striped
                                            highlightOnHover
                                            columns={[
                                                {
                                                    accessor: 'lastTimestamp', title: 'Timestamp', sortable: true, render: ({ lastTimestamp }) => format(new Date(lastTimestamp), 'yyyy-MM-dd HH:mm:ss')
                                                },
                                                // { accessor: 'involvedObject.name', title: 'Name', sortable: true },
                                                // { accessor: 'involvedObject.namespace', title: 'Namespace', sortable: true },
                                                // { accessor: 'involvedObject.kind', title: 'Kind', sortable: true },
                                                { accessor: 'reason', title: 'Reason', sortable: true },
                                                { accessor: 'message', title: 'Message', sortable: true },
                                            ]}
                                            records={paginatedEvents}
                                            totalRecords={filteredEvents.length}
                                            recordsPerPage={pageSize}
                                            page={page}
                                            onPageChange={setPage}
                                            recordsPerPageOptions={[10, 20, 30, 50]}
                                            onRecordsPerPageChange={setPageSize}
                                            sortIcons={{
                                                sorted: <IconChevronUp size={14} />,
                                                unsorted: <IconSelector size={14} />,
                                            }}
                                            noRecordsText="No events found"
                                            loadingText="Loading events..."
                                        />
                                    </Container>
                                </>
                            )}
                        </Box>
                    </Collapse>
                </Table.Td>
            </Table.Tr >
        </>
    );
}

// Helper function to get pod status text
function getPodStatusText(pod) {

    // Handle other common statuses based on containerStatuses
    if (pod.status.containerStatuses) {
        const allWaiting = pod.status.containerStatuses.every(status => status.state.waiting);
        const anyTerminated = pod.status.containerStatuses.some(status => status.state.terminated);

        if (allWaiting) {
            const reasons = pod.status.containerStatuses[0].state.waiting.reason;
            return reasons;
        } else if (anyTerminated) {
            const reasons = pod.status.containerStatuses[0].state.terminated.reason;
            return reasons;
        }
    }

    if (pod.status.phase) {
        return pod.status.phase; // Use the main phase if available
    }

    return 'Unknown'; // Fallback for unexpected cases
}


export default function PodsDashboard() {
    const [pods, setPods] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const [openPod, setOpenPod] = useState(null);

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const clusterName = useParams()?.clustername;

    useEffect(() => {
        fetchPods(clusterName, accessToken).then((data) => {
            if (data) {
                const formattedPods = data.map(pod => ({
                    name: pod.metadata.name,
                    namespace: pod.metadata.namespace,
                    containers: pod.spec.containers,
                    initContainers: pod.spec.initContainers,
                    status: pod.status,
                    containerStatuses: pod.status.containerStatuses,
                    ready: `${pod.status.containerStatuses?.filter(status => status.ready).length || 0}/${pod.spec.containers.length}`,
                    restarts: pod.status.containerStatuses?.reduce((acc, status) => acc + status.restartCount, 0) || 0,
                    age: calculateAge(pod.metadata.creationTimestamp),
                    ip: pod.status.podIP,
                    node: pod.spec.nodeName,
                    created: pod.metadata.creationTimestamp,
                }));
                setPods(formattedPods);
            }
            setIsLoading(false);
        });
    }, [openPod]);

    const totalPods = pods.length;
    const runningPods = pods.filter(pod => pod.status === 'Running').length;
    const finishedPods = pods.filter(pod => pod.status === 'Succeeded').length;
    const notRunningPods = totalPods - runningPods - finishedPods;

    if (isLoading) {
        return <Text>Loading pods...</Text>;
    }

    if (pods.length === 0) {
        return <Text>No pods found.</Text>;
    }

    return (
        <div>
            <Title order={2} align="center" mb="xl">Kubernetes Pods Dashboard</Title>

            <SimpleGrid cols={3} mb="xl">
                <Card shadow="sm" p="lg">
                    <RingProgress
                        sections={[{ value: (runningPods / totalPods) * 100, color: 'teal' }]}
                        label={
                            <Text size="xl" align="center">
                                {runningPods}/{totalPods - finishedPods}
                            </Text>
                        }
                    />
                    <Text align="center" mt="md">Running Pods</Text>
                </Card>
                <Card shadow="sm" p="lg">
                    <Group position="center">
                        <IconServer size={48} />
                        <div>
                            <Text size="xl">{totalPods}</Text>
                            <Text>Total Pods</Text>
                        </div>
                    </Group>
                </Card>
                <Card shadow="sm" p="lg">
                    <Group position="center">
                        <IconAlertTriangle size={48} color="orange" />
                        <div>
                            <Text size="xl">{notRunningPods}</Text>
                            <Text>Not Running Pods</Text>
                        </div>
                    </Group>
                </Card>
            </SimpleGrid>

            <Table mt="md">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Ready</Table.Th>
                        <Table.Th>Restarts</Table.Th>
                        <Table.Th>Age</Table.Th>
                        <Table.Th>IP</Table.Th>
                        <Table.Th>Node</Table.Th>
                        <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {pods.map((pod) => (
                        <PodRow
                            key={pod.name}
                            pod={pod}
                            isOpen={openPod === pod.name}
                            onToggle={() => setOpenPod(openPod === pod.name ? null : pod.name)}
                        />
                    ))}
                </Table.Tbody>
            </Table>
        </div>
    );
}