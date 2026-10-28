import { Badge, Group, Loader, Text } from '@mantine/core';
import { IconCheck, IconClock, IconX } from '@tabler/icons-react';

// Where one resource is in the apply: waiting, in progress (with how long),
// done, or failed.
export default function ApplyState({ state, size = 14 }) {
  const s = state?.state || 'waiting';
  if (s === 'done') return <Group gap={4} wrap="nowrap"><IconCheck size={size} color="var(--mantine-color-green-6)" /><Text size="xs" c="green.7">{state.took ? `done in ${state.took}` : 'done'}</Text></Group>;
  if (s === 'failed') return <Group gap={4} wrap="nowrap"><IconX size={size} color="var(--mantine-color-red-6)" /><Text size="xs" c="red.7">failed</Text></Group>;
  if (s === 'running') return <Group gap={4} wrap="nowrap"><Loader size={size - 2} /><Text size="xs" c="blue.7">{state.elapsed || 'in progress'}</Text></Group>;
  return <Group gap={4} wrap="nowrap"><IconClock size={size} color="var(--mantine-color-gray-5)" /><Text size="xs" c="dimmed">waiting</Text></Group>;
}


// A planned change and, during an apply, where it is: one chip per resource.
// Planned changes are outlined, with Terraform's sign; once the apply
// reaches them they fill in: blue while going, green when done, red when
// failed. Grey outlined is "not reached yet".
const VERBS = {
  create: { sign: '+', to: 'to create', ing: 'creating', ed: 'created', color: 'green' },
  update: { sign: '~', to: 'to update', ing: 'updating', ed: 'updated', color: 'yellow' },
  replace: { sign: '±', to: 'to replace', ing: 'replacing', ed: 'replaced', color: 'orange' },
  delete: { sign: '−', to: 'to destroy', ing: 'destroying', ed: 'destroyed', color: 'red' },
};

export function ChangeChip({ action, state, applying = false }) {
  const v = VERBS[action] || VERBS.create;
  const s = state?.state;
  const chip = (color, variant, children, extra = {}) => (
    <Badge size="sm" radius="sm" color={color} variant={variant} style={{ textTransform: 'none', fontWeight: 600 }} {...extra}>
      {children}
    </Badge>
  );
  if (!applying) return chip(v.color, 'outline', `${v.sign} ${v.to}`);
  if (s === 'done') {
    return chip('green', 'filled', `${v.ed}${state.took ? ` in ${state.took}` : ''}`, { leftSection: <IconCheck size={12} /> });
  }
  if (s === 'failed') return chip('red', 'filled', `${action === 'delete' ? 'destroy' : action} failed`, { leftSection: <IconX size={12} /> });
  if (s === 'running') {
    return chip('blue', 'light', `${v.ing}…${state.elapsed ? ` ${state.elapsed}` : ''}`, { leftSection: <Loader size={10} color="blue" /> });
  }
  return chip('gray', 'outline', `${v.sign} waiting`);
}

export function ChangeLegend({ applying }) {
  return (
    <Group gap="xs">
      <Text size="xs" c="dimmed">{applying ? 'Each resource:' : 'Planned:'}</Text>
      {applying ? (
        <>
          <ChangeChip action="create" applying state={null} />
          <ChangeChip action="create" applying state={{ state: 'running' }} />
          <ChangeChip action="create" applying state={{ state: 'done' }} />
          <ChangeChip action="create" applying state={{ state: 'failed' }} />
        </>
      ) : (
        Object.keys(VERBS).map((a) => <ChangeChip key={a} action={a} />)
      )}
    </Group>
  );
}
