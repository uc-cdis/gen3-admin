import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor } from '@mantine/core';

import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link'

export default function Dep() {
    const clusterName = useParams()?.clustername;

    return (
        <>
            Hello
            <DataTable
                agent={clusterName}
                endpoint={`/apis/apps/v1/daemonsets`}
                fields={[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/workloads/daemonsets/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    { key: "status.numberReady", label: "Ready" },
                    { key: "status.desiredNumberScheduled", label: "Desired" },
                    { key: "status.updatedNumberScheduled", label: "Updated" },
                    { key: "status.numberAvailable", label: "Available" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                ]}
            />
        </>
    )
}