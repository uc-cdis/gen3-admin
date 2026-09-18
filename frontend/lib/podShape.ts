/**
 * Turning a Kubernetes pod into the shape the detail views render.
 *
 * Both the services dashboard and the "Other pods" grid need the same
 * container breakdown, and the parsing was previously inline in
 * `openPodsModal` -- so the second caller would have meant a second copy of
 * a twenty-line reduce over `initContainerStatuses` and `containerStatuses`.
 */

export type ContainerShape = {
  name: string;
  ready: boolean;
  state: 'Running' | 'Waiting' | 'Terminated' | 'Unknown';
  reason?: string;
  restartCount: number;
  isInit: boolean;
};

export type PodShape = {
  name: string;
  phase: string;
  containers: ContainerShape[];
};

function containerState(stateObj: any): ContainerShape['state'] {
  if (stateObj?.running) return 'Running';
  if (stateObj?.waiting) return 'Waiting';
  if (stateObj?.terminated) return 'Terminated';
  return 'Unknown';
}

function toContainer(c: any, isInit: boolean): ContainerShape {
  const stateObj = c?.state || {};
  return {
    name: c?.name,
    ready: c?.ready ?? false,
    state: containerState(stateObj),
    // Waiting carries the reason while starting or stuck; terminated carries
    // it after the fact. A pod can report Running while a container sits in
    // either, so both matter.
    reason: stateObj.waiting?.reason || stateObj.terminated?.reason,
    restartCount: c?.restartCount ?? 0,
    isInit,
  };
}

/**
 * Parse one pod. Init containers come first, matching the order they run in,
 * so a failed init is visible above the main container waiting on it.
 */
export function toPodShape(pod: any): PodShape {
  const init = (pod?.status?.initContainerStatuses ?? []).map((c: any) => toContainer(c, true));
  const main = (pod?.status?.containerStatuses ?? []).map((c: any) => toContainer(c, false));

  return {
    name: pod?.metadata?.name,
    phase: pod?.status?.phase ?? 'Unknown',
    containers: [...init, ...main],
  };
}
