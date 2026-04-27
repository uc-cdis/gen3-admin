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
                endpoint={`/api/v1/namespaces/${namespace}/secrets`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/configurations/secrets/${namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    { key: "type", label: "Type" },
                    {
                        key: "metadata.name",
                        label: "Keys",
                        render: ({ original }) => {
                            const keys = original.data ? Object.keys(original.data) : [];
                            return keys.length > 0
                                ? <Text>{keys.length}</Text>
                                : <Text c="dimmed">0</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
