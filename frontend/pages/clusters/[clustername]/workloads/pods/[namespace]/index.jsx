import DataTable from '@/components/DataTable/DataTable';
import { Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import {
  ageColumn,
  nameColumn,
  podReadyColumn,
  podRestartsColumn,
  podStatusColumn,
  usageColumns,
} from '@/lib/workloadColumns';

export default function NamespacedPods() {
  const clusterName = useParams()?.clustername;
  const namespace = useParams()?.namespace;

  return (
    <>
      <PageHeader title="Pods" subtitle={`${clusterName} / ${namespace}`} />
      <DataTable
        agent={clusterName}
        endpoint={`/api/v1/namespaces/${namespace}/pods`}
        metricsEndpoint={`/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods`}
        fields={[
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
          ...usageColumns(),
          ageColumn(),
        ]}
      />
    </>
  );
}
