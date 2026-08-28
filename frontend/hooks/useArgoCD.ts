import { useCallback } from 'react';

import useSWR, { useSWRConfig } from 'swr';

import type { ArgoAvailability } from '@/lib/argocd';
import {
  getAppLogs,
  getApplication,
  getArgoStatus,
  getHistory,
  getManagedResources,
  getManifests,
  getResourceTree,
  listApplications,
  listApplicationsViaCRD,
  listArgoClusters,
  listArgoProjects,
  listArgoRepositories,
} from '@/lib/argocd';
import { useAccessToken } from './useK8s';

/**
 * SWR hooks for ArgoCD.
 *
 * Polling is adaptive rather than fixed: a sync in progress is worth watching at
 * 5s, but a Synced+Healthy app changes rarely and polling it hard just multiplies
 * load on the Go proxy and the agent's gRPC stream.
 */

type Result<T> = {
  data: T | undefined;
  error: any;
  isLoading: boolean;
  isValidating: boolean;
  refresh: () => Promise<any>;
};

function toResult<T>(swr: any): Result<T> {
  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    refresh: () => swr.mutate(),
  };
}

/** Availability is cached for a minute and shared by every ArgoCD view. */
export function useArgoStatus(cluster: string | null | undefined): Result<ArgoAvailability> {
  const token = useAccessToken();
  const swr = useSWR(
    cluster && token ? ['argo-status', cluster] : null,
    () => getArgoStatus(cluster as string, token),
    { dedupingInterval: 60_000, revalidateOnFocus: false }
  );
  return toResult<ArgoAvailability>(swr);
}

/** How fast to poll a list, based on whether anything is mid-operation. */
function listInterval(data: any): number {
  const items = data?.items ?? [];
  const busy = items.some(
    (app: any) =>
      app?.status?.operationState?.phase === 'Running' ||
      app?.status?.health?.status === 'Progressing'
  );
  return busy ? 5_000 : 30_000;
}

export function useArgoApplications(
  cluster: string | null | undefined,
  opts: { degraded?: boolean; project?: string } = {}
) {
  const token = useAccessToken();
  const swr = useSWR(
    cluster && token ? ['argo-apps', cluster, opts.degraded ?? false, opts.project ?? ''] : null,
    () =>
      opts.degraded
        ? listApplicationsViaCRD(cluster as string, token)
        : listApplications(cluster as string, token, { project: opts.project }),
    { refreshInterval: listInterval, keepPreviousData: true }
  );
  return toResult<{ items: any[] }>(swr);
}

/** Detail polling: fast while an operation runs, slow once it settles. */
function detailInterval(data: any): number {
  const phase = data?.status?.operationState?.phase;
  if (phase === 'Running' || phase === 'Terminating') return 5_000;
  if (data?.status?.health?.status === 'Progressing') return 5_000;
  return 15_000;
}

export function useArgoApplication(
  cluster: string | null | undefined,
  name: string | null | undefined,
  appNamespace?: string
) {
  const token = useAccessToken();
  const swr = useSWR(
    cluster && name && token ? ['argo-app', cluster, name, appNamespace ?? ''] : null,
    () => getApplication(cluster as string, name as string, appNamespace, token),
    { refreshInterval: detailInterval, keepPreviousData: true }
  );
  return toResult<any>(swr);
}

export function useArgoResourceTree(
  cluster: string | null | undefined,
  name: string | null | undefined,
  appNamespace?: string,
  enabled = true
) {
  const token = useAccessToken();
  const swr = useSWR(
    enabled && cluster && name && token ? ['argo-tree', cluster, name, appNamespace ?? ''] : null,
    () => getResourceTree(cluster as string, name as string, appNamespace, token),
    { refreshInterval: 15_000, keepPreviousData: true }
  );
  return toResult<any>(swr);
}

/**
 * Managed resources power the diff. Not polled: the payload is large (live and
 * desired manifests for every resource) and a diff the user is reading should not
 * shift underneath them.
 */
export function useArgoManagedResources(
  cluster: string | null | undefined,
  name: string | null | undefined,
  appNamespace?: string,
  enabled = true
) {
  const token = useAccessToken();
  const swr = useSWR(
    enabled && cluster && name && token ? ['argo-managed', cluster, name, appNamespace ?? ''] : null,
    () => getManagedResources(cluster as string, name as string, appNamespace, token),
    { revalidateOnFocus: false }
  );
  return toResult<{ items: any[] }>(swr);
}

export function useArgoHistory(
  cluster: string | null | undefined,
  name: string | null | undefined,
  appNamespace?: string,
  enabled = true
) {
  const token = useAccessToken();
  const swr = useSWR(
    enabled && cluster && name && token ? ['argo-history', cluster, name, appNamespace ?? ''] : null,
    () => getHistory(cluster as string, name as string, appNamespace, token),
    { revalidateOnFocus: false }
  );
  return toResult<{ items: any[]; automatedSyncEnabled?: boolean; ownedByApplicationSet?: boolean }>(swr);
}

export function useArgoManifests(
  cluster: string | null | undefined,
  name: string | null | undefined,
  appNamespace?: string,
  revision?: string,
  enabled = true
) {
  const token = useAccessToken();
  const swr = useSWR(
    enabled && cluster && name && token
      ? ['argo-manifests', cluster, name, appNamespace ?? '', revision ?? '']
      : null,
    () => getManifests(cluster as string, name as string, appNamespace, revision, token),
    { revalidateOnFocus: false }
  );
  return toResult<{ manifests: string[] }>(swr);
}

export function useArgoLogs(
  cluster: string | null | undefined,
  name: string | null | undefined,
  opts: Parameters<typeof getAppLogs>[2],
  enabled = true
) {
  const token = useAccessToken();
  const swr = useSWR(
    enabled && cluster && name && token
      ? ['argo-logs', cluster, name, JSON.stringify(opts)]
      : null,
    () => getAppLogs(cluster as string, name as string, opts, token),
    { revalidateOnFocus: false }
  );
  return toResult<string[]>(swr);
}

export function useArgoProjects(cluster: string | null | undefined) {
  const token = useAccessToken();
  const swr = useSWR(
    cluster && token ? ['argo-projects', cluster] : null,
    () => listArgoProjects(cluster as string, token)
  );
  return toResult<{ items: any[] }>(swr);
}

export function useArgoRepositories(cluster: string | null | undefined) {
  const token = useAccessToken();
  const swr = useSWR(
    cluster && token ? ['argo-repos', cluster] : null,
    () => listArgoRepositories(cluster as string, token)
  );
  return toResult<{ items: any[] }>(swr);
}

export function useArgoClusters(cluster: string | null | undefined) {
  const token = useAccessToken();
  const swr = useSWR(
    cluster && token ? ['argo-clusters', cluster] : null,
    () => listArgoClusters(cluster as string, token)
  );
  return toResult<{ items: any[] }>(swr);
}

/**
 * Invalidate every cached ArgoCD read for a cluster.
 *
 * Called after a write so the UI reflects it. Deliberately not optimistic: this
 * mutates real infrastructure, and showing a state the server has not confirmed
 * would be misleading.
 */
export function useArgoInvalidate() {
  const { mutate } = useSWRConfig();

  return useCallback(
    (cluster: string) =>
      mutate(
        (key: unknown) =>
          Array.isArray(key) && String(key[0]).startsWith('argo-') && key[1] === cluster,
        undefined,
        { revalidate: true }
      ),
    [mutate]
  );
}
