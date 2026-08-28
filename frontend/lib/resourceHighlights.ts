/**
 * Per-kind field triage for the resource detail view.
 *
 * The detail page previously rendered every field as an identically-weighted
 * card, so `Resource Version` and `Generation` competed for attention with
 * `Phase` and `Pod IP`. That is the opposite of what the page is for: you open it
 * because something looks wrong and you want the few facts that tell you what.
 *
 * Fields are sorted into three tiers:
 *   headline  - shown in the strip under the title; what you check first
 *   secondary - shown in the normal grid
 *   advanced  - collapsed by default; bookkeeping you occasionally need
 *
 * Anything not listed falls through to `secondary`, so a kind with no entry here
 * still renders everything and just loses the prioritisation.
 */

export type FieldTier = 'headline' | 'secondary' | 'advanced';

/**
 * Server-assigned bookkeeping. Rarely what you want when triaging, and it is the
 * bulk of the visual noise on the current page.
 */
const UNIVERSAL_ADVANCED = [
  'metadata.resourceVersion',
  'metadata.uid',
  'metadata.generation',
  'metadata.selfLink',
  'metadata.creationTimestamp',
  'metadata.managedFields',
  'metadata.finalizers',
  'metadata.ownerReferences',
];

type KindConfig = {
  headline: string[];
  advanced?: string[];
};

const KIND_CONFIG: Record<string, KindConfig> = {
  Pod: {
    // Where is it, is it up, and is it restarting -- the triage questions.
    headline: ['status.phase', 'status.podIP', 'spec.nodeName'],
    advanced: [
      'spec.dnsPolicy',
      'spec.preemptionPolicy',
      'spec.priority',
      'spec.schedulerName',
      'spec.terminationGracePeriodSeconds',
      'spec.restartPolicy',
      'spec.serviceAccountName',
      'status.hostIP',
      'status.qosClass',
    ],
  },

  Deployment: {
    headline: ['status.readyReplicas', 'spec.replicas', 'status.updatedReplicas'],
    advanced: [
      'spec.revisionHistoryLimit',
      'spec.progressDeadlineSeconds',
      'spec.strategy.rollingUpdate.maxSurge',
      'spec.strategy.rollingUpdate.maxUnavailable',
      'spec.minReadySeconds',
    ],
  },

  StatefulSet: {
    headline: ['status.readyReplicas', 'spec.replicas', 'spec.serviceName'],
    advanced: ['spec.revisionHistoryLimit', 'spec.podManagementPolicy', 'spec.updateStrategy.type'],
  },

  DaemonSet: {
    headline: ['status.numberReady', 'status.desiredNumberScheduled', 'status.numberUnavailable'],
    advanced: ['spec.revisionHistoryLimit', 'spec.updateStrategy.type'],
  },

  ReplicaSet: {
    headline: ['status.readyReplicas', 'spec.replicas'],
    advanced: ['spec.minReadySeconds'],
  },

  Service: {
    headline: ['spec.type', 'spec.clusterIP', 'spec.ports'],
    advanced: [
      'spec.sessionAffinity',
      'spec.ipFamilyPolicy',
      'spec.ipFamilies',
      'spec.internalTrafficPolicy',
      'spec.externalTrafficPolicy',
    ],
  },

  // Capacity and binding are the questions; the rest is provisioner detail.
  PersistentVolumeClaim: {
    headline: ['status.phase', 'status.capacity.storage', 'spec.storageClassName'],
    advanced: ['spec.volumeMode', 'spec.volumeName', 'spec.accessModes'],
  },

  PersistentVolume: {
    headline: ['status.phase', 'spec.capacity.storage', 'spec.storageClassName'],
    advanced: ['spec.volumeMode', 'spec.persistentVolumeReclaimPolicy', 'spec.accessModes'],
  },

  Node: {
    headline: ['status.nodeInfo.kubeletVersion', 'status.capacity.cpu', 'status.capacity.memory'],
    advanced: [
      'status.nodeInfo.osImage',
      'status.nodeInfo.kernelVersion',
      'status.nodeInfo.containerRuntimeVersion',
      'status.nodeInfo.architecture',
      'status.nodeInfo.bootID',
      'status.nodeInfo.machineID',
      'status.nodeInfo.systemUUID',
      'spec.podCIDR',
      'spec.providerID',
    ],
  },

  Job: {
    headline: ['status.succeeded', 'status.failed', 'status.active'],
    advanced: ['spec.backoffLimit', 'spec.completions', 'spec.parallelism', 'spec.ttlSecondsAfterFinished'],
  },

  CronJob: {
    headline: ['spec.schedule', 'spec.suspend', 'status.lastScheduleTime'],
    advanced: [
      'spec.concurrencyPolicy',
      'spec.successfulJobsHistoryLimit',
      'spec.failedJobsHistoryLimit',
      'spec.startingDeadlineSeconds',
    ],
  },

  Ingress: {
    headline: ['spec.ingressClassName', 'spec.rules', 'status.loadBalancer.ingress'],
  },

  // For a Secret/ConfigMap the data itself is the point, not the wrapper.
  Secret: { headline: ['type'] },
  ConfigMap: { headline: [] },
  StorageClass: {
    headline: ['provisioner', 'reclaimPolicy', 'volumeBindingMode'],
    advanced: ['allowVolumeExpansion', 'parameters'],
  },
};

/** Which tier a field belongs to for a given resource kind. */
export function fieldTier(kind: string | undefined, path: string): FieldTier {
  if (UNIVERSAL_ADVANCED.includes(path)) return 'advanced';

  const config = kind ? KIND_CONFIG[kind] : undefined;
  if (!config) return 'secondary';

  if (config.headline.includes(path)) return 'headline';
  if (config.advanced?.includes(path)) return 'advanced';
  return 'secondary';
}

/**
 * Split a column list into the three tiers, preserving each kind's declared
 * headline order so the strip reads consistently rather than in page order.
 */
export function partitionColumns<T extends { path: string }>(
  kind: string | undefined,
  columns: T[]
): { headline: T[]; secondary: T[]; advanced: T[] } {
  const headline: T[] = [];
  const secondary: T[] = [];
  const advanced: T[] = [];

  columns.forEach((column) => {
    const tier = fieldTier(kind, column.path);
    if (tier === 'headline') headline.push(column);
    else if (tier === 'advanced') advanced.push(column);
    else secondary.push(column);
  });

  const order = (kind && KIND_CONFIG[kind]?.headline) || [];
  headline.sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));

  return { headline, secondary, advanced };
}

/** Relative age from a timestamp, e.g. "8m", "3d". */
export function formatAge(timestamp: string | undefined): string {
  if (!timestamp) return '-';
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return '-';

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Ready/total container counts and total restarts for a pod.
 *
 * Restarts belong in the headline: a pod can report Running while crash-looping,
 * and the restart count is what reveals it.
 */
export function podReadiness(resource: any): {
  ready: number;
  total: number;
  restarts: number;
} | null {
  const statuses = resource?.status?.containerStatuses;
  if (!Array.isArray(statuses) || statuses.length === 0) return null;

  return {
    ready: statuses.filter((c: any) => c.ready).length,
    total: statuses.length,
    restarts: statuses.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0),
  };
}
