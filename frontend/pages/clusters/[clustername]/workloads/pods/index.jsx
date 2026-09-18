import DataTable from '@/components/DataTable/DataTable';
import { Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import {
  ageColumn,
  nameColumn,
  namespaceColumn,
  podReadyColumn,
  podRestartsColumn,
  podStatusColumn,
} from '@/lib/workloadColumns';

export default function Pods() {
  const clusterName = useParams()?.clustername;

  return (
    <>
      <PageHeader title="Pods" subtitle={clusterName} />
      <DataTable
        agent={clusterName}
        endpoint={`/api/v1/pods`}
        metricsEndpoint={`/apis/metrics.k8s.io/v1beta1/pods`}
        fields={[
          namespaceColumn,
          nameColumn(clusterName, 'pods'),
          podStatusColumn(),
          podReadyColumn(),
          podRestartsColumn(),
          {
            key: 'status.podIP',
            label: 'IP',
            render: ({ original }) => <Text>{original.status?.podIP ?? '-'}</Text>,
          },
          {
            key: 'spec.nodeName',
            label: 'Node',
            render: ({ original }) => <Text>{original.spec?.nodeName ?? '-'}</Text>,
          },
          ageColumn(),
        ]}
      />
    </>
  );
}
