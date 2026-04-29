import DataTable from '@/components/DataTable/DataTable';

import { Anchor, Badge, Group, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

function VersionBadges({ versions = [] }) {
    const servedVersions = versions.filter((version) => version.served);

    if (!servedVersions.length) {
        return <Text c="dimmed">No served versions</Text>;
    }

    return (
        <Group gap={6}>
            {servedVersions.map((version) => (
                <Badge
                    key={version.name}
                    size="sm"
                    variant={version.storage ? 'filled' : 'light'}
                    color={version.storage ? 'blue' : 'gray'}
                >
                    {version.name}{version.storage ? ' storage' : ''}
                </Badge>
            ))}
        </Group>
    );
}

export default function CustomResourceDefinitions() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/apiextensions.k8s.io/v1/customresourcedefinitions`}
                fields={[
                    {
                        key: "metadata.name",
                        label: "Name",
                        render: ({ original }) => (
                            <Anchor component={Link} href={`/clusters/${clusterName}/configurations/crds/${original.metadata.name}`}>
                                <Text fw={500}>{original.metadata.name}</Text>
                            </Anchor>
                        )
                    },
                    { key: "spec.group", label: "API Group" },
                    { key: "spec.names.kind", label: "Kind" },
                    { key: "spec.names.plural", label: "Plural" },
                    {
                        key: "spec.scope",
                        label: "Scope",
                        render: ({ original }) => (
                            <Badge variant="light" color={original.spec?.scope === 'Namespaced' ? 'blue' : 'gray'}>
                                {original.spec?.scope || '-'}
                            </Badge>
                        )
                    },
                    {
                        key: "spec.versions",
                        label: "Versions",
                        render: ({ original }) => <VersionBadges versions={original.spec?.versions} />
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}
