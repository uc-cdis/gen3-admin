import { toPodShape } from './podShape';

describe('toPodShape', () => {
  it('reads init and main containers into one list', () => {
    const pod = {
      metadata: { name: 'usersync-abc' },
      status: {
        phase: 'Pending',
        initContainerStatuses: [
          { name: 'wait-for-db', ready: true, state: { terminated: { reason: 'Completed' } } },
        ],
        containerStatuses: [
          { name: 'usersync', ready: false, state: { waiting: { reason: 'PodInitializing' } } },
        ],
      },
    };

    const shape = toPodShape(pod);
    expect(shape.name).toBe('usersync-abc');
    expect(shape.phase).toBe('Pending');
    expect(shape.containers).toHaveLength(2);
  });

  // Init containers run before the main ones, so a failed init should read
  // above the container that is waiting on it.
  it('puts init containers first', () => {
    const pod = {
      metadata: { name: 'p' },
      status: {
        initContainerStatuses: [{ name: 'migrate', state: {} }],
        containerStatuses: [{ name: 'app', state: {} }],
      },
    };
    const [first, second] = toPodShape(pod).containers;
    expect(first.name).toBe('migrate');
    expect(first.isInit).toBe(true);
    expect(second.isInit).toBe(false);
  });

  it('maps each container state', () => {
    const pod = {
      metadata: { name: 'p' },
      status: {
        containerStatuses: [
          { name: 'a', state: { running: {} } },
          { name: 'b', state: { waiting: { reason: 'ImagePullBackOff' } } },
          { name: 'c', state: { terminated: { reason: 'Error' } } },
          { name: 'd', state: {} },
        ],
      },
    };
    expect(toPodShape(pod).containers.map((c) => c.state)).toEqual([
      'Running',
      'Waiting',
      'Terminated',
      'Unknown',
    ]);
  });

  // A pod can report Running while a container sits in either state, so the
  // reason has to come from whichever one carries it.
  it('takes the reason from waiting or terminated', () => {
    const pod = {
      metadata: { name: 'p' },
      status: {
        containerStatuses: [
          { name: 'a', state: { waiting: { reason: 'CrashLoopBackOff' } } },
          { name: 'b', state: { terminated: { reason: 'OOMKilled' } } },
        ],
      },
    };
    expect(toPodShape(pod).containers.map((c) => c.reason)).toEqual([
      'CrashLoopBackOff',
      'OOMKilled',
    ]);
  });

  it('tolerates a pod with no container statuses at all', () => {
    const shape = toPodShape({ metadata: { name: 'scheduled-not-started' }, status: {} });
    expect(shape.containers).toEqual([]);
    expect(shape.phase).toBe('Unknown');
  });

  it('defaults restarts and readiness rather than emitting undefined', () => {
    const pod = { metadata: { name: 'p' }, status: { containerStatuses: [{ name: 'a' }] } };
    const [c] = toPodShape(pod).containers;
    expect(c.restartCount).toBe(0);
    expect(c.ready).toBe(false);
  });
});
