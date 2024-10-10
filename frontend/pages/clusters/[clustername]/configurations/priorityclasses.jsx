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
                endpoint={`/apis/scheduling.k8s.io/v1/priorityclasses`}
                fields = {[
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor href={`/clusters/${clusterName}/pods/${Name}`}>{Name}</Anchor>) },
                    { key: "value", label: "Value" },
                    { key: "globalDefault", label: "Global Default", render: ({ globalDefault }) => globalDefault ? 'True' : 'False' },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}