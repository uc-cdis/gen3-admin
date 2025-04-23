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
                endpoint={`/apis/apps/v1/deployments`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/workloads/deployments/${Namespace}/${Name}`}>{Name}</Anchor>) },

                    // Ready / Total containers (Ex 0/1 or 1/1)
                    {
                        key: "status", label: "Ready", render: ({ Ready }) => {
                            let ready = Ready?.readyReplicas || 0;
                            const total = Ready?.replicas || 0;

                            return `${ready}/${total}`;

                        }
                    },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}