import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.job;

    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="Job"
                tabs={["overview", "yaml", "events"]}
                url={`/apis/batch/v1/namespaces/${namespace}/jobs/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Completions", path: "spec.completions" },
                            { label: "Parallelism", path: "spec.parallelism" },
                            { label: "Succeeded", path: "status.succeeded" },
                            { label: "Failed", path: "status.failed" },
                            { label: "Active", path: "status.active" },
                        ],
                        rightColumns: [
                            { label: "Start Time", path: "status.startTime" },
                            { label: "Completion Time", path: "status.completionTime" },
                            { label: "Backoff Limit", path: "spec.backoffLimit" },
                            { label: "Active Deadline", path: "spec.activeDeadlineSeconds" },
                            { label: "TTL After Finished", path: "spec.ttlSecondsAfterFinished" },
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                        ]
                    }
                }}
            />
        </>
    )
}
