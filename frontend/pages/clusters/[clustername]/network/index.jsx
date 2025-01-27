import { useParams } from 'next/navigation';

import { Anchor } from '@mantine/core';

import Link from 'next/link'

export default function Network() {

    const activeCluster = useParams()?.clustername;

    const workloads = [
        { label: 'Ingresses', link: `/clusters/${activeCluster}/network/ingresses`} , 
        { label: 'Services', link: `/clusters/${activeCluster}/network/services`},
        { label: 'Endpoints', link: `/clusters/${activeCluster}/network/endpoints`},
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