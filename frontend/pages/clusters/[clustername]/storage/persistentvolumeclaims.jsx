import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor} from '@mantine/core';

import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';

import Link from 'next/link';

export default function Dep() {
    const clusterName = useParams()?.clustername;

    console.log("clustername", clusterName)
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/api/v1/persistentvolumeclaims`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor component={Link} href={`/clusters/${clusterName}/storage/persistentvolumes/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    { key: "status.phase", label: "Status", render: ({ Status }) => (<Badge color={Status === 'Bound' ? 'green' : Status === 'Pending' ? 'orange' : Status === 'Succeeded' ? 'grey' : 'red'}>{Status}</Badge>) },
                    { key: "spec.capacity.storage", label: "Capacity" },
                    { key: "spec.accessModes", label: "Access Modes" },
                    { key: "spec.volumeName", label: "Volume", render: ({ Volume }) => Volume ? <Anchor component={Link} href={`/clusters/${clusterName}/storage/persistentvolumes/${Volume}`}>{Volume}</Anchor> : "" },
                    { key: "spec.storageClassName", label: "Storage Class" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}