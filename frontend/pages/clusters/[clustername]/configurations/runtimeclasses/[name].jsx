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
                type="RuntimeClass"
                tabs={["overview", "yaml"]}
                url={`/apis/node.k8s.io/v1/runtimeclasses/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Handler", path: "handler" },
                            { label: "Created", path: "metadata.creationTimestamp" },
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
