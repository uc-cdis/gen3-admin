import DataTable from '@/components/DataTable/DataTable';

import { Badge, Anchor} from '@mantine/core';

import { useParams } from 'next/navigation';

import calculateAge from '@/utils/calculateAge';


export default function Dep() {
    const clusterName = useParams()?.clustername;

    console.log("clustername", clusterName)
    return (
        <>
            <DataTable
                agent={clusterName}
                endpoint={`/apis/rbac.authorization.k8s.io/v1/roles`}
                fields = {[
                    { key: "metadata.namespace", label: "Namespace" },
                    { key: "metadata.name", label: "Name", render: ({ Name, Namespace }) => (<Anchor href={`/clusters/${clusterName}/access-control/serviceaccounts/${Namespace}/${Name}`}>{Name}</Anchor>) },
                    { key: "rules", label: "Rules", render: ({ Rules }) => Rules.map(rule => `${rule.apiGroups.join(', ')}/${rule.resources.join(', ')}/${rule.verbs.join(', ')}`).join(', ') },
                    { key: "metadata.creationTimestamp", label: "Age", render: ({ Age }) => calculateAge(Age) },
                  ]}
            />
        </>
    )
}