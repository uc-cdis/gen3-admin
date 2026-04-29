import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Secrets() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/secrets`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/configurations/secrets/${original.metadata.namespace}/${original.metadata.name}`}>
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
                            return <Text>{keys.length}</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
