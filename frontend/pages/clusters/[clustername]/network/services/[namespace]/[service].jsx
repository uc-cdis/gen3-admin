import { callGoApi } from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

import { Stack, Text, Divider, Group, Table, ScrollArea, Button, Anchor, } from '@mantine/core'

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.service;

    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="ingress"
                tabs={["overview", "YAML", "events"]}
                url={`/api/v1/namespaces/${namespace}/services/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace", },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Type", path: "spec.type" },
                            { label: "Cluster IP", path: "spec.clusterIP" },
                            { label: "External IP", path: "status.loadBalancer.ingress", render: ((value) => { console.log(value); return value?.value?.length > 0 ? value.value[0].ip : "N/A" }) },
                            {
                                label: "Ports",
                                path: "spec.ports",
                                render: ((value) => {
                                    console.log(value?.value);

                                    if (!value?.value?.length) return '-';

                                    return value?.value?.map((port) => {

                                        return (
                                            <Group key={port.port} position="right" gap={4}>
                                                <Text size="sm" className="font-mono">{port.name}:{port.port} ({port.protocol}) {"-->"}</Text>
                                                <Text size="sm" className="font-mono">{port.targetPort}</Text>
                                            </Group>
                                        )
                                    })
                                }
                                )
                            },
                        ],
                        rightColumns: [
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Generation", path: "metadata.generation" },
                        ]
                    }
                }}
            />
        </>
    )
}