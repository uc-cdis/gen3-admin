import { useEffect } from 'react';

import { useParams } from 'next/navigation';

import { useGlobalState } from '@/contexts/global';

/**
 * Resolve which cluster the current page is about.
 *
 * The app had two unreconciled sources of truth: ~80 pages read
 * `useParams().clustername` from the URL, while the navbar, header and spotlight
 * read `activeCluster` from global state. Deep-linking to
 * /clusters/foo/... therefore rendered foo's data while the sidebar still linked
 * to the previously selected cluster.
 *
 * The URL wins: it is explicit, shareable and unambiguous. When it disagrees with
 * stored state, the stored value is updated to match so the chrome follows the
 * page.
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
