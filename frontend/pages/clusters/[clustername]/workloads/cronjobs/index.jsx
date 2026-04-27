import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function CronJobs() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/batch/v1/cronjobs`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/workloads/cronjobs/${original.metadata.namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    { key: "spec.schedule", label: "Schedule" },
                    {
                        key: "metadata.name",
                        label: "Suspend",
                        render: ({ original }) => (
                            original.spec?.suspend
                                ? <Badge color="orange" variant="filled" size="sm">Suspended</Badge>
                                : <Badge color="green" variant="filled" size="sm">Active</Badge>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Last Schedule",
                        render: ({ original }) => {
                            const last = original.status?.lastScheduleTime;
                            if (!last) return <Text c="dimmed">-</Text>;
                            return <Text>{calculateAge(last)}</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
