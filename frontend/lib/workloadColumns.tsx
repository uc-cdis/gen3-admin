import Link from 'next/link';
import { Anchor, Text } from '@mantine/core';

import { ReplicaBadge, StatusBadge } from '@/components/ui';
import ScaleControl from '@/components/ScaleControl';
import { formatAge } from '@/lib/resourceHighlights';

/**
 * Column builders shared by the workload list pages.
 *
 * Those pages were fourteen near-copies of the same table -- seven kinds, each
 * with a cluster-wide and a namespace-scoped variant -- and the copies had
 * drifted: the namespaced StatefulSets and ReplicaSets lost their Desired
 * column, Jobs lost Duration, CronJobs lost Last Schedule. Each also hand-rolled
 * its own status colours, so the two Pods pages disagreed with each other *and*
 * with lib/status.ts about what colour a Succeeded pod is.
 *
 * Defining each column once removes the drift by construction and routes every
 * status through the shared resolver.
 */

type Row = { original: any };

export const namespaceColumn = {
  key: 'metadata.namespace',
  label: 'Namespace',
};

/** Name, linking to the resource detail page for `kind`. */
export function nameColumn(clusterName: string | undefined, kind: string) {
  return {
    key: 'metadata.name',
    label: 'Name',
    render: ({ original }: Row) => (
      <Anchor
        component={Link}
        href={`/clusters/${clusterName}/workloads/${kind}/${original.metadata?.namespace}/${original.metadata?.name}`}
      >
        <Text fw={500}>{original.metadata?.name}</Text>
      </Anchor>
    ),
  };
}

/**
 * Ready as a status badge rather than plain text.
 *
 * `2/3` in grey tells you the numbers but not whether to care. ReplicaBadge
 * resolves the same pair through `resolveReplicaStatus`, which distinguishes
 * "scaled to zero on purpose" (neutral) from "no replicas available" (error)
 * from "still rolling out" (pending) -- the distinction that makes a list
 * scannable.
 */
export function readyColumn(
  readyOf: (r: any) => number | undefined,
  desiredOf: (r: any) => number | undefined
) {
  return {
    key: 'metadata.name',
    label: 'Ready',
    render: ({ original }: Row) => (
      <ReplicaBadge ready={readyOf(original) ?? 0} desired={desiredOf(original) ?? 0} size="sm" />
    ),
  };
}

/** A plain numeric cell, rendering '-' when the field is absent. */
export function numberColumn(label: string, valueOf: (r: any) => number | undefined) {
  return {
    key: 'metadata.name',
    label,
    render: ({ original }: Row) => {
      const value = valueOf(original);
      return <Text>{value ?? '-'}</Text>;
    },
  };
}

/**
 * Relative age from a timestamp.
 *
 * Reads `original` rather than the row's stringified value. The previous form,
 * `render: ({ Age }) => calculateAge(Age)`, worked only because the row object
 * is keyed by column *label* -- renaming the column to "Created" would have
 * silently produced "NaNd" on every row.
 */
export function ageColumn(label = 'Age', pathOf: (r: any) => string | undefined = (r) => r?.metadata?.creationTimestamp) {
  return {
    key: 'metadata.creationTimestamp',
    label,
    render: ({ original }: Row) => <Text>{formatAge(pathOf(original))}</Text>,
  };
}

/** Pod phase, with the container reason that a bare phase hides. */
export function podStatusColumn() {
  return {
    key: 'status.phase',
    label: 'Status',
    render: ({ original }: Row) => {
      const containers = original.status?.containerStatuses ?? [];
      // A crash-looping pod still reports phase=Running; the reason is the
      // only place that shows up.
      const reason =
        containers.find((c: any) => c?.state?.waiting?.reason)?.state?.waiting?.reason ??
        containers.find((c: any) => c?.state?.terminated?.reason)?.state?.terminated?.reason;
      const ready = containers.length > 0 && containers.every((c: any) => c?.ready);

      return (
        <StatusBadge
          domain="pod"
          value={original.status?.phase}
          reason={reason}
          ready={ready}
          size="sm"
        />
      );
    },
  };
}

/** Container readiness for a pod, as ready/total. */
export function podReadyColumn() {
  return {
    key: 'metadata.name',
    label: 'Ready',
    render: ({ original }: Row) => {
      const containers = original.status?.containerStatuses ?? [];
      const ready = containers.filter((c: any) => c?.ready).length;
      return <ReplicaBadge ready={ready} desired={containers.length} size="sm" />;
    },
  };
}

/**
 * Total container restarts.
 *
 * Surfaced because phase alone hides a crash loop: a pod restarting every
 * thirty seconds reads as `Running` until you open it.
 */
export function podRestartsColumn() {
  return {
    key: 'metadata.name',
    label: 'Restarts',
    render: ({ original }: Row) => {
      const restarts = (original.status?.containerStatuses ?? []).reduce(
        (sum: number, c: any) => sum + (c?.restartCount ?? 0),
        0
      );
      if (!restarts) return <Text c="dimmed">0</Text>;
      return (
        <Text c={restarts > 5 ? 'statusError' : 'statusWarn'} fw={600}>
          {restarts}
        </Text>
      );
    },
  };
}

/** Job completions, as succeeded/desired. */
export function jobStatusColumn() {
  return {
    key: 'metadata.name',
    label: 'Status',
    render: ({ original }: Row) => {
      const conditions = original.status?.conditions ?? [];
      const active = original.status?.active ?? 0;

      // Conditions carry the terminal answer; `active` covers the run itself.
      const failed = conditions.find((c: any) => c?.type === 'Failed' && c?.status === 'True');
      if (failed) {
        return <StatusBadge domain="job" value="failed" reason={failed.reason} size="sm" />;
      }
      const complete = conditions.find((c: any) => c?.type === 'Complete' && c?.status === 'True');
      if (complete) return <StatusBadge domain="job" value="complete" size="sm" />;
      if (active > 0) return <StatusBadge domain="job" value="active" size="sm" />;

      // Neither running nor finished: suspended if asked for, otherwise a job
      // that has not been scheduled yet.
      const suspended = original.spec?.suspend === true;
      return <StatusBadge domain="job" value={suspended ? 'suspended' : 'unknown'} size="sm" />;
    },
  };
}

/**
 * How long a job ran, from start to completion.
 *
 * A job still running is measured against now, so the cell ticks up rather
 * than reading '-' for the entire run.
 */
export function formatDuration(startTime?: string, completionTime?: string): string {
  if (!startTime) return '-';

  const start = new Date(startTime).getTime();
  if (Number.isNaN(start)) return '-';

  const end = completionTime ? new Date(completionTime).getTime() : Date.now();
  if (Number.isNaN(end)) return '-';

  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Editable replica count.
 *
 * Labelled now that the cell is an input showing the desired count rather
 * than a button: the column holds a value you can change, so a heading is
 * accurate.
 */
export function scaleColumn(kind: string, clusterName: string | undefined, desiredOf: (r: any) => number | undefined) {
  return {
    key: 'metadata.name',
    label: 'Replicas',
    render: ({ original }: Row) => (
      <ScaleControl
        compact
        kind={kind}
        namespace={original.metadata?.namespace}
        name={original.metadata?.name}
        cluster={clusterName}
        current={desiredOf(original)}
      />
    ),
  };
}

/**
 * CPU and memory, from the metrics endpoint.
 *
 * These read from the row rather than `original`: DataTable merges the
 * summarised usage onto the row by name, so there is nothing on the
 * Kubernetes object itself to read. Renders a dash when metrics-server is not
 * installed, which is common enough that it must not look like an error.
 */
export function usageColumns() {
  return [
    {
      key: 'cpu',
      label: 'cpu',
      render: (row: any) => <Text c={row.cpu ? undefined : 'dimmed'}>{row.cpu ?? '-'}</Text>,
    },
    {
      key: 'memory',
      label: 'memory',
      render: (row: any) => <Text c={row.memory ? undefined : 'dimmed'}>{row.memory ?? '-'}</Text>,
    },
  ];
}
