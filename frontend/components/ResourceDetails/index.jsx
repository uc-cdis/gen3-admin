import { useState } from 'react';
import { Button, Center, Group, Loader, Tabs, useMantineColorScheme, Modal, Text, Card, Badge, Stack, Title, Paper, Divider } from '@mantine/core';

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
import { resolveReplicaStatus, resolveStatus } from '@/lib/status';
// How to read ready/desired for each replica-backed kind. Field names differ
// per kind, which is why this cannot be one generic accessor.
const REPLICA_KINDS = {
    Deployment: (r) => ({ ready: r?.status?.readyReplicas, desired: r?.spec?.replicas }),
    StatefulSet: (r) => ({ ready: r?.status?.readyReplicas, desired: r?.spec?.replicas }),
    ReplicaSet: (r) => ({ ready: r?.status?.readyReplicas, desired: r?.spec?.replicas }),
    DaemonSet: (r) => ({
        ready: r?.status?.numberReady,
        desired: r?.status?.desiredNumberScheduled,
    }),
};

import { useK8sResource } from '@/hooks/useK8s';

export default function ResourceDetails({ cluster, namespace, resource, type, tabs, url, columnDefinitions, columnConfig }) {
    const { height } = useViewportSize();
    const [activeTab, setActiveTab] = useState('overview');
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const { colorScheme } = useMantineColorScheme();
    const isDarkMode = colorScheme === 'dark';

    // Fetching runs through the shared SWR layer, reaching the ~26 pages that
    // render through this component. The immediate win is deduplication: a detail
    // page and the components inside it frequently request the same object, and
    // the result now survives navigating between resources.
    const query = useK8sResource(resource && type && url ? url : null, { cluster });

    const resourceData = query.data ?? null;
    // Only a genuine first load blocks the page; a background revalidation keeps
    // the current content on screen.
    const isLoading = query.isLoading && query.data === undefined;

    // A 404 is an ordinary outcome here, not a fault: completed Job pods and other
    // short-lived resources get garbage-collected, so links to them go stale.
    const error = query.error
        ? query.error.isNotFound
            ? `This ${String(type || 'resource').toLowerCase()} no longer exists. It may have been deleted or garbage-collected.`
            : query.error.message || 'Failed to fetch resource'
        : null;

    const fetchResource = query.refresh;

    const deleteResource = async () => {
        try {
            await callK8sApi(url, 'DELETE', null, null, cluster, accessToken);
            notifications.show({
                title: 'Resource Deleted',
                message: `${type} ${resource} was successfully deleted.`,
                color: 'green'
            });
            // Previously the deleted resource stayed on screen as though nothing
            // had happened. Revalidating surfaces the 404 as the "no longer
            // exists" state, which is the honest result of a successful delete.
            setDeleteModalOpen(false);
            query.refresh();
        } catch (error) {
            notifications.show({
                title: 'Deletion Failed',
                message: error.message || `Failed to delete ${type}.`,
                color: 'red'
            });
        }
    };

    const encodeSecretValue = (value) => {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    };

    const updateSecretKey = async (key, decodedValue) => {
        if (type !== 'Secret') return;

        const encodedValue = encodeSecretValue(decodedValue);
        const patch = { data: { [key]: encodedValue } };

        try {
            const updated = await callK8sApi(
                url,
                'PATCH',
                patch,
                { 'Content-Type': 'application/merge-patch+json' },
                cluster,
                accessToken
            );

            // Write the confirmed value straight into the cache so the editor
            // reflects it immediately. revalidate: false because the PATCH
            // response is already authoritative -- refetching would only risk
            // showing a stale read.
            query.mutate(
                (current) => ({
                    ...(updated || current),
                    data: {
                        ...(current?.data || {}),
                        ...(updated?.data || {}),
                        [key]: encodedValue,
                    },
                }),
                { revalidate: false }
            );

            notifications.show({
                title: 'Secret updated',
                message: `${key} was saved and encoded as base64.`,
                color: 'green',
            });
        } catch (error) {
            notifications.show({
                title: 'Secret update failed',
                message: error.message || `Failed to update ${key}.`,
                color: 'red',
            });
            throw error;
        }
    };

    // Determine status for the header badge
    // Pick the right status domain for this resource kind; the colours and
    // labels themselves come from lib/status.ts so they match every other view.
    const getStatusInfo = () => {
        if (type === 'Node') {
            const ready = resourceData?.status?.conditions?.find(c => c.type === 'Ready');
            if (!ready) return null;
            return resolveStatus('node', ready.status);
        }
        if (type === 'Pod') {
            const containers = resourceData?.status?.containerStatuses;
            return resolveStatus('pod', resourceData?.status?.phase, {
                reason: containers?.[0]?.state?.waiting?.reason,
                ready: containers?.every(c => c.ready),
            });
        }

        // Replica-backed workloads have no status.phase, so they used to fall
        // through and render no badge at all -- the detail page for a
        // Deployment with zero available replicas looked identical to a
        // healthy one.
        if (REPLICA_KINDS[type]) {
            const { ready, desired } = REPLICA_KINDS[type](resourceData);
            return resolveReplicaStatus(ready, desired);
        }

        if (type === 'Job') {
            const conditions = resourceData?.status?.conditions ?? [];
            const failed = conditions.find(c => c.type === 'Failed' && c.status === 'True');
            if (failed) return resolveStatus('job', 'failed', { reason: failed.reason });
            if (conditions.find(c => c.type === 'Complete' && c.status === 'True')) {
                return resolveStatus('job', 'complete');
            }
            if ((resourceData?.status?.active ?? 0) > 0) return resolveStatus('job', 'active');
            return resolveStatus('job', resourceData?.spec?.suspend ? 'suspended' : 'unknown');
        }

        if (type === 'CronJob') {
            return resolveStatus('job', resourceData?.spec?.suspend ? 'suspended' : 'active');
        }

        // PVC and PV are the kinds whose phase this domain actually describes.
        if (resourceData?.status?.phase && (type === 'PersistentVolumeClaim' || type === 'PersistentVolume')) {
            return resolveStatus('pvc', resourceData.status.phase);
        }

        // Any other kind carrying a phase: label it without claiming a domain
        // it may not belong to. The catch-all used to route everything through
        // the pvc domain, which mislabels anything that is not a volume.
        if (resourceData?.status?.phase) {
            return resolveStatus('generic', resourceData.status.phase);
        }
        return null;
    };

    const status = getStatusInfo();

    return (
        <Stack gap="md">
            <Stack gap="sm">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                    <Stack gap={6}>
                        <Group gap="sm" wrap="wrap">
                            <Title order={2}>{resource}</Title>
                            <Badge size="lg" variant="filled" color="blue">{type}</Badge>
                            {status && <Badge size="lg" variant="light" color={status.color}>{status.label}</Badge>}
                            {namespace && <Badge size="lg" variant="outline">ns: {namespace}</Badge>}
                        </Group>
                        {resourceData?.metadata?.uid && (
                            <Text size="xs" c="dimmed">
                                uid {resourceData.metadata.uid}
                            </Text>
                        )}
                    </Stack>

                    <Group gap="xs">
                        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={fetchResource} disabled={isLoading} size="sm">
                            Refresh
                        </Button>
                        <Button color="red" leftSection={<IconTrash size={16} />} onClick={() => setDeleteModalOpen(true)} size="sm">
                            Delete
                        </Button>
                    </Group>
                </Group>
            </Stack>

            <Divider />

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
                            onUpdateSecretKey={updateSecretKey}
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
