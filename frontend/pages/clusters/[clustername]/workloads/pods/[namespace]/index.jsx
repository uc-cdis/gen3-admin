import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
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
                endpoint={`/api/v1/namespaces/${namespace}/pods`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/workloads/pods/${namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Status",
                        render: ({ original }) => {
                            const phase = original.status?.phase;
                            const containerStatuses = original.status?.containerStatuses;
                            const hasCrashLoopBackOff = Array.isArray(containerStatuses) && containerStatuses.some(
                                s => s?.state?.waiting?.reason === 'CrashLoopBackOff'
                            );
                            const statusText = hasCrashLoopBackOff ? 'CrashLoopBackOff' : phase || 'Unknown';
                            let color;
                            if (hasCrashLoopBackOff) color = 'red';
                            else switch (phase) {
                                case 'Running': color = 'green'; break;
                                case 'Pending': color = 'orange'; break;
                                case 'Succeeded': case 'Completed': color = 'blue'; break;
                                case 'Failed': case 'Error': color = 'red'; break;
                                default: color = 'gray';
                            }
                            return <Badge color={color} variant="filled" radius="sm">{statusText}</Badge>;
                        }
                    },
                    { key: "status.podIP", label: "IP" },
                    { key: "spec.nodeName", label: "Node" },
                    {
                        key: "metadata.name",
                        label: "Ready",
                        render: ({ original }) => {
                            const containers = original.status?.containerStatuses || [];
                            let ready = 0, total = containers.length;
                            containers.forEach(c => { if (c.ready) ready++; });
                            return <Text>{`${ready}/${total}`}</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
