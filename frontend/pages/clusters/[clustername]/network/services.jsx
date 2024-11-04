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
                endpoint={`/api/v1/services`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor href={`/clusters/${clusterName}/services/${Name}`}>{Name}</Anchor>) },
                    { key: "spec.type", label: "Type" },
                    { key: "spec.clusterIP", label: "Cluster IP" },
                    { key: "status.loadBalancer.ingress[0].ip", label: "ExtIP", render: ({ ExtIP }) => ExtIP ? ExtIP : "" },
                    { key: "spec.ports", label: "Ports" , render: ({ Ports }) => Ports.map(port => `${port.port}/${port.protocol}`).join(', ') },
                  ]}
            />
        </>
    )
}