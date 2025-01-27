import { useParams } from 'next/navigation';

import { Anchor } from '@mantine/core';

import Link from 'next/link'

export default function Workloads() {

    const activeCluster = useParams()?.clustername;

    const workloads = [
        { label: 'Pods', link: `/clusters/${activeCluster}/workloads/pods`} , 
        { label: 'Deployments', link: `/clusters/${activeCluster}/workloads/deployments`},
        { label: 'DaemonSets', link: `/clusters/${activeCluster}/workloads/daemonsets`},
        { label: 'StatefulSets', link: `/clusters/${activeCluster}/workloads/statefulsets`},
        { label: 'ReplicaSets', link: `/clusters/${activeCluster}/workloads/replicasets`},
        { label: 'Jobs', link: `/clusters/${activeCluster}/workloads/jobs`},
        { label: 'CronJobs', link: `/clusters/${activeCluster}/workloads/cronjobs`},
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