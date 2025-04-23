import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor } from '@mantine/core';

import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Dep() {
    const clusterName = useParams()?.clustername;

    console.log("clustername", clusterName)
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/pods`}
                metricsEndpoint={`/apis/metrics.k8s.io/v1beta1/pods`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/workloads/pods/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    {
                        key: "status.phase",
                        label: "Status",
                        render: ({ Status, Ready }) => {
                            // Check if pod is in CrashLoopBackOff state
                            const hasCrashLoopBackOff = Ready?.some(
                                status => status?.state?.waiting?.reason === 'CrashLoopBackOff'
                            );

                            // Determine status text to display
                            const statusText = hasCrashLoopBackOff
                                ? 'CrashLoopBackOff'
                                : Status || 'Unknown';

                            // Determine badge color based on status
                            let color;
                            if (hasCrashLoopBackOff) {
                                color = 'red';
                            } else {
                                switch (Status) {
                                    case 'Running':
                                        color = 'green';
                                        break;
                                    case 'Pending':
                                        color = 'orange';
                                        break;
                                    case 'Succeeded':
                                        color = 'gray';
                                        break;
                                    case 'Completed':
                                        color = 'blue';
                                        break;
                                    case 'Failed':
                                    case 'Error':
                                        color = 'red';
                                        break;
                                    default:
                                        color = 'gray';
                                }
                            }

                            return (
                                <Badge
                                    color={color}
                                    variant="filled"
                                    radius="sm"
                                >
                                    {statusText}
                                </Badge>
                            );
                        }
                    },
                    { key: "status.podIP", label: "IP" },
                    { key: "spec.nodeName", label: "Node" },
                    { key: "", label: "CPU" },

                    // Ready / Total containers (Ex 0/1 or 1/1)
                    {
                        key: "status.containerStatuses", label: "Ready", render: ({ Ready }) => {
                            // Handle cases where Ready might be undefined or not an array
                            const containers = Array.isArray(Ready) ? Ready : [];
                            let ready = 0;
                            let total = 0;

                            containers.forEach(container => {
                                if (container.ready) ready++;
                                total++;
                            });

                            return `${ready}/${total}`;

                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}