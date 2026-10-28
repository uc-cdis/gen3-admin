/**
 * Where a CSOC bootstrap stands, and what to do next.
 *
 * The wizard used to piece this together from flags set by replayed runs,
 * the step saved in the browser and a status read once on the setup page,
 * which disagreed: after a destroy that never started it showed the last
 * apply as done with Next enabled, while the registry said failed. Now one
 * function derives it from the registry record (its settled status and its
 * last run) and from what is in the way (an expired AWS session, a
 * registry that cannot be read). Each state has one screen and one main
 * action. The table is in docs/workshop/PREP.md.
 */

export type Operation =
  | 'init'
  | 'plan'
  | 'apply'
  | 'destroy'
  | 'install-csoc'
  | 'finish-csoc'
  | 'uninstall-csoc';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'stopped' | 'lost';

export type Run = {
  id: string;
  operation: Operation | string;
  status: RunStatus;
  exit_code?: number;
  /** For a plan: what it would change. */
  plan?: { add: number; change: number; destroy: number } | null;
  started_at?: string;
  ended_at?: string;
};

export type EnvStatus =
  | 'new'
  | 'planned'
  | 'applied'
  | 'bootstrapped'
  | 'installed'
  | 'partial'
  | 'destroyed';

export type Environment = {
  name: string;
  status: EnvStatus | string;
  last_run?: Run | null;
  gitops?: { pull_request?: { state?: string; merged?: boolean; url?: string; number?: number } | null } | null;
  install?: { mode?: string } | null;
};

export type Step = 'setup' | 'provision' | 'certificate' | 'install' | 'done';

export type Action =
  | {
    kind: 'run'; op: Operation; label: string; force?: boolean; needsForm?: boolean;
    /** Typed confirmation first: this destroys or replaces running infrastructure. */
    confirm?: { destroy: number };
  }
  | { kind: 'stop'; label: string }
  | { kind: 'goto'; step: Step; label: string }
  | { kind: 'teardown'; label: string; skipUninstall?: boolean }
  | { kind: 'open'; href: string; label: string }
  | { kind: 'propose'; label: string }
  | { kind: 'retry-check'; label: string }
  | { kind: 'start-over'; label: string }
  | { kind: 'cert-records'; label: string }
  | { kind: 'cert-check'; label: string }
  | { kind: 'cert-change'; label: string };

export type Blocker = {
  /**
   * 'auth': the AWS session must be renewed. 'registry': the state bucket
   * could not be read. 'zone': the hosted zone the hostnames need is missing
   * or not delegated, so nothing that relies on it may run; tearing down
   * still may.
   */
  kind: 'auth' | 'registry' | 'zone';
  message: string;
  loginCommand?: string;
};

export type StateId =
  | 'draft'
  | 'ready-to-plan'
  | 'plan-ready'
  | 'running'
  | 'plan-failed'
  | 'apply-failed'
  | 'cert-needed'
  | 'cert-pending'
  | 'cert-failed'
  | 'infra-ready'
  | 'bootstrap-failed'
  | 'awaiting-pr'
  | 'ready-to-finish'
  | 'finish-failed'
  | 'ready'
  | 'uninstall-failed'
  | 'destroy-failed'
  | 'destroyed'
  | 'blocked';

export type Tone = 'gray' | 'blue' | 'green' | 'yellow' | 'red';

export type WizardState = {
  id: StateId;
  /** The step this state belongs on. */
  step: Step;
  tone: Tone;
  title: string;
  detail: string;
  primary: Action | null;
  secondary: Action[];
  /** Raw operations the Advanced menu may run in this state. */
  ops: Operation[];
  /** The run in progress, if any. */
  running: Run | null;
  /** The last run, when it did not succeed: failed, stopped or lost. */
  problem: Run | null;
  /** The last run, however it ended. */
  lastRun: Run | null;
  /** The teardown panel belongs open in this state. */
  teardown: boolean;
  blocker: Blocker | null;
};

/** The certificate chosen for the load balancer, and ACM's status for it. */
export type Certificate = {
  arn?: string; status?: string; reason?: string;
  /** Hostnames it does not cover: they changed since it was chosen. */
  missing?: string[];
  /** ACM has published every validation record. */
  recordsReady?: boolean;
  /** Every validation record is in its Route 53 zone / answered by public DNS. */
  inZone?: boolean;
  public?: boolean;
  /** Writing or checking the records failed. */
  error?: string;
};

export type Inputs = {
  env: Environment | null;
  cert?: Certificate | null;
  /** 'route53': the hostnames are in a zone in this account; 'self': the operator runs DNS. */
  dns?: 'route53' | 'self';
  blocker?: Blocker | null;
  /** The CSOC portal, for the Done state. */
  portalUrl?: string;
};

const LABEL: Record<string, string> = {
  init: 'Init',
  plan: 'Plan',
  apply: 'Apply',
  destroy: 'Destroy',
  'install-csoc': 'Bootstrap',
  'finish-csoc': 'Finish install',
  'uninstall-csoc': 'Uninstall',
  validate: 'Validate',
  output: 'Output',
};

/** "the apply", "the bootstrap": how the banner names a run. */
export function runName(op: string): string {
  return {
    init: 'init',
    plan: 'plan',
    apply: 'apply',
    destroy: 'destroy',
    'install-csoc': 'bootstrap',
    'finish-csoc': 'finish',
    'uninstall-csoc': 'uninstall',
  }[op] || op;
}

const TERRAFORM_OPS = ['init', 'plan', 'apply', 'destroy'];

function stepOf(op: string): Step {
  return TERRAFORM_OPS.includes(op) ? 'provision' : 'install';
}

const hasInfra = (s: string) => s === 'applied' || s === 'bootstrapped' || s === 'installed';
const hasCSOC = (s: string) => s === 'bootstrapped' || s === 'installed';

const teardown: Action = { kind: 'teardown', label: 'Tear down' };
const replan: Action = { kind: 'run', op: 'plan', label: 'Plan again' };
const editConfig: Action = { kind: 'goto', step: 'setup', label: 'Edit configuration' };

function allowedOps(status: string, certIssued: boolean): Operation[] {
  const ops: Operation[] = ['init', 'plan'];
  if (status !== 'new' && status !== 'destroyed') ops.push('apply');
  if (status === 'partial' || hasInfra(status)) ops.push('destroy');
  // The load balancer needs an issued certificate; once bootstrapped, the
  // CSOC already has one.
  if (hasCSOC(status) || (status === 'applied' && certIssued)) ops.push('install-csoc');
  if (hasCSOC(status)) ops.push('finish-csoc', 'uninstall-csoc');
  return ops;
}

type Base = Omit<WizardState, 'ops' | 'running' | 'problem' | 'lastRun' | 'blocker'>;

// Between the apply and the install: the certificate the load balancer will
// serve, chosen, then validated by ACM.
function certificateState(cert: Certificate | null | undefined, dns: 'route53' | 'self'): Base | null {
  if (!cert?.arn) {
    return {
      id: 'cert-needed', step: 'certificate', tone: 'blue',
      title: 'Infrastructure up; the CSOC needs a certificate',
      detail: 'Request a public certificate from ACM, import one, or use one the account already has. The install serves it on the load balancer.',
      primary: null, secondary: [teardown], teardown: false,
    };
  }
  if (!cert.status) {
    return {
      id: 'cert-pending', step: 'certificate', tone: 'blue', title: 'Checking the certificate…', detail: '',
      primary: null, secondary: [teardown], teardown: false,
    };
  }
  if (cert.missing?.length) {
    return {
      id: 'cert-failed', step: 'certificate', tone: 'red',
      title: `The certificate does not cover ${cert.missing.join(' or ')}`,
      detail: 'The hostnames changed since it was chosen. Request or choose one that covers them.',
      primary: { kind: 'cert-change', label: 'Use a different certificate' },
      secondary: [teardown], teardown: false,
    };
  }
  if (cert.status === 'PENDING_VALIDATION') {
    if (cert.recordsReady === false) {
      return {
        id: 'cert-pending', step: 'certificate', tone: 'blue',
        title: 'ACM is preparing the validation records',
        detail: 'They appear below within a few seconds.',
        primary: null, secondary: [], teardown: false,
      };
    }
    if (cert.error) {
      return {
        id: 'cert-pending', step: 'certificate', tone: 'red',
        title: dns === 'route53' ? 'Could not write the validation records' : 'Could not check the validation records',
        detail: cert.error,
        primary: { kind: 'cert-check', label: 'Try again' }, secondary: [], teardown: false,
      };
    }
    if (dns === 'route53') {
      // Automatic: the wizard writes the records, checks them, and moves on
      // once ACM issues the certificate. Nothing to press.
      const where = !cert.inZone ? 'Writing the validation records to Route 53'
        : !cert.public ? 'Records in Route 53; waiting for public DNS to answer'
          : 'Records in Route 53 and public DNS; waiting for ACM to issue';
      return {
        id: 'cert-pending', step: 'certificate', tone: 'blue',
        title: 'Validating the certificate',
        detail: `${where}. Usually a few minutes; this page checks every 10 seconds and moves on to Install by itself.`,
        primary: null, secondary: [], teardown: false,
      };
    }
    return {
      id: 'cert-pending', step: 'certificate', tone: 'yellow',
      title: cert.public ? 'Records found; waiting for ACM to issue' : 'Create the validation records in your DNS',
      detail: cert.public
        ? 'Public DNS answers with every record. ACM usually issues within a few minutes; this page checks every 10 seconds.'
        : 'Create the CNAME records below wherever your DNS is hosted. This page checks every 10 seconds and moves on by itself once ACM issues the certificate.',
      primary: { kind: 'cert-check', label: 'Check now' },
      secondary: [], teardown: false,
    };
  }
  if (cert.status !== 'ISSUED') {
    return {
      id: 'cert-failed', step: 'certificate', tone: 'red',
      title: `The certificate is ${cert.status.toLowerCase().replace(/_/g, ' ')}`,
      detail: cert.reason ? `ACM says: ${cert.reason.toLowerCase().replace(/_/g, ' ')}.` : 'ACM will not issue it. Request or choose another.',
      primary: { kind: 'cert-change', label: 'Use a different certificate' },
      secondary: [teardown], teardown: false,
    };
  }
  return null;
}

/** The state from the settled status alone. */
function settled(env: Environment, portalUrl?: string, cert?: Certificate | null, dns: 'route53' | 'self' = 'route53'): Base {
  const status = env.status;
  const pr = env.gitops?.pull_request;
  const gitops = Boolean(env.gitops) && env.install?.mode !== 'direct';
  switch (status) {
    case 'planned':
      return {
        id: 'plan-ready', step: 'provision', tone: 'blue',
        title: 'Plan ready',
        detail: 'Review what the plan creates, then apply it. Nothing exists in AWS yet.',
        primary: { kind: 'run', op: 'apply', label: 'Apply' },
        secondary: [replan, editConfig], teardown: false,
      };
    case 'applied':
      return certificateState(cert, dns) || {
        id: 'infra-ready', step: 'install', tone: 'blue',
        title: 'Cluster up, CSOC not installed',
        detail: 'Fill in who may reach the CSOC and the admin password, then bootstrap it.',
        primary: { kind: 'run', op: 'install-csoc', label: 'Bootstrap CSOC', needsForm: true },
        secondary: [teardown], teardown: false,
      };
    case 'bootstrapped':
      if (gitops && pr?.state === 'open') {
        return {
          id: 'awaiting-pr', step: 'install', tone: 'yellow',
          title: `Waiting for pull request #${pr.number} to be merged`,
          detail: 'Review the CSOC configuration and merge it on GitHub. This page checks every 15 seconds.',
          primary: pr.url ? { kind: 'open', href: pr.url, label: 'Open the pull request' } : null,
          secondary: [teardown], teardown: false,
        };
      }
      if (gitops && !pr?.merged) {
        return {
          id: 'awaiting-pr', step: 'install', tone: 'yellow',
          title: 'Bootstrapped; the configuration PR is not open',
          detail: 'Open the pull request with the CSOC configuration, then merge it.',
          primary: { kind: 'propose', label: 'Open pull request' },
          secondary: [teardown], teardown: false,
        };
      }
      return {
        id: 'ready-to-finish', step: 'install', tone: 'blue',
        title: 'Bootstrapped; ready to finish',
        detail: 'Finishing waits for Keycloak and the portal, adds the egress IP to the allowlist and creates the DNS records.',
        primary: { kind: 'run', op: 'finish-csoc', label: 'Finish install' },
        secondary: [{ kind: 'run', op: 'install-csoc', label: 'Bootstrap again', needsForm: true }, teardown],
        teardown: false,
      };
    case 'installed':
      return {
        id: 'ready', step: 'done', tone: 'green',
        title: 'CSOC is ready',
        detail: 'Sign in as admin with the password you set. DNS can take a few minutes.',
        primary: portalUrl ? { kind: 'open', href: portalUrl, label: 'Open the CSOC' } : null,
        secondary: [{ kind: 'run', op: 'finish-csoc', label: 'Run finish again' }, teardown],
        teardown: false,
      };
    case 'partial':
      return {
        id: 'apply-failed', step: 'provision', tone: 'red',
        title: 'Part of the infrastructure exists',
        detail: 'An apply or destroy stopped midway. Plan again to see what is left, then apply or tear down.',
        primary: replan, secondary: [teardown], teardown: false,
      };
    case 'destroyed':
      return {
        id: 'destroyed', step: 'done', tone: 'gray',
        title: 'Torn down',
        detail: 'Terraform destroyed everything it created. Below is what is left outside it.',
        primary: { kind: 'run', op: 'plan', label: 'Provision again' },
        secondary: [{ kind: 'start-over', label: 'Start over' }], teardown: true,
      };
    default:
      return {
        id: 'ready-to-plan', step: 'provision', tone: 'blue',
        title: 'Nothing created yet',
        detail: 'Plan shows everything Terraform will create. Nothing is created until you apply.',
        primary: { kind: 'run', op: 'plan', label: 'Plan' },
        secondary: [editConfig], teardown: false,
      };
  }
}

function outcomeWords(run: Run): string {
  const name = `The ${runName(run.operation)}`;
  if (run.status === 'stopped') return `${name} was stopped`;
  if (run.status === 'lost') return `${name}'s result is unknown`;
  return `${name} failed`;
}

/** Adjusts the settled state for a last run that did not succeed. */
function afterProblem(base: Base, env: Environment, run: Run): Base {
  const status = env.status;
  const words = outcomeWords(run);
  const lost = run.status === 'lost'
    ? ' The API restarted while it ran, so its end was not recorded.'
    : '';
  switch (run.operation) {
    case 'init':
    case 'plan':
      if (hasInfra(status)) {
        // A failed plan changed nothing: the real next step stays first,
        // and the failure is a note with its retry beside it.
        return {
          ...base,
          detail: `${base.detail} (${words}; nothing changed. Its log is below.)`.trim(),
          secondary: [{ kind: 'run', op: run.operation as Operation, label: `Retry ${runName(run.operation)}` }, ...base.secondary],
        };
      }
      return {
        ...base, id: 'plan-failed', tone: 'red', step: 'provision',
        title: words,
        detail: `Nothing in AWS changed. The log below says why; fix the configuration or retry.${lost}`,
        primary: { kind: 'run', op: run.operation as Operation, label: `Retry ${runName(run.operation)}` },
        secondary: [editConfig, ...base.secondary.filter((a) => a.kind === 'teardown')],
      };
    case 'apply':
      return {
        ...base, id: 'apply-failed', step: 'provision', tone: 'red',
        title: words,
        detail: (hasInfra(status)
          ? 'The cluster is still up; some changes may not have been made. Plan again to see what is left.'
          : 'Some resources may exist. Plan again to see what is left, then apply, or tear down.') + lost,
        primary: replan,
        secondary: [teardown],
      };
    case 'destroy':
      return {
        ...base, id: 'destroy-failed', step: 'done', tone: 'red',
        title: words,
        detail: `Some resources are still there. Retry the teardown; it picks up where it stopped.${lost}`,
        primary: { kind: 'teardown', label: 'Retry teardown' },
        secondary: [], teardown: true,
      };
    case 'install-csoc':
      return {
        ...base, id: 'bootstrap-failed', step: 'install', tone: 'red',
        title: words,
        detail: `The cluster is up. ${run.status === 'stopped' ? 'The log below shows where it stopped' : 'The log below says what went wrong'}; bootstrapping again is safe.${lost}`,
        primary: { kind: 'run', op: 'install-csoc', label: 'Bootstrap again', needsForm: true },
        secondary: [teardown],
      };
    case 'finish-csoc':
      if (!hasCSOC(status)) return base;
      return {
        ...base, id: 'finish-failed', step: 'install', tone: 'red',
        title: words,
        detail: `The CSOC is bootstrapped. ${run.status === 'stopped' ? 'The log below shows where it stopped' : 'The log below says what went wrong'}; finishing again is safe.${lost}`,
        primary: { kind: 'run', op: 'finish-csoc', label: 'Finish again' },
        secondary: [{ kind: 'run', op: 'install-csoc', label: 'Bootstrap again', needsForm: true }, teardown],
      };
    case 'uninstall-csoc':
      return {
        ...base, id: 'uninstall-failed', step: 'done', tone: 'red',
        title: words,
        detail: `Removing what the install added outside Terraform did not finish. Retry with Force, or destroy anyway (load balancers or volumes it missed can make the destroy hang).${lost}`,
        primary: { kind: 'teardown', label: 'Retry teardown with Force' },
        secondary: [{ kind: 'teardown', label: 'Destroy anyway…', skipUninstall: true }],
        teardown: true,
      };
  }
  return base;
}

export function deriveState({ env, blocker = null, portalUrl, cert = null, dns = 'route53' }: Inputs): WizardState {
  if (!env) {
    return {
      id: blocker ? 'blocked' : 'draft', step: 'setup', tone: blocker ? 'yellow' : 'gray',
      title: blocker ? blockerTitle(blocker) : 'Not set up yet',
      detail: blocker?.message || 'Fill in the setup, review it, and Provision registers the environment.',
      primary: null, secondary: [], ops: [], running: null, problem: null, lastRun: null, teardown: false, blocker,
    };
  }
  const run = env.last_run || null;
  const base = settled(env, portalUrl, cert, dns);
  let state: Base = base;
  let running: Run | null = null;
  let problem: Run | null = null;

  if (run?.status === 'running') {
    running = run;
    const tearing = run.operation === 'destroy' || run.operation === 'uninstall-csoc';
    state = {
      ...base, id: 'running', step: tearing ? 'done' : stepOf(run.operation), tone: 'blue',
      title: `${LABEL[run.operation] || run.operation} in progress`,
      detail: runningDetail(run.operation),
      primary: { kind: 'stop', label: 'Stop this run' },
      secondary: [], teardown: tearing,
    };
  } else if (run && run.status !== 'succeeded') {
    problem = run;
    state = afterProblem(base, env, run);
  } else if (run?.operation === 'plan' && run.status === 'succeeded' && env.status !== 'planned') {
    // A plan made on top of what exists (half-built, or running) is ready to
    // apply too. Without this the only button after Plan again was Plan
    // again.
    const p = run.plan;
    const n = p ? p.add + p.change + p.destroy : null;
    if (n !== 0) {
      const what = p ? [p.add && `${p.add} to create`, p.change && `${p.change} to change`, p.destroy && `${p.destroy} to destroy`].filter(Boolean).join(', ') : 'changes';
      state = {
        ...base, id: 'plan-ready', step: 'provision', tone: 'blue',
        title: env.status === 'partial' ? 'Plan ready to finish the infrastructure'
          : hasInfra(env.status) ? 'Plan ready: changes to the running infrastructure' : 'Plan ready',
        detail: `The plan has ${what}. Review it below, then apply.${hasInfra(env.status) || env.status === 'partial' ? '' : ' Nothing exists in AWS yet.'}`,
        primary: {
          kind: 'run', op: 'apply', label: 'Apply',
          ...(p && p.destroy > 0 && (hasInfra(env.status) || env.status === 'partial') ? { confirm: { destroy: p.destroy } } : {}),
        },
        secondary: [replan, ...(hasInfra(env.status) || env.status === 'partial' ? [teardown] : [editConfig])],
      };
    }
  }

  // A bootstrap needs an issued certificate: until there is one, the way on
  // is the certificate's, whatever the last run was.
  if (env.status === 'applied' && cert?.status !== 'ISSUED' && !running) {
    const certState = certificateState(cert, dns);
    const offersBootstrap = (a: Action | null) => a?.kind === 'run' && a.op === 'install-csoc';
    if (certState && (offersBootstrap(state.primary) || state.secondary.some(offersBootstrap))) {
      state = {
        ...state, step: 'certificate',
        // With no certificate to act on yet, the screen is the chooser.
        id: certState.primary ? state.id : certState.id,
        detail: `${state.detail} ${certState.title}: ${certState.detail}`.trim(),
        primary: certState.primary,
        secondary: [...certState.secondary.filter((a) => a.kind !== 'teardown'), teardown],
      };
    }
  }

  // Past the bootstrap, a certificate that no longer covers the hostnames
  // (they were edited) is not the next step but must not go unsaid.
  if (hasCSOC(env.status) && cert?.missing?.length && !running) {
    state = {
      ...state, tone: state.tone === 'green' ? 'yellow' : state.tone,
      detail: `${state.detail} The hostnames changed: the certificate does not cover ${cert.missing.join(' or ')}. Choose one that does, then bootstrap again.`,
      secondary: [{ kind: 'cert-change', label: 'Use a different certificate' }, ...state.secondary],
    };
  }

  // On the way forward the banner offers the next step and nothing else:
  // tearing down is on the Done step, in Advanced, and here only where it
  // is a reasonable way out (half-built infrastructure, a failed teardown).
  // Re-running a bootstrap or a finish is in Advanced too.
  const tearDownHere = state.id === 'ready' || state.id === 'destroy-failed' || state.id === 'uninstall-failed'
    || state.id === 'destroyed' || env.status === 'partial' || (state.id === 'apply-failed' && !hasInfra(env.status));
  state = {
    ...state,
    secondary: state.secondary.filter((a) => (a.kind === 'teardown' && !a.skipUninstall ? tearDownHere : true)
      && !(a.kind === 'run' && (a.op === 'install-csoc' || a.op === 'finish-csoc'))),
  };

  const out: WizardState = {
    ...state,
    ops: running ? [] : allowedOps(env.status, cert?.status === 'ISSUED'),
    running, problem, lastRun: run, blocker,
  };
  if (blocker) {
    // Nothing can run, or be known, until the blocker is cleared; what the
    // registry said last is still shown beneath it. A missing zone holds
    // back only what needs it: a teardown can still go ahead.
    out.tone = 'yellow';
    out.primary = { kind: 'retry-check', label: 'Check again' };
    out.secondary = blocker.kind === 'zone' && !running ? state.secondary.filter((a) => a.kind === 'teardown') : [];
    out.ops = [];
  }
  return out;
}

function runningDetail(op: string): string {
  return {
    init: 'Downloading the modules and providers. Under a minute.',
    plan: 'Working out what to create. Under a minute.',
    apply: 'Creating the infrastructure. 15–20 minutes; you can close this page and come back.',
    destroy: 'Deleting the infrastructure. About 5 minutes; up to 30 if AWS is slow to release network interfaces.',
    'install-csoc': 'Installing External Secrets, the load balancer controller, Keycloak and the portal. About 5 minutes.',
    'finish-csoc': 'Waiting for Keycloak and the portal, then creating the DNS records. 3–6 minutes.',
    'uninstall-csoc': 'Removing the load balancers, volumes, nodes, DNS records and secrets the install added. A few minutes.',
  }[op] || '';
}

function blockerTitle(b: Blocker): string {
  return b.kind === 'auth' ? 'AWS session expired' : 'Cannot read the state bucket';
}

export const STEP_INDEX: Record<Step, number> = { setup: 1, provision: 3, certificate: 4, install: 5, done: 6 };

/** Labels for the Advanced menu's raw operations. */
export const OP_LABEL = LABEL;
