import { useState, useEffect } from 'react';
import {
  Container, Title, Text, Tabs, Alert, Group, Badge, Tooltip, Loader, Stack,
} from '@mantine/core';
import {
  IconChartLine, IconFileText, IconRoute, IconFlame, IconShieldLock, IconAlertCircle,
} from '@tabler/icons-react';

import { useGlobalState } from '@/contexts/global';
import { fetchCapabilities } from '@/lib/observability';
import MetricsPanel from '@/components/Observability/MetricsPanel';
import LogsPanel from '@/components/Observability/LogsPanel';
import TracesPanel from '@/components/Observability/TracesPanel';
import AuditPanel from '@/components/Observability/AuditPanel';
import ProfilesPanel from '@/components/Observability/ProfilesPanel';

/**
 * Observability for the selected environment.
 *
 * Everything here is scoped to the environment picked in the global selector --
 * the backends are centralized and hold every cluster, so an unscoped view is
 * noise rather than insight.
 *
 * Tabs are capability-gated: the stack is not uniform across deployments (the
 * Pyroscope ingress is currently down, for one), so the page asks which backends
 * respond and disables the rest instead of surfacing a tab that errors on click.
 */
export default function Observability() {
  const { activeGlobalEnv } = useGlobalState();
  const [cluster, namespace] = activeGlobalEnv ? activeGlobalEnv.split('/') : [null, null];

  const [caps, setCaps] = useState(null);
  const [tab, setTab] = useState('metrics');

  useEffect(() => {
    fetchCapabilities()
      .then(setCaps)
      .catch(() => setCaps({}));
  }, []);

  const available = (name) => caps?.[name]?.available;

  const TabLabel = ({ name, label }) => {
    if (caps && !available(name)) {
      return (
        <Tooltip label={`${label} backend is not reachable (${caps[name]?.error || caps[name]?.status})`}>
          <Group gap={6}><Text size="sm" c="dimmed">{label}</Text></Group>
        </Tooltip>
      );
    }
    return <Text size="sm">{label}</Text>;
  };

  if (!activeGlobalEnv) {
    return (
      <Container fluid my={20}>
        <Title order={2}>Observability</Title>
        <Alert mt="md" color="blue" icon={<IconAlertCircle size={16} />}>
          Select an environment to view its logs, metrics and traces.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid my={20}>
      <Group justify="space-between" mb="md">
        <Stack gap={2}>
          <Title order={2}>Observability</Title>
          <Text size="sm" c="dimmed">
            Logs, metrics and traces for <strong>{namespace}</strong> on <strong>{cluster}</strong>
          </Text>
        </Stack>
        <Group gap="xs">
          {caps === null && <Loader size="xs" />}
          {caps && Object.entries(caps).map(([name, c]) => (
            <Tooltip key={name} label={c.available ? 'reachable' : (c.error || `HTTP ${c.status}`)}>
              <Badge size="xs" variant="dot" color={c.available ? 'green' : 'gray'}>
                {name}
              </Badge>
            </Tooltip>
          ))}
        </Group>
      </Group>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="metrics" leftSection={<IconChartLine size={16} />}
            disabled={caps && !available('mimir')}>
            <TabLabel name="mimir" label="Metrics" />
          </Tabs.Tab>
          <Tabs.Tab value="logs" leftSection={<IconFileText size={16} />}
            disabled={caps && !available('loki')}>
            <TabLabel name="loki" label="Logs" />
          </Tabs.Tab>
          <Tabs.Tab value="traces" leftSection={<IconRoute size={16} />}
            disabled={caps && !available('tempo')}>
            <TabLabel name="tempo" label="Traces" />
          </Tabs.Tab>
          <Tabs.Tab value="profiles" leftSection={<IconFlame size={16} />}
            disabled={caps && !available('pyroscope')}>
            <TabLabel name="pyroscope" label="Profiles" />
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconShieldLock size={16} />}>
            <Text size="sm">Audit</Text>
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="metrics" pt="md">
          {tab === 'metrics' && <MetricsPanel cluster={cluster} namespace={namespace} />}
        </Tabs.Panel>

        <Tabs.Panel value="logs" pt="md">
          {tab === 'logs' && <LogsPanel cluster={cluster} namespace={namespace} />}
        </Tabs.Panel>

        <Tabs.Panel value="traces" pt="md">
          {tab === 'traces' && <TracesPanel />}
        </Tabs.Panel>

        <Tabs.Panel value="profiles" pt="md">
          {tab === 'profiles' && <ProfilesPanel />}
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          {tab === 'audit' && <AuditPanel cluster={cluster} namespace={namespace} />}
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
