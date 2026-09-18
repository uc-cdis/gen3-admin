/**
 * What a workload's pods are doing right now.
 *
 * The services dashboard already lists every pod in the namespace on each
 * refresh, then throws almost all of it away: `podReasonByOwner` keeps a
 * single representative failure reason per workload and nothing else. So a
 * card could say "0 up" and "STOPPED" while two pods were visibly pulling an
 * image, and scaling from 0 to 2 left the card frozen until the numbers
 * happened to land.
 *
 * Summarising the same pods costs no extra requests.
 */

export type RolloutPhase =
  | 'stopped' // desired 0 -- deliberate, not an outage
  | 'ready' // everything up
  | 'pulling' // fetching images
  | 'starting' // containers created, not yet ready
  | 'pending' // not scheduled yet
  | 'failing' // crash loops, image pull failures
  | 'terminating'; // scaling down

export type RolloutState = {
  phase: RolloutPhase;
  /** Short sentence for the card: "1 pulling image". '' when settled. */
  detail: string;
  ready: number;
  desired: number;
  /** True while the pods have not reached the desired state. */
  converging: boolean;
};

/** Reasons that mean a pod will not recover without intervention. */
const FAILING = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'CreateContainerError',
  'InvalidImageName',
  'OOMKilled',
  'Evicted',
]);

/** Reasons that are a normal part of starting up. */
const PULLING = new Set(['Pulling', 'ContainerCreating']);

type ContainerState = { reason?: string; ready?: boolean };

function containerStates(pod: any): ContainerState[] {
  const all = [
    ...(pod?.status?.initContainerStatuses || []),
    ...(pod?.status?.containerStatuses || []),
  ];
  return all.map((c: any) => ({
    reason: c?.state?.waiting?.reason || c?.state?.terminated?.reason,
    ready: c?.ready === true,
  }));
}

/**
 * Summarise a workload from its pods.
 *
 * `desired` comes from the spec rather than the pod count, so a scale-up is
 * reflected the instant it is applied -- before any new pod exists.
 */
export function summarizeRollout(
  pods: any[] | undefined,
  desired: number,
  ready: number
): RolloutState {
  // Defensive: callers pass a field off a captured object that may predate
  // it. Treating "no list" as "no pods" is right anyway -- it degrades to
  // the replica counts rather than throwing.
  const list = Array.isArray(pods) ? pods : [];
  const base = { ready, desired };

  if (desired === 0) {
    // Nothing is meant to be running. Terminating pods are the tail of a
    // scale-down and worth saying, since the card is otherwise silent.
    const terminating = list.filter((p) => p?.metadata?.deletionTimestamp).length;
    return {
      ...base,
      phase: terminating > 0 ? 'terminating' : 'stopped',
      detail: terminating > 0 ? `${terminating} shutting down` : '',
      converging: terminating > 0,
    };
  }

  let pulling = 0;
  let starting = 0;
  let pendingCount = 0;
  let failing = 0;
  let failReason = '';

  for (const pod of list) {
    if (pod?.metadata?.deletionTimestamp) continue;

    const phase = pod?.status?.phase;
    const states = containerStates(pod);
    const reason = states.find((s) => s.reason && FAILING.has(s.reason))?.reason;

    if (reason) {
      failing += 1;
      failReason = failReason || reason;
      continue;
    }
    if (states.some((s) => s.reason && PULLING.has(s.reason))) {
      pulling += 1;
      continue;
    }
    if (phase === 'Pending') {
      pendingCount += 1;
      continue;
    }
    // Running but not every container ready: started, still failing probes.
    if (phase === 'Running' && states.some((s) => !s.ready)) starting += 1;
  }

  // Ordered by what the reader most needs to know: a failure outranks
  // progress, and progress outranks a settled count.
  if (failing > 0) {
    return {
      ...base,
      phase: 'failing',
      detail: failReason ? `${failing} ${humanize(failReason)}` : `${failing} failing`,
      converging: false, // will not resolve on its own
    };
  }
  if (pulling > 0) {
    return { ...base, phase: 'pulling', detail: plural(pulling, 'pulling image'), converging: true };
  }
  if (pendingCount > 0) {
    return { ...base, phase: 'pending', detail: plural(pendingCount, 'scheduling'), converging: true };
  }
  if (starting > 0) {
    return { ...base, phase: 'starting', detail: plural(starting, 'starting'), converging: true };
  }
  if (ready < desired) {
    return { ...base, phase: 'starting', detail: `${desired - ready} to go`, converging: true };
  }

  return { ...base, phase: 'ready', detail: '', converging: false };
}

function plural(n: number, label: string): string {
  return `${n} ${label}`;
}

/** CrashLoopBackOff -> "crash looping", ImagePullBackOff -> "image pull failed". */
function humanize(reason: string): string {
  switch (reason) {
    case 'CrashLoopBackOff':
      return 'crash looping';
    case 'ImagePullBackOff':
    case 'ErrImagePull':
      return 'image pull failed';
    case 'OOMKilled':
      return 'out of memory';
    case 'Evicted':
      return 'evicted';
    default:
      // Split camel case so an unmapped reason still reads as words.
      return reason.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }
}

/** Colour token for a phase, from the theme's status ramps. */
export function rolloutColor(phase: RolloutPhase): string {
  switch (phase) {
    case 'ready':
      return 'statusOk';
    case 'failing':
      return 'statusError';
    case 'pulling':
    case 'starting':
    case 'pending':
    case 'terminating':
      return 'statusPending';
    case 'stopped':
    default:
      return 'statusNeutral';
  }
}

/** Short label for the badge. */
export function rolloutLabel(phase: RolloutPhase): string {
  switch (phase) {
    case 'ready':
      return 'Healthy';
    case 'failing':
      return 'Failing';
    case 'pulling':
      return 'Pulling';
    case 'starting':
      return 'Starting';
    case 'pending':
      return 'Pending';
    case 'terminating':
      return 'Stopping';
    case 'stopped':
    default:
      return 'Stopped';
  }
}

/**
 * Live CPU and memory for a set of pods, from metrics.k8s.io.
 *
 * The API reports per container, in nanocores/millicores and Ki/Mi/Gi, so a
 * per-workload figure means parsing those suffixes and summing. Returns null
 * when there is nothing to report -- metrics-server is often not installed,
 * and a missing reading must render as absent rather than as zero, which
 * would look like an idle service.
 */
export type Usage = { cpuMillis: number; memoryMiB: number };

export function parseCpu(value: string | undefined): number {
  if (!value) return 0;
  const raw = String(value);
  if (raw.endsWith('n')) return parseInt(raw, 10) / 1_000_000;
  if (raw.endsWith('u')) return parseInt(raw, 10) / 1_000;
  if (raw.endsWith('m')) return parseInt(raw, 10);
  return parseFloat(raw) * 1000;
}

export function parseMemory(value: string | undefined): number {
  if (!value) return 0;
  const raw = String(value);
  const num = parseFloat(raw);
  if (Number.isNaN(num)) return 0;
  if (raw.endsWith('Ki')) return num / 1024;
  if (raw.endsWith('Mi')) return num;
  if (raw.endsWith('Gi')) return num * 1024;
  if (raw.endsWith('Ti')) return num * 1024 * 1024;
  return num / (1024 * 1024); // bare bytes
}

export function sumUsage(podMetrics: any[] | undefined): Usage | null {
  if (!Array.isArray(podMetrics) || podMetrics.length === 0) return null;

  let cpuMillis = 0;
  let memoryMiB = 0;
  for (const pod of podMetrics) {
    for (const c of pod?.containers ?? []) {
      cpuMillis += parseCpu(c?.usage?.cpu);
      memoryMiB += parseMemory(c?.usage?.memory);
    }
  }
  return { cpuMillis, memoryMiB };
}

/** Compact rendering: "12m" / "1.2" cores, "101Mi" / "1.4Gi". */
export function formatCpu(cpuMillis: number): string {
  if (cpuMillis >= 1000) return `${(cpuMillis / 1000).toFixed(1)}`;
  if (cpuMillis >= 1) return `${Math.round(cpuMillis)}m`;
  // Below a millicore, round up rather than to zero: a service using
  // something should not read as using nothing.
  return cpuMillis > 0 ? '<1m' : '0';
}

export function formatMemory(memoryMiB: number): string {
  if (memoryMiB >= 1024) return `${(memoryMiB / 1024).toFixed(1)}Gi`;
  return `${Math.round(memoryMiB)}Mi`;
}
