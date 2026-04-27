import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text, Group } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

function parseK8sMemory(val) {
    if (!val) return 0;
    const match = String(val).match(/^(\d+)(Ki|Mi|Gi|Ti)?$/);
    if (!match) return 0;
    const n = parseInt(match[1], 10);
    const unit = match[2] || '';
    switch (unit) {
        case 'Ki': return n * 1024;
        case 'Mi': return n * 1024 ** 2;
        case 'Gi': return n * 1024 ** 3;
        case 'Ti': return n * 1024 ** 4;
        default: return n;
    }
}

function formatMemory(val) {
    if (!val) return '-';
    const bytes = parseK8sMemory(val);
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}Gi`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)}Mi`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}Ki`;
    return `${bytes}`;
}

export default function Nodes() {
    const clusterName = useParams()?.clustername;
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/nodes`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/cluster/nodes/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Status",
                        render: ({ original }) => {
                            const ready = original.status?.conditions?.find(c => c.type === 'Ready');
                            return ready?.status === 'True'
                                ? <Badge color="green" variant="filled" size="sm">Ready</Badge>
                                : <Badge color="red" variant="filled" size="sm">NotReady</Badge>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Roles",
                        render: ({ original }) => {
                            const labels = original.metadata?.labels || {};
                            const roles = Object.entries(labels)
                                .filter(([key]) => key.startsWith("node-role.kubernetes.io/"))
                                .map(([key]) => key.split("/")[1]);
                            return roles.length > 0
                                ? (
                                    <Group gap={4}>
                                        {roles.map(r => <Badge key={r} variant="filled" color="blue" size="sm">{r}</Badge>)}
                                    </Group>
                                )
                                : <Text c="dimmed" fs="italic">worker</Text>;
                        }
                    },
                    { key: "status.nodeInfo.kubeletVersion", label: "Version", render: ({ Version }) => <Text>{Version}</Text> },
                    {
                        key: "metadata.name",
                        label: "Pods",
                        render: ({ original }) => {
                            const pods = original.status?.capacity?.pods;
                            return pods ? <Text>{pods}</Text> : <Text c="dimmed">-</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "CPU (cap)",
                        render: ({ original }) => {
                            const cpu = original.status?.capacity?.cpu;
                            return cpu ? <Text>{cpu}</Text> : <Text c="dimmed">-</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Mem (cap)",
                        render: ({ original }) => {
                            const mem = original.status?.capacity?.memory;
                            return <Text>{formatMemory(mem)}</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
