import { useEffect, useMemo, useState } from 'react';

import DataTable from '@/components/DataTable/DataTable';
import callK8sApi from '@/lib/k8s';
import calculateAge from '@/utils/calculateAge';

import { Anchor, Badge, Card, Center, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

function getDisplayVersion(crd) {
    const versions = crd?.spec?.versions || [];
    return versions.find((version) => version.storage) || versions.find((version) => version.served) || versions[0];
}

function buildListEndpoint(crd) {
    const version = getDisplayVersion(crd);
    if (!crd?.spec?.group || !version?.name || !crd?.spec?.names?.plural) return null;

    return `/apis/${crd.spec.group}/${version.name}/${crd.spec.names.plural}`;
}

function conditionColor(condition) {
    if (condition.status === 'True') return 'green';
    if (condition.status === 'False') return 'gray';
    return 'orange';
}

function Conditions({ resource }) {
    const conditions = resource.status?.conditions || [];

    if (!conditions.length) {
        const phase = resource.status?.phase;
        return phase ? <Badge variant="light">{phase}</Badge> : <Text c="dimmed">-</Text>;
    }

    return (
        <Group gap={6}>
            {conditions.slice(0, 3).map((condition) => (
                <Badge key={condition.type} color={conditionColor(condition)} variant="light">
                    {condition.type}: {condition.status}
                </Badge>
            ))}
            {conditions.length > 3 && <Badge variant="outline" color="gray">+{conditions.length - 3}</Badge>}
        </Group>
    );
}

export default function CustomResourceDefinitionDetail() {
    const clusterName = useParams()?.clustername;
    const crdName = useParams()?.name;
    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const [crd, setCrd] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!clusterName || !crdName) return;

        let cancelled = false;

        const fetchCrd = async () => {
            setLoading(true);
            setError(null);

            try {
                const response = await callK8sApi(
                    `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${crdName}`,
                    'GET',
                    null,
                    null,
                    clusterName,
                    accessToken
                );

                if (!cancelled) setCrd(response);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Failed to load CRD');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchCrd();

        return () => {
            cancelled = true;
        };
    }, [clusterName, crdName, accessToken]);

    const version = getDisplayVersion(crd);
    const endpoint = buildListEndpoint(crd);
    const isNamespaced = crd?.spec?.scope === 'Namespaced';

    const fields = useMemo(() => {
        const columns = [];

        if (isNamespaced) {
            columns.push({ key: "metadata.namespace", label: "Namespace" });
        }

        columns.push(
            {
                key: "metadata.name",
                label: "Name",
                render: ({ original }) => {
                    const namespaceSegment = isNamespaced ? `${original.metadata.namespace}/` : '';
                    return (
                        <Anchor
                            component={Link}
                            href={`/clusters/${clusterName}/configurations/crds/${crdName}/resources/${namespaceSegment}${original.metadata.name}`}
                        >
                            <Text fw={500}>{original.metadata.name}</Text>
                        </Anchor>
                    );
                }
            },
            {
                key: "status.conditions",
                label: "Status",
                render: ({ original }) => <Conditions resource={original} />
            },
            { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
            { key: "metadata.resourceVersion", label: "Version" },
        );

        return columns;
    }, [clusterName, crdName, isNamespaced]);

    if (loading) {
        return (
            <Center py="xl">
                <Stack align="center">
                    <Loader />
                    <Text c="dimmed">Loading CRD...</Text>
                </Stack>
            </Center>
        );
    }

    if (error || !crd) {
        return (
            <Card withBorder radius="md" p="xl">
                <Text c="red" fw={600}>Failed to load CRD</Text>
                <Text c="dimmed" size="sm">{error || 'CRD not found'}</Text>
            </Card>
        );
    }

    return (
        <Stack gap="lg">
            <Card withBorder radius="md" p="lg">
                <Stack gap="md">
                    <Group justify="space-between" align="flex-start" wrap="wrap">
                        <Stack gap={4}>
                            <Group gap="sm" wrap="wrap">
                                <Title order={2}>{crd.spec?.names?.kind || crd.metadata?.name}</Title>
                                <Badge size="lg" variant="filled" color="blue">CRD</Badge>
                                <Badge size="lg" variant="outline">{crd.spec?.scope}</Badge>
                            </Group>
                            <Text c="dimmed" size="sm">{crd.metadata?.name}</Text>
                        </Stack>
                        <Group gap="xs">
                            {(crd.spec?.versions || []).map((item) => (
                                <Badge key={item.name} variant={item.storage ? 'filled' : 'light'} color={item.storage ? 'blue' : 'gray'}>
                                    {item.name}{item.storage ? ' storage' : ''}
                                </Badge>
                            ))}
                        </Group>
                    </Group>

                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                        <Card withBorder radius="md" p="md">
                            <Text size="xs" c="dimmed">API group</Text>
                            <Text fw={700}>{crd.spec?.group}</Text>
                        </Card>
                        <Card withBorder radius="md" p="md">
                            <Text size="xs" c="dimmed">Resource</Text>
                            <Text fw={700}>{crd.spec?.names?.plural}</Text>
                        </Card>
                        <Card withBorder radius="md" p="md">
                            <Text size="xs" c="dimmed">Version being browsed</Text>
                            <Text fw={700}>{version?.name || '-'}</Text>
                        </Card>
                        <Card withBorder radius="md" p="md">
                            <Text size="xs" c="dimmed">Created</Text>
                            <Text fw={700}>{calculateAge(crd.metadata?.creationTimestamp)}</Text>
                        </Card>
                    </SimpleGrid>
                </Stack>
            </Card>

            {endpoint ? (
                <DataTable
                    agent={clusterName}
                    endpoint={endpoint}
                    fields={fields}
                    searchableFields={isNamespaced ? ["Namespace", "Name", "Status"] : ["Name", "Status"]}
                />
            ) : (
                <Card withBorder radius="md" p="xl">
                    <Text c="dimmed">This CRD does not expose a browsable served version.</Text>
                </Card>
            )}
        </Stack>
    )
}
