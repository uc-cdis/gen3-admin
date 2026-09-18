import DataTable from '@/components/DataTable/DataTable';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import {
  ageColumn,
  nameColumn,
  numberColumn,
  readyColumn,
  scaleColumn,
} from '@/lib/workloadColumns';

export default function NamespacedStatefulSets() {
  const clusterName = useParams()?.clustername;
  const namespace = useParams()?.namespace;

  return (
    <>
      <PageHeader title="StatefulSets" subtitle={`${clusterName} / ${namespace}`} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/apps/v1/namespaces/${namespace}/statefulsets`}
        fields={[
          nameColumn(clusterName, 'statefulsets'),
          readyColumn(
            (r) => r.status?.readyReplicas,
            (r) => r.spec?.replicas
          ),
          numberColumn('Desired', (r) => r.spec?.replicas),
          ageColumn(),
          scaleColumn('StatefulSet', clusterName, (r) => r.spec?.replicas),
        ]}
      />
    </>
  );
}
