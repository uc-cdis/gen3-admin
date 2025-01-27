
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
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/configmaps`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace", render: ({ Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/configurations/configmaps/${Namespace}`}>{Namespace}</Anchor>) },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/configurations/configmaps/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    { key: "data", label: "Data", render: ({ Data }) => { return Object.keys(Data).map(key => <div>{key}</div>) } },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}