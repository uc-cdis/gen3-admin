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
                type="StatefulSet"
                tabs={["overview", "yaml", "events"]}
                url={`/apis/apps/v1/namespaces/${namespace}/statefulsets/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Replicas", path: "spec.replicas" },
                            { label: "Ready", path: "status.readyReplicas" },
                            { label: "Current", path: "status.currentReplicas" },
                            { label: "Updated", path: "status.updatedReplicas" },
                            { label: "Available", path: "status.availableReplicas" },
                        ],
                        rightColumns: [
                            { label: "Service Name", path: "spec.serviceName" },
                            { label: "Pod Mgmt Policy", path: "spec.podManagementPolicy" },
                            { label: "Update Strategy", path: "spec.updateStrategy.type" },
                            { label: "Selector", path: "spec.selector.matchLabels" },
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Generation", path: "metadata.generation" },
                        ]
                    }
                }}
            />
        </>
    )
}
