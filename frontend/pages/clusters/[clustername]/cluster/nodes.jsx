import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor, Tooltip, ScrollArea } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Dep() {
    const clusterName = useParams()?.clustername;
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/nodes`}
                fields={[
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor component={Link} href={`/clusters/${clusterName}/deployments/${Name}`}>{Name}</Anchor>) },
                    // Resourve version
                    { key: "metadata.resourceVersion", label: "Resource Version" },
                    { key: "status.nodeInfo.kubeletVersion", label: "Kubelet Version" },
                    // Roles
                    // Check if labels that start with "node-role.kubernetes.io/" are present and then render them with the role name
                    { key: "metadata.labels", label: "Roles", render: ({ Roles }) => (<>{Object.entries(Roles).map(([key, value]) => key.startsWith("node-role.kubernetes.io/") ? <Badge fullWidth key={key} color="blue">{key.split("/")[1]}</Badge> : null)}</>) },
                    {
                        key: "metadata.labels",
                        label: "Labels",
                        render: ({ Labels }) => (
                            <>
                                <ScrollArea.Autosize mah={100} mx="auto">
                                    {Object.entries(Labels).map(([key, value]) => (
                                        <div>
                                            <strong style={{ color: "#333" }}>{key}:</strong> {value}
                                        </div>
                                    ))}
                                </ScrollArea.Autosize>
                            </>
                        )
                    },
                    // Condition status
                    {
                        key: "status.conditions", label: "Conditions", render: ({ Conditions }) => Conditions.map(cond =>
                            cond.status === 'True' ? <Badge key={cond.type} color="green">{cond.type}</Badge> : null
                        )
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                    { key: "status.capacity.cpu", label: "CPU" },
                    { key: "status.capacity.memory", label: "Memory" },
                    { key: "status.capacity.pods", label: "Pods" },
                    { key: "status.capacity.ephemeral-storage", label: "Ephemeral Storage" },
                    { key: "status.allocatable.cpu", label: "Allocatable CPU" },
                    { key: "status.allocatable.memory", label: "Allocatable Memory" },
                    { key: "status.allocatable.pods", label: "Allocatable Pods" },
                    { key: "status.allocatable.ephemeral-storage", label: "Allocatable Ephemeral Storage" },
                    {
                        key: "status.addresses", label: "Addresses", render: ({ Addresses }) => (


                            <ScrollArea.Autosize>
                                {Addresses.map(addr =>
                                    // <Badge key={addr.type} color="blue">{addr.type}: {addr.address}</Badge>
                                    <>
                                        <strong>{addr.type}</strong>: {addr.address}<br />
                                    </>
                                )}
                            </ScrollArea.Autosize>
                        )
                    },
                    { key: "status.nodeInfo.operatingSystem", label: "Operating System" },
                    { key: "status.nodeInfo.architecture", label: "Architecture" },
                    { key: "status.nodeInfo.containerRuntimeVersion", label: "Container Runtime Version" },
                    { key: "status.nodeInfo.kernelVersion", label: "Kernel Version" },
                    { key: "status.nodeInfo.osImage", label: "OS Image" },
                    { key: "status.nodeInfo.bootID", label: "Boot ID" },
                    { key: "status.nodeInfo.systemUUID", label: "System UUID" },
                    { key: "status.nodeInfo.machineID", label: "Machine ID" },
                ]}
            />
        </>
    )
}