import DataTable from '@/components/DataTable/DataTable';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import {
  ageColumn,
  nameColumn,
  numberColumn,
  readyColumn,
} from '@/lib/workloadColumns';

export default function NamespacedReplicaSets() {
  const clusterName = useParams()?.clustername;
  const namespace = useParams()?.namespace;

  return (
    <>
      <PageHeader title="ReplicaSets" subtitle={`${clusterName} / ${namespace}`} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/apps/v1/namespaces/${namespace}/replicasets`}
        fields={[
          nameColumn(clusterName, 'replicasets'),
          readyColumn(
            (r) => r.status?.readyReplicas,
            (r) => r.spec?.replicas
          ),
          numberColumn('Desired', (r) => r.spec?.replicas),
          ageColumn(),
        ]}
      />
    </>
  );
}
