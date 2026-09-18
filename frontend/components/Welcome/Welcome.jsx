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

  return (
    <OnboardingStepper
      accessToken={accessToken}
      onComplete={async (agentName) => {
        setActiveCluster(agentName);

        // Finishing setup used to set only `activeCluster`, while the landing
        // page branches on `activeGlobalEnv` -- so "Go to Dashboard" left the
        // user looking at the wizard they had just completed. Re-read the
        // environment list (the release was created during the wizard, so the
        // cached list predates it) and select the one on this agent.
        const fresh = (await refresh())?.environments ?? [];
        const match = fresh.find((env) => env.value.startsWith(`${agentName}/`));
        // Pass the item: it was created during the wizard, so it is not in the
        // list the hook captured on mount.
        if (match) selectEnvironment(match.value, { item: match });
      }}
    />
  );
}
