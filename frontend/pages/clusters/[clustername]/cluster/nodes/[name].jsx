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
                type="Node"
                tabs={["overview", "yaml", "events"]}
                url={`/api/v1/nodes/${resource}`}
                columnConfig={{
                    layout: {
                        leftColumns: [
                            { label: "Name", path: "metadata.name" },
                            { label: "Age", path: "metadata.creationTimestamp" },
                            { label: "Kubelet Version", path: "status.nodeInfo.kubeletVersion" },
                            { label: "OS Image", path: "status.nodeInfo.osImage" },
                            { label: "Kernel Version", path: "status.nodeInfo.kernelVersion" },
                            { label: "Container Runtime", path: "status.nodeInfo.containerRuntimeVersion" },
                            { label: "Architecture", path: "status.nodeInfo.architecture" },
                            { label: "Operating System", path: "status.nodeInfo.operatingSystem" },
                        ],
                        rightColumns: [
                            { label: "Resource Version", path: "metadata.resourceVersion" },
                            { label: "UID", path: "metadata.uid" },
                            { label: "Phase", path: "status.phase" },
                            { label: "Boot ID", path: "status.nodeInfo.bootID" },
                            { label: "System UUID", path: "status.nodeInfo.systemUUID" },
                            { label: "Machine ID", path: "status.nodeInfo.machineID" },
                        ]
                    }
                }}
            />
        </>
    )
}
