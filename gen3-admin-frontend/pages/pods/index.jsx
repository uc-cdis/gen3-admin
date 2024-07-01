import React, { useState, useEffect } from 'react';
import { Table, Badge, Text, Progress, Button, Group, Card, SimpleGrid, RingProgress, Title } from '@mantine/core';
import { IconServer, IconAlertTriangle, IconCheck } from '@tabler/icons-react';

import callK8sApi from '@/lib/k8s';

async function fetchPods() {
    try {
        const data = await callK8sApi('/api/v1/namespaces/default/pods');
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

export default function PodsDashboard() {
    const [pods, setPods] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchPods().then((data) => {
            if (data) {
                const formattedPods = data.map(pod => ({
                    name: pod.metadata.name,
                    status: pod.status.phase,
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
    }, []);

    const totalPods = pods.length;
    const runningPods = pods.filter(pod => pod.status === 'Running').length;
    const notRunningPods = totalPods - runningPods;

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
                                {runningPods}/{totalPods}
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

            <Table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Ready</th>
                        <th>Restarts</th>
                        <th>Age</th>
                        <th>IP</th>
                        <th>Node</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {pods.map((pod, index) => (
                        <tr key={index}>
                            <td>{pod.name}</td>
                            <td>
                                <Badge 
                                    color={pod.status === 'Running' ? 'green' : 
                                           pod.status === 'Pending' ? 'yellow' : 'red'}
                                >
                                    {pod.status}
                                </Badge>
                            </td>
                            <td>{pod.ready}</td>
                            <td>{pod.restarts}</td>
                            <td>{pod.age}</td>
                            <td>{pod.ip}</td>
                            <td>{pod.node}</td>
                            <td>
                                <Button variant="subtle" compact>Details</Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </div>
    );
}