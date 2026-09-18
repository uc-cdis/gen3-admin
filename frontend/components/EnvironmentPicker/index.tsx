import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconLock, IconPlus, IconSearch } from '@tabler/icons-react';

import { StatusBadge } from '@/components/ui';
import type { EnvItem } from '@/hooks/useEnvironments';
import { useSelectEnvironment } from '@/hooks/useSelectEnvironment';
import { parseEnvKey } from '@/lib/envKey';

type EnvironmentPickerProps = {
  environments: EnvItem[];
  /** Agents that returned 403, so "denied" is not shown as "empty". */
  inaccessibleAgents?: string[];
  /** Start the setup wizard for a cluster that is not onboarded yet. */
  onAddCluster: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
};

/**
 * What the landing page shows when environments exist but none is selected.
 *
 * This replaces the setup wizard in that case. Showing an 8-step "install
 * CSOC" flow to someone whose fleet is already running -- the common path for
 * a new engineer joining an existing deployment -- told them to build
 * infrastructure that was one click away.
 *
 * Sized for the real fleet, which is dozens of environments rather than a
 * handful: search leads, rows are compact enough to scan a screenful at a
 * time, and they are grouped by agent because that is the axis people
 * actually think along ("the dev0 one"). Row chrome is deliberately minimal --
 * when every row reads HELM / DEPLOYED, badges on each one are noise, so the
 * status badge appears only when a release is *not* healthy.
 */
export function EnvironmentPicker({
  environments,
  inaccessibleAgents = [],
  onAddCluster,
  refreshing,
  onRefresh,
}: EnvironmentPickerProps) {
  const selectEnvironment = useSelectEnvironment(environments);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? environments.filter(
          (env) =>
            env.label.toLowerCase().includes(needle) ||
            env.value.toLowerCase().includes(needle)
        )
      : environments;

    const byAgent = new Map<string, EnvItem[]>();
    for (const env of matches) {
      const { cluster } = parseEnvKey(env.value);
      const list = byAgent.get(cluster);
      if (list) list.push(env);
      else byAgent.set(cluster, [env]);
    }
    return [...byAgent.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [environments, query]);

  const matchCount = groups.reduce((n, [, items]) => n + items.length, 0);

  return (
    <Stack gap="lg" py="xl">
      <Stack gap={4}>
        <Title order={2}>Choose an environment</Title>
        <Text size="sm" c="dimmed">
          {environments.length === 1
            ? '1 environment is available to you.'
            : `${environments.length} environments are available to you.`}
        </Text>
      </Stack>

      <Group gap="xs" wrap="nowrap">
        <TextInput
          flex={1}
          placeholder="Filter by hostname, agent or namespace"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          autoFocus
        />
        {onRefresh && (
          <Button variant="default" onClick={onRefresh} loading={refreshing}>
            Refresh
          </Button>
        )}
      </Group>

      {inaccessibleAgents.length > 0 && (
        <Alert
          variant="light"
          color="statusWarn"
          icon={<IconLock size={16} />}
          title="Some clusters are not shown"
        >
          <Text size="sm">
            You do not have read access to{' '}
            <Text span fw={600}>
              {inaccessibleAgents.join(', ')}
            </Text>
            . Ask an administrator for the{' '}
            {inaccessibleAgents.length === 1
              ? `${inaccessibleAgents[0]}-read role`
              : 'corresponding -read roles'}
            .
          </Text>
        </Alert>
      )}

      {matchCount === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="xl">
          No environments match &ldquo;{query}&rdquo;.
        </Text>
      ) : (
        <Stack gap="lg">
          {groups.map(([agent, items]) => (
            <Stack key={agent} gap={4}>
              <Group gap="xs">
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  {agent}
                </Text>
                <Text size="xs" c="dimmed">
                  {items.length}
                </Text>
              </Group>

              <Stack gap={0}>
                {items.map((env) => {
                  const { namespace } = parseEnvKey(env.value);
                  const healthy = env.status?.toLowerCase() === 'deployed';

                  return (
                    <UnstyledButton
                      key={env.value}
                      onClick={() => selectEnvironment(env.value)}
                      px="sm"
                      py={8}
                      style={{ borderRadius: 'var(--mantine-radius-sm)' }}
                      className="env-row"
                    >
                      <Group justify="space-between" wrap="nowrap" gap="sm">
                        <Text size="sm" truncate style={{ minWidth: 0 }}>
                          {env.label}
                        </Text>
                        <Group gap="xs" wrap="nowrap">
                          <Badge size="sm" variant="light" color="gray" radius="xl">
                            {namespace}
                          </Badge>
                          {/* Only when it needs attention -- a column of
                              identical green badges carries no information. */}
                          {!healthy && (
                            <StatusBadge domain="helm" value={env.status} size="sm" />
                          )}
                        </Group>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}

      <Box pt="xs">
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconPlus size={16} />}
          onClick={onAddCluster}
        >
          Set up a new cluster
        </Button>
      </Box>

      <style jsx global>{`
        .env-row:hover {
          background-color: var(--mantine-color-default-hover);
        }
      `}</style>
    </Stack>
  );
}

export default EnvironmentPicker;
