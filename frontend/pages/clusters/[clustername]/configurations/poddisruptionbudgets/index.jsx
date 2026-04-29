import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function PodDisruptionBudgets() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/policy/v1/poddisruptionbudgets`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/configurations/poddisruptionbudgets/${original.metadata.namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Health",
                        render: ({ original }) => {
                            const current = original.status?.currentHealthy || 0;
                            const desired = original.status?.desiredHealthy || 0;
                            return <Text>{`${current}/${desired}`}</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Allowed Disruptions",
                        render: ({ original }) => {
                            const allowed = original.status?.disruptionsAllowed;
                            return allowed !== undefined ? <Text>{allowed}</Text> : <Text c="dimmed">-</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
