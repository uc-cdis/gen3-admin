import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor } from '@mantine/core';
import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';


export default function Dep() {
    const clusterName = useParams()?.clustername;

    console.log("clustername", clusterName)
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/nodes`}
                fields = {[
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor href={`/clusters/${clusterName}/deployments/${Name}`}>{Name}</Anchor>) },
                    // Resourve version
                    { key: "metadata.resourceVersion", label: "Resource Version" },
                    { key: "status.nodeInfo.kubeletVersion", label: "Kubelet Version" },
                    // Roles
                    // Check if labels that start with "node-role.kubernetes.io/" are present and then render them with the role name
                    { key: "metadata.labels", label: "Roles", render: ({ Roles }) => (<>{Object.entries(Roles).map(([key, value]) => key.startsWith("node-role.kubernetes.io/") ? <Badge key={key} color="blue">{key.split("/")[1]}</Badge> : null)}</>) },
                    {key: "metadata.labels", label: "Labels", render: ({ Labels }) => (<>{Object.entries(Labels).map(([key, value]) => <Badge key={key} color="blue">{key}: {value}</Badge>)}</>) },
                    // Condition status
                    { key: "status.conditions", label: "Conditions", render: ({ Conditions }) => Conditions.map(cond => 
                        cond.status === 'True' ? <Badge key={cond.type} color="green">{cond.type}</Badge> : null
                    )},
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}