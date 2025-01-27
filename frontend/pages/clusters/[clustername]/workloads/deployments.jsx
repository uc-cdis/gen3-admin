import DataTable from '@/components/DataTable/DataTable';

import { useParams } from 'next/navigation';


import { Anchor } from '@mantine/core';

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
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor component={Link} href={`/clusters/${clusterName}/deployments/${Name}`}>{Name}</Anchor>) },
                    { key: "status.readyReplicas", label: "Ready" },
                    { key: "spec.replicas", label: "Desired" },
                    { key: "status.updatedReplicas", label: "Updated" },
                    { key: "status.availableReplicas", label: "Available" },
                    { key: "status.conditions[0].type", label: "Conditions" }, // Assuming you want the first condition
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}