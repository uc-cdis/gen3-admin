import { useParams } from 'next/navigation';

import { Anchor } from '@mantine/core';

export default function Storage() {

    const activeCluster = useParams()?.clustername;

    const workloads = [
        { label: 'Persistent Volumes', link: `/clusters/${activeCluster}/storage/persistentvolumes`} , 
        { label: 'Persistent Volume Claims', link: `/clusters/${activeCluster}/storage/persistentvolumeclaims`},
        { label: 'Storage Classes', link: `/clusters/${activeCluster}/storage/storageclasses`},
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