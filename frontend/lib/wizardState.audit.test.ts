/**
 * Every combination the registry can hold, held to the rules every screen
 * must keep. A failure names the combination, which is a hole in the state
 * table.
 */
import { deriveState, Environment, Run, Blocker, Certificate } from './wizardState';

const STATUSES = ['new', 'planned', 'applied', 'bootstrapped', 'installed', 'partial', 'destroyed'];
const OPS = ['init', 'plan', 'apply', 'destroy', 'install-csoc', 'finish-csoc', 'uninstall-csoc'];
const OUTCOMES: Run['status'][] = ['running', 'succeeded', 'failed', 'stopped', 'lost'];
const CERTS: (Certificate | null)[] = [null, { arn: 'a' }, { arn: 'a', status: 'PENDING_VALIDATION' }, { arn: 'a', status: 'ISSUED' }, { arn: 'a', status: 'FAILED' }];
const BLOCKERS: (Blocker | null)[] = [null, { kind: 'auth', message: 'expired', loginCommand: 'aws sso login' }, { kind: 'zone', message: 'gone' }];
const GITOPS = [null, { pull_request: { state: 'open', number: 1, url: 'u' } }, { pull_request: { state: 'closed', merged: true } }];
const PLANS = [{ add: 3, change: 1, destroy: 0 }, { add: 0, change: 1, destroy: 2 }, { add: 0, change: 0, destroy: 0 }];

type Case = { name: string; env: Environment; cert: Certificate | null; blocker: Blocker | null };
const cases: Case[] = [];
for (const status of STATUSES) {
  const runs: (Run | null)[] = [null];
  for (const op of OPS) for (const st of OUTCOMES) {
    if (op === 'plan' && st === 'succeeded') PLANS.forEach((plan) => runs.push({ id: 'r', operation: op, status: st, plan }));
    else runs.push({ id: 'r', operation: op, status: st });
  }
  for (const run of runs) for (const cert of CERTS) for (const blocker of BLOCKERS) for (const gitops of GITOPS) {
    if (gitops && status !== 'bootstrapped') continue;
    const env: Environment = { name: 'w', status, last_run: run, gitops, install: gitops ? { mode: 'gitops' } : { mode: 'direct' } };
    const label = `${status} · ${run ? `${run.operation} ${run.status}${run.plan ? ` (${run.plan.add + run.plan.change + run.plan.destroy} changes)` : ''}` : 'no run'} · cert ${cert?.status || (cert ? 'checking' : 'none')} · ${blocker?.kind || 'no blocker'}${gitops ? ` · PR ${gitops.pull_request.state}` : ''}`;
    cases.push({ name: label, env, cert, blocker });
  }
}

const hasInfra = (s: string) => ['partial', 'applied', 'bootstrapped', 'installed'].includes(s);
const all = (s: ReturnType<typeof deriveState>) => [s.primary, ...s.secondary].filter(Boolean);

describe(`audit of ${cases.length} combinations`, () => {
  const holes: string[] = [];
  for (const c of cases) {
    const s = deriveState({ env: c.env, cert: c.cert, blocker: c.blocker, portalUrl: 'https://p' });
    const r = c.env.last_run;
    const why = (rule: string) => holes.push(`${rule}: ${c.name} -> ${s.id} "${s.title}"`);
    // 1. Always a way forward (or a body that is one).
    if (!s.primary && !['cert-needed', 'cert-pending'].includes(s.id)) why('no next action');
    // 2. A run going: Stop, and nothing else may start.
    if (r?.status === 'running' && !c.blocker && (s.primary?.kind !== 'stop' || s.ops.length)) why('running without Stop, or with ops');
    // 3. A plan with changes on anything but a blank account is ready to apply.
    if (r?.operation === 'plan' && r.status === 'succeeded' && r.plan && r.plan.add + r.plan.change + r.plan.destroy > 0
      && !c.blocker && !(s.primary?.kind === 'run' && s.primary.op === 'apply')) why('plan with changes but no Apply');
    // 4. An expired session allows nothing but checking again.
    if (c.blocker?.kind === 'auth' && (all(s).some((a) => a!.kind !== 'retry-check') || s.ops.length)) why('acts while signed out');
    // 5. Half-built infrastructure, or a teardown that stopped, offers tearing down.
    const halfBuilt = c.env.status === 'partial' || (r && ['destroy', 'uninstall-csoc'].includes(r.operation) && !['succeeded', 'running'].includes(r.status));
    if (halfBuilt && c.blocker?.kind !== 'auth' && r?.status !== 'running'
      && !all(s).some((a) => a!.kind === 'teardown') && !s.teardown) why('half-built infra with no way to tear it down');
    // 10. The way forward offers no teardown in the banner (it is in Advanced and on Done).
    const forward = ['cert-needed', 'cert-pending', 'cert-failed', 'infra-ready', 'awaiting-pr', 'ready-to-finish', 'bootstrap-failed', 'finish-failed'];
    if (forward.includes(s.id) && c.env.status !== 'partial' && all(s).some((a) => a!.kind === 'teardown')) why('teardown on the way forward');
    // 6. A failed, stopped or lost run is named.
    if (r && ['failed', 'stopped', 'lost'].includes(r.status) && !s.problem) why('problem run not named');
    // 7. Install and finish only with an issued certificate (or past it).
    const installs = all(s).concat(s.ops.map((op) => ({ kind: 'run', op } as never))).some((a: any) => a.kind === 'run' && a.op === 'install-csoc');
    if (installs && c.env.status === 'applied' && c.cert?.status !== 'ISSUED') why('bootstrap offered without an issued certificate');
    // 8. Applying a plan that destroys what exists asks first.
    if (r?.operation === 'plan' && r.status === 'succeeded' && r.plan?.destroy && (hasInfra(c.env.status))
      && s.primary?.kind === 'run' && s.primary.op === 'apply' && !s.primary.confirm) why('destructive apply without confirmation');
    // 9. A failed plan or init over a running CSOC does not take its next step away.
    if (r && ['plan', 'init'].includes(r.operation) && r.status !== 'running' && r.status !== 'succeeded'
      && ['applied', 'bootstrapped', 'installed'].includes(c.env.status) && !c.blocker && s.primary?.kind === 'run' && s.primary.op === r.operation) {
      why('a failed plan hijacked the next step');
    }
  }
  it('has no holes', () => {
    expect(holes).toEqual([]);
  });
});
