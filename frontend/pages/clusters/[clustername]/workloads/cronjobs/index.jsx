import DataTable from '@/components/DataTable/DataTable';
import { Badge, Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import { ageColumn, nameColumn, namespaceColumn } from '@/lib/workloadColumns';
import { formatAge } from '@/lib/resourceHighlights';

export default function CronJobs() {
  const clusterName = useParams()?.clustername;

  return (
    <>
      <PageHeader title="CronJobs" subtitle={clusterName} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/batch/v1/cronjobs`}
        fields={[
          namespaceColumn,
          nameColumn(clusterName, 'cronjobs'),
          {
            key: 'spec.schedule',
            label: 'Schedule',
            render: ({ original }) => <Text ff="monospace">{original.spec?.schedule ?? '-'}</Text>,
          },
          {
            key: 'metadata.name',
            label: 'Suspend',
            render: ({ original }) =>
              original.spec?.suspend ? (
                <Badge color="statusWarn" size="sm">
                  Suspended
                </Badge>
              ) : (
                <Badge color="statusOk" size="sm">
                  Active
                </Badge>
              ),
          },
          {
            key: 'metadata.name',
            label: 'Last Schedule',
            render: ({ original }) => <Text>{formatAge(original.status?.lastScheduleTime)}</Text>,
          },
          ageColumn(),
        ]}
      />
    </>
  );
}
