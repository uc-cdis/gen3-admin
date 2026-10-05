import { useCallback, useState } from "react";
import { notifications } from "@mantine/notifications";

import { useK8sMutation } from "./useK8s";

/**
 * Restarting a replica-backed workload.
 *
 * Does what `kubectl rollout restart` does: stamps
 * `kubectl.kubernetes.io/restartedAt` on the *pod template* rather than
 * deleting pods. Changing the template bumps the pod hash, so the controller
 * performs a real rolling update and honours the configured strategy and
 * surge/unavailable budget. Deleting pods directly would have been the
 * obvious shortcut and the wrong one -- it takes capacity away immediately
 * and ignores maxUnavailable, so a restart would read as an outage.
 *
 * The same annotation key as kubectl, deliberately: a restart from this
 * console and one from a terminal are then indistinguishable to the cluster,
 * and neither leaves a second redundant annotation behind.
 */

/** Objects with a pod template we can stamp to trigger a rollout. */
const RESTART_PATHS: Record<string, (ns: string, name: string) => string> = {
  Deployment: (ns, name) =>
    `/apis/apps/v1/namespaces/${ns}/deployments/${name}`,
  StatefulSet: (ns, name) =>
    `/apis/apps/v1/namespaces/${ns}/statefulsets/${name}`,
  DaemonSet: (ns, name) => `/apis/apps/v1/namespaces/${ns}/daemonsets/${name}`,
};

/**
 * DaemonSets cannot scale but can restart, so this is deliberately not
 * `isScalable`. Same prototype-safe lookup: `'constructor' in RESTART_PATHS`
 * would otherwise report a bogus kind as restartable.
 */
export function isRestartable(kind: string | undefined): boolean {
  return Boolean(
    kind && Object.prototype.hasOwnProperty.call(RESTART_PATHS, kind),
  );
}

export type RestartTarget = {
  kind: string;
  namespace: string;
  name: string;
  /** Agent the workload lives on; omitted uses the resolved cluster. */
  cluster?: string | null;
};

export function useRestartWorkload() {
  const { call, invalidate } = useK8sMutation();
  const [pending, setPending] = useState(false);

  const restart = useCallback(
    async (target: RestartTarget): Promise<boolean> => {
      const build = Object.prototype.hasOwnProperty.call(
        RESTART_PATHS,
        target.kind,
      )
        ? RESTART_PATHS[target.kind]
        : undefined;
      if (!build) {
        notifications.show({
          color: "statusError",
          title: "Cannot restart",
          message: `${target.kind} does not support restarting.`,
        });
        return false;
      }

      const path = build(target.namespace, target.name);
      setPending(true);
      try {
        await call(path, {
          method: "PATCH",
          // Strategic merge patch, matching kubectl. A plain merge patch on
          // `annotations` would replace the whole map and drop every other
          // annotation on the template.
          headers: { "Content-Type": "application/strategic-merge-patch+json" },
          body: {
            spec: {
              template: {
                metadata: {
                  annotations: {
                    "kubectl.kubernetes.io/restartedAt":
                      new Date().toISOString(),
                  },
                },
              },
            },
          },
          cluster: target.cluster,
        });

        // Same non-optimistic path as scaling: show what the server
        // confirmed, and let the badge move through pending as the rollout
        // actually proceeds.
        await invalidate("/apis/apps/v1");

        notifications.show({
          color: "statusOk",
          title: "Restarting",
          message: `${target.name} is rolling out a restart.`,
        });
        return true;
      } catch (error: any) {
        notifications.show({
          color: "statusError",
          title: "Restart failed",
          message: error?.message || `Could not restart ${target.name}.`,
        });
        return false;
      } finally {
        setPending(false);
      }
    },
    [call, invalidate],
  );

  return { restart, pending };
}
