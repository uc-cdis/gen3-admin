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
                endpoint={`/api/v1/namespaces`}
                fields = {[
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor component={Link} href={`/clusters/${clusterName}/deployments/${Name}`}>{Name}</Anchor>) },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                    { key: "status.phase", label: "Status" },
                    // UID
                    { key: "metadata.uid", label: "UID" },
                    { key: "metadata.labels", label: "Labels", render: ({ Labels }) => (<>{Object.entries(Labels).map(([key, value]) => <Badge key={key} color="blue">{key}: {value}</Badge>)}</>) },
                  ]}
            />
        </>
    )
}