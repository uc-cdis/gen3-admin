import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { Alert, Anchor, Button, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconGitBranch, IconInfoCircle, IconServer2 } from '@tabler/icons-react';
import Link from 'next/link';

import { EmptyState, LoadingState } from '@/components/ui';
import { useArgoStatus } from '@/hooks/useArgoCD';
import type { ArgoUnavailableReason } from '@/lib/argocd';

type ArgoMode = {
  /** True when the ArgoCD API is usable and full features are available. */
  full: boolean;
  /** True when falling back to CRD reads with reduced functionality. */
  degraded: boolean;
  reason?: ArgoUnavailableReason;
  message?: string;
  version?: string;
};

const ArgoModeContext = createContext<ArgoMode>({ full: true, degraded: false });

export function useArgoMode() {
  return useContext(ArgoModeContext);
}

/** Human-readable explanation and remedy per failure reason. */
function explain(reason: ArgoUnavailableReason, message: string): { title: string; body: ReactNode } {
  switch (reason) {
    case 'no_credentials':
      return {
        title: 'ArgoCD is installed but this console cannot authenticate to it',
        body: (
          <>
            {message} Set <code>ARGOCD_AUTH_TOKEN</code> (recommended) or{' '}
            <code>ARGOCD_USERNAME</code>/<code>ARGOCD_PASSWORD</code> on the API server. The
            bootstrap secret <code>argocd-initial-admin-secret</code> is often deleted after
            install, which is why it may not be found.
          </>
        ),
      };
    case 'unreachable':
      return {
        title: 'Cannot reach the ArgoCD API',
        body: (
          <>
            {message} Check that the cluster agent is connected and that{' '}
            <code>argocd-server</code> is running. Set <code>ARGOCD_SERVER_URL</code> if it is
            served somewhere non-standard.
          </>
        ),
      };
    case 'agent_too_old':
      return {
        title: 'The cluster agent needs upgrading',
        body: <>{message}</>,
      };
    case 'unsupported':
      return {
        title: 'This ArgoCD version does not support the feature',
        body: <>{message}</>,
      };
    default:
      return { title: 'ArgoCD API unavailable', body: <>{message}</> };
  }
}

export type ArgoAvailabilityGateProps = {
  cluster: string | null | undefined;
  /**
   * True while the cluster is still being determined (state hydrating, or the
   * agent list loading). Prevents a "no cluster" flash on first paint.
   */
  resolving?: boolean;
  /** Called when the user asks to install ArgoCD (not_installed only). */
  onInstall?: () => void;
  children: ReactNode;
};

/**
 * Decides whether ArgoCD views run in full or degraded mode.
 *
 * Three outcomes:
 *  - available: render children with the full feature set.
 *  - not_installed: an install prompt, since CRD fallback is pointless when the
 *    CRDs themselves are absent.
 *  - anything else: render children in degraded mode with a banner. Views read
 *    from the CRD and API-only tabs (tree, diff, history, logs) render disabled
 *    with an explanation rather than disappearing -- a vanishing tab is more
 *    confusing than one that says why it is unavailable.
 */
export function ArgoAvailabilityGate({
  cluster,
  resolving = false,
  onInstall,
  children,
}: ArgoAvailabilityGateProps) {
  const status = useArgoStatus(cluster);

  // A failed availability probe is itself a degraded state, not a hard error.
  const availability = status.data;
  const available = availability?.available === true;
  const reason = (availability as any)?.reason as ArgoUnavailableReason | undefined;
  const message = (availability as any)?.message ?? 'ArgoCD is not reachable.';

  // Hooks must run before the early returns below, so both context values are
  // built up front even though only one of them is used on any given render.
  const fullMode = useMemo(
    () => ({ full: true, degraded: false, version: (availability as any)?.version }),
    [availability]
  );
  const degradedMode = useMemo(
    () => ({ full: false, degraded: true, reason, message }),
    [reason, message]
  );

  // Still working out which cluster this is; showing "no cluster" here would be a
  // false negative on the first paint of a shared link.
  if (!cluster && resolving) {
    return <LoadingState label="Determining cluster..." />;
  }

  if (!cluster) {
    return (
      <EmptyState
        icon={<IconServer2 size={32} opacity={0.4} />}
        title="No cluster selected"
        description={
          <>
            These ArgoCD URLs do not name a cluster, so one has to be selected. Pick an
            environment from the header, or open an agent from{' '}
            <Anchor component={Link} href="/clusters">Clusters</Anchor>.
          </>
        }
      />
    );
  }

  if (status.isLoading && !status.data) {
    return <LoadingState label="Checking ArgoCD availability..." />;
  }

  if (available) {
    return (
      <ArgoModeContext.Provider value={fullMode}>
        {children}
      </ArgoModeContext.Provider>
    );
  }

  if (reason === 'not_installed') {
    return (
      <EmptyState
        icon={<IconGitBranch size={32} opacity={0.4} />}
        title="ArgoCD is not installed on this cluster"
        description={
          <>
            GitOps features need ArgoCD running in the cluster. {message}
          </>
        }
        action={
          onInstall ? (
            <Button leftSection={<IconGitBranch size={16} />} onClick={onInstall}>
              Install ArgoCD
            </Button>
          ) : undefined
        }
      />
    );
  }

  const { title, body } = explain(reason ?? 'upstream_error', message);

  return (
    <ArgoModeContext.Provider value={degradedMode}>
      <Stack gap="md">
        <Alert
          variant="light"
          color="statusWarn"
          icon={<IconAlertTriangle size={18} />}
          title={title}
        >
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{body}</Text>
            <Text size="xs" c="dimmed">
              Showing data read directly from Application resources. Resource tree, diffs,
              history and logs need the ArgoCD API and are unavailable.
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="light" onClick={() => status.refresh()}>
                Retry
              </Button>
            </Group>
          </Stack>
        </Alert>
        {children}
      </Stack>
    </ArgoModeContext.Provider>
  );
}

/** Placeholder for a tab that needs the ArgoCD API while in degraded mode. */
export function ArgoFeatureUnavailable({ feature }: { feature: string }) {
  const mode = useArgoMode();
  return (
    <Alert variant="light" color="statusNeutral" icon={<IconInfoCircle size={18} />} title={`${feature} unavailable`}>
      <Text size="sm">
        {feature} is provided by the ArgoCD API, which is currently unreachable
        {mode.message ? `: ${mode.message}` : '.'}
      </Text>
      <Text size="xs" c="dimmed" mt="xs">
        This view reads Application resources directly, which do not contain this data.{' '}
        <Anchor href="https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_app/" target="_blank" rel="noreferrer">
          ArgoCD docs
        </Anchor>
      </Text>
    </Alert>
  );
}
