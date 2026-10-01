import { useRouter } from "next/router";
import { useSession } from "next-auth/react"

import { useGlobalState } from '@/contexts/global';
import { useEnvironments } from '@/hooks/useEnvironments';
import { useSelectEnvironment } from '@/hooks/useSelectEnvironment';
import { OnboardingStepper } from './OnboardingStepper';

export function Welcome() {
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const { setActiveCluster } = useGlobalState();
  const { environments, refresh } = useEnvironments();
  const selectEnvironment = useSelectEnvironment(environments);
  const router = useRouter();

  return (
    <OnboardingStepper
      accessToken={accessToken}
      onComplete={async (agentName) => {
        setActiveCluster(agentName);

        // If the cluster already runs a Gen3 environment, open it. Re-read the
        // list first: the cached one predates anything installed meanwhile.
        const fresh = (await refresh())?.environments ?? [];
        const match = fresh.find((env) => env.value.startsWith(`${agentName}/`));
        if (match) {
          // Pass the item: it may not be in the list the hook captured on mount.
          selectEnvironment(match.value, { item: match });
          return;
        }

        // The wizard installs the agent, ArgoCD and monitoring -- not Gen3 --
        // so usually there is no environment yet. "Go to Dashboard" used to
        // stop here and leave the user on the wizard they had just finished.
        // The cluster itself is the useful place to land.
        router.push(`/clusters/${encodeURIComponent(agentName)}`);
      }}
    />
  );
}
