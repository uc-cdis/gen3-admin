import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text, Group } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

const TYPE_COLORS = {
    ClusterIP: 'blue',
    NodePort: 'violet',
    LoadBalancer: 'green',
    ExternalName: 'orange',
};

export default function Services() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/services`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/network/services/${original.metadata.namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "spec.type",
                        label: "Type",
                        render: ({ original }) => {
                            const t = original.spec?.type || 'ClusterIP';
                            return <Badge size="sm" variant="filled" color={TYPE_COLORS[t] || 'gray'}>{t}</Badge>;
                        }
                    },
                    { key: "spec.clusterIP", label: "Cluster IP" },
                    {
                        key: "metadata.name",
                        label: "Ports",
                        render: ({ original }) => {
                            const ports = original.spec?.ports || [];
                            return ports.length > 0
                                ? (
                                    <Group gap={4}>
                                        {ports.map((p, i) => (
                                            <Text key={i} size="xs" className="font-mono">
                                                {p.name && <span style={{ color: 'var(--mantine-color-dimmed)' }}>{p.name}:</span>}
                                                {p.port}<span style={{ color: 'var(--mantine-color-dimmed)' }}>/</span>{p.protocol}
                                            </Text>
                                        ))}
                                    </Group>
                                )
                                : <Text c="dimmed" size="sm">-</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "External IP",
                        render: ({ original }) => {
                            const ingress = original.status?.loadBalancer?.ingress;
                            if (!ingress || ingress.length === 0) {
                                return original.spec?.type === 'LoadBalancer'
                                    ? <Badge size="xs" variant="outline" color="yellow">Pending</Badge>
                                    : <Text c="dimmed" size="sm">-</Text>;
                            }
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
                        label: "Selector",
                        render: ({ original }) => {
                            const sel = original.spec?.selector;
                            if (!sel || Object.keys(sel).length === 0) return <Text c="dimmed" size="sm">-</Text>;
                            return (
                                <Group gap={4}>
                                    {Object.entries(sel).slice(0, 3).map(([k, v]) => (
                                        <Badge key={k} size="xs" variant="light">{k}=<Text span fw={700}>{v}</Text></Badge>
                                    ))}
                                    {Object.keys(sel).length > 3 && (
                                        <Badge size="xs" variant="light">+{Object.keys(sel).length - 3}</Badge>
                                    )}
                                </Group>
                            );
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
