import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function PersistentVolumes() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/persistentvolumes`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/storage/persistentvolumes/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Status",
                        render: ({ original }) => {
                            const phase = original.status?.phase;
                            const color = phase === 'Bound' ? 'green' : phase === 'Pending' ? 'orange' : phase === 'Available' ? 'blue' : 'red';
                            return <Badge color={color} variant="filled" size="sm">{phase || 'Unknown'}</Badge>;
                        }
                    },
                    { key: "spec.capacity.storage", label: "Capacity" },
                    {
                        key: "metadata.name",
                        label: "Claim",
                        render: ({ original }) => {
                            const claim = original.spec?.claimRef;
                            if (!claim) return <Text c="dimmed">-</Text>;
                            return (
                                <Anchor component={Link} href={`/clusters/${clusterName}/storage/persistentvolumeclaims/${claim.namespace}/${claim.name}`}>
                                    <Text>{claim.namespace}/{claim.name}</Text>
                                </Anchor>
                            );
                        }
                    },
                    { key: "spec.storageClassName", label: "Storage Class" },
                    { key: "spec.persistentVolumeReclaimPolicy", label: "Reclaim Policy" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
