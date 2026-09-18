import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSession, signOut } from 'next-auth/react';

import { AuthenticatedLayout } from '@/layout/AuthenticatedLayout';
import { useGlobalState } from '@/contexts/global';
import { useEnvironments } from '@/hooks/useEnvironments';
import { useGoApi } from '@/hooks/useK8s';
import { parseEnvKey } from '@/lib/envKey';
import { LoadingState } from '@/components/ui';
import { useFocusedLayout } from '@/contexts/focusedLayout';

import { Welcome } from '@/components/Welcome/Welcome';
import EnvironmentPicker from '@/components/EnvironmentPicker';
import EnvironmentDashboardComp from '@/components/EnvironmentDashboard';

/**
 * What to render on `/`.
 *
 * This used to be a single expression, `cluster == "" ? <Welcome/> : <Dashboard/>`,
 * whose only input was whether an environment had been selected. That produced
 * three separate wrong answers:
 *
 *  - A user whose fleet is already running, but who has not touched the
 *    picker, was shown the 8-step setup wizard telling them to install
 *    infrastructure that already exists.
 *  - `activeGlobalEnv` is restored from localStorage inside an effect, so it
 *    is empty on the first render of *every* visit -- the wizard flashed on
 *    each page load before the dashboard replaced it.
 *  - Finishing the wizard set `activeCluster`, but this branch reads
 *    `activeGlobalEnv`, so completing setup did not dismiss the wizard.
 *
 * The rule now: only show setup when there is genuinely nothing to show.
 */
export default function HomePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { activeGlobalEnv, hydrated } = useGlobalState();

  const { environments, loading: environmentsLoading, validating, refresh } = useEnvironments();

  // Only asked when there is no environment to show; distinguishes "you have
  // no Gen3 releases yet" from "no cluster is connected at all", which need
  // different screens.
  const wantAgents = hydrated && environments.length === 0;
  const agents = useGoApi(wantAgents ? '/agents' : null, { revalidateOnFocus: false });

  useEffect(() => {
    if (session?.error) {
      console.log('Session error detected, signing out:', session.error);
      signOut({ callbackUrl: '/' });
    }
  }, [session?.error]);

  const { cluster, namespace } = parseEnvKey(activeGlobalEnv);

  // The chooser and the setup wizard own the viewport: no environment is
  // selected, so the navbar and breadcrumbs have nothing to navigate.
  const choosing = hydrated && !environmentsLoading && !cluster;
  useFocusedLayout(choosing);

  const body = () => {
    // Before hydration every stored value reads as empty. Acting on that gap
    // is what caused the wizard flash.
    if (!hydrated || environmentsLoading) {
      return <LoadingState label="Loading environments" />;
    }

    if (cluster) {
      return <EnvironmentDashboardComp env={cluster} namespace={namespace} />;
    }

    if (environments.length > 0) {
      return (
        <EnvironmentPicker
          environments={environments}
          refreshing={validating}
          onRefresh={refresh}
          onAddCluster={() => router.push('/bootstrap')}
        />
      );
    }

    // No environments. If an agent is connected the cluster is onboarded but
    // has no Gen3 release yet, so keep waiting on that answer rather than
    // flashing setup at someone who does not need it.
    if (agents.isLoading) {
      return <LoadingState label="Checking for connected clusters" />;
    }

    return <Welcome />;
  };

  return <AuthenticatedLayout>{body()}</AuthenticatedLayout>;
}
