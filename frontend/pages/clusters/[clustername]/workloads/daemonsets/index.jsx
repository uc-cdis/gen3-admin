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

export default function DaemonSets() {
  const clusterName = useParams()?.clustername;

  return (
    <>
      <PageHeader title="DaemonSets" subtitle={clusterName} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/apps/v1/daemonsets`}
        fields={[
          namespaceColumn,
          nameColumn(clusterName, 'daemonsets'),
          // DaemonSets scale to the node count rather than a spec.replicas.
          readyColumn(
            (r) => r.status?.numberReady,
            (r) => r.status?.desiredNumberScheduled
          ),
          numberColumn('Up-to-date', (r) => r.status?.updatedNumberScheduled),
          numberColumn('Available', (r) => r.status?.numberAvailable),
          ageColumn(),
        ]}
      />
    </>
  );
}
