import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {
    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.name;

    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="PersistentVolumeClaim"
                tabs={["overview", "yaml", "events"]}
                url={`/api/v1/namespaces/${namespace}/persistentvolumeclaims/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Status", path: "status.phase" },
                            { label: "Capacity", path: "spec.capacity.storage" },
                            { label: "Access Modes", path: "spec.accessModes" },
                            { label: "Storage Class", path: "spec.storageClassName" },
                            { label: "Volume Name", path: "spec.volumeName" },
                        ],
                        rightColumns: [
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Reclaim Policy", path: "spec.persistentVolumeReclaimPolicy" },
                            { label: "Volume Mode", path: "spec.volumeMode" },
                        ]
                    }
                }}
            />
        </>
    )
}
