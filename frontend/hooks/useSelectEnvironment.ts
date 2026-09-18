import { useCallback } from 'react';
import { useRouter } from 'next/router';

import { useGlobalState } from '@/contexts/global';
import { parseEnvKey } from '@/lib/envKey';
import type { EnvItem } from './useEnvironments';

/**
 * Selecting an environment, in one place.
 *
 * Choosing an environment sets six pieces of global state and then navigates.
 * That sequence lived inline in the header's `handleEnvironmentChange`; the
 * landing-page picker needs exactly the same behaviour, and a second copy
 * would drift the moment either side gained a field.
 *
 * Returns a callback taking the environment key (`<agent>/<namespace>/<app>`).
 * Unknown keys are ignored rather than half-applied, so a stale localStorage
 * value cannot leave the app pointing at an environment that no longer exists.
 *
 * Pass `opts.item` when selecting something that is not in the list this hook
 * captured -- an environment created moments ago by the setup wizard will not
 * be in the cached array yet, and the lookup would otherwise reject it.
 */
export function useSelectEnvironment(environments: EnvItem[]) {
  const router = useRouter();
  const {
    activeCluster,
    setActiveCluster,
    setActiveGlobalEnv,
    setActiveEnvManager,
    setActiveEnvAppName,
    setActiveClusterProvider,
    setActiveClusterK8sVersion,
  } = useGlobalState();

  return useCallback(
    (value: string | null, opts: { navigate?: boolean; item?: EnvItem } = {}) => {
      const { navigate = true, item } = opts;
      if (!value) return;

      const selected = item ?? environments.find((e) => e.value === value);
      if (!selected) return;

      setActiveGlobalEnv(value);
      setActiveEnvManager(selected.manager);
      setActiveEnvAppName(selected.appName);
      setActiveClusterProvider(selected.provider);
      setActiveClusterK8sVersion(selected.k8sVersion);

      const { cluster, namespace } = parseEnvKey(value);
      if (cluster !== activeCluster) setActiveCluster(cluster);

      if (navigate) {
        router.push(`/environments/${cluster}/${namespace}`);
      }
    },
    [
      environments,
      activeCluster,
      router,
      setActiveCluster,
      setActiveGlobalEnv,
      setActiveEnvManager,
      setActiveEnvAppName,
      setActiveClusterProvider,
      setActiveClusterK8sVersion,
    ]
  );
}
