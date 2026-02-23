'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import cx from 'clsx';
import { useRouter, usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

import {
  Group,
  Button,
  Burger,
  Box,
  Menu,
  UnstyledButton,
  Text,
  rem,
  Badge,
  Select,
} from '@mantine/core';

import {
  IconLogout,
  IconCircleCheck,
  IconCircleX,
  IconCircleMinus,
  IconTrash,
  IconReplace,
  IconLoader,
  IconClock,
  IconRefresh,
  IconArrowBackUp,
  IconChevronDown,
} from '@tabler/icons-react';

import { ColorSchemeToggle } from '@/components/ColorSchemeToggle/ColorSchemeToggle';
import { useGlobalState } from '@/contexts/global';
import { callGoApi } from '@/lib/k8s';
import callK8sApi from '@/lib/k8s';
import classes from './Header.module.css';

type EnvManager = 'helm' | 'argocd';

type EnvItem = {
  value: string;
  label: string;
  status: string;
  namespace: string;
  manager: EnvManager;
  appName: string;

  provider: string;
  k8sVersion: string;
};

const STATUS_CONFIG: Record<
  string,
  { icon: any; color: string; badgeColor: string }
> = {
  deployed: { icon: IconCircleCheck, color: 'var(--mantine-color-green-6)', badgeColor: 'green' },
  failed: { icon: IconCircleX, color: 'var(--mantine-color-red-6)', badgeColor: 'red' },
  unknown: { icon: IconCircleMinus, color: 'var(--mantine-color-gray-6)', badgeColor: 'gray' },
  uninstalled: { icon: IconTrash, color: 'var(--mantine-color-gray-6)', badgeColor: 'gray' },
  superseded: { icon: IconReplace, color: 'var(--mantine-color-orange-6)', badgeColor: 'orange' },
  uninstalling: { icon: IconLoader, color: 'var(--mantine-color-yellow-6)', badgeColor: 'yellow' },
  'pending-install': { icon: IconClock, color: 'var(--mantine-color-blue-6)', badgeColor: 'blue' },
  'pending-upgrade': { icon: IconRefresh, color: 'var(--mantine-color-blue-6)', badgeColor: 'blue' },
  'pending-rollback': { icon: IconArrowBackUp, color: 'var(--mantine-color-cyan-6)', badgeColor: 'cyan' },
};

const getStatusIcon = (status?: string) =>
  STATUS_CONFIG[status || 'unknown'] || STATUS_CONFIG.unknown;

export function Header({
  mobileOpened,
  toggleMobile,
  desktopOpened,
  toggleDesktop,
}: {
  mobileOpened: boolean;
  toggleMobile: () => void;
  desktopOpened: boolean;
  toggleDesktop: () => void;
}) {
  const bootstrapEnabled = process.env.NEXT_PUBLIC_BOOTSTRAP_MODE === 'true';
  if (bootstrapEnabled) return <>Gen3 CSOC Bootstrapping</>;

  const [userMenuOpened, setUserMenuOpened] = useState(false);
  const [environments, setEnvironments] = useState<EnvItem[]>([]);
  const [activeEnvironments, setActiveEnvironments] = useState<string | null>(null);
  const [environmentsLoading, setEnvironmentsLoading] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);

  const router = useRouter();
  const currentPath = usePathname();
  const {
    activeCluster, setActiveCluster,
    activeGlobalEnv, setActiveGlobalEnv,
    setActiveEnvManager, setActiveEnvAppName,
    activeClusterProvider, setActiveClusterProvider,
    activeClusterK8sVersion, setActiveClusterK8sVersion
  } = useGlobalState();

  const { data: sessionData } = useSession();
  const accessToken = (sessionData as any)?.accessToken;

  const fetchEnvironments = async () => {
    if (!accessToken) return;
    setEnvironmentsLoading(true);

    try {
      const agentsResponse = await callGoApi('/agents', 'GET', null, null, accessToken);
      const connectedAgents = agentsResponse.filter((c: any) => c.connected);

      const environmentsData = await Promise.all(
        connectedAgents.map(async (agent: any) => {
          try {
            const chartsResponse = await callGoApi(
              `/agents/${agent.name}/helm/list`,
              'GET',
              null,
              null,
              accessToken
            );

            const gen3Charts = chartsResponse.filter(
              (chart: any) =>
                chart.chart?.toLowerCase().includes('gen3') ||
                chart.name?.toLowerCase().includes('gen3')
            );

            return await Promise.all(
              gen3Charts.map(async (chart: any) => {
                try {
                  const configMapResponse = await callK8sApi(
                    `/api/v1/namespaces/${chart.namespace}/configmaps/manifest-global`,
                    'GET',
                    null,
                    null,
                    agent.name,
                    accessToken
                  );

                  const hostname =
                    configMapResponse?.data?.hostname || chart.name;

                  return {
                    value: `${agent.name}/${chart.namespace}/${chart.name}`,
                    label: `${hostname}`,
                    status: chart.status || 'unknown',
                    namespace: chart.namespace,
                    manager: chart.helm === 'true' ? 'helm' : 'argocd',
                    appName: chart.name,
                    provider: agent.provider || "",
                    k8sVersion: agent.k8sVersion || "",
                  };
                } catch {
                  return {
                    value: `${agent.name}/${chart.namespace}/${chart.name}`,
                    label: `${agent.name}/${chart.name}`,
                    status: chart.status || 'unknown',
                    namespace: chart.namespace,
                    manager: chart.helm === 'true' ? 'helm' : 'argocd',
                    appName: chart.name,
                    provider: agent.provider || "",
                    k8sVersion: agent.k8sVersion || "",
                  };
                }
              })
            );
          } catch (err) {
            console.error(`Error fetching charts for ${agent.name}`, err);
            return [];
          }
        })
      );

      setEnvironments(environmentsData.flat());
    } finally {
      setEnvironmentsLoading(false);
    }
  };


  useEffect(() => {
    fetchEnvironments();
    if (activeGlobalEnv) setActiveEnvironments(activeGlobalEnv);
  }, [activeGlobalEnv]);

  const handleEnvironmentChange = (value: string | null) => {
    if (!value) return;
    const selectedEnv = environments.find((e) => e.value === value);
    if (!selectedEnv) return;

    setActiveEnvironments(value);
    setActiveGlobalEnv(value);
    setActiveEnvManager(selectedEnv.manager);
    setActiveEnvAppName(selectedEnv.appName);
    setActiveClusterProvider(selectedEnv.provider);
    setActiveClusterK8sVersion(selectedEnv.k8sVersion);

    const [cluster, namespace] = value.split('/');
    if (cluster !== activeCluster) setActiveCluster(cluster);
    router.push(`/environments/${cluster}/${namespace}`);
  };

  return (
    <Group h="100%" px="md" justify="space-between" align="center" wrap="nowrap">
      <Group wrap="nowrap" gap="xs">
        <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
        <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="sm" />

        <Group wrap="wrap" gap="xs" style={{ flexGrow: 1 }}>
          {/* 👇 Rendered directly instead of as an inline component */}
          <Select
            data={environments.map(item => ({
              value: item.value,
              label: item.label,
            }))}
            value={activeEnvironments || activeGlobalEnv || null}
            onChange={handleEnvironmentChange}
            placeholder="Select Environment"
            allowDeselect={false}
            searchable
            clearable
            style={{ flex: 1, minWidth: 420, fontFamily: 'monospace' }}
            dropdownOpened={envOpen}
            onDropdownOpen={() => setEnvOpen(true)}
            onDropdownClose={() => setEnvOpen(false)}
            renderOption={({ option }) => {
              const env = environments.find(e => e.value === option.value);
              if (!env) return null;

              const statusConfig = getStatusIcon(env.status);
              const StatusIcon = statusConfig.icon;

              return (
                <Group justify="space-between" wrap="nowrap" w="100%">
                  <div style={{ fontFamily: 'monospace' }}>{env.label}</div>
                  <Group gap="xs" wrap="nowrap">
                    <Badge size="sm" variant="light" color="gray" radius="xl">
                      {env.namespace}
                    </Badge>
                    <StatusIcon
                      style={{ width: rem(16), height: rem(16) }}
                      color={statusConfig.color}
                    />
                  </Group>
                </Group>
              );
            }}
          />
          <Button onClick={fetchEnvironments} loading={environmentsLoading}>
            <IconRefresh />
          </Button>
        </Group>
      </Group>

      <Box visibleFrom="sm">
        <Group justify="flex-end">
          <ColorSchemeToggle />

          {/* 👇 Rendered directly instead of as an inline component */}
          <Menu
            width={200}
            position="bottom"
            withinPortal={false}
            onOpen={() => setUserMenuOpened(true)}
            onClose={() => setUserMenuOpened(false)}
          >
            <Menu.Target>
              <UnstyledButton className={cx(classes.user, { [classes.userActive]: userMenuOpened })}>
                <Group gap={7}>
                  <Text fw={500} size="sm">{sessionData?.user?.email}</Text>
                  <IconChevronDown style={{ width: rem(12), height: rem(12) }} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => signOut()}>
                Logout
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>

        </Group>
      </Box>
    </Group>
  );
}
