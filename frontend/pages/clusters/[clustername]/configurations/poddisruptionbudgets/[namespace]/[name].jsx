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
                type="PodDisruptionBudget"
                tabs={["overview", "yaml", "events"]}
                url={`/apis/policy/v1/namespaces/${namespace}/poddisruptionbudgets/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Min Available", path: "spec.minAvailable" },
                            { label: "Max Unavailable", path: "spec.maxUnavailable" },
                            { label: "Current Healthy", path: "status.currentHealthy" },
                            { label: "Desired Healthy", path: "status.desiredHealthy" },
                            { label: "Disruptions Allowed", path: "status.disruptionsAllowed" },
                            { label: "Expected Pods", path: "status.expectedPods" },
                        ],
                        rightColumns: [
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                        ]
                    }
                }}
            />
        </>
    )
}
