import { useCallback, useState } from 'react';
import { notifications } from '@mantine/notifications';

import { useK8sMutation } from './useK8s';

/**
 * Suspending and resuming a CronJob.
 *
 * `spec.suspend` stops Kubernetes creating new Jobs from the schedule. Runs
 * already in flight are left alone, which is usually what someone reaching
 * for this wants: stop the next one, do not kill the current one.
 */

export type SuspendTarget = {
  namespace: string;
  name: string;
  /** Agent the CronJob lives on; omitted uses the resolved cluster. */
  cluster?: string | null;
};

export function useSuspendCronJob() {
  const { call, invalidate } = useK8sMutation();
  const [pending, setPending] = useState(false);

  const setSuspended = useCallback(
    async (target: SuspendTarget, suspend: boolean): Promise<boolean> => {
      setPending(true);
      try {
        await call(
          `/apis/batch/v1/namespaces/${target.namespace}/cronjobs/${target.name}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/merge-patch+json' },
            body: { spec: { suspend } },
            cluster: target.cluster,
          }
        );

        await invalidate('/apis/batch/v1');

        notifications.show({
          color: suspend ? 'statusWarn' : 'statusOk',
          title: suspend ? 'Suspended' : 'Resumed',
          message: suspend
            ? `${target.name} will not start new runs. Anything already running continues.`
            : `${target.name} will run on its schedule again.`,
        });
        return true;
      } catch (error: any) {
        notifications.show({
          color: 'statusError',
          title: suspend ? 'Could not suspend' : 'Could not resume',
          message: error?.message || `Failed to update ${target.name}.`,
        });
        return false;
      } finally {
        setPending(false);
      }
    },
    [call, invalidate]
  );

  return { setSuspended, pending };
}

/**
 * Whether a CronJob is suspended.
 *
 * The field is `spec.suspend`. Several call sites read `spec.suspended`,
 * which does not exist on the Kubernetes object and is therefore always
 * undefined -- so a suspended CronJob rendered as active and an
 * Active/Suspended filter matched everything. Reading it in one place keeps
 * the typo from coming back.
 */
export function isSuspended(cronJob: any): boolean {
  return cronJob?.spec?.suspend === true;
}
