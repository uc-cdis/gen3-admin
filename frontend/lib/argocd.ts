import { ApiError } from './apiError';
import { callGoApi } from './k8s';
import callK8sApi from './k8s';

/**
 * ArgoCD API client.
 *
 * Everything here talks to /api/argocd/:agent/..., which is backed by a real
 * ArgoCD API client server-side. That is what makes the resource tree, diffs,
 * history and rollback possible -- none of them exist in the Application CRD.
 *
 * The previous version of this file patched the CRD's `.operation` field to fake
 * a sync. That approach could be silently ignored by the controller, could not
 * express a target revision or a resource subset, and its completion check
 * reported success from a *previous* run's operationState. The CRD path survives
 * only as an explicitly-named fallback for clusters where the ArgoCD API is
 * unreachable.
 */

// ── Availability ─────────────────────────────────────────────────────────────

export type ArgoUnavailableReason =
  | 'not_installed'
  | 'no_credentials'
  | 'unreachable'
  | 'not_found'
  | 'unsupported'
  | 'agent_too_old'
  | 'upstream_error';

export type ArgoAvailability =
  | { available: true; version: string; kubeVersion?: string }
  | { available: false; reason: ArgoUnavailableReason; message: string };

function base(cluster: string) {
  return `/argocd/${encodeURIComponent(cluster)}`;
}

/** Append appNamespace when the app lives outside the default ArgoCD namespace. */
function appPath(cluster: string, name: string, suffix = '', appNamespace?: string) {
  const path = `${base(cluster)}/applications/${encodeURIComponent(name)}${suffix}`;
  if (!appNamespace) return path;
  return `${path}?appNamespace=${encodeURIComponent(appNamespace)}`;
}

export async function getArgoStatus(cluster: string, token?: string): Promise<ArgoAvailability> {
  try {
    return await callGoApi(`${base(cluster)}/status`, 'GET', null, null, token);
  } catch (error) {
    // A transport failure is itself an availability answer, not an exception the
    // caller should have to handle.
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, reason: 'unreachable', message };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function listApplications(cluster: string, token?: string, opts?: { project?: string }) {
  const query = opts?.project ? `?project=${encodeURIComponent(opts.project)}` : '';
  return callGoApi(`${base(cluster)}/applications${query}`, 'GET', null, null, token);
}

export function getApplication(cluster: string, name: string, appNamespace: string | undefined, token?: string) {
  return callGoApi(appPath(cluster, name, '', appNamespace), 'GET', null, null, token);
}

export function getResourceTree(cluster: string, name: string, appNamespace: string | undefined, token?: string) {
  return callGoApi(appPath(cluster, name, '/resource-tree', appNamespace), 'GET', null, null, token);
}

export function getManagedResources(cluster: string, name: string, appNamespace: string | undefined, token?: string) {
  return callGoApi(appPath(cluster, name, '/managed-resources', appNamespace), 'GET', null, null, token);
}

export function getHistory(cluster: string, name: string, appNamespace: string | undefined, token?: string) {
  return callGoApi(appPath(cluster, name, '/history', appNamespace), 'GET', null, null, token);
}

export function getManifests(
  cluster: string,
  name: string,
  appNamespace: string | undefined,
  revision: string | undefined,
  token?: string
) {
  const path = appPath(cluster, name, '/manifests', appNamespace);
  const separator = path.includes('?') ? '&' : '?';
  const withRevision = revision ? `${path}${separator}revision=${encodeURIComponent(revision)}` : path;
  return callGoApi(withRevision, 'GET', null, null, token);
}

export function getAppEvents(cluster: string, name: string, appNamespace: string | undefined, token?: string) {
  return callGoApi(appPath(cluster, name, '/events', appNamespace), 'GET', null, null, token);
}

export type AppLogOptions = {
  appNamespace?: string;
  namespace?: string;
  podName?: string;
  container?: string;
  tailLines?: number;
  sinceSeconds?: number;
  filter?: string;
};

export async function getAppLogs(
  cluster: string,
  name: string,
  opts: AppLogOptions,
  token?: string
): Promise<string[]> {
  const params = new URLSearchParams();
  if (opts.appNamespace) params.set('appNamespace', opts.appNamespace);
  if (opts.namespace) params.set('namespace', opts.namespace);
  if (opts.podName) params.set('podName', opts.podName);
  if (opts.container) params.set('container', opts.container);
  params.set('tailLines', String(opts.tailLines ?? 1000));
  if (opts.sinceSeconds) params.set('sinceSeconds', String(opts.sinceSeconds));
  if (opts.filter) params.set('filter', opts.filter);

  const raw: string = await callGoApi(
    `${base(cluster)}/applications/${encodeURIComponent(name)}/logs?${params.toString()}`,
    'GET',
    null,
    null,
    token,
    'text'
  );

  // ArgoCD returns newline-delimited JSON, one {result:{content}} per line.
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed?.result?.content ?? line;
      } catch {
        return line;
      }
    });
}

export function listArgoProjects(cluster: string, token?: string) {
  return callGoApi(`${base(cluster)}/projects`, 'GET', null, null, token);
}

export function listArgoRepositories(cluster: string, token?: string) {
  return callGoApi(`${base(cluster)}/repositories`, 'GET', null, null, token);
}

export function listArgoClusters(cluster: string, token?: string) {
  return callGoApi(`${base(cluster)}/clusters`, 'GET', null, null, token);
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type SyncResourceRef = {
  group?: string;
  kind: string;
  name: string;
  namespace?: string;
};

export type SyncOptionFlags = {
  prune?: boolean;
  dryRun?: boolean;
  force?: boolean;
  replace?: boolean;
  applyOutOfSyncOnly?: boolean;
  serverSideApply?: boolean;
  respectIgnoreDifferences?: boolean;
  createNamespace?: boolean;
  revision?: string;
  resources?: SyncResourceRef[];
  retryLimit?: number;
};

/**
 * Build the ArgoCD sync payload from UI flags.
 *
 * `prune` and `dryRun` are top-level fields; the rest are string entries in
 * syncOptions, and `force` additionally belongs on the apply strategy.
 */
export function buildSyncRequest(flags: SyncOptionFlags, appNamespace?: string) {
  const syncOptions: string[] = [];
  if (flags.replace) syncOptions.push('Replace=true');
  if (flags.applyOutOfSyncOnly) syncOptions.push('ApplyOutOfSyncOnly=true');
  if (flags.serverSideApply) syncOptions.push('ServerSideApply=true');
  if (flags.respectIgnoreDifferences) syncOptions.push('RespectIgnoreDifferences=true');
  if (flags.createNamespace) syncOptions.push('CreateNamespace=true');

  const request: Record<string, unknown> = {
    prune: Boolean(flags.prune),
    dryRun: Boolean(flags.dryRun),
  };

  if (appNamespace) request.appNamespace = appNamespace;
  if (flags.revision) request.revision = flags.revision;
  if (syncOptions.length) request.syncOptions = { items: syncOptions };
  if (flags.resources?.length) request.resources = flags.resources;
  if (flags.force) request.strategy = { apply: { force: true } };
  if (flags.retryLimit && flags.retryLimit > 0) {
    request.retryStrategy = {
      limit: flags.retryLimit,
      backoff: { duration: '5s', factor: 2, maxDuration: '3m' },
    };
  }

  return request;
}

export function syncApplication(
  cluster: string,
  name: string,
  flags: SyncOptionFlags,
  appNamespace?: string,
  token?: string
) {
  return callGoApi(
    `${base(cluster)}/applications/${encodeURIComponent(name)}/sync`,
    'POST',
    buildSyncRequest(flags, appNamespace) as Record<string, unknown>,
    null,
    token
  );
}

export function rollbackApplication(
  cluster: string,
  name: string,
  id: number,
  appNamespace?: string,
  token?: string
) {
  return callGoApi(
    `${base(cluster)}/applications/${encodeURIComponent(name)}/rollback`,
    'POST',
    { id, appNamespace },
    null,
    token
  );
}

export function terminateOperation(cluster: string, name: string, appNamespace?: string, token?: string) {
  return callGoApi(
    appPath(cluster, name, '/terminate-op', appNamespace),
    'POST',
    {},
    null,
    token
  );
}

export function refreshApplication(
  cluster: string,
  name: string,
  appNamespace: string | undefined,
  hard: boolean,
  token?: string
) {
  const path = appPath(cluster, name, '/refresh', appNamespace);
  const separator = path.includes('?') ? '&' : '?';
  return callGoApi(`${path}${separator}hard=${hard}`, 'POST', {}, null, token);
}

/** Update the application spec. This is how a branch / chart version is changed. */
export function updateApplicationSpec(
  cluster: string,
  name: string,
  appNamespace: string | undefined,
  spec: Record<string, unknown>,
  token?: string
) {
  return callGoApi(appPath(cluster, name, '/spec', appNamespace), 'PUT', spec, null, token);
}

// ── Sync completion tracking ─────────────────────────────────────────────────

export type OperationState = {
  phase?: string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
};

/**
 * Decide whether a terminal operation phase belongs to the sync *we* started.
 *
 * The old implementation resolved as soon as it saw phase === 'Succeeded', but a
 * previous run's Succeeded is still present when a new operation has not been
 * recorded yet, so it reported success immediately and incorrectly. Comparing
 * startedAt against the value captured at submit time fixes that: the bug was a
 * correlation problem, not a polling-interval problem.
 */
export function isOurOperation(state: OperationState | undefined, submittedAt: string | undefined): boolean {
  if (!state?.startedAt) return false;
  if (!submittedAt) return true;
  return new Date(state.startedAt).getTime() >= new Date(submittedAt).getTime();
}

export function isTerminalPhase(phase: string | undefined): boolean {
  return phase === 'Succeeded' || phase === 'Failed' || phase === 'Error';
}

// ── CRD fallback (degraded mode only) ────────────────────────────────────────

/**
 * Read applications straight from the CRD.
 *
 * Only for clusters where the ArgoCD API is unreachable. Shaped to match the API
 * response so the same components can render either source.
 */
export async function listApplicationsViaCRD(cluster: string, token?: string) {
  const response = await callK8sApi(
    '/apis/argoproj.io/v1alpha1/applications',
    'GET',
    null,
    null,
    cluster,
    token,
    'json',
    { nullOn404: true }
  );
  if (response?.items) return response;

  // Cluster-wide list can be denied by RBAC even when the namespaced one works.
  const namespaced = await callK8sApi(
    '/apis/argoproj.io/v1alpha1/namespaces/argocd/applications',
    'GET',
    null,
    null,
    cluster,
    token,
    'json',
    { nullOn404: true }
  );
  return namespaced ?? { items: [] };
}

export function getApplicationViaCRD(
  cluster: string,
  name: string,
  namespace = 'argocd',
  token?: string
) {
  return callK8sApi(
    `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/applications/${encodeURIComponent(name)}`,
    'GET',
    null,
    null,
    cluster,
    token,
    'json',
    { nullOn404: true }
  );
}

/**
 * Legacy sync by patching the CRD's `.operation` field.
 *
 * DEPRECATED and used only in degraded mode. ArgoCD's controller may ignore this
 * when an operation is already in flight, and progress cannot be tracked
 * reliably, so the UI warns before offering it.
 */
export async function syncViaCRDFallback(
  cluster: string,
  name: string,
  namespace = 'argocd',
  flags: SyncOptionFlags = {},
  token?: string
) {
  const endpoint = `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/applications/${encodeURIComponent(name)}`;

  const app = await callK8sApi(endpoint, 'GET', null, null, cluster, token, 'json', {
    nullOn404: true,
  });
  if (!app) {
    throw new ApiError({
      message: `Application ${name} not found in namespace ${namespace}`,
      status: 404,
      statusText: 'Not Found',
      endpoint,
    });
  }

  const existing: string[] = app?.spec?.syncPolicy?.syncOptions ?? [];
  const options = new Set<string>(existing);
  if (flags.prune) options.add('Prune=true');
  if (flags.force) options.add('Force=true');
  if (flags.replace) options.add('Replace=true');

  return callK8sApi(
    endpoint,
    'PATCH',
    { operation: { sync: { syncOptions: Array.from(options) } } },
    { 'Content-Type': 'application/merge-patch+json' },
    cluster,
    token
  );
}
