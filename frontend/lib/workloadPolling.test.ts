import { CONVERGING_MS, SETTLED_MS, workloadRefreshInterval } from './workloadPolling';

const deployment = (spec: number, status: Record<string, number>) => ({
  spec: { replicas: spec },
  status,
});

describe('workloadRefreshInterval', () => {
  it('settles on an empty list', () => {
    expect(workloadRefreshInterval([])).toBe(SETTLED_MS);
    expect(workloadRefreshInterval(undefined)).toBe(SETTLED_MS);
  });

  it('accepts either a bare array or an items envelope', () => {
    const busy = [deployment(3, { readyReplicas: 1 })];
    expect(workloadRefreshInterval(busy)).toBe(CONVERGING_MS);
    expect(workloadRefreshInterval({ items: busy })).toBe(CONVERGING_MS);
  });

  describe('replica-backed workloads', () => {
    it('polls quickly while replicas are short of desired', () => {
      expect(workloadRefreshInterval([deployment(3, { readyReplicas: 1 })])).toBe(CONVERGING_MS);
    });

    it('settles once ready, updated and available all match', () => {
      const settled = deployment(3, {
        readyReplicas: 3,
        updatedReplicas: 3,
        availableReplicas: 3,
      });
      expect(workloadRefreshInterval([settled])).toBe(SETTLED_MS);
    });

    // A rollout can be ready on the old ReplicaSet while new pods start, so
    // ready alone is not enough to call it done.
    it('keeps polling when updated lags behind desired', () => {
      const rolling = deployment(3, {
        readyReplicas: 3,
        updatedReplicas: 1,
        availableReplicas: 3,
      });
      expect(workloadRefreshInterval([rolling])).toBe(CONVERGING_MS);
    });

    // Scaled to zero is a steady state, not something to watch.
    it('settles on a workload scaled to zero', () => {
      expect(workloadRefreshInterval([deployment(0, { readyReplicas: 0 })])).toBe(SETTLED_MS);
    });

    it('polls quickly when a DaemonSet is short of its node count', () => {
      const ds = { status: { desiredNumberScheduled: 5, numberReady: 2 } };
      expect(workloadRefreshInterval([ds])).toBe(CONVERGING_MS);
    });

    // One unhealthy workload in a long list must speed up the whole page.
    it('takes the fastest interval any item asks for', () => {
      const list = [
        deployment(1, { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 }),
        deployment(3, { readyReplicas: 0 }),
      ];
      expect(workloadRefreshInterval(list)).toBe(CONVERGING_MS);
    });
  });

  describe('pods', () => {
    const pod = (phase: string, containerStatuses: any[] = []) => ({
      spec: { containers: [{ name: 'app' }] },
      status: { phase, containerStatuses },
    });

    it('polls quickly while pending', () => {
      expect(workloadRefreshInterval([pod('Pending')])).toBe(CONVERGING_MS);
    });

    it('settles on a running pod with every container ready', () => {
      expect(workloadRefreshInterval([pod('Running', [{ ready: true }])])).toBe(SETTLED_MS);
    });

    it('polls quickly on a running pod whose containers are not ready', () => {
      expect(workloadRefreshInterval([pod('Running', [{ ready: false }])])).toBe(CONVERGING_MS);
    });

    // Terminal states will not change again on their own.
    it('settles on succeeded and failed pods', () => {
      expect(workloadRefreshInterval([pod('Succeeded')])).toBe(SETTLED_MS);
      expect(workloadRefreshInterval([pod('Failed')])).toBe(SETTLED_MS);
    });
  });

  describe('jobs', () => {
    it('polls quickly while a job is active', () => {
      expect(workloadRefreshInterval([{ spec: { completions: 1 }, status: { active: 1 } }])).toBe(
        CONVERGING_MS
      );
    });

    it('settles on a finished job', () => {
      expect(
        workloadRefreshInterval([{ spec: { completions: 1 }, status: { active: 0, succeeded: 1 } }])
      ).toBe(SETTLED_MS);
    });
  });

  // Objects with no replica or phase information must not pin the page at the
  // fast rate forever.
  it('settles on kinds it does not recognise', () => {
    expect(workloadRefreshInterval([{ metadata: { name: 'a-configmap' } }])).toBe(SETTLED_MS);
  });
});
