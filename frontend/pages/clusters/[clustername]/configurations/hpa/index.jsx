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
           <h1>Horizontal Pod Autoscalers</h1>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/autoscaling/v1/horizontalpodautoscalers`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor component={Link} href={`/clusters/${clusterName}/pods/${Name}`}>{Name}</Anchor>) },
                    { key: "t", label: "Minimum Pods"},
                    { key: "t", label: "Maximum Pods"},
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}