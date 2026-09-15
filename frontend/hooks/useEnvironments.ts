import useSWR from 'swr';

import callK8sApi, { callGoApi } from '@/lib/k8s';
import { useAccessToken } from './useK8s';

/**
 * The environment list behind the header's picker.
 *
 * This is the most expensive query in the app: it lists agents, then Helm
 * releases per agent, then a `manifest-global` configmap per Gen3 release to
 * recover the real hostname. On a cluster with hundreds of namespaces that is
 * dozens of round trips, each crossing the agent gRPC tunnel.
 *
 * It used to run from a useEffect keyed on `activeGlobalEnv`, so *selecting* an
 * environment re-ran the whole scan -- the dropdown paid the full cost on every
 * interaction. Moving it behind SWR means:
 *
 *  - one shared cache entry, so mounting the header twice does not double the work
 *  - selecting an environment reads from cache instead of refetching
 *  - the result survives navigation, so the picker is populated immediately
 *
 * Deliberately long-lived: environments change on the timescale of deployments,
 * not seconds, and the header has an explicit refresh button for when that is
 * not good enough.
 */

export type EnvItem = {
  value: string;
  label: string;
  status: string;
  namespace: string;
  manager: 'helm' | 'argocd';
  appName: string;
  provider: string;
  k8sVersion: string;
};

const ENVIRONMENTS_CACHE_MS = 5 * 60 * 1000;

async function fetchEnvironments(token: string): Promise<EnvItem[]> {
  const agents = await callGoApi('/agents', 'GET', null, null, token);
  const connected = (agents || []).filter((agent: any) => agent?.connected);

  const perAgent = await Promise.all(
    connected.map(async (agent: any) => {
      let charts: any[] = [];
      try {
        charts = await callGoApi(`/agents/${agent.name}/helm/list`, 'GET', null, null, token);
      } catch {
        // One unreachable agent should not blank the whole picker.
        return [] as EnvItem[];
      }

      const gen3Charts = (charts || []).filter(
        (chart: any) =>
          chart.chart?.toLowerCase().includes('gen3') ||
          chart.name?.toLowerCase().includes('gen3')
      );

      return Promise.all(
        gen3Charts.map(async (chart: any): Promise<EnvItem> => {
          const base: EnvItem = {
            value: `${agent.name}/${chart.namespace}/${chart.name}`,
            label: `${agent.name}/${chart.name}`,
            status: chart.status || 'unknown',
            namespace: chart.namespace,
            manager: chart.helm === 'true' ? 'helm' : 'argocd',
            appName: chart.name,
            provider: agent.provider || '',
            k8sVersion: agent.k8sVersion || '',
          };

          try {
            // A 404 here is normal: not every release ships manifest-global.
            const configMap = await callK8sApi(
              `/api/v1/namespaces/${chart.namespace}/configmaps/manifest-global`,
              'GET',
              null,
              null,
              agent.name,
              token,
              'json',
              { nullOn404: true }
            );
            const hostname = configMap?.data?.hostname;
            return hostname ? { ...base, label: hostname } : base;
          } catch {
            return base;
          }
        })
      );
    })
  );

  return perAgent.flat();
}

export function useEnvironments() {
  const token = useAccessToken();

  const swr = useSWR<EnvItem[]>(
    token ? ['environments'] : null,
    () => fetchEnvironments(token as string),
    {
      // Expensive enough that refetching on focus or remount is not worth it.
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      dedupingInterval: ENVIRONMENTS_CACHE_MS,
      keepPreviousData: true,
    }
  );

  return {
    environments: swr.data ?? [],
    // Only a true first load; a background revalidate keeps the list visible.
    loading: swr.isLoading && !swr.data,
    validating: swr.isValidating,
    error: swr.error,
    refresh: () => swr.mutate(),
  };
}
