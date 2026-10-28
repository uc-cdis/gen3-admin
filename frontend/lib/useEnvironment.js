import { useCallback, useEffect, useRef, useState } from 'react';

// The environment's record in the state bucket: its settled status and its
// last run, which is what lib/wizardState derives the wizard's state from.
// Polled every few seconds while a run is going (the API records its end a
// moment after the log stream closes) and every half minute otherwise. A
// failed read keeps the last record and reports the error, with the login
// command when the AWS session expired.
export function useEnvironment({ target, name, enabled }) {
  const [env, setEnv] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const key = enabled ? JSON.stringify({ ...target, name }) : null;
  const latest = useRef({ target, name });
  latest.current = { target, name };
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!key) return null;
    const mine = ++seq.current;
    try {
      const res = await fetch('/api/environments/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...latest.current.target, name: latest.current.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (mine !== seq.current) return null;
      if (res.status === 404) {
        setEnv(null);
        setError(null);
      } else if (!res.ok) {
        setError({ message: data.error || `HTTP ${res.status}`, code: data.code, loginCommand: data.login_command });
      } else {
        setEnv(data);
        setError(null);
      }
      setLoaded(true);
      return res.ok ? data : null;
    } catch (err) {
      if (mine === seq.current) setError({ message: err.message });
      return null;
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    refresh();
  }, [key, refresh]);

  const running = env?.last_run?.status === 'running';
  useEffect(() => {
    if (!key) return undefined;
    const id = setInterval(refresh, running ? 4000 : 30000);
    return () => clearInterval(id);
  }, [key, running, refresh]);

  // A new name is a different environment: forget the old record.
  useEffect(() => {
    setEnv(null);
    setLoaded(false);
  }, [name]);

  return { env, error, loaded, refresh };
}

// value, passed on at most once per interval: the plan review re-parses the
// whole log on every update, which is thousands of lines during an apply.
export function useThrottled(value, ms = 1000) {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  const timer = useRef(null);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    clearTimeout(timer.current);
    if (wait <= 0) {
      last.current = Date.now();
      setShown(value);
      return undefined;
    }
    timer.current = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer.current);
  }, [value, ms]);
  return shown;
}
