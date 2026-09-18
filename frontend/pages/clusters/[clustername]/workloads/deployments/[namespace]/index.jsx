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

export default function NamespacedDeployments() {
  const clusterName = useParams()?.clustername;
  const namespace = useParams()?.namespace;

  return (
    <>
      <PageHeader title="Deployments" subtitle={`${clusterName} / ${namespace}`} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/apps/v1/namespaces/${namespace}/deployments`}
        fields={[
          nameColumn(clusterName, 'deployments'),
          readyColumn(
            (r) => r.status?.readyReplicas,
            (r) => r.spec?.replicas
          ),
          numberColumn('Up-to-date', (r) => r.status?.updatedReplicas),
          numberColumn('Available', (r) => r.status?.availableReplicas),
          ageColumn(),
          scaleColumn('Deployment', clusterName, (r) => r.spec?.replicas),
        ]}
      />
    </>
  );
}
