import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.pod;


    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="ReplicaSet"
                tabs={["overview", "yaml", "events"]}
                url={`/apis/apps/v1/namespaces/${namespace}/replicasets/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Replicas", path: "status.replicas" },
                            { label: "Ready", path: "status.readyReplicas" },
                            { label: "Available", path: "status.availableReplicas" },
                            { label: "Fully Labeled", path: "status.fullyLabeledReplicas" },
                        ],
                        rightColumns: [
                            { label: "Owner (Kind)", path: "metadata.ownerReferences", render: (refs) => refs?.[0]?.kind || '-' },
                            { label: "Owner (Name)", path: "metadata.ownerReferences", render: (refs) => refs?.[0]?.name || '-' },
                            { label: "Selector", path: "spec.selector.matchLabels" },
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                        ]
                    }
                }}
            />
        </>
    )
}
