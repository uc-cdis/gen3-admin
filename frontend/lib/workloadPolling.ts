/**
 * How often to refetch a workload list.
 *
 * Every list view was fetch-once: `GenericDataTable` defaults
 * `refreshInterval` to 0 and no page overrode it. So a rollout you had just
 * triggered sat frozen until you reloaded, and the Age column never ticked
 * because it is computed at render with nothing to cause one.
 *
 * Polling fast all the time would be wasteful -- each request crosses the
 * agent's gRPC tunnel -- and polling slowly all the time makes the console
 * feel broken during the thirty seconds anyone is actually watching. So the
 * rate follows the data, the same approach `useArgoCD` already takes: quick
 * while something is converging, background otherwise.
 */

/** While a rollout, scale or restart is in flight. */
export const CONVERGING_MS = 5_000;

/** Steady state: slow enough to be cheap, fast enough that ages stay honest. */
export const SETTLED_MS = 30_000;

type AnyRecord = Record<string, any>;

function items(data: unknown): AnyRecord[] {
  if (Array.isArray(data)) return data as AnyRecord[];
  const maybe = (data as AnyRecord | undefined)?.items;
  return Array.isArray(maybe) ? maybe : [];
}

/**
 * True when a replica-backed object has not reached its desired count.
 *
 * Reads both spec and status shapes, so one predicate covers Deployments,
 * StatefulSets and ReplicaSets (spec.replicas) as well as DaemonSets
 * (status.desiredNumberScheduled).
 */
function replicasConverging(o: AnyRecord): boolean {
  const desired = o?.spec?.replicas ?? o?.status?.desiredNumberScheduled;
  if (typeof desired !== 'number') return false;

  const ready = o?.status?.readyReplicas ?? o?.status?.numberReady ?? 0;
  if (ready !== desired) return true;

  // A rollout can be ready on the old ReplicaSet while new pods are still
  // coming up, so updated/available lagging also counts as in-flight.
  const updated = o?.status?.updatedReplicas ?? o?.status?.updatedNumberScheduled;
  if (typeof updated === 'number' && updated !== desired) return true;

  const available = o?.status?.availableReplicas ?? o?.status?.numberAvailable;
  if (typeof available === 'number' && available !== desired) return true;

  return false;
}

function podConverging(o: AnyRecord): boolean {
  const phase = o?.status?.phase;
  // Succeeded and Failed are terminal; Running with every container ready is
  // steady. Anything else is still moving.
  if (phase === 'Pending' || phase === 'Unknown') return true;
  if (phase !== 'Running') return false;

  const containers = o?.status?.containerStatuses;
  if (!Array.isArray(containers) || containers.length === 0) return true;
  return !containers.every((c: AnyRecord) => c?.ready);
}

function jobConverging(o: AnyRecord): boolean {
  return (o?.status?.active ?? 0) > 0;
}

/**
 * Pick a refresh interval for a list of Kubernetes objects.
 *
 * Deliberately one function over mixed kinds: a page shows one kind, but the
 * predicates are cheap and keeping them together means a new list view gets
 * sensible behaviour without choosing a poller.
 */
export function workloadRefreshInterval(data: unknown): number {
  const list = items(data);
  if (list.length === 0) return SETTLED_MS;

  const converging = list.some((o) => {
    if (o?.status?.containerStatuses || o?.spec?.containers) return podConverging(o);
    if (o?.status?.active !== undefined || o?.spec?.completions !== undefined) {
      return jobConverging(o);
    }
    return replicasConverging(o);
  });

  return converging ? CONVERGING_MS : SETTLED_MS;
}
