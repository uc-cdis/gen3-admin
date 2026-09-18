/**
 * Mirrors computeStatus from index.tsx. That file is a 1300-line component
 * with no export for this, so the logic is duplicated here rather than left
 * untested; the branches are the ones that decide what colour a whole
 * namespace of services renders.
 */
function computeStatus(desired: number, ready: number) {
  if (desired === 0) return { status: 'stopped', label: 'Stopped' };
  if (ready === 0) return { status: 'down', label: 'Down' };
  if (ready < desired) return { status: 'degraded', label: 'Degraded' };
  return { status: 'healthy', label: 'Healthy' };
}

describe('service health', () => {
  // The bug this fixes: checking ready === 0 first meant a service someone
  // had deliberately scaled down was flagged red as an outage, so a
  // namespace of stopped services looked like a fire.
  it('treats scaled-to-zero as stopped, not down', () => {
    expect(computeStatus(0, 0)).toEqual({ status: 'stopped', label: 'Stopped' });
  });

  it('still reports a real outage', () => {
    // Two replicas wanted, none running -- that is down.
    expect(computeStatus(2, 0)).toEqual({ status: 'down', label: 'Down' });
  });

  it('reports a partial rollout as degraded', () => {
    expect(computeStatus(3, 1)).toEqual({ status: 'degraded', label: 'Degraded' });
  });

  it('reports a full complement as healthy', () => {
    expect(computeStatus(3, 3)).toEqual({ status: 'healthy', label: 'Healthy' });
  });
});
