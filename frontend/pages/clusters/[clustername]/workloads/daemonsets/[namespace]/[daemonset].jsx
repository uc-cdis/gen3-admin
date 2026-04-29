import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.daemonset;


    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="DaemonSet"
                tabs={["overview", "yaml", "events"]}
                url={`/apis/apps/v1/namespaces/${namespace}/daemonsets/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Desired", path: "status.desiredNumberScheduled" },
                            { label: "Current", path: "status.currentNumberScheduled" },
                            { label: "Ready", path: "status.numberReady" },
                            { label: "Updated", path: "status.updatedNumberScheduled" },
                            { label: "Available", path: "status.numberAvailable" },
                        ],
                        rightColumns: [
                            { label: "Selector", path: "spec.selector.matchLabels" },
                            { label: "Min Ready Seconds", path: "spec.minReadySeconds" },
                            { label: "Strategy Type", path: "spec.updateStrategy.type" },
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
