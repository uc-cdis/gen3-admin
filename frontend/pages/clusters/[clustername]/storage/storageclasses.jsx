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
                endpoint={`/apis/storage.k8s.io/v1/storageclasses`}
                fields = {[
                    { key: "metadata.name", label: "Name", render: ({ Name }) => (<Anchor href={`/clusters/${clusterName}/storage/persistentvolumes/${Name}`}>{Name}</Anchor>) },
                    { key: "provisioner", label: "Provisioner" },
                    { key: "reclaimPolicy", label: "Reclaim Policy" },
                    { key: "volumeBindingMode", label: "Volume Binding Mode" },
                    { key: "allowVolumeExpansion", label: "Allow Volume Expansion", render: ({ AllowVolumeExpansion }) => AllowVolumeExpansion ? "Yes" : "No" },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}