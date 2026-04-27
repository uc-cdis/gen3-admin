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
                type="PersistentVolume"
                tabs={["overview", "yaml", "events"]}
                url={`/api/v1/persistentvolumes/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Status", path: "status.phase" },
                            { label: "Capacity", path: "spec.capacity.storage" },
                            { label: "Access Modes", path: "spec.accessModes" },
                            { label: "Reclaim Policy", path: "spec.persistentVolumeReclaimPolicy" },
                            { label: "Storage Class", path: "spec.storageClassName" },
                            { label: "Claim", path: "spec.claimRef.name" },
                            { label: "Claim Namespace", path: "spec.claimRef.namespace" },
                            { label: "Reason", path: "status.reason" },
                            { label: "Message", path: "status.message" },
                        ],
                        rightColumns: [
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Volume Mode", path: "spec.volumeMode" },
                            { label: "Provisioner", path: "spec.csiprovisioner" },
                        ]
                    }
                }}
            />
        </>
    )
}
