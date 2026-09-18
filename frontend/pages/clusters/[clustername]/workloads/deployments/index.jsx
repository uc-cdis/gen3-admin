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

export default function Deployments() {
  const clusterName = useParams()?.clustername;

  return (
    <>
      <PageHeader title="Deployments" subtitle={clusterName} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/apps/v1/deployments`}
        fields={[
          namespaceColumn,
          nameColumn(clusterName, 'deployments'),
          // Desired comes from spec, not status: during a scale-down
          // status.replicas still reports the old count, so using it as the
          // denominator made a shrinking deployment look unhealthy.
          readyColumn(
            (r) => r.status?.readyReplicas,
            (r) => r.spec?.replicas
          ),
          numberColumn('Up-to-date', (r) => r.status?.updatedReplicas),
          numberColumn('Available', (r) => r.status?.availableReplicas),
          ageColumn(),
        ]}
      />
    </>
  );
}
