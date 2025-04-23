import { callGoApi } from '@/lib/k8s';
import React, { useState, useEffect } from 'react';
import {
    Container,
    Title,
    Text,
    Select,
    Card,
    Group,
    Badge,
    Divider,
    Table,
    Loader,
    Stack,
    Button,
    Alert,
    Anchor
} from '@mantine/core';
import { IconServer, IconCheck, IconX, IconExclamationCircle, IconRefresh } from '@tabler/icons-react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';


const ProxyDashboard = () => {
    const session = useSession();
    const { data: sessionData } = session;
    const [selectedEnv, setSelectedEnv] = useState(null);
    const [envs, setEnvs] = useState([]);
    const [proxies, setProxies] = useState(null);
    const [envsLoading, setEnvsLoading] = useState(false);
    const [proxiesLoading, setProxiesLoading] = useState(false);
    const [envsError, setEnvsError] = useState(false);
    const [proxiesError, setProxiesError] = useState(false);

    const fetchEnvironments = async () => {
        setEnvsLoading(true);
        try {
            const data = await callGoApi('/squid/asgs', 'GET', null, null, sessionData?.accessToken);
            setEnvs(data);
            setEnvsError(false);
        } catch (error) {
            console.error('Failed to fetch environments:', error);
            setEnvsError(true);
            setEnvs([]);
        }
        setEnvsLoading(false);
    };

    const fetchProxyData = async () => {
        setProxiesLoading(true);
        try {
            const data = await callGoApi('/squid/proxies?env=' + selectedEnv, 'GET', null, null, sessionData.accessToken);
            setProxies(data);
            setProxiesError(false);
        } catch (error) {
            console.error(`Failed to fetch proxy data for ${selectedEnv}:`, error);
            setProxiesError(true);
            setProxies(null);
        }
        setProxiesLoading(false);
    };

    // Fetch environments on component mount
    useEffect(() => {
        fetchEnvironments();
    }, []);

    // Fetch proxy data when environment changes
    useEffect(() => {
        if (!selectedEnv) {
            setProxies(null);
            return;
        }
        fetchProxyData();
    }, [selectedEnv]);

    // Format environment names from ASG data
    const envOptions = envs ?
        envs.map(asg => {
            // Assuming asg names follow a pattern like "squid-auto-envname"
            const envName = asg?.replace('squid-auto-', '') || asg.name;
            return { value: envName, label: envName };
        }) : [];

    // Handle health status badge color
    const getHealthColor = (status) => {
        if (!status) return 'gray';
        switch (status.toLowerCase()) {
            case 'healthy': return 'green';
            case 'unhealthy': return 'red';
            default: return 'yellow';
        }
    };

    // Handle port status badge
    const getPortStatusBadge = (status) => {
        if (status === 'Open') {
            return <Badge color="green" leftSection={<IconCheck size={14} />}>Open</Badge>;
        } else {
            return <Badge color="red" leftSection={<IconX size={14} />}>Closed</Badge>;
        }
    };

    return (
        <Container size="xl" p="md">
            <Title order={2} mb="lg">Squid Proxy Management Dashboard (Read Only) </Title>

            <Card withBorder shadow="sm" p="md" mb="lg">
                <Group position="apart" mb="md">
                    <Text fw={500} size="lg">Environment Selection</Text>
                    <Select
                        placeholder="Select environment"
                        data={envOptions}
                        value={selectedEnv}
                        onChange={setSelectedEnv}
                        searchable
                        clearable
                        // disabled={asgsQuery.isLoading}
                        w={300}
                    />
                    <Button
                        onClick={fetchEnvironments}
                    >
                        <IconRefresh />
                    </Button>
                </Group>

                {envsLoading && (
                    <Group position="center" p="md">
                        <Loader size="sm" />
                        <Text color="dimmed">Loading environments...</Text>
                    </Group>
                )}

                {envsError && (
                    <Alert color="red" title="Error loading environments">
                        Failed to load environment data. Please try again later.
                    </Alert>
                )}
            </Card>

            {selectedEnv && (
                <>
                    {proxiesLoading ? (
                        <Card withBorder shadow="sm" p="xl">
                            <Group position="center">
                                <Loader />
                                <Text color="dimmed">Loading proxy data...</Text>
                            </Group>
                        </Card>
                    ) : proxiesError ? (
                        <Alert color="red" title="Error loading proxy data">
                            Failed to load proxy data for {selectedEnv}. Please try again later.
                        </Alert>
                    ) : proxies ? (
                        <Stack spacing="md">
                            <Card withBorder shadow="sm" p="md">
                                <Group position="apart" mb="xs">
                                    <Title order={3}>Proxy Overview: {selectedEnv}</Title>
                                    <Badge size="lg" color="blue">
                                        Active Instance: {proxies.current_active_id || "None"}
                                    </Badge>
                                    <Button
                                        onClick={fetchProxyData}
                                    >
                                        <IconRefresh />
                                    </Button>
                                </Group>
                                <Text color="dimmed" mb="md">
                                    Cloud Proxy DNS: {proxies.cloud_proxy_dns !== "NONE" ?
                                        proxies.cloud_proxy_dns : "Not configured"}
                                </Text>
                            </Card>

                            <Title order={4} mt="md">Instance Details</Title>
                            <Table striped highlightOnHover withBorder withColumnBorders>
                                <thead>
                                    <tr>
                                        <th>Instance ID</th>
                                        <th>Status</th>
                                        <th>Private IP</th>
                                        <th>Public IP</th>
                                        <th>Port 3128</th>
                                        <th>Health</th>
                                        <th>AMI</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {proxies.instances && Object.entries(proxies.instances).map(([id, instance]) => (
                                        <tr key={id}>
                                            <td>
                                                <Group spacing="xs">
                                                    <IconServer size={16} />
                                                    <Anchor component={Link} href={"/cloud/ssm/"+instance.instance_id}>{instance.instance_id}</Anchor>
                                                </Group>
                                            </td>
                                            <td>
                                                <Badge color={instance.active ? "green" : "gray"}>
                                                    {instance.active ? "Active" : "Standby"}
                                                </Badge>
                                            </td>
                                            <td>{instance.priv_ip}</td>
                                            <td>{instance.pub_ip}</td>
                                            <td>{getPortStatusBadge(instance.port_3128)}</td>
                                            <td>
                                                <Badge color={getHealthColor(instance.health_state)}>
                                                    {instance.health_state || "Unknown"}
                                                </Badge>
                                            </td>
                                            <td>
                                                <Text size="sm" tt="uppercase">{instance.ami_id}</Text>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>

                            <Card withBorder shadow="sm" p="md" mt="md">
                                <Title order={4} mb="md">Instance Tags</Title>
                                {proxies.instances && Object.entries(proxies.instances).map(([id, instance]) => (
                                    <div key={`tags-${id}`}>
                                        <Group position="apart" mb="xs">
                                            <Text fw={500}>{instance.instance_id}</Text>
                                            <Badge color={instance.active ? "green" : "gray"}>
                                                {instance.active ? "Active" : "Standby"}
                                            </Badge>
                                        </Group>
                                        <Table size="sm" mb="md">
                                            <thead>
                                                <tr>
                                                    <th>Tag Key</th>
                                                    <th>Value</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {instance.tags && Object.entries(instance.tags).map(([tagKey, tagValue]) => (
                                                    <tr key={`${id}-${tagKey}`}>
                                                        <td>{tagKey}</td>
                                                        <td>{tagValue}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                        <Divider my="sm" />
                                    </div>
                                ))}
                            </Card>
                        </Stack>
                    ) : (
                        <Text>No data available</Text>
                    )}
                </>
            )}
        </Container>
    );
};

export default ProxyDashboard;