import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Jobs() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/batch/v1/jobs`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/workloads/jobs/${original.metadata.namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Completions",
                        render: ({ original }) => {
                            const succeeded = original.status?.succeeded || 0;
                            const total = original.spec?.completions || 1;
                            return <Text>{`${succeeded}/${total}`}</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Duration",
                        render: ({ original }) => {
                            const start = original.status?.startTime;
                            const finish = original.status?.completionTime;
                            if (!start) return <Text c="dimmed">-</Text>;
                            if (!finish) return <Text>Running</Text>;
                            const ms = new Date(finish) - new Date(start);
                            if (ms < 60000) return <Text>{(ms / 1000).toFixed(0)}s</Text>;
                            if (ms < 3600000) return <Text>{(ms / 60000).toFixed(0)}m</Text>;
                            return <Text>{(ms / 3600000).toFixed(1)}h</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
