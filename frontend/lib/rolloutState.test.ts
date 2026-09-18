import { rolloutColor, rolloutLabel, summarizeRollout } from './rolloutState';

const pod = (phase: string, containers: any[] = [], deleting = false) => ({
  metadata: deleting ? { deletionTimestamp: '2026-01-01T00:00:00Z' } : {},
  status: { phase, containerStatuses: containers },
});

const waiting = (reason: string) => ({ state: { waiting: { reason } }, ready: false });
const running = () => ({ state: { running: {} }, ready: true });
const notReady = () => ({ state: { running: {} }, ready: false });

describe('summarizeRollout', () => {
  // The list comes off a Service object the modal captured when it opened,
  // which can predate the field. This threw at runtime -- "Cannot read
  // properties of undefined" -- because the type declared it required and
  // TypeScript therefore trusted it.
  it('degrades to the replica counts when the pod list is missing', () => {
    expect(() => summarizeRollout(undefined, 2, 1)).not.toThrow();
    const s = summarizeRollout(undefined, 2, 1);
    expect(s.phase).toBe('starting');
    expect(s.ready).toBe(1);
    expect(s.desired).toBe(2);
  });

  it('reports stopped for a missing list with nothing desired', () => {
    expect(summarizeRollout(undefined, 0, 0).phase).toBe('stopped');
  });

  // Scaled to zero is deliberate, not an outage -- the whole point of the
  // distinction the dashboard was getting wrong.
  it('reports a deliberate zero as stopped, not failing', () => {
    const s = summarizeRollout([], 0, 0);
    expect(s.phase).toBe('stopped');
    expect(s.converging).toBe(false);
  });

  it('reports the tail of a scale-down', () => {
    const s = summarizeRollout([pod('Running', [running()], true)], 0, 0);
    expect(s.phase).toBe('terminating');
    expect(s.detail).toBe('1 shutting down');
    expect(s.converging).toBe(true);
  });

  it('says what a starting pod is actually doing', () => {
    const s = summarizeRollout([pod('Pending', [waiting('Pulling')])], 2, 0);
    expect(s.phase).toBe('pulling');
    expect(s.detail).toBe('1 pulling image');
    expect(s.converging).toBe(true);
  });

  it('distinguishes scheduling from pulling', () => {
    expect(summarizeRollout([pod('Pending')], 1, 0).phase).toBe('pending');
  });

  it('reports running-but-not-ready as starting', () => {
    const s = summarizeRollout([pod('Running', [notReady()])], 1, 0);
    expect(s.phase).toBe('starting');
  });

  // A failure outranks progress: it is what the reader needs to see first.
  it('surfaces a failure ahead of other pods still starting', () => {
    const s = summarizeRollout(
      [pod('Running', [waiting('CrashLoopBackOff')]), pod('Pending', [waiting('Pulling')])],
      2,
      0
    );
    expect(s.phase).toBe('failing');
    expect(s.detail).toBe('1 crash looping');
  });

  // A crash loop will not fix itself, so polling fast forever is pointless.
  it('does not mark a failing workload as converging', () => {
    const s = summarizeRollout([pod('Running', [waiting('ImagePullBackOff')])], 1, 0);
    expect(s.converging).toBe(false);
    expect(s.detail).toBe('1 image pull failed');
  });

  it('is settled once every replica is ready', () => {
    const s = summarizeRollout([pod('Running', [running()]), pod('Running', [running()])], 2, 2);
    expect(s.phase).toBe('ready');
    expect(s.detail).toBe('');
    expect(s.converging).toBe(false);
  });

  // desired comes from the spec, so a scale-up shows immediately -- before
  // Kubernetes has created any pod to observe.
  it('reflects a scale-up before the new pods exist', () => {
    const s = summarizeRollout([pod('Running', [running()])], 3, 1);
    expect(s.converging).toBe(true);
    expect(s.detail).toBe('2 to go');
  });

  it('reads init container state too', () => {
    const s = summarizeRollout(
      [{ metadata: {}, status: { phase: 'Pending', initContainerStatuses: [waiting('Pulling')] } }],
      1,
      0
    );
    expect(s.phase).toBe('pulling');
  });

  it('humanises an unmapped reason rather than showing camel case', () => {
    const s = summarizeRollout([pod('Running', [waiting('CreateContainerError')])], 1, 0);
    expect(s.detail).toBe('1 create container error');
  });
});

describe('phase presentation', () => {
  it('uses theme status tokens, not raw colours', () => {
    expect(rolloutColor('ready')).toBe('statusOk');
    expect(rolloutColor('failing')).toBe('statusError');
    expect(rolloutColor('pulling')).toBe('statusPending');
    // Stopped is neutral: grey, not red.
    expect(rolloutColor('stopped')).toBe('statusNeutral');
  });

  it('labels each phase', () => {
    expect(rolloutLabel('stopped')).toBe('Stopped');
    expect(rolloutLabel('pulling')).toBe('Pulling');
    expect(rolloutLabel('ready')).toBe('Healthy');
  });
});
