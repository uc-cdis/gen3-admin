import DataTable from '@/components/DataTable/DataTable';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import {
  ageColumn,
  nameColumn,
  namespaceColumn,
  numberColumn,
  readyColumn,
} from '@/lib/workloadColumns';

export default function StatefulSets() {
  const clusterName = useParams()?.clustername;

  return (
    <>
      <PageHeader title="StatefulSets" subtitle={clusterName} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/apps/v1/statefulsets`}
        fields={[
          namespaceColumn,
          nameColumn(clusterName, 'statefulsets'),
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
