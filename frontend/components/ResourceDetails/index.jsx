import { useState, useEffect } from 'react';
import { Button, Center, Container, Group, Loader, Tabs, useMantineColorScheme, Modal, Text, Card, Badge, Stack, Title, Paper } from '@mantine/core';

import callK8sApi from '@/lib/k8s';
import { useViewportSize } from '@mantine/hooks';

import Overview from './Overview';
import Logs from './Logs';

import Editor from "@monaco-editor/react";

import YAML from 'yaml';
import Events from './Events';
import { IconRefresh, IconTrash, IconCode, IconEye, IconActivityHeartbeat } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

import { useSession } from 'next-auth/react';

export default function ResourceDetails({ cluster, namespace, resource, type, tabs, url, columnDefinitions, columnConfig }) {
    const { height } = useViewportSize();
    const [activeTab, setActiveTab] = useState('overview');
    const [resourceData, setResourceData] = useState(null);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const { colorScheme } = useMantineColorScheme();
    const isDarkMode = colorScheme === 'dark';

    const fetchResource = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await callK8sApi(url, 'GET', null, null, cluster, accessToken);
            setResourceData(response);
            return response;
        } catch (error) {
            console.error('Failed to fetch resource:', error);
            setError(error.message || 'Failed to fetch resource');
            return null;
        } finally {
            setIsLoading(false);
        }
    };

    const deleteResource = async () => {
        try {
            await callK8sApi(url, 'DELETE', null, null, cluster, accessToken);
            notifications.show({
                title: 'Resource Deleted',
                message: `${type} ${resource} was successfully deleted.`,
                color: 'green'
            });
        } catch (error) {
            notifications.show({
                title: 'Deletion Failed',
                message: error.message || `Failed to delete ${type}.`,
                color: 'red'
            });
        }
    };

    useEffect(() => {
        if (!resource || !cluster || !type || !url) return;
        fetchResource().then((data) => {
            if (data) setResourceData(data);
        });
    }, [type, resource, namespace, cluster]);

    // Determine status for the header badge
    const getStatusInfo = () => {
        if (type === 'Node') {
            const ready = resourceData?.status?.conditions?.find(c => c.type === 'Ready');
            return ready?.status === 'True' ? { label: 'Ready', color: 'green' } : { label: 'NotReady', color: 'red' };
        }
        if (type === 'Pod') {
            const phase = resourceData?.status?.phase;
            const colors = { Running: 'green', Pending: 'orange', Succeeded: 'blue', Failed: 'red' };
            return { label: phase || 'Unknown', color: colors[phase] || 'gray' };
        }
        if (resourceData?.status?.phase) {
            const phase = resourceData.status.phase;
            const colors = { Bound: 'green', Pending: 'orange', Available: 'blue', Failed: 'red' };
            return { label: phase, color: colors[phase] || 'gray' };
        }
        return null;
    };

    const status = getStatusInfo();

    return (
        <Stack spacing="lg">
            {/* Header Card */}
            <Card p="lg" radius="md">
                <Group justify="space-between" wrap="wrap">
                    <div>
                        <Group gap="md" align="end">
                            <Title order={2}>{resource}</Title>
                            <Badge size="lg" variant="filled" color="blue">{type}</Badge>
                            {status && <Badge size="lg" variant="light" color={status.color}>{status.label}</Badge>}
                            {namespace && <Badge size="lg" variant="outline">ns: {namespace}</Badge>}
                        </Group>
                    </div>

                    <Group gap="sm">
                        <Button
                            variant="default"
                            leftSection={<IconRefresh size={16} />}
                            onClick={fetchResource}
                            disabled={isLoading}
                            size="sm"
                        >
                            Refresh
                        </Button>
                        <Button
                            color="red"
                            leftSection={<IconTrash size={16} />}
                            onClick={() => setDeleteModalOpen(true)}
                            size="sm"
                        >
                            Delete
                        </Button>
                    </Group>
                </Group>
            </Card>

            {/* Content */}
            {isLoading ? (
                <Center py="xl">
                    <Stack align="center">
                        <Loader size="lg" />
                        <Text c="dimmed" size="sm">Loading {type}...</Text>
                    </Stack>
                </Center>
            ) : error ? (
                <Paper p="xl" withBorder radius="md">
                    <Center>
                        <Stack align="center">
                            <Text c="red" fw={500}>Error loading resource</Text>
                            <Text c="dimmed" size="sm">{error}</Text>
                            <Button variant="light" onClick={fetchResource} size="sm" mt="xs">Retry</Button>
                        </Stack>
                    </Center>
                </Paper>
            ) : resourceData ? (
                <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
                    <Tabs.List mb="md">
                        {tabs.map(tab => {
                            const t = tab.toLowerCase();
                            let icon = null;
                            if (t === 'overview') icon = <IconEye size={16} />;
                            if (t === 'yaml') icon = <IconCode size={16} />;
                            if (t === 'events') icon = <IconActivityHeartbeat size={16} />;
                            if (t === 'logs') icon = null;
                            return (
                                <Tabs.Tab value={t} key={t} leftSection={icon}>
                                    {tab[0].toUpperCase() + tab.slice(1)}
                                </Tabs.Tab>
                            );
                        })}
                    </Tabs.List>

                    <Tabs.Panel value="overview">
                        <Overview
                            resource={resourceData}
                            columns={columnDefinitions}
                            columnConfig={columnConfig}
                            type={type}
                        />
                    </Tabs.Panel>

                    <Tabs.Panel value="logs">
                        {type === "Pod" ? (
                            <Logs
                                namespace={namespace}
                                cluster={cluster}
                                accessToken={accessToken}
                                pod={resource}
                                containers={[
                                    ...(resourceData?.spec?.containers || []).map(c => c.name),
                                    ...(resourceData?.spec?.initContainers || []).map(c => c.name),
                                ]}
                            />
                        ) : (
                            <Center py="xl"><Text c="dimmed">Logs are only available for Pods.</Text></Center>
                        )}
                    </Tabs.Panel>

                    <Tabs.Panel value="events">
                        <Events
                            resource={resource}
                            type={type}
                            accessToken={accessToken}
                            namespace={namespace}
                            cluster={cluster}
                        />
                    </Tabs.Panel>

                    <Tabs.Panel value="yaml">
                        <Paper withBorder radius="md" p={0}>
                            <Editor
                                value={YAML.stringify(resourceData, null, 2)}
                                defaultLanguage='yaml'
                                height={Math.min(height - 200, 800)}
                                theme={isDarkMode ? 'vs-dark' : 'light'}
                                options={{
                                    minimap: { enabled: false },
                                    readOnly: true,
                                    fontSize: 13,
                                    lineNumbers: 'on',
                                    scrollBeyondLastLine: false,
                                    wordWrap: 'on',
                                    automaticLayout: true,
                                }}
                            />
                        </Paper>
                    </Tabs.Panel>
                </Tabs>
            ) : (
                <Center py="xl">
                    <Text c="dimmed">No data available.</Text>
                </Center>
            )}

            <Modal
                opened={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title={`Delete ${type}?`}
                centered
            >
                <Text mb="md">
                    Are you sure you want to delete <b>{resource}</b>
                    {namespace ? <> in namespace <b>{namespace}</b></> : ''}?
                    This action cannot be undone.
                </Text>
                <Group justify="flex-end">
                    <Button variant="subtle" onClick={() => setDeleteModalOpen(false)}>Cancel</Button>
                    <Button color="red" onClick={() => { setDeleteModalOpen(false); deleteResource(); }}>Delete</Button>
                </Group>
            </Modal>
        </Stack>
    )
}
