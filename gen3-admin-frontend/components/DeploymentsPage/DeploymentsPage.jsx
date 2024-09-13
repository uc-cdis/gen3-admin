import React, { useEffect, useState } from 'react';
import callK8sApi from '@/lib/k8s';


import { Table, Badge, Text, Progress, Group, Card, SimpleGrid, RingProgress, Title, ThemeIcon, Loader, Box, Collapse, Button, ActionIcon, useMantineTheme } from '@mantine/core';
import { IconServer, IconActivity, IconAlertTriangle, IconChevronDown, IconChevronRight, IconChevronUp, IconRefresh } from '@tabler/icons-react';


import { useSession } from 'next-auth/react';

import { useParams } from 'next/navigation';

async function fetchDeployments(accessToken, clusterName) {
    try {
        console.log('fetching deployments for cluster', clusterName, accessToken)
        const data = await callK8sApi('/apis/apps/v1/namespaces/default/deployments', 'GET', null, null, clusterName, accessToken);
        return data.items;
    } catch (error) {
        console.error('Failed to fetch deployments:', error);
        return null;
    }
}

async function fetchPodsForDeployment(deploymentName, accessToken, clusterName) {
    try {
        // Step 1: Fetch ReplicaSets for the deployment
        const rsData = await callK8sApi(`/apis/apps/v1/namespaces/default/replicasets`, 'GET', null, null, clusterName, accessToken);
        const replicaSets = rsData.items;

        // Step 2: Filter ReplicaSets owned by our deployment
        const ownedReplicaSets = replicaSets.filter(rs => {
            return rs.metadata.ownerReferences &&
                rs.metadata.ownerReferences.some(ref =>
                    ref.kind === 'Deployment' && ref.name === deploymentName
                );
        });

        if (ownedReplicaSets.length === 0) {
            console.log(`No ReplicaSets found for deployment ${deploymentName}`);
            return [];
        }

        // Step 3: Fetch all pods
        const podsData = await callK8sApi('/api/v1/namespaces/default/pods', 'GET', null, null, clusterName, accessToken);
        const allPods = podsData.items;

        // Step 4: Filter pods owned by the ReplicaSets we found
        const deploymentPods = allPods.filter(pod => {
            return pod.metadata.ownerReferences &&
                pod.metadata.ownerReferences.some(ref =>
                    ref.kind === 'ReplicaSet' && ownedReplicaSets.some(rs => rs.metadata.name === ref.name)
                );
        });

        return deploymentPods;
    } catch (error) {
        console.error(`Failed to fetch pods for deployment ${deploymentName}:`, error);
        return null;
    }
}

async function restartDeployment(deploymentName, accessToken, clusterName) {
    try {
        const patchBody = {
            spec: {
                template: {
                    metadata: {
                        annotations: {
                            'kubectl.kubernetes.io/restartedAt': new Date().toISOString()
                        }
                    }
                }
            }
        };

        await callK8sApi(
            `/apis/apps/v1/namespaces/default/deployments/${deploymentName}`,
            'PATCH',
            patchBody,
            { 'Content-Type': 'application/strategic-merge-patch+json' }, null, accessToken
        );
        
        console.log(`Successfully triggered restart for deployment ${deploymentName}`);
        return true;
    } catch (error) {
        console.error(`Failed to restart deployment ${deploymentName}:`, error);
        return false;
    }
}





function calculateAge(created) {
    const now = new Date();
    const createdDate = new Date(created);
    const diffTime = Math.abs(now - createdDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return `${diffDays} days`;
}

function PodStatus({ status }) {
    const color = status === 'Running' ? 'green' : status === 'Pending' ? 'yellow' : 'red';
    return <Badge color={color}>{status}</Badge>;
}

function DeploymentRow({ deployment, onToggle, isOpen, onRestart }) {
    const [pods, setPods] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isRestarting, setIsRestarting] = useState(false);

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const clusterName = useParams()?.clustername;

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            fetchPodsForDeployment(deployment.name, accessToken, clusterName).then((data) => {
                if (data) {
                    setPods(data);
                }
                setIsLoading(false);
            });
        }
    }, [isOpen, deployment.name, sessionData]);

    const readyRatio = deployment.ready / deployment.desired;
    const age = calculateAge(deployment.created);

    const handleRestart = async () => {
        if (!accessToken) {
            return;
        }
        setIsRestarting(true);
        const success = await restartDeployment(deployment.name, accessToken, clusterName);
        if (success) {
            onRestart(deployment.name, accessToken, clusterName);
        }
        setIsRestarting(false);
    };

    return (
        <>
            <Table.Tr 
                // style={{ cursor: 'pointer', backgroundColor: isOpen ? '#f0f0f0' : 'transparent' }}
            >
                <Table.Td>
                    {deployment.ready === deployment.desired ? (
                        <Badge color="green">Active</Badge>
                    ) : (
                        <Badge color="red">Inactive</Badge>
                    )}
                </Table.Td>
                <Table.Td>
                    <Group spacing="xs">
                        <ActionIcon onClick={onToggle}>
                            {isOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        </ActionIcon>
                        <Text>{deployment.name}</Text>
                    </Group>
                </Table.Td>
                <Table.Td>{deployment.image}</Table.Td>
                <Table.Td>{`${deployment.ready}/${deployment.total}`}</Table.Td>
                <Table.Td>{age}</Table.Td>
                <Table.Td>
                    <Progress
                        value={readyRatio * 100}
                        color={readyRatio === 1 ? 'green' : readyRatio === 0 ? 'red' : 'yellow'}
                    />
                </Table.Td>
                <Table.Td>
                    <Button 
                        leftIcon={<IconRefresh size={14} />}
                        variant="outline"
                        size="xs"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleRestart();
                        }}
                        loading={isRestarting}
                    >
                        Restart
                    </Button>
                </Table.Td>
            </Table.Tr>
            <Table.Tr>
                <Table.Td colSpan={7} style={{ padding: 0 }}>
                    <Collapse in={isOpen}>
                        <Box p="md">
                            {isLoading ? (
                                <Loader />
                            ) : (
                                <Table>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>Pod Name</Table.Th>
                                            <Table.Th>Status</Table.Th>
                                            <Table.Th>IP</Table.Th>
                                            <Table.Th>Node</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {pods.map((pod) => (
                                            <Table.Tr key={pod.metadata.name}>
                                                <Table.Td>{pod.metadata.name}</Table.Td>
                                                <Table.Td><PodStatus status={pod.status.phase} /></Table.Td>
                                                <Table.Td>{pod.status.podIP}</Table.Td>
                                                <Table.Td>{pod.spec.nodeName}</Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            )}
                        </Box>
                    </Collapse>
                </Table.Td>
            </Table.Tr>
        </>
    );
}


const DashboardCard = ({ title, value, icon, color, secondaryInfo, change }) => {
    const theme = useMantineTheme();

    return (
        <Card shadow="sm" padding="lg" radius="md" >
            {/* style={{ background: `linear-gradient(45deg, ${color}22, ${color}11)` }} */}
            <Group position="apart" style={{ marginBottom: 5, marginTop: theme.spacing.sm }}>
                <Text size="lg" weight={500}>{title}</Text>
                <ThemeIcon color={color} variant="light" size={38} radius="md">
                    {icon}
                </ThemeIcon>
            </Group>

            <Group align="flex-end" spacing="xs">
                <Text size="xl" weight={700} style={{ fontSize: '2.5rem', lineHeight: 1 }}>
                    {value}
                </Text>
                {change !== undefined && (
                    <Text
                        c={change > 0 ? 'teal' : 'red'}
                        size="sm"
                        weight={500}
                        style={{ display: 'flex', alignItems: 'center' }}
                    >
                        {change > 0 ? <IconChevronUp size={20} stroke={1.5} /> : <IconChevronDown size={20} stroke={1.5} />}
                        {Math.abs(change)}%
                    </Text>
                )}
            </Group>

            <Text size="xs" c="dimmed" mt={7}>
                {secondaryInfo}
            </Text>

            <Button variant="subtle" fullWidth mt="md" radius="md" color={color}>
                View Details
            </Button>
        </Card>
    );
};


export function DashboardCards({ activeDeployments, totalDeployments, inactiveDeployments }) {
    return (
        <SimpleGrid cols={3} breakpoints={[{ maxWidth: 'sm', cols: 1 }]} mt="md">
            <DashboardCard
                title="Active Deployments"
                value={activeDeployments}
                icon={<IconActivity size={28} />}
                color="teal"
                secondaryInfo={`${((activeDeployments / totalDeployments) * 100).toFixed(1)}% of total`}
                change={5}
            />
            <DashboardCard
                title="Total Deployments"
                value={totalDeployments}
                icon={<IconServer size={28} />}
                color="blue"
                secondaryInfo="Across all namespaces"
                change={-2}
            />
            <DashboardCard
                title="Inactive Deployments"
                value={inactiveDeployments}
                icon={<IconAlertTriangle size={28} />}
                color="orange"
                secondaryInfo={`${((inactiveDeployments / totalDeployments) * 100).toFixed(1)}% of total`}
                change={0}
            />
        </SimpleGrid>
    );
}


export function DeploymentsPage() {
    const [deployments, setDeployments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [openDeployment, setOpenDeployment] = useState(null);

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const clusterName = useParams()?.clustername;

    useEffect(() => {
        fetchDeployments(accessToken, clusterName).then((data) => {
            if (data) {
                const formattedDeployments = data.map(deployment => ({
                    name: deployment.metadata.name,
                    ready: deployment.status.readyReplicas || 0,
                    desired: deployment.spec.replicas,
                    total: deployment.status.replicas || 0,
                    image: deployment.spec.template.spec.containers[0].image,
                    created: deployment.metadata.creationTimestamp,
                }));
                setDeployments(formattedDeployments);
            }
            setIsLoading(false);
        });
    }, [sessionData]);

    const totalDeployments = deployments.length;
    const activeDeployments = deployments.filter(d => d.ready === d.desired).length;
    const inactiveDeployments = totalDeployments - activeDeployments;

    if (isLoading) {
        return <Text>Loading deployments...</Text>;
    }

    if (deployments.length === 0) {
        return <Text>No deployments found.</Text>;
    }

    const handleRestart = async (deploymentName, accessToken, clusterName) => {
        await fetchDeployments(accessToken, clusterName);  // Refresh the deployment list after restart
    };


    return (
        <div>
            <Title order={2} align="center" mb="xl">Kubernetes Deployments Dashboard</Title>

            <DashboardCards
                activeDeployments={activeDeployments}
                totalDeployments={totalDeployments}
                inactiveDeployments={inactiveDeployments}
            />


            <Table>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Image</Table.Th>
                        <Table.Th>Ready</Table.Th>
                        <Table.Th>Age</Table.Th>
                        <Table.Th>Health</Table.Th>
                        <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {deployments.map((deployment) => (
                        <DeploymentRow
                            key={deployment.name}
                            deployment={deployment}
                            isOpen={openDeployment === deployment.name}
                            onToggle={() => setOpenDeployment(openDeployment === deployment.name ? null : deployment.name)}
                            onRestart={handleRestart}
                        />
                    ))}
                </Table.Tbody>
            </Table>

        </div>
    );
}