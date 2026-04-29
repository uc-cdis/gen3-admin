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
                endpoint={`/apis/batch/v1/namespaces/${namespace}/jobs`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/workloads/jobs/${namespace}/${original.metadata.name}`}>
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
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
