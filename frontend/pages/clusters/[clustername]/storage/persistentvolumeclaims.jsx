import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function PersistentVolumeClaims() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/persistentvolumeclaims`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/storage/persistentvolumeclaims/${original.metadata.namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Status",
                        render: ({ original }) => {
                            const phase = original.status?.phase;
                            const color = phase === 'Bound' ? 'green' : phase === 'Pending' ? 'orange' : 'red';
                            return <Badge color={color} variant="filled" size="sm">{phase || 'Unknown'}</Badge>;
                        }
                    },
                    { key: "spec.capacity.storage", label: "Capacity" },
                    {
                        key: "metadata.name",
                        label: "Volume",
                        render: ({ original }) => {
                            const vol = original.spec?.volumeName;
                            return vol ? (
                                <Anchor component={Link} href={`/clusters/${clusterName}/storage/persistentvolumes/${vol}`}>
                                    <Text>{vol}</Text>
                                </Anchor>
                            ) : <Text c="dimmed">-</Text>;
                        }
                    },
                    { key: "spec.storageClassName", label: "Storage Class" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
