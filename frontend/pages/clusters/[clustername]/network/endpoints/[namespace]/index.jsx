import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Endpoints() {
    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/namespaces/${namespace}/endpoints`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/network/endpoints/${namespace}/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Addresses",
                        render: ({ original }) => {
                            const addresses = original.subsets?.flatMap(s => s.addresses || []) || [];
                            return <Text size="sm">{addresses.length}</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Ports",
                        render: ({ original }) => {
                            const ports = original.subsets?.flatMap(s => s.ports || []) || [];
                            const uniquePorts = [...new Set(ports.map(p => p.port))];
                            return <Text size="sm">{uniquePorts.join(', ') || '-'}</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
