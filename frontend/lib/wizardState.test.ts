import { deriveState, Environment, Run } from './wizardState';

const run = (operation: string, status: Run['status']): Run => ({ id: 'r1', operation, status });
const env = (status: string, last_run: Run | null = null, extra: Partial<Environment> = {}): Environment => ({
  name: 'workshop', status, last_run, ...extra,
});

describe('deriveState', () => {
  it.each([
    // [case, env, id, step, primary]
    ['no environment', null, 'draft', 'setup', undefined],
    ['new', env('new'), 'ready-to-plan', 'provision', 'run:plan'],
    ['plan ready', env('planned', run('plan', 'succeeded')), 'plan-ready', 'provision', 'run:apply'],
    ['plan running', env('new', run('plan', 'running')), 'running', 'provision', 'stop'],
    ['plan failed', env('new', run('plan', 'failed')), 'plan-failed', 'provision', 'run:plan'],
    ['first apply failed', env('partial', run('apply', 'failed')), 'apply-failed', 'provision', 'run:plan'],
    ['apply stopped', env('partial', run('apply', 'stopped')), 'apply-failed', 'provision', 'run:plan'],
    ['infra ready', env('applied', run('apply', 'succeeded')), 'infra-ready', 'install', 'run:install-csoc'],
    ['bootstrap running', env('applied', run('install-csoc', 'running')), 'running', 'install', 'stop'],
    ['bootstrap failed', env('applied', run('install-csoc', 'failed')), 'bootstrap-failed', 'install', 'run:install-csoc'],
    ['ready to finish', env('bootstrapped', run('install-csoc', 'succeeded')), 'ready-to-finish', 'install', 'run:finish-csoc'],
    ['finish failed', env('bootstrapped', run('finish-csoc', 'failed')), 'finish-failed', 'install', 'run:finish-csoc'],
    ['finish lost', env('bootstrapped', run('finish-csoc', 'lost')), 'finish-failed', 'install', 'run:finish-csoc'],
    ['ready', env('installed', run('finish-csoc', 'succeeded')), 'ready', 'done', 'open'],
    ['uninstall running', env('installed', run('uninstall-csoc', 'running')), 'running', 'done', 'stop'],
    ['uninstall failed', env('installed', run('uninstall-csoc', 'failed')), 'uninstall-failed', 'done', 'teardown'],
    ['destroy running', env('applied', run('destroy', 'running')), 'running', 'done', 'stop'],
    ['destroy failed', env('partial', run('destroy', 'failed')), 'destroy-failed', 'done', 'teardown'],
    ['destroyed', env('destroyed', run('destroy', 'succeeded')), 'destroyed', 'done', 'run:plan'],
  ])('%s', (_, e, id, step, primary) => {
    const s = deriveState({ env: e as Environment | null, portalUrl: 'https://portal.example.org', cert: { arn: 'arn:c', status: 'ISSUED' } });
    expect(s.id).toBe(id);
    expect(s.step).toBe(step);
    const p = s.primary;
    const got = !p ? undefined : p.kind === 'run' ? `run:${p.op}` : p.kind;
    expect(got).toBe(primary);
  });

  it('keeps the next step first when a plan fails over a running CSOC', () => {
    const s = deriveState({ env: env('bootstrapped', run('plan', 'failed')) });
    expect(s.id).toBe('ready-to-finish');
    expect(s.primary).toEqual({ kind: 'run', op: 'finish-csoc', label: 'Finish install' });
    expect(s.secondary[0]).toEqual({ kind: 'run', op: 'plan', label: 'Retry plan' });
    expect(s.problem?.operation).toBe('plan');
  });

  it('asks for a typed confirmation to apply a plan that destroys running infrastructure', () => {
    const destroys = { ...run('plan', 'succeeded'), plan: { add: 0, change: 1, destroy: 2 } };
    const creates = { ...run('plan', 'succeeded'), plan: { add: 3, change: 0, destroy: 0 } };
    expect(deriveState({ env: env('installed', destroys) }).primary).toMatchObject({ op: 'apply', confirm: { destroy: 2 } });
    expect(deriveState({ env: env('installed', creates) }).primary).not.toHaveProperty('confirm');
  });

  it('waits on an open pull request in GitOps mode', () => {
    const s = deriveState({
      env: env('bootstrapped', run('install-csoc', 'succeeded'), {
        gitops: { pull_request: { state: 'open', number: 7, url: 'https://github.com/o/r/pull/7' } },
        install: { mode: 'gitops' },
      }),
    });
    expect(s.id).toBe('awaiting-pr');
    expect(s.primary).toEqual({ kind: 'open', href: 'https://github.com/o/r/pull/7', label: 'Open the pull request' });
  });

  it('offers to destroy without uninstalling when the uninstall failed', () => {
    const s = deriveState({ env: env('installed', run('uninstall-csoc', 'failed')) });
    expect(s.secondary).toContainEqual({ kind: 'teardown', label: 'Destroy anyway…', skipUninstall: true });
    expect(s.teardown).toBe(true);
  });

  it('allows nothing while a run is going', () => {
    expect(deriveState({ env: env('planned', run('apply', 'running')) }).ops).toEqual([]);
  });

  it('only allows what the status permits', () => {
    expect(deriveState({ env: env('new') }).ops).toEqual(['init', 'plan']);
    expect(deriveState({ env: env('installed') }).ops).toEqual(
      ['init', 'plan', 'apply', 'destroy', 'install-csoc', 'finish-csoc', 'uninstall-csoc']);
  });

  it('blocks every action while the AWS session is expired', () => {
    const s = deriveState({
      env: env('bootstrapped', run('finish-csoc', 'failed')),
      blocker: { kind: 'auth', message: 'expired', loginCommand: 'aws sso login --profile p' },
    });
    expect(s.ops).toEqual([]);
    expect(s.primary).toEqual({ kind: 'retry-check', label: 'Check again' });
    expect(s.secondary).toEqual([]);
    // What the registry said last stays visible.
    expect(s.id).toBe('finish-failed');
  });

  it('holds back everything but teardown while the hosted zone is missing', () => {
    const s = deriveState({
      env: env('partial', run('apply', 'failed')),
      blocker: { kind: 'zone', message: 'The hosted zone for portal.example.org no longer exists.' },
    });
    expect(s.ops).toEqual([]);
    expect(s.primary).toEqual({ kind: 'retry-check', label: 'Check again' });
    expect(s.secondary).toEqual([{ kind: 'teardown', label: 'Tear down' }]);
    expect(s.id).toBe('apply-failed');
  });

  it.each([
    ['no certificate yet', null, 'cert-needed', undefined],
    ['records not published yet', { arn: 'a', status: 'PENDING_VALIDATION', recordsReady: false }, 'cert-pending', undefined],
    ['pending, Route 53: automatic', { arn: 'a', status: 'PENDING_VALIDATION', recordsReady: true, inZone: true }, 'cert-pending', undefined],
    ['writing failed', { arn: 'a', status: 'PENDING_VALIDATION', recordsReady: true, error: 'AccessDenied' }, 'cert-pending', 'cert-check'],
    ['failed', { arn: 'a', status: 'FAILED', reason: 'CAA_ERROR' }, 'cert-failed', 'cert-change'],
    ['issued', { arn: 'a', status: 'ISSUED' }, 'infra-ready', 'run'],
  ])('certificate: %s', (_, cert, id, primary) => {
    const s = deriveState({ env: env('applied', run('apply', 'succeeded')), cert });
    expect(s.id).toBe(id);
    expect(s.primary?.kind).toBe(primary);
  });

  it('asks for the records by hand when DNS is not in Route 53', () => {
    const s = deriveState({ env: env('applied'), cert: { arn: 'a', status: 'PENDING_VALIDATION' }, dns: 'self' });
    expect(s.primary).toEqual({ kind: 'cert-check', label: 'Check now' });
  });

  it('flags a certificate that no longer covers the hostnames', () => {
    const s = deriveState({ env: env('applied'), cert: { arn: 'a', status: 'ISSUED', missing: ['auth.new.example.org'] } });
    expect(s.id).toBe('cert-failed');
    expect(s.title).toBe('The certificate does not cover auth.new.example.org');
    const installed = deriveState({ env: env('installed'), cert: { arn: 'a', status: 'ISSUED', missing: ['portal.new.example.org'] } });
    expect(installed.id).toBe('ready');
    expect(installed.secondary[0]).toEqual({ kind: 'cert-change', label: 'Use a different certificate' });
  });
});
