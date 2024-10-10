import { useParams } from 'next/navigation';

import { Anchor } from '@mantine/core';

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
                            <Anchor href={workload.link}>{workload.label}</Anchor>
                        </li>
                    ))}
                </ul>
            </div>
        </>
    )
}