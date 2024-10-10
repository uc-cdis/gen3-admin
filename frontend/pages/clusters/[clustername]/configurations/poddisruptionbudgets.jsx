import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor} from '@mantine/core';

import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';


export default function Dep() {
    const clusterName = useParams()?.clustername;

    console.log("clustername", clusterName)
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/policy/v1/poddisruptionbudgets`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor href={`/clusters/${clusterName}/pods/${Name}`}>{Name}</Anchor>) },
                    { key: "spec.minAvailable", label: "Min Available" },
                    { key: "spec.maxUnavailable", label: "Max Unavailable" },
                    { key: "status.currentHealthy", label: "Current" },
                    { key: "status.desiredHealthy", label: "Desired" },
                    { key: "status.disruptionsAllowed", label: "Disruptions Allowed" },
                    { key: "status.expectedPods", label: "Expected Pods" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}