import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function ReplicaSets() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/apps/v1/replicasets`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/workloads/replicasets/${original.metadata.namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Ready",
                        render: ({ original }) => {
                            const ready = original.status?.readyReplicas || 0;
                            const total = original.spec?.replicas || 0;
                            return <Text>{`${ready}/${total}`}</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Desired",
                        render: ({ original }) => {
                            const desired = original.spec?.replicas ?? '-';
                            return <Text>{desired}</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
