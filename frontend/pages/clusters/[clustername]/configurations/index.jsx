import { useParams } from 'next/navigation';

import { Anchor } from '@mantine/core';


import Link from 'next/link';

export default function Configurations() {

    const activeCluster = useParams()?.clustername;

    const workloads = [
        { label: 'Secrets', link: `/clusters/${activeCluster}/configurations/secrets`},
        { label: 'ConfigMaps', link: `/clusters/${activeCluster}/configurations/configmaps`},
        { label: 'Horizontal Pod Autoscalers', link: `/clusters/${activeCluster}/configurations/hpa`},
        { label: 'Priority Classes', link: `/clusters/${activeCluster}/configurations/priorityclasses`},
        { label: 'Runtime Classes', link: `/clusters/${activeCluster}/configurations/runtimeclasses`},
        { label: 'Pod Disruption Budgets', link: `/clusters/${activeCluster}/configurations/poddisruptionbudgets`} , 
    ];
    return (

        <>
            <div>
                <h1>Workloads</h1>
                <ul>
                    {workloads.map((workload) => (
                        <li>
                            <Anchor component={Link} href={workload.link}>{workload.label}</Anchor>
                        </li>
                    ))}
                </ul>
            </div>
        </>
    )
}