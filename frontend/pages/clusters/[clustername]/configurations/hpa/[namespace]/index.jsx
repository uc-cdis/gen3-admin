import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Dep() {
    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/configurations/hpa/${namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Target",
                        render: ({ original }) => {
                            const ref = original.spec?.scaleTargetRef;
                            if (!ref) return <Text c="dimmed">-</Text>;
                            return <Text>{ref.kind}/{ref.name}</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Replicas",
                        render: ({ original }) => {
                            const current = original.status?.currentReplicas ?? '-';
                            const desired = original.status?.desiredReplicas ?? '-';
                            return <Text>{current}/{desired}</Text>;
                        }
                    },
                    { key: "spec.minReplicas", label: "Min" },
                    { key: "spec.maxReplicas", label: "Max" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
