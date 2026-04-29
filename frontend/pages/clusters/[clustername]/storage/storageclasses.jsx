import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function StorageClasses() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/storage.k8s.io/v1/storageclasses`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/storage/storageclasses/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    { key: "provisioner", label: "Provisioner" },
                    { key: "reclaimPolicy", label: "Reclaim Policy" },
                    { key: "volumeBindingMode", label: "Binding Mode" },
                    {
                        key: "metadata.name",
                        label: "Allow Expansion",
                        render: ({ original }) => (
                            original.allowVolumeExpansion
                                ? <Text>Yes</Text>
                                : <Text c="dimmed">No</Text>
                        )
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
