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
                endpoint={`/api/v1/secrets`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace", render: ({ Namespace}) => (<Anchor component={Link} href={`/clusters/${clusterName}/configurations/secrets/${Namespace}/`}>{Namespace}</Anchor>) },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/configurations/secrets/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    { key: "type", label: "Type" },
                    { key: "data", label: "Keys", render: ({ Keys }) => { return Object.keys(Keys).map(key => <div>{key}</div>) } },
                    // Ready / Total containers (Ex 0/1 or 1/1)
                    // { key: "status.containerStatuses", label: "Ready", render: ({ Ready }) => { let ready = 0; let total = 0; Ready.forEach(container => { if (container.ready) ready++; total++; }); return `${ready}/${total}` } },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}