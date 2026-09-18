import DataTable from '@/components/DataTable/DataTable';
import { Text } from '@mantine/core';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/ui';
import {
  ageColumn,
  formatDuration,
  jobStatusColumn,
  nameColumn,
  namespaceColumn,
} from '@/lib/workloadColumns';

export default function Jobs() {
  const clusterName = useParams()?.clustername;

  return (
    <>
      <PageHeader title="Jobs" subtitle={clusterName} />
      <DataTable
        agent={clusterName}
        endpoint={`/apis/batch/v1/jobs`}
        fields={[
          namespaceColumn,
          nameColumn(clusterName, 'jobs'),
          jobStatusColumn(),
          {
            key: 'metadata.name',
            label: 'Completions',
            render: ({ original }) => (
              <Text>{`${original.status?.succeeded || 0}/${original.spec?.completions || 1}`}</Text>
            ),
          },
          {
            key: 'metadata.name',
            label: 'Duration',
            render: ({ original }) => (
              <Text>
                {formatDuration(original.status?.startTime, original.status?.completionTime)}
              </Text>
            ),
          },
          ageColumn(),
        ]}
      />
    </>
  );
}
