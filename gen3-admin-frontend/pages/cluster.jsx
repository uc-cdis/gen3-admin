'use client';

import { Title, Text, Code, Grid, RingProgress, Progress, Paper, Badge, Divider, Table, HoverCard, Container, Skeleton } from '@mantine/core';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DataTable } from 'mantine-datatable';


import { FixedSizeList } from "react-window";

async function fetchK8sVersion() {
    try {
        const response = await fetch('/api/k8s/proxy/version'); // This endpoint will be redirected by your proxy
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        const data = await response.json();
        let versionString = data.major + "." + data.minor
        return versionString;
    } catch (error) {
        console.error('Failed to fetch cluster version:', error);

        return null;
    }
}

export default function Cluster() {
    // const k8s_version = "1.26"
    const [k8sversion, setK8sVersion] = useState("");
    const [events, setEvents] = useState([]);
    const [pods, setPods] = useState([]);

    const [nodeMetrics, setNodeMetrics] = useState({});
    const [nodeDetails, setNodeDetails] = useState({});
    const [capacity, setCapacity] = useState({ cpu: 0, memory: 0, pods: 0 })
    const [usedCapacity, setUsedCapacity] = useState({ cpu: 0, memory: 0, pods: 0 })





    function parseCpu(value) {
        if (!value) return 0;

        // Check if the last character is a digit
        const isLastCharDigit = !isNaN(value.slice(-1));
        const numberStr = isLastCharDigit ? value : value.slice(0, -1);  // Extract number part
        const unit = isLastCharDigit ? '' : value.slice(-1);             // Extract unit

        const number = parseFloat(numberStr);  // Convert number to float
        console.log("ParseCPU:", numberStr, number, unit); // Debugging output

        // Handle potential errors
        if (isNaN(number)) {
            console.warn("Invalid CPU value:", value);
            return 0;
        }

        switch (unit) {
            case 'n': return number / 1000000000;
            case 'u': return number / 1000000;
            case 'm': return number / 1000;
            default: return number; // Assume cores
        }
    }



    useEffect(() => {
        const fetchNodeData = async () => {
            try {
                // Reset capacity and usage before render. 
                setCapacity({ cpu: 0, memory: 0, pods: 0 })
                setUsedCapacity({ cpu: 0, memory: 0, pods: 0 })

                const [metricsResponse, detailsResponse] = await Promise.all([
                    fetch('/api/k8s/proxy/apis/metrics.k8s.io/v1beta1/nodes'),
                    fetch('/api/k8s/proxy/api/v1/nodes')
                ]);

                if (!metricsResponse.ok || !detailsResponse.ok) {
                    throw new Error(`Error fetching data: Metrics: ${metricsResponse.status}, Details: ${detailsResponse.status}`);
                }

                const metricsData = await metricsResponse.json();
                const detailsData = await detailsResponse.json();

                setNodeMetrics(metricsData);
                setNodeDetails(detailsData);

                // Calculate capacity AFTER both fetches have completed
                calculateCapacity(detailsData);
                calculateUsage(metricsData)
            } catch (error) {
                console.error('Failed to fetch node data:', error);
                // Implement error handling (e.g., display error message to the user, redirect to error pages)
            }
        };

        const calculateCapacity = (detailsData) => {
            detailsData?.items?.forEach(node => {
                setCapacity(prevCapacity => {
                    const nodeCpu = parseInt(parseCpu(node.status.capacity.cpu)) || 0;
                    const nodeMemory = parseInt(node.status.capacity['memory'].slice(0, -2)) || 0;
                    const pods = parseFloat(node.status.capacity.pods || 0);
                    return {
                        ...prevCapacity,
                        cpu: prevCapacity.cpu + nodeCpu,
                        memory: prevCapacity.memory + nodeMemory,
                        pods: prevCapacity.pods + pods,
                    };
                });
            });
        };

        // New function to calculate used resources
        const calculateUsage = (metricsData) => {
            let totalCpuUsage = 0;
            let totalMemoryUsage = 0;
            let totalPodsUsage = 0;

            metricsData?.items?.forEach(nodeMetric => {
                const nodeUsage = nodeMetric.usage;
                console.log("Parsed cpu usage: ", parseCpu(nodeUsage.cpu))
                totalCpuUsage += parseCpu(nodeUsage.cpu) || 0;
                totalMemoryUsage += parseInt(nodeUsage.memory.slice(0, -2)) || 0;
                // You might need to adjust if pods are tracked differently in metrics
                // totalPodsUsage += parseFloat(nodeUsage.pods) || 0; 
            });
            console.log(totalCpuUsage)
            setUsedCapacity(prevUsedCapacity => ({
                ...prevUsedCapacity,
                cpu: totalCpuUsage,
                memory: totalMemoryUsage,
                // pods: totalPodsUsage,
            }));
        };


        fetchNodeData(); // Call the async function to trigger the data fetching and calculation
    }, []); // Empty dependency array ensures this runs only once after initial render


    useEffect(() => {
        fetchK8sVersion().then(data => {
            if (data) {
                setK8sVersion(data);
            }
            else {
                setK8sVersion("error");
            }
        });
    }, []);

    useEffect(() => {
        const fetchEvents = async () => {
            try {
                // const response = await fetch('/api/cluster/capacity'); // This endpoint will be redirected by your proxy
                // const response = await fetch('/api/k8s/proxy/apis/metrics.k8s.io/v1beta1/nodes'); // This endpoint will be redirected by your proxy
                const response = await fetch('/api/k8s/proxy/api/v1/events'); // This endpoint will be redirected by your proxy
                if (!response.ok) {
                    throw new Error(`Error: ${response.status}`);
                }
                const data = await response.json();
                setEvents(data.items);
            } catch (error) {
                console.error('Failed to fetch events:', error);
            }
        };

        fetchEvents();
    }, [])

    useEffect(() => {
        const fetchPods = async () => {
            try {
                const response = await fetch('/api/k8s/proxy/api/v1/pods'); // This endpoint will be redirected by your proxy
                if (!response.ok) {
                    throw new Error(`Error: ${response.status}`);
                }
                const data = await response.json();
                setPods(data.items);
            } catch (error) {
                console.error('Failed to fetch pods:', error);
            }
        };
        fetchPods();
    }, [])


    return (
        <>
            <Skeleton visible={false}>
                <Container fluid my={20}>
                    <Title>Cluster Dashboard</Title>
                </Container>
                <Divider />
                <Container fluid my={20}>
                    <Text>
                        This is the cluster dashboard. It will show the status of your kubernetes cluster, the number of nodes, and other useful information.
                    </Text>
                </Container>
                <Divider />

                <Container fluid my={20}>
                    <Grid>
                        {/* <Grid.Col span={4}>
                            <Paper>
                                Provider: AWS
                            </Paper>
                        </Grid.Col> */}
                        <Grid.Col span={4}>
                            Kubernetes Version: {k8sversion}
                        </Grid.Col>
                        {/* <Grid.Col span={4}>
                            Created: 2021-08-01
                        </Grid.Col> */}
                    </Grid>
                </Container>
                <Divider />
                <Container fluid my={20}>
                    <Grid>
                        {/* Total Resources */}
                        {/* <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                                <Grid>
                                    <Grid.Col span={4}>
                                        <Text>524</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Text>Total Resources</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Badge>1</Badge>
                                    </Grid.Col>
                                </Grid>
                            </Paper>
                        </Grid.Col> */}
                        <Grid.Col span={4}>
                            {/* Nodes */}
                            {/* <Anchor component={Link} href="/nodes"> */}
                            <Paper shadow="lg" withBorder p="xl" component={Link} href="/nodes">
                                <Grid>
                                    <Grid.Col span={4}>
                                        <Text>{nodeMetrics?.items?.length}</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Text>Nodes</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Badge color="red">1 alerts</Badge>
                                    </Grid.Col>
                                </Grid>
                            </Paper>
                            {/* </Anchor> */}
                        </Grid.Col>
                        <Grid.Col span={4}>
                            {/* Nodes */}
                            <Paper shadow="lg" withBorder p="xl" component={Link} href="/deployments">
                                <Grid>
                                    <Grid.Col span={4}>
                                        <Text>13</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Text>Deployments</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Badge>1</Badge>
                                    </Grid.Col>
                                </Grid>
                            </Paper>
                        </Grid.Col>
                    </Grid>
                </Container>
                <Divider />
                <Container fluid my={20}>
                    <Title order={2}>
                        Capacity
                    </Title>
                    <Text>
                    </Text>
                    <Grid>
                        {/* <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                                <Title order={4}>Pods</Title>
                                <Text>Used  | {capacity?.used}/{capacity?.capacity} | {(capacity?.used / capacity?.capacity * 100).toFixed(1)}%</Text>
                                <Progress value={(capacity?.used / capacity?.capacity * 100).toFixed(1)} />
                            </Paper>
                        </Grid.Col> */}
                        <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                                <Title order={4}>Cluster CPU Usage</Title>
                                <RingProgress
                                    sections={[{ value: ((usedCapacity.cpu / capacity.cpu) * 100), color: 'blue' }]}
                                    label={
                                        <Text c="blue" fw={700} ta="center" size="xl">
                                            {((usedCapacity.cpu / capacity.cpu) * 100).toFixed(1)}%
                                        </Text>
                                    }
                                />
                                <Text> {usedCapacity.cpu.toFixed(2)} / {capacity.cpu} cores</Text>
                            </Paper>
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                                <Title order={4}>Cluster Memory Usage</Title>
                                <RingProgress
                                    sections={[{ value: ((usedCapacity.memory / capacity.memory) * 100), color: 'blue' }]}
                                    label={
                                        <Text c="blue" fw={700} ta="center" size="xl">
                                            {((usedCapacity.memory / capacity.memory) * 100).toFixed(1)}%
                                        </Text>
                                    }
                                />
                                <Text> {(usedCapacity.memory / 1000000).toFixed(1)} / {(capacity.memory / 1000000).toFixed(1)} GB</Text>
                            </Paper>
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                                <Title order={4}>Pods</Title>
                                {console.log(pods.length, capacity.pods)}
                                <RingProgress
                                    sections={[{ value: ((pods.length / capacity.pods) * 100), color: 'blue' }]}
                                    label={
                                        <Text c="blue" fw={700} ta="center" size="xl">
                                            {((pods.length / capacity.pods) * 100).toFixed(1)}%
                                        </Text>
                                    }
                                />
                                <Text> {pods.length} / {capacity.pods} Pods</Text>
                            </Paper>
                        </Grid.Col>
                        {/* <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                                <Text>Memory</Text>
                                <Text> Reserved 1.15 / 8 cores</Text>
                                <Progress value={14.37} label="1.15 / 8 cores" />
                                <Text>Used 0.69 / 8 cores</Text>
                                <Progress value={7.11} color="yellow" label="0.57 / 8 cores" />
                            </Paper>
                        </Grid.Col> */}
                    </Grid>
                </Container>
                <Divider />
                <Container fluid my={20} height={500}>
                    <Title order={2}>
                        Events Table
                    </Title>
                    <DataTable
                        height={300}
                        columns={[
                            { accessor: 'lastTimestamp', title: 'Timestamp', sortable: true },
                            { accessor: 'involvedObject.namespace', title: 'Namespace', sortable: true },
                            { accessor: 'kind', title: 'Kind', sortable: true },
                            { accessor: 'reason', title: 'Reason', sortable: true },
                            { accessor: 'message', title: 'Message', sortable: true },
                        ]}
                        records={events}
                    />
                </Container>
                <Divider />
                {/* <Container fluid my={20}>
                    <Title order={2}>
                        Events
                    </Title>
                    <FixedSizeList
                        width="100%"
                        height={500}
                        itemCount={events.length}
                        itemSize={22}
                    // ref={listRef}
                    >
                        {({ index, style }) => {
                            return (

                                <div style={style}>
                                    <Code>
                                        {events[index].lastTimestamp ? events[index].lastTimestamp : "no time"}  -
                                    </Code>
                                    <Code>
                                        {events[index].involvedObject.namespace ? events[index].involvedObject.namespace : "no namespace"}  -
                                    </Code>
                                    <Code>

                                    </Code>
                                    <Code>
                                        {events[index].message}
                                    </Code>
                                </div>
                            );
                        }}
                    </FixedSizeList>
                </Container> */}
            </Skeleton>
        </>
    );
}