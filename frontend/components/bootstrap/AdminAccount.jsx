import { useEffect, useState } from 'react';
import { Alert, Button, Code, CopyButton, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { IconCheck, IconCopy, IconX } from '@tabler/icons-react';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%*+-=?@^_';
const generate = (n = 20) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (b) => CHARS[b % CHARS.length]).join('');

// Errors that mean "not reachable yet", not "wrong".
const TRANSIENT = /no such host|i\/o timeout|connection refused|connection reset|EOF|HTTP 50[234]|status 50[234]|TLS handshake|certificate/i;

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Who the CSOC admin is, and a new password when the old one is lost. The
 * password is never stored; the reset goes through Keycloak's master admin,
 * whose login is in Secrets Manager.
 */
export default function AdminAccount({ target, environment }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null); // { password, done }
  const [busy, setBusy] = useState(false);

  // Right after the finish, Keycloak's public name may not resolve yet, or
  // its load balancer may not answer: keep asking quietly for up to 10
  // minutes, and show an error only for anything else, or once that is up.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer;
    const ask = (attempt) => {
      post('/api/gitops/csoc-admin', { ...target, environment })
        .then((d) => { if (!cancelled) { setInfo(d); setError(null); setWaiting(false); } })
        .catch((err) => {
          if (cancelled) return;
          if (attempt < 60 && TRANSIENT.test(err.message)) {
            setWaiting(true);
            timer = setTimeout(() => ask(attempt + 1), 10000);
            return;
          }
          setWaiting(false);
          setError(err.message);
        });
    };
    ask(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [environment, target.bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/gitops/csoc-admin/reset', { ...target, environment, password: fresh.password });
      setFresh({ ...fresh, done: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Text fw={600}>Admin account</Text>
        {!info && !error && <Group gap="xs"><Loader size="xs" /><Text size="sm">{waiting ? 'Waiting for Keycloak to answer at its public name (DNS can take a few minutes)…' : 'Asking Keycloak…'}</Text></Group>}
        {info && (
          <Stack gap={2}>
            <Text size="sm">Username: <b>{info.username}</b></Text>
            <Text size="sm">Email: <b>{info.email || '(none)'}</b></Text>
            {info.session_idle_hours && (
              <Text size="xs" c="dimmed">A sign-in survives {info.session_idle_hours} hours idle, and lasts up to 12 hours{info.sessions_extended ? ' (just extended from Keycloak\'s 30 minute default)' : ''}.</Text>
            )}
          </Stack>
        )}
        {error && <Alert color="red" icon={<IconX />}>{error}</Alert>}
        {!fresh && (
          <Group>
            <Button size="xs" variant="light" onClick={() => setFresh({ password: generate(), done: false })}>Reset admin password…</Button>
          </Group>
        )}
        {fresh && !fresh.done && (
          <Stack gap="xs">
            <Text size="sm">The new password. Save it in your password manager, then set it:</Text>
            <Group gap="xs">
              <Code>{fresh.password}</Code>
              <CopyButton value={fresh.password}>
                {({ copied, copy }) => (
                  <Button size="compact-xs" variant="subtle" onClick={copy} leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={() => setFresh(null)}>Cancel</Button>
              <Button size="xs" color="red" loading={busy} onClick={reset}>Set this password</Button>
            </Group>
          </Stack>
        )}
        {fresh?.done && (
          <Alert color="green" icon={<IconCheck />}>
            Done. Sign in as <b>{info?.username || 'admin'}</b> with the new password; the old one no longer works.
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
