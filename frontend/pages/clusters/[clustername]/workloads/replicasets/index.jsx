import DataTable from '@/components/DataTable/DataTable';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import {
  ageColumn,
  nameColumn,
  namespaceColumn,
  numberColumn,
  readyColumn,
  scaleColumn,
} from '@/lib/workloadColumns';

export default function ReplicaSets() {
  const clusterName = useParams()?.clustername;

  return (
    <>
      <PageHeader title="ReplicaSets" subtitle={clusterName} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/apps/v1/replicasets`}
        fields={[
          namespaceColumn,
          nameColumn(clusterName, 'replicasets'),
          readyColumn(
            (r) => r.status?.readyReplicas,
            (r) => r.spec?.replicas
          ),
          numberColumn('Desired', (r) => r.spec?.replicas),
          ageColumn(),
          scaleColumn('ReplicaSet', clusterName, (r) => r.spec?.replicas),
        ]}
      />
    </>
  );
}
