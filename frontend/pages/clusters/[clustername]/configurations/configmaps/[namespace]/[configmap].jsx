import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.configmap;
    console.log("+++++++++++++++",`/api/v1/namespaces/${namespace}/configmaps/${resource}`)


    return (
        <>
            <ResourceDetails 
                cluster={clusterName} 
                namespace={namespace}
                resource={resource}
                type="configmap" 
                tabs={["overview", "yaml"]}
                url={`/api/v1/namespaces/${namespace}/configmaps/${resource}`} 
                columnDefinitions={[
                    { label: "Name", path: "metadata.name" },
                    { label: "Namespace", path: "metadata.namespace" },
                    { label: "Creation Timestamp", path: "metadata.creationTimestamp" },
                    { label: "Resource Version", path: "metadata.resourceVersion" },
                    { label: "Self Link", path: "metadata.selfLink" },
                    { label: "UID", path: "metadata.uid" },
                ]}
            />
        </>
    )
}