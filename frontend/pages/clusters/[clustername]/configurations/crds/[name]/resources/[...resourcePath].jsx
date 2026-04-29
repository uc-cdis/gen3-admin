import { useEffect, useState } from 'react';

import ResourceDetails from '@/components/ResourceDetails';
import callK8sApi from '@/lib/k8s';

import { Card, Center, Loader, Stack, Text } from '@mantine/core';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';

function getDisplayVersion(crd) {
    const versions = crd?.spec?.versions || [];
    return versions.find((version) => version.storage) || versions.find((version) => version.served) || versions[0];
}

function buildResourceEndpoint(crd, namespace, resourceName) {
    const version = getDisplayVersion(crd);
    if (!crd?.spec?.group || !version?.name || !crd?.spec?.names?.plural || !resourceName) return null;

    const base = `/apis/${crd.spec.group}/${version.name}`;
    if (crd.spec.scope === 'Namespaced') {
        return `${base}/namespaces/${namespace}/${crd.spec.names.plural}/${resourceName}`;
    }

    return `${base}/${crd.spec.names.plural}/${resourceName}`;
}

export default function CustomResourceInstanceDetail() {
    const router = useRouter();
    const clusterName = router.query.clustername;
    const crdName = router.query.name;
    const resourcePath = router.query.resourcePath || [];
    const pathParts = Array.isArray(resourcePath) ? resourcePath : [resourcePath];
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

    if (loading || !router.isReady) {
        return (
            <Center py="xl">
                <Stack align="center">
                    <Loader />
                    <Text c="dimmed">Loading custom resource...</Text>
                </Stack>
            </Center>
        );
    }

    if (error || !crd) {
        return (
            <Card withBorder radius="md" p="xl">
                <Text c="red" fw={600}>Failed to load custom resource</Text>
                <Text c="dimmed" size="sm">{error || 'CRD not found'}</Text>
            </Card>
        );
    }

    const isNamespaced = crd.spec?.scope === 'Namespaced';
    const namespace = isNamespaced ? pathParts[0] : '';
    const resourceName = isNamespaced ? pathParts[1] : pathParts[0];
    const url = buildResourceEndpoint(crd, namespace, resourceName);
    const kind = crd.spec?.names?.kind || 'CustomResource';

    if (!url || !resourceName) {
        return (
            <Card withBorder radius="md" p="xl">
                <Text c="red" fw={600}>Invalid custom resource URL</Text>
                <Text c="dimmed" size="sm">Could not resolve API path for this CRD instance.</Text>
            </Card>
        );
    }

    return (
        <ResourceDetails
            cluster={clusterName}
            namespace={namespace}
            resource={resourceName}
            type={kind}
            tabs={["overview", "events", "yaml"]}
            url={url}
            columnConfig={{
                layout: {
                    leftColumns: [
                        { label: "Name", path: "metadata.name" },
                        { label: "Namespace", path: "metadata.namespace" },
                        { label: "Kind", path: "kind" },
                        { label: "API Version", path: "apiVersion" },
                        { label: "Created", path: "metadata.creationTimestamp" },
                    ],
                    rightColumns: [
                        { label: "Generation", path: "metadata.generation" },
                        { label: "Resource Version", path: "metadata.resourceVersion" },
                        { label: "UID", path: "metadata.uid" },
                    ]
                }
            }}
        />
    )
}
