import { useState, useEffect } from 'react';
import callK8sApi from '@/lib/k8s';
import { useParams } from 'next/navigation';
import ResourceDetails from '@/components/ResourceDetails';
import { Stack, Text, Group, Table, Badge, Anchor, ScrollArea, Loader, Center, Card } from '@mantine/core'
import Link from 'next/link'
import { IconNetwork } from '@tabler/icons-react';

function AssociatedBackends({ cluster, namespace, url }) {
    const [backends, setBackends] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        callK8sApi(url, 'GET', null, null, cluster, null)
            .then(ing => {
                const services = new Set();
                const defaultBackend = ing?.spec?.defaultBackend?.service?.name;
                if (defaultBackend) services.add(defaultBackend);
                ing?.spec?.rules?.forEach(rule =>
                    rule.http?.paths?.forEach(path => {
                        if (path.backend?.service?.name) services.add(path.backend.service.name);
                    })
                );
                setBackends(Array.from(services));
            })
            .catch(() => setBackends([]))
            .finally(() => setLoading(false));
    }, [cluster, namespace, url]);

    if (!backends || backends.length === 0) return null;

    return (
        <Card p="lg" radius="md" withBorder>
            <Group gap="xs" mb="md">
                <IconNetwork size={18} />
                <Text fw={600} size="lg">Backend Services</Text>
                <Badge size="sm">{backends.length}</Badge>
            </Group>

            <ScrollArea.Autosize mah={200}>
                <Table striped highlightOnHover size="xs">
                    <thead><tr><th>Service</th></tr></thead>
                    <tbody>
                        {backends.map(name => (
                            <tr key={name}>
                                <td>
                                    <Anchor component={Link} href={`/clusters/${cluster}/network/services/${namespace}/${name}`}>
                                        <Text fw={500} size="sm">{name}</Text>
                                    </Anchor>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </ScrollArea.Autosize>
        </Card>
    );
}

export default function Detail() {
    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.ingress;

    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="Ingress"
                tabs={["overview", "YAML", "events"]}
                url={`/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Ingress Class", path: "spec.ingressClassName" },
                            {
                                label: "Address",
                                path: "status.loadBalancer.ingress",
                                render: (value) => Array.isArray(value) && value.length > 0
                                    ? value.map(ing => ing.hostname || ing.ip).filter(Boolean).join(', ')
                                    : '-'
                            },
                            {
                                label: "Default Backend",
                                path: "spec.defaultBackend",
                                render: (value) => value?.service?.name ? (
                                    <Anchor component={Link} href={`/clusters/${clusterName}/network/services/${namespace}/${value.service.name}`}>
                                        <Text fw={500} size="sm">{value.service.name}</Text>
                                    </Anchor>
                                ) : '-'
                            },
                            {
                                label: "Rules",
                                path: "spec.rules",
                                render: ({ value }) => {
                                    if (!value?.length) return '-';
                                    return value.map((rule, index) => (
                                        <Stack key={index} spacing={2}>
                                            <Text size="sm" fw={500}>{rule.host || '*'}</Text>
                                            {rule.http?.paths?.map((path, pathIndex) => (
                                                <Group key={pathIndex} gap={4}>
                                                    <Text size="xs" className="font-mono">
                                                        {path.path || '/'}
                                                    </Text>
                                                    <Text size="xs">→</Text>
                                                    <Anchor component={Link}
                                                        href={`/clusters/${clusterName}/network/services/${namespace}/${path.backend?.service?.name}`}>
                                                        <Text size="xs" fw={500} className="font-mono">
                                                            {path.backend?.service?.name}:{path.backend?.service?.port?.number}
                                                        </Text>
                                                    </Anchor>
                                                </Group>
                                            ))}
                                        </Stack>
                                    ));
                                }
                            },
                        ],
                        rightColumns: [
                            {
                                label: "TLS",
                                path: "spec.tls",
                                render: (tls) => Array.isArray(tls)
                                    ? tls.map(t => t.secretName || t.hosts?.join(', ') || '-').join(', ')
                                    : '-'
                            },
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Generation", path: "metadata.generation" },
                        ]
                    }
                }}
            />
            <AssociatedBackends cluster={clusterName} namespace={namespace} url={`/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses/${resource}`} />
        </>
    )
}
