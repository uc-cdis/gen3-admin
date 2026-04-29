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
                endpoint={`/apis/apps/v1/namespaces/${namespace}/deployments`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/workloads/deployments/${namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Ready",
                        render: ({ original }) => {
                            const ready = original.status?.readyReplicas || 0;
                            const total = original.status?.replicas || 0;
                            return <Text>{`${ready}/${total}`}</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Up-to-date",
                        render: ({ original }) => {
                            const updated = original.status?.updatedReplicas ?? '-';
                            return <Text>{updated}</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Available",
                        render: ({ original }) => {
                            const available = original.status?.availableReplicas ?? '-';
                            return <Text>{available}</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
