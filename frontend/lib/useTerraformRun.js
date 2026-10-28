import { useCallback, useEffect, useRef, useState } from 'react';

// One run at a time for one work dir: start it, follow its log, stop it.
// What the environment *is* comes from the registry (lib/wizardState); this
// only carries the run being shown and its log. A run that cannot start (an
// expired SSO session, say) leaves an error, not a log line, and nothing is
// left armed behind it.

// Where the runner keeps the plan written by `plan`, inside its work dir.
const SAVED_PLAN_PATH = '/workspace/tf/tfplan';

// The log stream goes straight to the API in development: Next's proxy
// buffers server-sent events.
// The run log stream is fetched straight from the API host, not through
// the Next.js proxy: the proxy gzip-compresses the event stream and holds
// it in a buffer, so the UI sits on "Waiting for logs...". The base is set
// per deployment (NEXT_PUBLIC_STREAM_BASE, baked at build time) and falls
// back to the local dev layout, then same-origin.
const streamBase = () =>
  process.env.NEXT_PUBLIC_STREAM_BASE ||
  (process.env.NODE_ENV !== 'production'
    ? 'http://localhost:8002/api'
    : '/api');

function toApiCredentials(credentials) {
  if (!credentials?.accessKeyId) return undefined;
  return {
    access_key_id: credentials.accessKeyId,
    secret_access_key: credentials.secretAccessKey,
    session_token: credentials.sessionToken || undefined,
  };
}

export const END = { ok: '\n✓ Execution completed successfully' };

/**
 * @param {object} p
 * @param {string} p.workDir
 * @param {string} p.environment
 * @param {string} p.moduleName
 * @param {string} p.tfvars
 * @param {object} p.awsContext  region, profile, credentials, roleArn, stateBucket, stateRegion
 * @param {(run: {id: string, operation: string}, ok: boolean) => void} [p.onEnd]
 * @param {(run: {id: string, operation: string}) => void} [p.onStart]
 */
export function useTerraformRun({ workDir, environment, moduleName, tfvars, awsContext, onEnd, onStart, dockerImage }) {
  const [run, setRun] = useState(null); // { id, operation }
  const [lines, setLines] = useState([]);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  // { message, code, loginCommand } when a run could not start.
  const [error, setError] = useState(null);
  // A plan run in this page, not yet applied: apply then runs exactly it.
  const reviewedPlan = useRef(null);
  // The run that last ended here: the API records its end a moment after
  // its log closes, and refuses a new run until then.
  const lastEnded = useRef(null);
  const stream = useRef(0); // bumps to abandon an older stream
  const callbacks = useRef({ onEnd, onStart });
  callbacks.current = { onEnd, onStart };

  useEffect(() => () => { stream.current += 1; }, []);

  const follow = useCallback(async (id, operation, { replay = false, attempt = 0, fallbackLog = null } = {}) => {
    const mine = ++stream.current;
    const current = () => mine === stream.current;
    const finish = (ok, message) => {
      if (!current()) return;
      setRunning(false);
      setLines((prev) => [...prev, message]);
      if (operation === 'plan') reviewedPlan.current = ok ? id : null;
      if (operation === 'apply') reviewedPlan.current = null;
      lastEnded.current = id;
      if (!replay) callbacks.current.onEnd?.({ id, operation }, ok);
    };
    try {
      const res = await fetch(`${streamBase()}/terraform/executions/${id}/stream`);
      if (!res.ok || !res.body) {
        // The container is gone (pruned, another machine): the registry
        // keeps every run's log.
        if (fallbackLog) {
          const text = await fallbackLog(id).catch(() => null);
          if (text != null && current()) {
            setLines(text.split('\n'));
            setRunning(false);
            return;
          }
        }
        finish(false, `\n✗ Could not stream logs (HTTP ${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = '';
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !current()) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';
        const batch = [];
        for (const line of parts) {
          if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5); // not trimmed: plan output is indented
          if (event === 'done') {
            let code = 1;
            try { code = JSON.parse(data).exit_code; } catch { /* a failure */ }
            finished = true;
            if (batch.length) setLines((prev) => [...prev, ...batch.splice(0)]);
            finish(code === 0, code === 0 ? END.ok : `\n✗ Execution failed (exit code ${code})`);
          } else if (event === 'failed') {
            finished = true;
            finish(false, `\n✗ Error: ${data}`);
          } else if (event === 'message') {
            batch.push(data);
          }
        }
        if (batch.length && current()) setLines((prev) => [...prev, ...batch]);
      }
      if (!current() || finished) return;
      // The connection dropped (a proxy, a laptop asleep), not the run: if
      // it is still going, follow it again. The stream replays the log from
      // the start, so the lines so far are replaced, not repeated.
      const list = await fetch('/api/terraform/executions').then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const live = (list || []).find((e) => e.id === id);
      if (live?.status === 'running' && attempt < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!current()) return;
        setLines([]);
        follow(id, operation, { replay, attempt: attempt + 1, fallbackLog });
        return;
      }
      finish(false, '\n✗ Log stream ended before the run reported an exit status');
    } catch (err) {
      finish(false, `\n✗ Log stream error: ${err.message}`);
    }
  }, []);

  /** Shows a run: followed live if it is going, its log otherwise. */
  const attach = useCallback((id, operation, { live = false, fallbackLog = null } = {}) => {
    setRun({ id, operation });
    setLines([]);
    setError(null);
    setRunning(live);
    follow(id, operation, { replay: !live, fallbackLog });
  }, [follow]);

  /** Starts an operation. Resolves to the new run, or null if it did not start. */
  const start = useCallback(async (operation, { force = false, install = null } = {}) => {
    setStarting(true);
    setError(null);
    try {
      const send = () => fetch('/api/terraform/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation,
          work_dir: workDir,
          runtime: 'docker',
          auto_approve: operation === 'apply' || operation === 'destroy',
          docker_image: dockerImage,
          docker_network: 'bridge',
          state_bucket: awsContext.stateBucket,
          state_region: awsContext.stateRegion,
          module: operation === 'init' ? moduleName : undefined,
          plan_file: operation === 'apply' && reviewedPlan.current ? SAVED_PLAN_PATH : undefined,
          tfvars,
          tfvars_file_name: 'terraform.tfvars',
          aws_region: awsContext.region,
          aws_profile: awsContext.profile || undefined,
          aws_credentials: toApiCredentials(awsContext.credentials),
          aws_role_arn: awsContext.roleArn || undefined,
          environment: environment || undefined,
          install: operation === 'install-csoc' ? install : undefined,
          force: force || undefined,
        }),
      });
      let res = await send();
      let data = await res.json().catch(() => ({}));
      // Busy with the run that just ended here: its end is being recorded.
      for (let i = 0; i < 10 && res.status === 409 && data.code === 'busy' && data.run_id === lastEnded.current; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        res = await send();
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        setError({
          operation,
          message: data.error || `The ${operation} could not start (HTTP ${res.status})`,
          code: data.code,
          loginCommand: data.login_command,
        });
        return null;
      }
      const started = { id: data.id, operation };
      setRun(started);
      setLines([]);
      setRunning(true);
      callbacks.current.onStart?.(started);
      follow(data.id, operation);
      return started;
    } catch (err) {
      setError({ operation, message: err.message });
      return null;
    } finally {
      setStarting(false);
    }
  }, [workDir, environment, moduleName, tfvars, awsContext, dockerImage, follow]);

  /** Stops the run shown. The registry records it as stopped, not failed. */
  const stop = useCallback(async () => {
    if (!run) return false;
    const res = await fetch(`/api/terraform/executions/${run.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError({ operation: run.operation, message: data?.error || 'Could not stop the run' });
      return false;
    }
    return true;
  }, [run]);

  return { run, lines, running, starting, error, start, attach, stop, clearError: () => setError(null) };
}
