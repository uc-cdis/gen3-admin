/**
 * Single source of truth for status -> color/label mapping.
 *
 * Before this existed the same logic was reimplemented in 14 files under four
 * different names (`statusColor`, `getStatusColor`, `getBadgeColor`,
 * `getStatusInfo`), and they disagreed: a Succeeded pod was gray in one place,
 * blue in another and teal in a third. Pages should not map status to color
 * themselves -- use <StatusBadge domain=... value=... /> instead.
 *
 * Adding a status: extend the relevant domain's table. Adding a new kind of
 * thing: add a domain. Never add a `color` prop to a caller.
 */

/** Semantic tone. Maps onto the `status*` color ramps in theme.ts. */
export type StatusTone = 'ok' | 'warn' | 'error' | 'info' | 'pending' | 'neutral';

export type StatusDomain =
  | 'pod' // k8s pod phase (+ container waiting reasons)
  | 'pvc' // PersistentVolumeClaim / PersistentVolume phase
  | 'node' // node Ready condition
  | 'helm' // helm release status
  | 'argoSync' // ArgoCD sync status
  | 'argoHealth' // ArgoCD health status
  | 'argoOp' // ArgoCD operation phase
  | 'job' // Job / CronJob outcome
  | 'condition' // generic k8s condition True/False/Unknown
  | 'generic'; // ready/enabled/connected style booleans and free text

export type StatusDescriptor = {
  tone: StatusTone;
  /** Display text, humanised from the raw value. */
  label: string;
  /** Mantine color key resolved from the tone. */
  color: string;
  /** Longer explanation, suitable for a tooltip. */
  description?: string;
};

const TONE_COLORS: Record<StatusTone, string> = {
  ok: 'statusOk',
  warn: 'statusWarn',
  error: 'statusError',
  info: 'statusInfo',
  pending: 'statusPending',
  neutral: 'statusNeutral',
};

type Entry = { tone: StatusTone; label?: string; description?: string };

/** Normalise so 'OutOfSync', 'outofsync' and 'out-of-sync' all match. */
function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Container waiting/terminated reasons that mean "actively broken", not merely
 * "not started yet". Sourced from the classification in CoreServicesOverview,
 * which was the most complete version in the codebase.
 */
const FAILING_REASONS = new Set([
  'crashloopbackoff',
  'imagepullbackoff',
  'errimagepull',
  'createcontainererror',
  'createcontainerconfigerror',
  'invalidimagename',
  'cannotruncontainer',
  'runcontainererror',
  'oomkilled',
  'error',
  'evicted',
  'deadlineexceeded',
]);

/** Reasons that are transient and expected during startup. */
const TRANSITIONAL_REASONS = new Set([
  'containercreating',
  'podinitializing',
  'pending',
  'terminating',
  'contaienrcreating',
]);

const DOMAINS: Record<StatusDomain, Record<string, Entry>> = {
  pod: {
    running: { tone: 'ok', label: 'Running' },
    ready: { tone: 'ok', label: 'Ready' },
    // Finished successfully. Deliberately `info` rather than ok/neutral: it is a
    // normal terminal state, not an active-and-healthy one.
    succeeded: { tone: 'info', label: 'Succeeded' },
    completed: { tone: 'info', label: 'Completed' },
    pending: { tone: 'pending', label: 'Pending' },
    containercreating: { tone: 'pending', label: 'ContainerCreating' },
    podinitializing: { tone: 'pending', label: 'PodInitializing' },
    terminating: { tone: 'pending', label: 'Terminating' },
    failed: { tone: 'error', label: 'Failed' },
    error: { tone: 'error', label: 'Error' },
    crashloopbackoff: { tone: 'error', label: 'CrashLoopBackOff' },
    imagepullbackoff: { tone: 'error', label: 'ImagePullBackOff' },
    errimagepull: { tone: 'error', label: 'ErrImagePull' },
    oomkilled: { tone: 'error', label: 'OOMKilled' },
    evicted: { tone: 'error', label: 'Evicted' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  pvc: {
    bound: { tone: 'ok', label: 'Bound' },
    available: { tone: 'ok', label: 'Available' },
    pending: { tone: 'pending', label: 'Pending' },
    released: { tone: 'warn', label: 'Released' },
    failed: { tone: 'error', label: 'Failed' },
    lost: { tone: 'error', label: 'Lost' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  node: {
    ready: { tone: 'ok', label: 'Ready' },
    true: { tone: 'ok', label: 'Ready' },
    notready: { tone: 'error', label: 'NotReady' },
    false: { tone: 'error', label: 'NotReady' },
    schedulingdisabled: { tone: 'warn', label: 'SchedulingDisabled' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  // Seeded from the STATUS_CONFIG that lived in Header.tsx.
  helm: {
    deployed: { tone: 'ok', label: 'Deployed' },
    superseded: { tone: 'warn', label: 'Superseded' },
    pendinginstall: { tone: 'pending', label: 'Pending install' },
    pendingupgrade: { tone: 'pending', label: 'Pending upgrade' },
    pendingrollback: { tone: 'pending', label: 'Pending rollback' },
    uninstalling: { tone: 'pending', label: 'Uninstalling' },
    uninstalled: { tone: 'neutral', label: 'Uninstalled' },
    failed: { tone: 'error', label: 'Failed' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  // ArgoCD sync, health and operation are three separate axes. Flattening them
  // through one function (as both ArgoCD pages do today) loses meaning:
  // "Progressing" is a health state and not a sync state at all.
  argoSync: {
    synced: { tone: 'ok', label: 'Synced' },
    outofsync: { tone: 'warn', label: 'OutOfSync', description: 'Live state differs from the desired state in Git' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  argoHealth: {
    healthy: { tone: 'ok', label: 'Healthy' },
    progressing: { tone: 'pending', label: 'Progressing' },
    suspended: { tone: 'info', label: 'Suspended', description: 'Resource is paused and not being reconciled' },
    degraded: { tone: 'error', label: 'Degraded' },
    missing: { tone: 'warn', label: 'Missing', description: 'Resource is defined in Git but not present in the cluster' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  argoOp: {
    succeeded: { tone: 'ok', label: 'Succeeded' },
    running: { tone: 'pending', label: 'Running' },
    terminating: { tone: 'pending', label: 'Terminating' },
    failed: { tone: 'error', label: 'Failed' },
    error: { tone: 'error', label: 'Error' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  job: {
    complete: { tone: 'ok', label: 'Complete' },
    succeeded: { tone: 'ok', label: 'Succeeded' },
    active: { tone: 'pending', label: 'Active' },
    running: { tone: 'pending', label: 'Running' },
    suspended: { tone: 'info', label: 'Suspended' },
    failed: { tone: 'error', label: 'Failed' },
    deadlineexceeded: { tone: 'error', label: 'DeadlineExceeded' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  condition: {
    true: { tone: 'ok', label: 'True' },
    false: { tone: 'error', label: 'False' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },

  generic: {
    ready: { tone: 'ok', label: 'Ready' },
    true: { tone: 'ok', label: 'Yes' },
    yes: { tone: 'ok', label: 'Yes' },
    active: { tone: 'ok', label: 'Active' },
    connected: { tone: 'ok', label: 'Connected' },
    enabled: { tone: 'ok', label: 'Enabled' },
    healthy: { tone: 'ok', label: 'Healthy' },
    notready: { tone: 'error', label: 'Not ready' },
    false: { tone: 'neutral', label: 'No' },
    no: { tone: 'neutral', label: 'No' },
    disconnected: { tone: 'error', label: 'Disconnected' },
    disabled: { tone: 'neutral', label: 'Disabled' },
    unknown: { tone: 'neutral', label: 'Unknown' },
  },
};

/** Turn an unmatched raw value into something presentable. */
function humanize(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Unknown';
  // Split camelCase / PascalCase into words but leave ALLCAPS acronyms intact.
  return raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export type ResolveOptions = {
  /** Container waiting/terminated reason, which overrides a bland phase. */
  reason?: string;
  /** For pods: whether all containers report ready. */
  ready?: boolean;
  /** Restart count; a Running pod that keeps restarting is not healthy. */
  restarts?: number;
};

/**
 * Resolve a status value within a domain to a tone, label and color.
 * Unrecognised values fall back to a neutral badge with a humanised label
 * rather than throwing, so an unexpected value from the API still renders.
 */
export function resolveStatus(
  domain: StatusDomain,
  value: string | number | boolean | null | undefined,
  opts: ResolveOptions = {}
): StatusDescriptor {
  const table = DOMAINS[domain] ?? DOMAINS.generic;

  // A failing container reason is more informative than the pod phase: a pod in
  // CrashLoopBackOff still reports phase=Running.
  if (opts.reason) {
    const reason = normalize(opts.reason);
    if (FAILING_REASONS.has(reason)) {
      const entry = table[reason];
      return describe(entry?.tone ?? 'error', entry?.label ?? humanize(opts.reason), entry?.description);
    }
    if (TRANSITIONAL_REASONS.has(reason)) {
      const entry = table[reason];
      return describe(entry?.tone ?? 'pending', entry?.label ?? humanize(opts.reason), entry?.description);
    }
  }

  const key = normalize(value);
  const entry = table[key];

  if (entry) {
    // A Running pod whose containers are not ready is still starting up.
    if (domain === 'pod' && entry.tone === 'ok' && opts.ready === false) {
      return describe('pending', entry.label ?? humanize(value), 'Containers are not all ready');
    }
    return describe(entry.tone, entry.label ?? humanize(value), entry.description);
  }

  return describe('neutral', humanize(value));
}

function describe(tone: StatusTone, label: string, description?: string): StatusDescriptor {
  return { tone, label, color: TONE_COLORS[tone], description };
}

/**
 * Replica-count status, for the "N/M ready" case that a single phase string
 * cannot express (Deployments, StatefulSets, DaemonSets).
 */
export function resolveReplicaStatus(
  ready: number | undefined,
  desired: number | undefined,
  opts: ResolveOptions = {}
): StatusDescriptor {
  const r = ready ?? 0;
  const d = desired ?? 0;

  if (opts.reason && FAILING_REASONS.has(normalize(opts.reason))) {
    return describe('error', `${r}/${d}`, humanize(opts.reason));
  }
  // Scaled to zero on purpose is a normal state, not a failure.
  if (d === 0) return describe('neutral', `${r}/${d}`, 'Scaled to zero');
  if (r === 0) return describe('error', `${r}/${d}`, 'No replicas available');
  if (r < d) return describe('pending', `${r}/${d}`, 'Some replicas are not ready');
  return describe('ok', `${r}/${d}`, 'All replicas ready');
}

/** Tone for an HTTP status code, for request/response views. */
export function resolveHttpStatus(code: number | undefined): StatusDescriptor {
  if (!code) return describe('neutral', 'Unknown');
  if (code < 300) return describe('ok', String(code));
  if (code < 400) return describe('info', String(code));
  if (code < 500) return describe('warn', String(code));
  return describe('error', String(code));
}
