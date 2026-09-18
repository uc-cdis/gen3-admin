import { useCallback, useState } from 'react';
import { notifications } from '@mantine/notifications';

import { useK8sMutation } from './useK8s';

/**
 * Scaling a replica-backed workload.
 *
 * The transport for this already worked -- the proxy accepts every verb, the
 * agent forwards the method verbatim, and `ResourceDetails` has been sending
 * merge-patches for Secrets for a while -- but nothing in the UI ever called
 * it, so the console could show you a Deployment at 0/3 and offer no way to
 * do anything about it.
 *
 * Uses the `/scale` subresource rather than patching `spec.replicas` on the
 * object. Scale is the API Kubernetes provides for exactly this, it is the
 * same surface `kubectl scale` uses, and patching the parent risks clobbering
 * a concurrent change to an unrelated field.
 */

/** API group path for each kind that has a scale subresource. */
const SCALE_PATHS: Record<string, (ns: string, name: string) => string> = {
  Deployment: (ns, name) => `/apis/apps/v1/namespaces/${ns}/deployments/${name}/scale`,
  StatefulSet: (ns, name) => `/apis/apps/v1/namespaces/${ns}/statefulsets/${name}/scale`,
  ReplicaSet: (ns, name) => `/apis/apps/v1/namespaces/${ns}/replicasets/${name}/scale`,
};

/**
 * DaemonSets scale to the node count, so they have no replica control.
 *
 * Uses hasOwnProperty rather than `in`: `'constructor' in SCALE_PATHS` is true
 * through the prototype chain, which would report a bogus kind as scalable and
 * then hand the Object constructor to the caller as a path builder.
 */
export function isScalable(kind: string | undefined): boolean {
  return Boolean(kind && Object.prototype.hasOwnProperty.call(SCALE_PATHS, kind));
}

export type ScaleTarget = {
  kind: string;
  namespace: string;
  name: string;
  /** Agent the workload lives on; omitted uses the resolved cluster. */
  cluster?: string | null;
};

export function useScaleWorkload() {
  const { call, invalidate } = useK8sMutation();
  const [pending, setPending] = useState(false);

  const scale = useCallback(
    async (target: ScaleTarget, replicas: number): Promise<boolean> => {
      const build = Object.prototype.hasOwnProperty.call(SCALE_PATHS, target.kind)
        ? SCALE_PATHS[target.kind]
        : undefined;
      if (!build) {
        notifications.show({
          color: 'statusError',
          title: 'Cannot scale',
          message: `${target.kind} does not support scaling.`,
        });
        return false;
      }

      if (!Number.isInteger(replicas) || replicas < 0) {
        notifications.show({
          color: 'statusError',
          title: 'Invalid replica count',
          message: 'Replicas must be zero or a positive whole number.',
        });
        return false;
      }

      const path = build(target.namespace, target.name);
      setPending(true);
      try {
        await call(path, {
          method: 'PATCH',
          // Merge patch on the scale subresource: the smallest request that
          // expresses "set replicas", and it will not disturb other fields.
          headers: { 'Content-Type': 'application/merge-patch+json' },
          body: { spec: { replicas } },
          cluster: target.cluster,
        });

        // Not optimistic, matching the rest of the write path: this changes
        // real infrastructure, so the UI should show what the server
        // confirmed rather than what we asked for. The list refetches and the
        // badge moves to pending, then ok, as the rollout actually proceeds.
        await invalidate('/apis/apps/v1');

        notifications.show({
          color: 'statusOk',
          title: 'Scaling',
          message:
            replicas === 0
              ? `${target.name} is scaling to zero.`
              : `${target.name} is scaling to ${replicas} ${replicas === 1 ? 'replica' : 'replicas'}.`,
        });
        return true;
      } catch (error: any) {
        notifications.show({
          color: 'statusError',
          title: 'Scale failed',
          message: error?.message || `Could not scale ${target.name}.`,
        });
        return false;
      } finally {
        setPending(false);
      }
    },
    [call, invalidate]
  );

  return { scale, pending };
}
