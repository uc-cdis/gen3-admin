import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.cronjob;


    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource}
                type="CronJob"
                tabs={["overview", "yaml", "events"]}
                url={`/apis/batch/v1/namespaces/${namespace}/cronjobs/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Namespace", path: "metadata.namespace" },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Schedule", path: "spec.schedule" },
                            { label: "Suspend", path: "spec.suspend" },
                            { label: "Concurrency Policy", path: "spec.concurrencyPolicy" },
                            { label: "Last Schedule", path: "status.lastScheduleTime" },
                        ],
                        rightColumns: [
                            { label: "Starting Deadline", path: "spec.startingDeadlineSeconds" },
                            { label: "Successful Jobs Hist. Limit", path: "spec.successfulJobsHistoryLimit" },
                            { label: "Failed Jobs Hist. Limit", path: "spec.failedJobsHistoryLimit" },
                            { label: "Job Parallelism", path: "spec.jobTemplate.spec.parallelism" },
                            { label: "Job Completions", path: "spec.jobTemplate.spec.completions" },
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                        ]
                    }
                }}
            />
        </>
    )
}
