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
                type="Deployment"
                tabs={["overview", "yaml", "events"]}
                url={`/apis/apps/v1/namespaces/${namespace}/deployments/${resource}`} 
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Strategy Type", path: "spec.strategy.type" },
                            { label: "Max Unavailable", path: "spec.strategy.rollingUpdate.maxUnavailable" },
                            { label: "Max Surge", path: "spec.strategy.rollingUpdate.maxSurge" },

                        ],
                        rightColumns: [
                            { label: "Selector", path: "spec.selector.matchLabels.app" },
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Generation", path: "metadata.generation" },
                            { label: "Host IP", path: "status.hostIP" },
                        ]
                    }
                }}
            />
        </>
    )
}