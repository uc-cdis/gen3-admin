import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.pod;


    console.log("pod in detail page", resource)
    console.log("namespace in detail page", namespace)
    console.log("cluster in detail page", clusterName)

    return (
        <>
            <ResourceDetails 
                cluster={clusterName} 
                namespace={namespace} 
                resource={resource} 
                type="pod"
                tabs={["overview", "yaml", "events", "logs"]}
                url={`/api/v1/namespaces/${namespace}/pods/${resource}`} 
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Phase", path: "status.phase" },
                            { label: "Pod IP", path: "status.podIP" },
                            { label: "Node Name", path: "spec.nodeName" },
                            { label: "Priority", path: "spec.priority" },
                            { label: "Scheduler Name", path: "spec.schedulerName" },
                            { label: "Service Account", path: "spec.serviceAccountName" },
                        ],
                        rightColumns: [
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Generation", path: "metadata.generation" },
                            { label: "Host IP", path: "status.hostIP" },
                            { label: "DNS Policy", path: "spec.dnsPolicy" },
                            { label: "Preemption Policy", path: "spec.preemptionPolicy" },
                            { label: "Restart Policy", path: "spec.restartPolicy" },
                            { label: "Termination Grace Period", path: "spec.terminationGracePeriodSeconds" },
                        ]
                    }
                }}
            />
        </>
    )
}