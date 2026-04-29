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
                type="ClusterRoleBinding"
                tabs={["overview", "yaml"]}
                url={`/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Role Ref Kind", path: "roleRef.kind" },
                            { label: "Role Ref Name", path: "roleRef.name" },
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
