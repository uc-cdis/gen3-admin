import { Group, Loader, Text } from '@mantine/core';
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

