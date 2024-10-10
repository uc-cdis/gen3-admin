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
                endpoint={`/apis/networking.k8s.io/v1/ingresses`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor href={`/clusters/${clusterName}/pods/${Name}`}>{Name}</Anchor>) },
                    { key: "spec.ingressClassName", label: "Class" },
                    { key: "spec.rules", label: "Hosts", render: ({ Hosts }) => Hosts.map((host, i) => <Badge key={i}>{host?.host}</Badge>) },
                    // IP is an object not array
                    { key: "status.loadBalancer.ingress", label: "IP", render: ({ IP }) => IP[0]?.ip ? IP[0]?.ip : <Badge color="red">No address.</Badge> },
                    { key: "spec.ports", label: "Ports", render: ({ Ports }) => Object.keys(Ports).map(port => `${port}/${Ports[port].protocol}`).join(', ') },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}