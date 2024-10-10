import {callGoApi} from '@/lib/k8s';

import { useParams } from 'next/navigation';

import ResourceDetails from '@/components/ResourceDetails';

export default function Detail() {

    const clusterName = useParams()?.clustername;
    const namespace = useParams()?.namespace;
    const resource = useParams()?.configmap;


    return (
        <>
            <ResourceDetails cluster={clusterName} namespace={namespace} resource={resource} type="configmap" tabs={["overview", "data", "logs"]} url={`/api/v1/namespaces/${namespace}/configmaps/${resource}`} />
        </>
    )
}