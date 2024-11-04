import DataTable from '@/components/DataTable/DataTable';

import { useParams } from 'next/navigation';

import { Anchor } from '@mantine/core';

import calculateAge from '@/utils/calculateAge';


export default function Dep() {
    const clusterName = useParams()?.clustername;

    console.log("clustername", clusterName)
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/batch/v1/jobs`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor href={`/clusters/${clusterName}/deployments/${Name}`}>{Name}</Anchor>) },
                    { key: "status.succeeded", label: "Succeeded" },
                    { key: "status.conditions[0].type", label: "Conditions" }, // Assuming you want the first condition
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}