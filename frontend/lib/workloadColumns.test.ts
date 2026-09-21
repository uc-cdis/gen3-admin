import { formatDuration } from './workloadColumns';
import { resolveReplicaStatus, resolveStatus } from './status';

/**
 * The column builders themselves render JSX, so these cover the decisions the
 * cells make -- which is where the behaviour that matters lives. The rendering
 * is `ReplicaBadge` and `StatusBadge`, already covered by status.test.ts.
 */

describe('replica status shown by readyColumn', () => {
  // The distinction the old plain-text `2/3` could not make.
  it('separates scaled-to-zero from unavailable', () => {
    const scaledDown = resolveReplicaStatus(0, 0);
    const broken = resolveReplicaStatus(0, 3);

    expect(scaledDown.tone).toBe('neutral');
    expect(scaledDown.description).toMatch(/scaled to zero/i);

    expect(broken.tone).toBe('error');
    expect(broken.description).toMatch(/no replicas/i);
  });

  it('marks a partial rollout as pending, not failed', () => {
    expect(resolveReplicaStatus(2, 3).tone).toBe('pending');
  });

  it('marks a full rollout as ok', () => {
    expect(resolveReplicaStatus(3, 3).tone).toBe('ok');
  });

  // Missing fields are normal on a freshly created object.
  it('treats undefined counts as zero rather than throwing', () => {
    expect(() => resolveReplicaStatus(undefined, undefined)).not.toThrow();
    expect(resolveReplicaStatus(undefined, undefined).tone).toBe('neutral');
  });
});

describe('pod status shown by podStatusColumn', () => {
  // The case the old hand-rolled switch missed: a crash-looping pod still
  // reports phase Running, so only the container reason reveals it.
  it('reports a crash loop as an error despite phase Running', () => {
    const status = resolveStatus('pod', 'Running', { reason: 'CrashLoopBackOff' });
    expect(status.tone).toBe('error');
  });

  it('reports an image pull failure as an error', () => {
    expect(resolveStatus('pod', 'Pending', { reason: 'ImagePullBackOff' }).tone).toBe('error');
  });

  it('downgrades Running-but-not-ready to pending', () => {
    expect(resolveStatus('pod', 'Running', { ready: false }).tone).toBe('pending');
  });

  it('keeps a healthy running pod ok', () => {
    expect(resolveStatus('pod', 'Running', { ready: true }).tone).toBe('ok');
  });
});

describe('job status shown by jobStatusColumn', () => {
  it('maps the terminal states', () => {
    expect(resolveStatus('job', 'complete').tone).toBe('ok');
    expect(resolveStatus('job', 'failed').tone).toBe('error');
    expect(resolveStatus('job', 'active').tone).toBe('pending');
    expect(resolveStatus('job', 'suspended').tone).toBe('info');
  });
});

describe('formatDuration', () => {
  it('measures a finished job between its timestamps', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:45Z')).toBe('45s');
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z')).toBe('5m');
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T03:00:00Z')).toBe('3h');
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z')).toBe('2d');
  });

  // A running job has no completionTime; measuring against now means the cell
  // ticks up instead of reading '-' for the whole run.
  it('measures a running job against now', () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
    expect(formatDuration(thirtySecondsAgo)).toMatch(/^\d+s$/);
  });

  it('returns a dash for missing or unparseable input', () => {
    expect(formatDuration(undefined)).toBe('-');
    expect(formatDuration('not a date')).toBe('-');
    expect(formatDuration('2026-01-01T00:00:00Z', 'not a date')).toBe('-');
  });

  // Clock skew between the API server and the browser must not render as a
  // negative duration.
  it('clamps a completion that predates the start', () => {
    expect(formatDuration('2026-01-01T00:01:00Z', '2026-01-01T00:00:00Z')).toBe('0s');
  });
});
