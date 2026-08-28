import {
  resolveHttpStatus,
  resolveReplicaStatus,
  resolveStatus,
} from './status';

describe('resolveStatus', () => {
  it('normalises casing and punctuation', () => {
    // 'OutOfSync', 'outofsync' and 'out-of-sync' must all resolve identically.
    expect(resolveStatus('argoSync', 'OutOfSync').tone).toBe('warn');
    expect(resolveStatus('argoSync', 'outofsync').tone).toBe('warn');
    expect(resolveStatus('argoSync', 'out-of-sync').tone).toBe('warn');
  });

  it('keeps ArgoCD sync, health and operation as separate domains', () => {
    // Progressing is a health state, not a sync state. Flattening the three axes
    // through one lookup is the bug this domain split prevents.
    expect(resolveStatus('argoHealth', 'Progressing').tone).toBe('pending');
    expect(resolveStatus('argoSync', 'Progressing').tone).toBe('neutral');
    expect(resolveStatus('argoOp', 'Running').tone).toBe('pending');

    expect(resolveStatus('argoHealth', 'Degraded').tone).toBe('error');
    expect(resolveStatus('argoHealth', 'Missing').tone).toBe('warn');
    expect(resolveStatus('argoHealth', 'Suspended').tone).toBe('info');
  });

  it('resolves Succeeded consistently across domains', () => {
    // Previously gray in DataTable, blue in ResourceDetails and teal in ArgoCD.
    expect(resolveStatus('pod', 'Succeeded').tone).toBe('info');
    expect(resolveStatus('argoOp', 'Succeeded').tone).toBe('ok');
  });

  it('separates Pending from failure states', () => {
    // A Pending pod is normal; CrashLoopBackOff is not. Both were orange before.
    expect(resolveStatus('pod', 'Pending').tone).toBe('pending');
    expect(resolveStatus('pod', 'CrashLoopBackOff').tone).toBe('error');
    expect(resolveStatus('pod', 'Pending').tone).not.toBe(
      resolveStatus('pod', 'CrashLoopBackOff').tone
    );
  });

  it('lets a failing container reason override a healthy phase', () => {
    // A crash-looping pod still reports phase=Running.
    const status = resolveStatus('pod', 'Running', { reason: 'CrashLoopBackOff' });
    expect(status.tone).toBe('error');
    expect(status.label).toBe('CrashLoopBackOff');
  });

  it('treats a transitional reason as pending, not failed', () => {
    expect(resolveStatus('pod', 'Pending', { reason: 'ContainerCreating' }).tone).toBe('pending');
  });

  it('downgrades Running to pending when containers are not ready', () => {
    expect(resolveStatus('pod', 'Running', { ready: false }).tone).toBe('pending');
    expect(resolveStatus('pod', 'Running', { ready: true }).tone).toBe('ok');
  });

  it('falls back to a neutral humanised label for unknown values', () => {
    const status = resolveStatus('pod', 'SomeBrandNewPhase');
    expect(status.tone).toBe('neutral');
    expect(status.label).toBe('Some Brand New Phase');
  });

  it('handles null and undefined without throwing', () => {
    expect(resolveStatus('pod', null).tone).toBe('neutral');
    expect(resolveStatus('pod', undefined).label).toBe('Unknown');
  });

  it('maps node Ready conditions expressed as booleans', () => {
    expect(resolveStatus('node', 'True').tone).toBe('ok');
    expect(resolveStatus('node', 'False').tone).toBe('error');
  });

  it('exposes a color for every tone', () => {
    for (const value of ['Running', 'Pending', 'Failed', 'Succeeded', 'Nonsense']) {
      expect(resolveStatus('pod', value).color).toMatch(/^status/);
    }
  });
});

describe('resolveReplicaStatus', () => {
  it('treats scaled-to-zero as neutral rather than broken', () => {
    const status = resolveReplicaStatus(0, 0);
    expect(status.tone).toBe('neutral');
    expect(status.label).toBe('0/0');
  });

  it('flags no available replicas as an error', () => {
    expect(resolveReplicaStatus(0, 3).tone).toBe('error');
  });

  it('reports partial readiness as pending', () => {
    expect(resolveReplicaStatus(1, 3).tone).toBe('pending');
  });

  it('reports full readiness as ok', () => {
    expect(resolveReplicaStatus(3, 3).tone).toBe('ok');
  });

  it('defaults missing counts to zero', () => {
    expect(resolveReplicaStatus(undefined, undefined).label).toBe('0/0');
  });
});

describe('resolveHttpStatus', () => {
  it('buckets status codes by class', () => {
    expect(resolveHttpStatus(200).tone).toBe('ok');
    expect(resolveHttpStatus(301).tone).toBe('info');
    expect(resolveHttpStatus(404).tone).toBe('warn');
    expect(resolveHttpStatus(500).tone).toBe('error');
    expect(resolveHttpStatus(undefined).tone).toBe('neutral');
  });
});
