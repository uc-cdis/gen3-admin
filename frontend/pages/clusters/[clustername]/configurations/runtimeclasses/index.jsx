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
                endpoint={`/apis/node.k8s.io/v1/runtimeclasses`}
                fields = {[
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor component={Link} href={`/clusters/${clusterName}/pods/${Name}`}>{Name}</Anchor>) },
                    { key: "handler", label: "Handler", render: ({ Handler }) => Handler },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}