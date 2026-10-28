// Per-resource progress of an apply or destroy, read from Terraform's own log
// lines (the runner sets -no-color):
//
//   module.vpc.aws_nat_gateway.nat_gw: Creating...
//   module.vpc.aws_nat_gateway.nat_gw: Still creating... [1m30s elapsed]
//   module.vpc.aws_nat_gateway.nat_gw: Creation complete after 1m45s [id=nat-0abc]
//   Error: creating EC2 Launch Template (...): ...
//     with module.vpc.module.squid-auto.aws_launch_template.squid_auto,
//
// Each resource is 'running', 'done' or 'failed'; one the log has not named
// yet is still waiting.

const STEP = /^(\S.*?): (Creating|Modifying|Destroying|Still creating|Still modifying|Still destroying|Creation complete|Modifications complete|Destruction complete)(?:\.\.\.)?(?: after (\S+))?(?: \[(\S+) elapsed\])?/;
const WITH = /^\s*(?:│\s*)?with (\S+?),\s*$/;
const DIAGNOSTIC = /^\s*(?:│\s*)?(Error|Warning): (.+)$/;

const VERB = {
  Creating: 'create', Modifying: 'update', Destroying: 'delete',
  'Still creating': 'create', 'Still modifying': 'update', 'Still destroying': 'delete',
  'Creation complete': 'create', 'Modifications complete': 'update', 'Destruction complete': 'delete',
};

export function parseApplyProgress(lines) {
  const byAddress = new Map();
  // Every error, with what it was about: a data source's, say, is not a
  // change in the plan, so the plan's list alone would not show it.
  const errors = [];
  byAddress.errors = errors;
  // The diagnostic a "with <address>" line belongs to; only an error fails it.
  let diagnostic = null;
  for (const raw of lines) {
    if (typeof raw !== 'string') continue;
    const line = raw.replace(/\r$/, '');
    const d = line.match(DIAGNOSTIC);
    if (d) { diagnostic = d[1] === 'Error' ? d[2] : null; continue; }
    const w = line.match(WITH);
    if (w) {
      if (diagnostic) {
        byAddress.set(w[1], { ...byAddress.get(w[1]), state: 'failed', error: diagnostic });
        errors.push({ address: w[1], error: diagnostic });
      }
      diagnostic = null;
      continue;
    }
    const m = line.match(STEP);
    if (!m) continue;
    const [, address, step, after, elapsed] = m;
    // A data source read is not a change the plan lists.
    if (/(^|\.)data\./.test(address)) continue;
    const prev = byAddress.get(address);
    if (prev?.state === 'failed') continue;
    const op = VERB[step];
    if (/complete$/.test(step)) {
      // A replace destroys then creates: only the create finishes it.
      const replacing = prev?.replacing && op === 'delete';
      byAddress.set(address, { state: replacing ? 'running' : 'done', op, took: after, replacing: prev?.replacing });
    } else {
      byAddress.set(address, {
        state: 'running', op, elapsed: elapsed || prev?.elapsed,
        replacing: prev?.replacing || (prev?.state === 'done' && prev.op === 'delete' && op === 'create') || undefined,
      });
    }
  }
  return byAddress;
}

// Rolls the states of several resources (a card and what is folded into it)
// into one.
export function combineStates(states) {
  const known = states.filter(Boolean);
  if (known.some((s) => s.state === 'failed')) return 'failed';
  if (known.some((s) => s.state === 'running')) return 'running';
  if (known.length === states.length && known.length > 0) return 'done';
  return known.length > 0 ? 'running' : 'waiting';
}

export const STATE_LABEL = { waiting: 'waiting', running: 'in progress', done: 'done', failed: 'failed' };
export const STATE_COLOR = { waiting: 'gray', running: 'blue', done: 'green', failed: 'red' };
