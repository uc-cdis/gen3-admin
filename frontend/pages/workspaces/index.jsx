import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Container, Title, Table, Badge, Text, Button, ScrollArea, Group, Loader, Center, Anchor } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import callK8sApi from '@/lib/k8s';
import { useGlobalState } from '@/contexts/global';

const calculateAge = (creationTimestamp) => {
    if (!creationTimestamp) return 'Unknown';
    const diffMin = Math.floor((Date.now() - new Date(creationTimestamp).getTime()) / 60000);
    if (diffMin < 1) return 'Just now';
    const d = Math.floor(diffMin / 1440);
    const h = Math.floor((diffMin % 1440) / 60);
    const m = diffMin % 60;
    if (d > 0) return `${d}d ${h}h${m > 0 ? ` ${m}m` : ''}`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

export default function Workspaces() {
    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;
    const { activeGlobalEnv } = useGlobalState();

    const [workspaces, setWorkspaces] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const jupyterNs = 'jupyter-pods-gen3';

    const fetchWorkspaces = async () => {
        if (!activeGlobalEnv || !accessToken) return;
        setLoading(true);
        setError(null);
        try {
            const data = await callK8sApi(
                `/api/v1/namespaces/${jupyterNs}/pods`,
                'GET',
                null,
                null,
                activeGlobalEnv,
                accessToken
            );
            setWorkspaces(data?.items || []);
        } catch (err) {
            console.error('Error fetching workspaces:', err);
            setError(err?.message || 'Failed to fetch workspaces');
            setWorkspaces([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!activeGlobalEnv || !accessToken) return;
        fetchWorkspaces();
    }, [activeGlobalEnv, accessToken]);

    return (
        <Container size="xl" mt="xl">
            <Group justify="space-between" mb="md">
                <Title order={1}>Workspaces</Title>
                <Button
                    leftSection={<IconRefresh size={14} />}
                    onClick={fetchWorkspaces}
                    loading={loading}
                    size="sm"
                >
                    Refresh
                </Button>
            </Group>

            <Text size="sm" c="dimmed" mb="lg">
                Namespace: {jupyterNs}
                {activeGlobalEnv && (
                    <Text span c="dimmed" size="sm"> on {activeGlobalEnv}</Text>
                )}
            </Text>

            {loading ? (
                <Center py="xl">
                    <Loader />
                </Center>
            ) : error ? (
                <Center py="xl">
                    <Text c="red" ta="center">
                        {error}
                    </Text>
                </Center>
            ) : workspaces.length > 0 ? (
                <ScrollArea>
                    <Table striped highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Name</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th>Age</Table.Th>
                                <Table.Th>Restarts</Table.Th>
                                <Table.Th>Node</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {workspaces.map((ws) => {
                                const phase = ws.status?.phase || 'Unknown';
                                const containerStatuses = ws.status?.containerStatuses || [];
                                const restarts = containerStatuses.reduce(
                                    (sum, cs) => sum + (cs.restartCount || 0), 0
                                );

                                return (
                                    <Table.Tr key={ws.metadata.name}>
                                        <Table.Td>
                                            <Anchor
                                                href={`/clusters/${activeGlobalEnv}/workloads/pods/${ws.metadata.namespace}/${ws.metadata.name}`}
                                                fw={500}
                                            >
                                                {ws.metadata.name}
                                            </Anchor>
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge
                                                color={phase === 'Running' ? 'green' : 'orange'}
                                                variant="light"
                                            >
                                                {phase}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            {calculateAge(ws.metadata.creationTimestamp)}
                                        </Table.Td>
                                        <Table.Td>{restarts}</Table.Td>
                                        <Table.Td>
                                            <Text size="sm" c="dimmed">{ws.spec?.nodeName || 'N/A'}</Text>
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            ) : (
                <Text c="dimmed" ta="center" py="xl">
                    No workspaces found in the {jupyterNs} namespace.
                </Text>
            )}
        </Container>
    );
}
