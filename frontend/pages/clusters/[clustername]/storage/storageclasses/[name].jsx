import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {
    const clusterName = useParams()?.clustername;
    const resource = useParams()?.name;

    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace=""
                resource={resource}
                type="StorageClass"
                tabs={["overview", "yaml"]}
                url={`/apis/storage.k8s.io/v1/storageclasses/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Provisioner", path: "provisioner" },
                            { label: "Reclaim Policy", path: "reclaimPolicy" },
                            { label: "Binding Mode", path: "volumeBindingMode" },
                            { label: "Allow Expansion", path: "allowVolumeExpansion" },
                        ],
                        rightColumns: [
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Created", path: "metadata.creationTimestamp" },
                        ]
                    }
                }}
            />
        </>
    )
}
