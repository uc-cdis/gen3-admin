import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor} from '@mantine/core';

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
                endpoint={`/api/v1/endpoints`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/network/endpoints/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    // Print out endpoints in address:port format for all addresses and ports
                    // { key: "subsets", label: "Endpoints" , render: ({ Endpoints }) => Object.keys(Endpoints).map(endpoint => `${Endpoints[endpoint].addresses.map(address => `${address.ip}:${Endpoints[endpoint].ports[endpoint].port}`).join(', ')}`).join(', ') },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}