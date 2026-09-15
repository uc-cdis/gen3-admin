import { useEffect } from 'react';

import { useParams } from 'next/navigation';

import { useGlobalState } from '@/contexts/global';
import { useGoApi } from './useK8s';

/**
 * Resolve which cluster the current page is about.
 *
 * The app had two unreconciled sources of truth: ~80 pages read
 * `useParams().clustername` from the URL, while the navbar, header and spotlight
 * read `activeCluster` from global state. Deep-linking to /clusters/foo/...
 * therefore rendered foo's data while the sidebar still linked to the previously
 * selected cluster.
 *
 * The URL wins where it names a cluster: it is explicit, shareable and
 * unambiguous. When it disagrees with stored state, the stored value is updated
 * so the chrome follows the page.
 */
export function useResolvedCluster(): string | null {
  const params = useParams();
  const { activeCluster, setActiveCluster, activeGlobalEnv } = useGlobalState();

  const raw = (params as Record<string, unknown> | null)?.clustername;
  const urlCluster = Array.isArray(raw) ? raw[0] : (raw as string | undefined);

  // Environment selection encodes "cluster/namespace/app"; its cluster segment is
  // the fallback when the route is not cluster-scoped.
  const envCluster = activeGlobalEnv ? activeGlobalEnv.split('/')[0] : undefined;

  const resolved = urlCluster || activeCluster || envCluster || null;

  useEffect(() => {
    if (urlCluster && urlCluster !== activeCluster) {
      setActiveCluster(urlCluster);
    }
  }, [urlCluster, activeCluster, setActiveCluster]);

  return resolved;
}

export type ClusterResolution = {
  cluster: string | null;
  /**
   * True while we still might find a cluster (state is hydrating, or the agent
   * list is loading). Callers should wait rather than rendering "no cluster".
   */
  resolving: boolean;
  /** How the cluster was determined, useful for explaining it in the UI. */
  source: 'url' | 'state' | 'environment' | 'only-agent' | 'none';
};

/**
 * Cluster resolution for pages whose route does not name a cluster.
 *
 * The ArgoCD routes are /argocd/applications/[namespace]/[name], where the first
 * segment is the *ArgoCD* namespace, not a cluster. Without a fallback, opening
 * such a URL in a fresh session dead-ends on "no cluster selected" even though
 * the link looks shareable.
 *
 * Two problems are handled here that the plain hook does not:
 *
 *  1. Global state hydrates from localStorage inside an effect, so `activeCluster`
 *     is empty on the first render even when one is stored. Reporting "no cluster"
 *     during that window is a false negative, so `resolving` stays true until
 *     hydration has had a chance to run.
 *  2. When nothing is stored and exactly one agent is connected, that agent is
 *     unambiguous and is used. With several, we cannot guess, so the caller
 *     prompts instead.
 */
export function useResolvedClusterWithFallback(): ClusterResolution {
  const params = useParams();
  const { activeCluster, setActiveCluster, activeGlobalEnv, hydrated } = useGlobalState();

  const raw = (params as Record<string, unknown> | null)?.clustername;
  const urlCluster = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  const envCluster = activeGlobalEnv ? activeGlobalEnv.split('/')[0] : undefined;

  const known = urlCluster || activeCluster || envCluster;

  // Only ask for the agent list once state has hydrated and still told us
  // nothing, so a stored selection is never second-guessed by a network call.
  const agents = useGoApi<any[]>(hydrated && !known ? '/agents' : null, {
    revalidateOnFocus: false,
  });

  useEffect(() => {
    if (urlCluster && urlCluster !== activeCluster) {
      setActiveCluster(urlCluster);
    }
  }, [urlCluster, activeCluster, setActiveCluster]);

  // The URL is authoritative and needs no hydration.
  if (urlCluster) return { cluster: urlCluster, resolving: false, source: 'url' };

  // Before hydration every stored value reads as empty, so "no cluster" would be
  // a false negative.
  if (!hydrated) return { cluster: null, resolving: true, source: 'none' };

  if (activeCluster) return { cluster: activeCluster, resolving: false, source: 'state' };
  if (envCluster) return { cluster: envCluster, resolving: false, source: 'environment' };

  if (agents.isLoading) return { cluster: null, resolving: true, source: 'none' };

  // One connected agent is unambiguous. With several we cannot guess, so the
  // caller prompts for a choice.
  const connected = (agents.data || []).filter((agent: any) => agent?.connected);
  if (connected.length === 1) {
    return { cluster: connected[0].name, resolving: false, source: 'only-agent' };
  }

  return { cluster: null, resolving: false, source: 'none' };
}
