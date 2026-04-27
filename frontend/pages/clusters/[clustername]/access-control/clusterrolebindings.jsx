import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function ClusterRoleBindings() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/rbac.authorization.k8s.io/v1/clusterrolebindings`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/access-control/clusterrolebindings/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    {
                        key: "metadata.name",
                        label: "Role Ref",
                        render: ({ original }) => {
                            const ref = original.roleRef;
                            if (!ref) return <Text c="dimmed">-</Text>;
                            return <Text>{ref.kind}/{ref.name}</Text>;
                        }
                    },
                    {
                        key: "metadata.name",
                        label: "Subjects",
                        render: ({ original }) => {
                            const subjects = original.subjects || [];
                            return subjects.length > 0
                                ? <Text>{subjects.map(s => `${s.kind}/${s.name}`).join(', ')}</Text>
                                : <Text c="dimmed">-</Text>;
                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
