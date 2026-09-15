import { useCallback } from 'react';

import { useSession } from 'next-auth/react';
import useSWR, { type KeyedMutator, useSWRConfig } from 'swr';

import type { ApiError } from '@/lib/apiError';
import callK8sApi, { type CallOptions, callGoApi } from '@/lib/k8s';
import { useResolvedCluster } from './useResolvedCluster';

/**
 * Canonical data-fetching hooks.
 *
 * Replaces the hand-rolled useEffect + useState + manual "Refresh" button that
 * 60+ files each reimplemented. Gains over that pattern: request deduplication
 * (two components asking for the same object make one call), revalidation on
 * focus, opt-in polling, and a single place where auth tokens are attached.
 */

export function useAccessToken(): string | undefined {
  const { data: session } = useSession();
  return session?.accessToken;
}

/**
 * Short, stable fingerprint of the token.
 *
 * The token is part of the cache identity -- switching users must not serve the
 * previous user's cached data -- but must never appear in a cache key, since keys
 * show up in devtools and error messages. A cheap non-cryptographic hash is
 * enough: we only need "changed or not".
 */
function fingerprint(token: string | undefined): string {
  if (!token) return 'anon';
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash << 5) - hash + token.charCodeAt(i);
    hash |= 0;
  }
  return `t${(hash >>> 0).toString(36)}`;
}

export type UseK8sOptions<T> = {
  /** Cluster/agent name. Defaults to the resolved active cluster. */
  cluster?: string | null;
  /** Set false to hold the request (e.g. router params not ready yet). */
  enabled?: boolean;
  /**
   * Poll interval in ms, or a function of the latest data so polling can back
   * off once a resource reaches a terminal state.
   */
  refreshInterval?: number | ((data: T | undefined) => number);
  /** Keep showing the previous data while a new key loads. */
  keepPreviousData?: boolean;
  /** Transform the raw response before it is cached. */
  select?: (raw: any) => T;
  /** Treat 404 as `null` rather than an error. */
  nullOn404?: boolean;
  /** Revalidate when the window regains focus. Defaults to the global config. */
  revalidateOnFocus?: boolean;
};

export type UseK8sResult<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  /** First load, nothing cached yet. */
  isLoading: boolean;
  /** A background refresh is in flight. */
  isValidating: boolean;
  refresh: () => Promise<T | undefined>;
  mutate: KeyedMutator<T>;
};

function buildResult<T>(swr: {
  data: T | undefined;
  error: any;
  isLoading: boolean;
  isValidating: boolean;
  mutate: KeyedMutator<T>;
}): UseK8sResult<T> {
  return {
    data: swr.data,
    error: swr.error as ApiError | undefined,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    refresh: () => swr.mutate(),
    mutate: swr.mutate,
  };
}

/**
 * Fetch a single path from the Kubernetes proxy.
 *
 * Pass `path = null` to skip fetching. That is SWR's idiom for "not ready yet"
 * and it removes the useParams()-undefined-on-first-render race that several
 * pages worked around with ad-hoc guards.
 */
export function useK8sResource<T = any>(
  path: string | null | undefined,
  opts: UseK8sOptions<T> = {}
): UseK8sResult<T> {
  const token = useAccessToken();
  const resolvedCluster = useResolvedCluster();
  const cluster = opts.cluster !== undefined ? opts.cluster : resolvedCluster;

  const enabled = opts.enabled !== false && Boolean(path) && Boolean(cluster);
  const key = enabled ? ['k8s', cluster, path, fingerprint(token)] : null;

  const callOptions: CallOptions = { nullOn404: opts.nullOn404 };

  const swr = useSWR<T>(
    key,
    async () => {
      const raw = await callK8sApi(
        path as string,
        'GET',
        null,
        null,
        cluster,
        token,
        'json',
        callOptions
      );
      return (opts.select ? opts.select(raw) : raw) as T;
    },
    {
      refreshInterval: opts.refreshInterval as any,
      keepPreviousData: opts.keepPreviousData,
      revalidateOnFocus: opts.revalidateOnFocus,
    }
  );

  return buildResult<T>(swr as any);
}

/**
 * List variant: unwraps the Kubernetes `.items` envelope and yields `[]` rather
 * than `undefined` once loaded, so callers can map without a guard.
 */
export function useK8sList<T = any>(
  path: string | null | undefined,
  opts: UseK8sOptions<T[]> = {}
): UseK8sResult<T[]> {
  return useK8sResource<T[]>(path, {
    ...opts,
    select: opts.select ?? ((raw: any) => (raw?.items ?? []) as T[]),
  });
}

/** Fetch from the Go API (non-Kubernetes endpoints). */
export function useGoApi<T = any>(
  path: string | null | undefined,
  opts: Omit<UseK8sOptions<T>, 'cluster'> = {}
): UseK8sResult<T> {
  const token = useAccessToken();
  const enabled = opts.enabled !== false && Boolean(path);
  const key = enabled ? ['go', path, fingerprint(token)] : null;

  const swr = useSWR<T>(
    key,
    async () => {
      const raw = await callGoApi(path as string, 'GET', null, null, token, 'json', {
        nullOn404: opts.nullOn404,
      });
      return (opts.select ? opts.select(raw) : raw) as T;
    },
    {
      refreshInterval: opts.refreshInterval as any,
      keepPreviousData: opts.keepPreviousData,
      revalidateOnFocus: opts.revalidateOnFocus,
    }
  );

  return buildResult<T>(swr as any);
}

export type MutationInit = {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
  cluster?: string | null;
};

/**
 * Imperative writes plus targeted cache invalidation.
 *
 * Deliberately not optimistic: this console mutates real infrastructure, so
 * showing a change before the server confirms it would be misleading. Call
 * `invalidate(prefix)` after a write to refetch affected views.
 */
export function useK8sMutation() {
  const token = useAccessToken();
  const resolvedCluster = useResolvedCluster();
  const { mutate: globalMutate } = useSWRConfig();

  const call = useCallback(
    async <T = any>(path: string, init: MutationInit): Promise<T> => {
      const cluster = init.cluster !== undefined ? init.cluster : resolvedCluster;
      return callK8sApi(
        path,
        init.method,
        init.body ?? null,
        init.headers ?? null,
        cluster,
        token
      );
    },
    [resolvedCluster, token]
  );

  const invalidate = useCallback(
    async (pathPrefix: string) => {
      await globalMutate(
        (key: unknown) =>
          Array.isArray(key) && key[0] === 'k8s' && String(key[2] ?? '').startsWith(pathPrefix),
        undefined,
        { revalidate: true }
      );
    },
    [globalMutate]
  );

  return { call, invalidate };
}
