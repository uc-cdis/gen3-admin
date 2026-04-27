import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text, Group } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Detail() {
    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/network/ingresses/${namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "spec.ingressClassName",
                        label: "Class",
                        render: ({ original }) => original.spec?.ingressClassName
                            ? <Badge size="sm" variant="light">{original.spec.ingressClassName}</Badge>
                            : <Text c="dimmed" size="sm">-</Text>
                    },
                    {
                        key: "metadata.name",
                        label: "Hosts",
                        render: ({ original }) => {
                            const hosts = (original.spec?.rules || []).map(r => r.host || '*').filter(Boolean);
                            return hosts.length > 0
                                ? (
                                    <Group gap={4}>
                                        {hosts.slice(0, 2).map(h => (
                                            <Badge key={h} size="xs" variant="light">{h}</Badge>
                                        ))}
                                        {hosts.length > 2 && <Badge size="xs" variant="light">+{hosts.length - 2}</Badge>}
                                    </Group>
                                )
                                : <Text c="dimmed" size="sm">*</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Address",
                        render: ({ original }) => {
                            const ingress = original.status?.loadBalancer?.ingress;
                            if (!ingress || ingress.length === 0) return <Text c="dimmed" size="sm">-</Text>;
                            return (
                                <Group gap={4}>
                                    {ingress.map((addr, i) => (
                                        <Text key={i} size="sm">{addr.ip || addr.hostname}</Text>
                                    ))}
                                </Group>
                            );
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Backends",
                        render: ({ original }) => {
                            const services = new Set();
                            original.spec?.rules?.forEach(rule =>
                                rule.http?.paths?.forEach(p => {
                                    if (p.backend?.service?.name) services.add(p.backend.service.name);
                                })
                            );
                            if (original.spec?.defaultBackend?.service?.name) services.add(original.spec.defaultBackend.service.name);
                            return services.size > 0
                                ? <Text size="sm">{services.size} service{services.size > 1 ? 's' : ''}</Text>
                                : <Text c="dimmed" size="sm">-</Text>;
                        }
                    },
                    {
                        key: "spec.tls",
                        label: "TLS",
                        render: ({ original }) => {
                            const tls = original.spec?.tls;
                            return tls?.length
                                ? <Badge size="xs" color="green" variant="light">Enabled</Badge>
                                : <Text c="dimmed" size="sm">-</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
