import { summarizeRollout } from '@/lib/rolloutState';

/**
 * The services dashboard used to derive health from replica counts with a
 * local `computeStatus`, which checked `ready === 0` before looking at
 * `desired` -- so a workload deliberately scaled to zero was reported as an
 * outage and a namespace of stopped services looked like a fire.
 *
 * That helper is gone; the cards, the summary header and the modal all read
 * `summarizeRollout` now. These cover the distinction at the level the
 * dashboard actually uses.
 */
describe('dashboard service health', () => {
  it('treats scaled-to-zero as stopped, not an outage', () => {
    expect(summarizeRollout([], 0, 0).phase).toBe('stopped');
  });

  it('still reports a real outage', () => {
    const crashed = {
      metadata: {},
      status: {
        phase: 'Running',
        containerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff' } }, ready: false }],
      },
    };
    expect(summarizeRollout([crashed], 2, 0).phase).toBe('failing');
  });

  it('reports a partial rollout as in progress, not failed', () => {
    const starting = {
      metadata: {},
      status: { phase: 'Running', containerStatuses: [{ state: { running: {} }, ready: false }] },
    };
    expect(summarizeRollout([starting], 3, 1).phase).toBe('starting');
  });

  it('reports a full complement as ready', () => {
    const up = {
      metadata: {},
      status: { phase: 'Running', containerStatuses: [{ state: { running: {} }, ready: true }] },
    };
    expect(summarizeRollout([up, up], 2, 2).phase).toBe('ready');
  });
});
