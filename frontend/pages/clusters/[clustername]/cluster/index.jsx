import { useParams } from 'next/navigation';

import { Anchor } from '@mantine/core';

export default function Cluster() {

    const activeCluster = useParams()?.clustername;

    const workloads = [
        { label: 'Nodes', link: `/clusters/${activeCluster}/cluster/nodes`} , 
        { label: 'Namespaces', link: `/clusters/${activeCluster}/cluster/namespaces`},
    ];
    return (

        <>
            <div>
                <h1>Workloads</h1>
                <ul>
                    {workloads.map((workload) => (
                        <li>
                            <Anchor href={workload.link}>{workload.label}</Anchor>
                        </li>
                    ))}
                </ul>
            </div>
        </>
    )
}