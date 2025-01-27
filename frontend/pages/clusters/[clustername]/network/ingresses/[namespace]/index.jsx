
import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor } from '@mantine/core';

import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Detail() {
    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    console.log("clustername", clusterName)
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/network/ingresses/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    { key: "spec.ingressClassName", label: "Class" },
                    { key: "spec.rules", label: "Hosts", render: ({ Hosts }) => Hosts.map((host, i) => <Anchor component={Link} target="_blank" href={"https://" + host?.host} key={i}>{host?.host}</Anchor>) },
                    // IP is an object not array
                    { key: "status.loadBalancer.ingress", label: "Address", render: ({ Address }) => Address[0]?.hostname ? <Anchor component={Link} href={"https://" + Address[0]?.hostname} target="_blank"> {Address[0]?.hostname} </Anchor> : <Badge color="red">No address.</Badge> },
                    { key: "spec.ports", label: "Ports", render: ({ Ports }) => Object.keys(Ports).map(port => `${port}/${Ports[port].protocol}`).join(', ') },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}