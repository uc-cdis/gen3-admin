import { callGoApi } from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

import { Stack, Text, Divider, Group, Table, ScrollArea, Button, Anchor, } from '@mantine/core'

import Link from 'next/link'

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.ingress;


    console.log("pod in detail page", resource)
    console.log("namespace in detail page", namespace)
    console.log("cluster in detail page", clusterName)

    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="Ingress"
                tabs={["overview", "YAML", "events"]}
                url={`/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace", },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Ingress Class", path: "spec.ingressClassName" },
                            { label: "Default Backend", path: "spec.defaultBackend" },
                            { label: "Address", path: "status.loadBalancer.ingress", render: ((value) => { console.log(value); return value?.value?.length > 0 ? value.value[0].hostname : "N/A" }) },
                            { 
                                label: "Rules",
                                path: "spec.rules",
                                render: ({ value }) => {
                                    // Handle null/undefined values
                                    if (!value?.length) return '-';
            
                                    // Map over the rules and display each one
                                    return value.map((rule, index) => (
                                        <Stack key={index} spacing={2}>
                                            {/* <Text size="sm" c="dimmed">Host: </Text>
                                            <Text size="sm" className="font-mono">
                                                {rule.host}
                                            </Text>
                                            <Divider my="sm" />
                                            <Text size="sm" c="dimmed">Paths: </Text> */}
                                            <Stack spacing={1}>
                                                {rule.http?.paths.map((path, pathIndex) => (
                                                    <Group key={pathIndex} position="left" gap={4}>
                                                        <Text size="sm" className="font-mono">
                                                            {path.path} {" --> "}
                                                        </Text>
                                                        <Text size="sm" className="font-mono">
                                                            <Anchor component={Link} href={`/clusters/${clusterName}/network/services/${namespace}/${path.backend.service.name}`} >{path.backend.service.name}</Anchor>:{path.backend.service.port.number}
                                                        </Text>
                                                    </Group>
                                                ))}
                                            </Stack>
                                        </Stack>
                                    ));
                                }
                            },
            
                        ],
                        rightColumns: [
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Generation", path: "metadata.generation" },
                            { label: "Host IP", path: "status.hostIP" },
                            { label: "DNS Policy", path: "spec.dnsPolicy" },
                            { label: "Preemption Policy", path: "spec.preemptionPolicy" },
                            { label: "Restart Policy", path: "spec.restartPolicy" },
                            { label: "Termination Grace Period", path: "spec.terminationGracePeriodSeconds" },
                        ]
                    }
                }}
            />
        </>
    )
}