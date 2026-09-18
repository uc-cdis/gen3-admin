import { isScalable } from './useScaleWorkload';

describe('isScalable', () => {
  it('accepts the kinds with a scale subresource', () => {
    expect(isScalable('Deployment')).toBe(true);
    expect(isScalable('StatefulSet')).toBe(true);
    expect(isScalable('ReplicaSet')).toBe(true);
  });

  // DaemonSets scale to the node count, so a replica control would be
  // meaningless -- Kubernetes gives them no scale subresource either.
  it('rejects DaemonSet', () => {
    expect(isScalable('DaemonSet')).toBe(false);
  });

  it('rejects kinds that cannot scale at all', () => {
    expect(isScalable('Pod')).toBe(false);
    expect(isScalable('CronJob')).toBe(false);
    expect(isScalable('ConfigMap')).toBe(false);
  });

  // `type` is threaded through from a route param and may be absent.
  it('tolerates missing input', () => {
    expect(isScalable(undefined)).toBe(false);
    expect(isScalable('')).toBe(false);
  });

  // Guards against a prototype key being read as a supported kind.
  it('does not treat inherited object properties as kinds', () => {
    expect(isScalable('constructor')).toBe(false);
    expect(isScalable('toString')).toBe(false);
  });
});
