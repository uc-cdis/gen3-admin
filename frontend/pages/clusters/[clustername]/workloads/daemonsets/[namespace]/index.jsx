import DataTable from '@/components/DataTable/DataTable';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import {
  ageColumn,
  nameColumn,
  numberColumn,
  readyColumn,
} from '@/lib/workloadColumns';

export default function NamespacedDaemonSets() {
  const clusterName = useParams()?.clustername;
  const namespace = useParams()?.namespace;

  return (
    <>
      <PageHeader title="DaemonSets" subtitle={`${clusterName} / ${namespace}`} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/apps/v1/namespaces/${namespace}/daemonsets`}
        fields={[
          nameColumn(clusterName, 'daemonsets'),
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
