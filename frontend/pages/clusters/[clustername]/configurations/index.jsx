import { useParams } from 'next/navigation';

import { Anchor } from '@mantine/core';

export default function Configurations() {

    const activeCluster = useParams()?.clustername;

    const workloads = [
        { label: 'PodDisruptionBudgets', link: `/clusters/${activeCluster}/configurations/poddisruptionbudgets`} , 
        { label: 'ConfigMaps', link: `/clusters/${activeCluster}/configurations/configmaps`},
        { label: 'Secrets', link: `/clusters/${activeCluster}/configurations/secrets`},
        { label: 'PriorityClasses', link: `/clusters/${activeCluster}/configurations/priorityclasses`},
        { label: 'RuntimeClasses', link: `/clusters/${activeCluster}/configurations/runtimeclasses`},
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