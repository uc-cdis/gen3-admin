import { Alert, Badge, Button, Code, Group, Loader, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconExternalLink, IconInfoCircle, IconPlayerStop, IconRefresh, IconX } from '@tabler/icons-react';
import { runName } from '@/lib/wizardState';

const ICON = {
  green: <IconCheck size={18} />,
  red: <IconX size={18} />,
  yellow: <IconAlertTriangle size={18} />,
  blue: <IconInfoCircle size={18} />,
  gray: <IconInfoCircle size={18} />,
};

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

function elapsed(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

const RUN_COLOR = { running: 'blue', succeeded: 'green', failed: 'red', stopped: 'orange', lost: 'gray' };

/**
 * Where the environment stands, in one sentence, with what to do next. It
 * sits under the sticky stepper on every step past setup.
 *
 * actionState(action) -> { disabled, reason, loading } lets the page hold an
 * action back (an incomplete install form) and say why.
 */
export default function StateBanner({ state, environment, onAction, actionState = () => ({}), now, blockerBody = null }) {
  if (!state) return null;
  const { blocker, running, problem } = state;
  // The last run is always named, so a state can be traced to what led to it.
  const last = running || problem || state.lastRun;

  const button = (action, primary) => {
    const { disabled, reason, loading } = actionState(action);
    const icon = action.kind === 'stop' ? <IconPlayerStop size={16} />
      : action.kind === 'open' ? <IconExternalLink size={16} />
        : action.kind === 'retry-check' ? <IconRefresh size={16} /> : null;
    const color = action.kind === 'stop' || action.kind === 'teardown' ? 'red' : undefined;
    const b = (
      <Button
        key={action.label}
        size={primary ? 'sm' : 'xs'}
        variant={primary ? (action.kind === 'stop' ? 'outline' : 'filled') : 'light'}
        color={color}
        leftSection={icon}
        disabled={disabled}
        loading={loading}
        onClick={() => onAction(action)}
        {...(action.kind === 'open' ? { component: 'a', href: action.href, target: '_blank', rel: 'noreferrer' } : {})}
      >
        {action.label}
      </Button>
    );
    return reason && disabled ? <Tooltip key={action.label} label={reason}><span>{b}</span></Tooltip> : b;
  };

  return (
    <Stack gap="xs">
      {blocker && (
        <Alert color="yellow" icon={<IconAlertTriangle />}
          title={blocker.kind === 'auth' ? 'AWS session expired: nothing can run until you sign in'
            : blocker.kind === 'zone' ? blocker.title || 'The hosted zone needs fixing first'
              : 'Cannot read the state bucket'}>
          <Stack gap="xs">
            {blocker.kind === 'zone' ? (
              <>
                <Text size="sm">{blocker.message}</Text>
                {blockerBody}
              </>
            ) : blocker.loginCommand ? (
              <>
                <Text size="sm">Sign in from a terminal, then press Check again:</Text>
                <Code block>{blocker.loginCommand}</Code>
              </>
            ) : (
              <Text size="sm">{blocker.message}</Text>
            )}
            {blocker.kind !== 'zone' && (
              <Text size="xs" c="dimmed">
                What is shown below is what the state bucket said last; it may have changed since.
              </Text>
            )}
          </Stack>
        </Alert>
      )}
      <Paper withBorder p="md" radius="md"
        style={{ borderLeft: `4px solid var(--mantine-color-${state.tone === 'gray' ? 'gray-5' : `${state.tone}-6`})` }}>
        <Group justify="space-between" align="center" wrap="nowrap" gap="lg">
          <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
            <Text c={state.tone === 'gray' ? 'dimmed' : state.tone} mt={2}>
              {running ? <Loader size={16} /> : ICON[state.tone]}
            </Text>
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Group gap="xs">
                <Text fw={600}>{state.title}</Text>
                {environment && <Badge variant="outline" size="sm">{environment}</Badge>}
              </Group>
              <Text size="sm" c="dimmed">{state.detail}</Text>
              {last && (
                <Group gap={6} mt={2}>
                  <Text size="xs" c="dimmed">Last run:</Text>
                  <Badge size="xs" variant="light" color={RUN_COLOR[last.status]}>
                    {runName(last.operation)} {last.status}
                  </Badge>
                  <Text size="xs" c="dimmed" data-now={now}>
                    {last.status === 'running' ? `for ${elapsed(last.started_at)}` : ago(last.ended_at || last.started_at)}
                  </Text>
                </Group>
              )}
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {state.secondary.map((a) => button(a, false))}
            {state.primary && button(state.primary, true)}
          </Group>
        </Group>
      </Paper>
    </Stack>
  );
}
