import { useState, useEffect } from 'react';
import callK8sApi from '@/lib/k8s';
import { useParams } from 'next/navigation';
import ResourceDetails from '@/components/ResourceDetails';
import { Stack, Text, Group, Table, Badge, Anchor, ScrollArea, Loader, Center, Card } from '@mantine/core'
import Link from 'next/link'
import { IconContainer } from '@tabler/icons-react';

function AssociatedPods({ cluster, namespace, url }) {
    const [pods, setPods] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        callK8sApi(url, 'GET', null, null, cluster, null)
            .then(svc => {
                const selector = svc?.spec?.selector;
                if (!selector || Object.keys(selector).length === 0) { setPods([]); return; }
                const labelSelector = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(',');
                return callK8sApi(`/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(labelSelector)}`, 'GET', null, null, cluster, null);
            })
            .then(setPods)
            .catch(() => setPods([]))
            .finally(() => setLoading(false));
    }, [cluster, namespace, url]);

    const items = pods?.items || [];

    return (
        <Card p="lg" radius="md" withBorder>
            <Group gap="xs" mb="md">
                <IconContainer size={18} />
                <Text fw={600} size="lg">Associated Pods</Text>
                {items.length > 0 && <Badge size="sm">{items.length}</Badge>}
            </Group>

            {loading ? (
                <Center py="md"><Loader size="sm" /></Center>
            ) : items.length > 0 ? (
                <ScrollArea.Autosize mah={300}>
                    <Table striped highlightOnHover size="xs">
                        <thead><tr><th>Name</th><th>Ready</th><th>Status</th></tr></thead>
                        <tbody>
                            {items.map(pod => {
                                const ready = pod.status?.containerStatuses?.every(c => c.ready);
                                return (
                                    <tr key={pod.metadata.name}>
                                        <td>
                                            <Anchor component={Link} href={`/clusters/${cluster}/workloads/pods/${namespace}/${pod.metadata.name}`}>
                                                <Text fw={500} size="sm">{pod.metadata.name}</Text>
                                            </Anchor>
                                        </td>
                                        <td><Badge size="xs" color={ready ? 'green' : 'orange'} variant="filled">{ready ? 'Ready' : 'Not Ready'}</Badge></td>
                                        <td><Text size="sm">{pod.status?.phase}</Text></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </ScrollArea.Autosize>
            ) : (
                <Center py="md"><Text c="dimmed" size="sm">No pods match this service selector.</Text></Center>
            )}
        </Card>
    );
}

export default function Detail() {
    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.service;

    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="Service"
                tabs={["overview", "YAML", "events"]}
                url={`/api/v1/namespaces/${namespace}/services/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Type", path: "spec.type" },
                            { label: "Cluster IP", path: "spec.clusterIP" },
                            {
                                label: "External IP",
                                path: "status.loadBalancer.ingress",
                                render: (value) => Array.isArray(value) && value.length > 0
                                    ? value.map(ing => ing.ip || ing.hostname).join(', ')
                                    : 'None'
                            },
                            {
                                label: "Ports",
                                path: "spec.ports",
                                render: ((value) => {
                                    if (!value?.length) return '-';
                                    return value.map((port) => (
                                        <Group key={port.port} gap={4}>
                                            <Text size="xs" className="font-mono">
                                                {port.name ? `${port.name}: ` : ''}{port.port}/{port.protocol} → {String(port.targetPort)}
                                            </Text>
                                        </Group>
                                    ))
                                })
                            },
                        ],
                        rightColumns: [
                            { label: "Session Affinity", path: "spec.sessionAffinity" },
                            { label: "External Traffic Policy", path: "spec.externalTrafficPolicy" },
                            {
                                label: "Selector",
                                path: "spec.selector",
                                render: (value) => value && typeof value === 'object'
                                    ? Object.entries(value).map(([k, v]) => <Badge key={k} size="xs" variant="light" mr={4}>{k}={v}</Badge>)
                                    : String(value ?? '-')
                            },
                            { label: "IP Families", path: "spec.ipFamilies", render: (v) => Array.isArray(v) ? v.join(', ') : v },
                            { label: "IP Family Policy", path: "spec.ipFamilyPolicy" },
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                        ]
                    }
                }}
            />
            <AssociatedPods cluster={clusterName} namespace={namespace} url={`/api/v1/namespaces/${namespace}/services/${resource}`} />
        </>
    )
}
