import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Secret() {
    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.secret;

    return (
        <>
            <ResourceDetails
                cluster={clusterName}
                namespace={namespace}
                resource={resource} type="secret"
                tabs={["overview", "yaml", "events"]}
                url={`/api/v1/namespaces/${namespace}/secrets/${resource}`}
                columnDefinitions={[
                    { label: "Name", path: "metadata.name" },
                    { label: "Namespace", path: "metadata.namespace" },
                    { label: "Generate Name", path: "metadata.generateName" },
                    { label: "Creation Timestamp", path: "metadata.creationTimestamp" },
                    { label: "Resource Version", path: "metadata.resourceVersion" },
                    { label: "Self Link", path: "metadata.selfLink" },
                    { label: "UID", path: "metadata.uid" },
                    { label: "Type", path: "type" },
                ]}
            />
        </>
    )

}