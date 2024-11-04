import React, { useState, useEffect } from 'react';
import { Container, Title, Text, Grid, Paper, Button, RingProgress, Group, SimpleGrid, TextInput } from '@mantine/core';
import { IconServer, IconRocket, IconSearch } from '@tabler/icons-react';

import { DataTable } from 'mantine-datatable';
import callK8sApi from '@/lib/k8s';
import parseCpu from '@/utils/parseCpu'

import { format } from 'date-fns';

import { useParams } from 'next/navigation';

import { useSession } from 'next-auth/react';

import { IconChevronUp, IconSelector } from '@tabler/icons-react';
// import { access } from 'fs';

function parseMemory(memory) {
    if (typeof memory === 'number') return memory;
    if (memory.endsWith('Ki')) return parseInt(memory) / 1024 / 1024;
    if (memory.endsWith('Mi')) return parseInt(memory) / 1024;
    if (memory.endsWith('Gi')) return parseInt(memory);
    return parseInt(memory) / 1024 / 1024 / 1024;
}

export default function ClusterDashboard() {
    // Get the cluster name from the URL
    const clusterName = useParams()?.clustername;

    const session = useSession();
    const { data: sessionData } = session;

    console.log("sessionData", sessionData)

    const [k8sVersion, setK8sVersion] = useState("");
    const [nodes, setNodes] = useState([]);
    const [deployments, setDeployments] = useState([]);
    const [events, setEvents] = useState([]);
    const [capacity, setCapacity] = useState({ cpu: 0, memory: 0, pods: 0 });
    const [usedCapacity, setUsedCapacity] = useState({ cpu: 0, memory: 0, pods: 0 });

    // Events state
    const [filteredEvents, setFilteredEvents] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);



    useEffect(() => {
        if (!sessionData) {
            console.log("returning because access token is null")
            return;
        }
        const fetchClusterData = async () => {
            try {
                console.log("fetching cluster data")
                const [versionData, nodesData, deploymentsData, eventsData, metricsData, podsData] = await Promise.all([
                    callK8sApi('/version', 'GET', null, null, clusterName, sessionData.accessToken),
                    callK8sApi('/api/v1/nodes', 'GET', null, null, clusterName, sessionData.accessToken),
                    callK8sApi('/apis/apps/v1/deployments', 'GET', null, null, clusterName, sessionData.accessToken),
                    callK8sApi('/api/v1/events', 'GET', null, null, clusterName, sessionData.accessToken),
                    callK8sApi('/apis/metrics.k8s.io/v1beta1/nodes', 'GET', null, null, clusterName, sessionData.accessToken),
                    callK8sApi('/api/v1/pods', 'GET', null, null, clusterName, sessionData.accessToken)
                ]);

                setK8sVersion(`${versionData.major}.${versionData.minor}`);
                setNodes(nodesData.items);
                setDeployments(deploymentsData.items);
                setEvents(eventsData.items);

                calculateCapacity(nodesData.items);
                calculateUsage(metricsData.items, podsData.items);
            } catch (error) {
                console.error('Failed to fetch cluster data:', error);
            }
        };

        fetchClusterData();
    }, [sessionData]);


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


    const calculateCapacity = (nodes) => {
        let totalCpu = 0;
        let totalMemory = 0;
        let totalPods = 0;

        nodes.forEach(node => {
            totalCpu += parseCpu(node.status.capacity.cpu);
            totalMemory += parseMemory(node.status.capacity.memory);
            totalPods += parseInt(node.status.capacity.pods);
        });

        setCapacity({ cpu: totalCpu, memory: totalMemory, pods: totalPods });
    };

    const calculateUsage = (nodeMetrics, pods) => {
        let usedCpu = 0;
        let usedMemory = 0;

        nodeMetrics.forEach(metric => {
            usedCpu += parseCpu(metric.usage.cpu);
            usedMemory += parseMemory(metric.usage.memory);
        });

        setUsedCapacity(prev => ({
            ...prev,
            cpu: usedCpu,
            memory: usedMemory,
            pods: pods.length
        }));
    };

    const formatPercentage = (used, total) => {
        const percentage = (used / total) * 100;
        return percentage > 100 ? 100 : percentage.toFixed(1);
    };

    return (
        <Container fluid>
            <Title order={1} my="xl">Cluster Dashboard</Title>
            <Text mb="xl">
                This is the cluster dashboard. It will show the status of your kubernetes cluster, the number of nodes, and other useful information.
            </Text>

            <Paper shadow="xs" p="md" mb="xl">
                <Text>Kubernetes Version: {k8sVersion}</Text>
            </Paper>

            <SimpleGrid cols={2} spacing="lg" mb="xl">
                <Paper shadow="xs" p="md">
                    <Group position="apart">
                        <Group>
                            <IconServer size={24} color="blue" />
                            <div>
                                <Text size="xl" weight={700} color="blue">{nodes.length}</Text>
                                <Text>Nodes</Text>
                            </div>
                        </Group>
                        <Button variant="light" color="blue">1 ALERTS</Button>
                    </Group>
                </Paper>
                <Paper shadow="xs" p="md">
                    <Group position="apart">
                        <Group>
                            <IconRocket size={24} color="blue" />
                            <div>
                                <Text size="xl" weight={700} color="blue">{deployments.length}</Text>
                                <Text>Deployments</Text>
                            </div>
                        </Group>
                        <Button variant="light" color="blue">1</Button>
                    </Group>
                </Paper>
            </SimpleGrid>

            <Title order={2} mb="md">Capacity</Title>
            <SimpleGrid cols={3} spacing="lg" mb="xl">
                <Paper shadow="xs" p="md">
                    <Text weight={500} mb="xs">Cluster CPU Usage</Text>
                    <RingProgress
                        sections={[{ value: parseFloat(formatPercentage(usedCapacity.cpu, capacity.cpu)), color: 'blue' }]}
                        label={
                            <Text color="blue" weight={700} align="center" size="xl">
                                {formatPercentage(usedCapacity.cpu, capacity.cpu)}%
                            </Text>
                        }
                    />
                    <Text align="center" mt="sm">{usedCapacity.cpu.toFixed(2)} / {capacity.cpu.toFixed(2)} cores</Text>
                </Paper>
                <Paper shadow="xs" p="md">
                    <Text weight={500} mb="xs">Cluster Memory Usage</Text>
                    <RingProgress
                        sections={[{ value: parseFloat(formatPercentage(usedCapacity.memory, capacity.memory)), color: 'blue' }]}
                        label={
                            <Text color="blue" weight={700} align="center" size="xl">
                                {formatPercentage(usedCapacity.memory, capacity.memory)}%
                            </Text>
                        }
                    />
                    <Text align="center" mt="sm">{usedCapacity.memory.toFixed(1)} / {capacity.memory.toFixed(1)} GB</Text>
                </Paper>
                <Paper shadow="xs" p="md">
                    <Text weight={500} mb="xs">Pods</Text>
                    <RingProgress
                        sections={[{ value: parseFloat(formatPercentage(usedCapacity.pods, capacity.pods)), color: 'blue' }]}
                        label={
                            <Text color="blue" weight={700} align="center" size="xl">
                                {formatPercentage(usedCapacity.pods, capacity.pods)}%
                            </Text>
                        }
                    />
                    <Text align="center" mt="sm">{usedCapacity.pods} / {capacity.pods} Pods</Text>
                </Paper>
            </SimpleGrid>

            <Title order={2} mb="md">Events Table</Title>
            <Group position="apart" mb="md">
                <TextInput
                    placeholder="Search events..."
                    icon={<IconSearch size={14} />}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.currentTarget.value)}
                    style={{ width: '300px' }}
                />
                <Text>Total Events: {filteredEvents.length}</Text>
            </Group>
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
                    { accessor: 'involvedObject.name', title: 'Name', sortable: true },
                    { accessor: 'involvedObject.namespace', title: 'Namespace', sortable: true },
                    { accessor: 'involvedObject.kind', title: 'Kind', sortable: true },
                    { accessor: 'reason', title: 'Reason', sortable: true },
                    { accessor: 'message', title: 'Message', sortable: true, width: '40%' },
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
                // noRecordsText="No events found"
                loadingText="Loading events..."
            />


        </Container>
    );
}