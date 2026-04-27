import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function PriorityClasses() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/scheduling.k8s.io/v1/priorityclasses`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/configurations/priorityclasses/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    { key: "value", label: "Value" },
                    {
                        key: "metadata.name",
                        label: "Global Default",
                        render: ({ original }) => (
                            original.globalDefault
                                ? <Badge color="blue" variant="filled" size="sm">Yes</Badge>
                                : <Text c="dimmed">No</Text>
                        )
                    },
                    { key: "preemptionPolicy", label: "Preemption Policy" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
