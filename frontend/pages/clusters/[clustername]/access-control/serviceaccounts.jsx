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
                endpoint={`/api/v1/serviceaccounts`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/access-control/serviceaccounts/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    { key: "secrets", label: "Secrets" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}