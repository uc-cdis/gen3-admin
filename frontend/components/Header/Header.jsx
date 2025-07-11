'use client'

import { useState, useEffect } from 'react';
import cx from 'clsx';
import { useRouter, usePathname } from 'next/navigation';
import { useSession, signOut } from "next-auth/react";
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
  Combobox,
  useCombobox,
  InputBase
} from '@mantine/core';

import {
  IconLogout,
  IconPlus,
  IconCircleCheck,
  IconCircleX,
  IconCircleMinus,
  IconTrash,
  IconReplace,
  IconLoader,
  IconClock,
  IconRefresh,
  IconArrowBackUp,
  IconChevronDown
} from '@tabler/icons-react';

import { ColorSchemeToggle } from '@/components/ColorSchemeToggle/ColorSchemeToggle';
import { useGlobalState } from '@/contexts/global';
import { callGoApi } from '@/lib/k8s';
import classes from './Header.module.css';

// Status configuration for environment status icons
const STATUS_CONFIG = {
  'deployed': { icon: IconCircleCheck, color: 'var(--mantine-color-green-6)', badgeColor: 'green' },
  'failed': { icon: IconCircleX, color: 'var(--mantine-color-red-6)', badgeColor: 'red' },
  'unknown': { icon: IconCircleMinus, color: 'var(--mantine-color-gray-6)', badgeColor: 'gray' },
  'uninstalled': { icon: IconTrash, color: 'var(--mantine-color-gray-6)', badgeColor: 'gray' },
  'superseded': { icon: IconReplace, color: 'var(--mantine-color-orange-6)', badgeColor: 'orange' },
  'uninstalling': { icon: IconLoader, color: 'var(--mantine-color-yellow-6)', badgeColor: 'yellow' },
  'pending-install': { icon: IconClock, color: 'var(--mantine-color-blue-6)', badgeColor: 'blue' },
  'pending-upgrade': { icon: IconRefresh, color: 'var(--mantine-color-blue-6)', badgeColor: 'blue' },
  'pending-rollback': { icon: IconArrowBackUp, color: 'var(--mantine-color-cyan-6)', badgeColor: 'cyan' }
};

const getStatusIcon = (status) => STATUS_CONFIG[status] || STATUS_CONFIG['unknown'];

export function Header({ mobileOpened, toggleMobile, desktopOpened, toggleDesktop }) {
  const [userMenuOpened, setUserMenuOpened] = useState(false);
  const [clusters, setClusters] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [activeEnvironments, setActiveEnvironments] = useState('');
  const [clustersLoading, setClustersLoading] = useState(false);
  const [environmentsLoading, setEnvironmentsLoading] = useState(false);

  const router = useRouter();
  const currentPath = usePathname();
  const { data: sessionData } = useSession();
  const { activeCluster, setActiveCluster, activeGlobalEnv, setActiveGlobalEnv } = useGlobalState();

  const accessToken = sessionData?.accessToken;

  // Fetch available clusters
  const fetchClusters = async () => {
    if (!accessToken) return;

    setClustersLoading(true);
    try {
      const data = await callGoApi('/agents', 'GET', null, null, accessToken);
      const connectedClusterNames = data
        .filter(cluster => cluster.connected)
        .map(cluster => cluster.name);

      setClusters(connectedClusterNames);
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
      setClusters([]);
    } finally {
      setClustersLoading(false);
    }
  };

  // Fetch available environments
  const fetchEnvironments = async () => {
    if (!accessToken) return;

    setEnvironmentsLoading(true);
    try {
      const agentsResponse = await callGoApi('/agents', 'GET', null, null, accessToken);
      if (!agentsResponse?.length) {
        setEnvironments([]);
        return;
      }

      const connectedAgents = agentsResponse.filter(cluster => cluster.connected);
      const environmentsData = await Promise.all(
        connectedAgents.map(async (agent) => {
          try {
            const chartsResponse = await callGoApi(
              `/agents/${agent.name}/helm/list`,
              'GET',
              null,
              null,
              accessToken
            );

            const filtered = chartsResponse.filter(chart =>
              chart.chart.toLowerCase().includes("gen3") ||
              chart.name.toLowerCase().includes("gen3")
            );

            return filtered?.map(chart => ({
              value: `${agent.name}/${chart.namespace}`,
              label: `${agent.name}/${chart.name}`,
              status: chart.status || 'unknown',
              namespace: chart.namespace,
            })) || [];
          } catch (err) {
            console.error(`Error fetching charts for agent ${agent.name}:`, err);
            return [];
          }
        })
      );

      setEnvironments(environmentsData.flat());
    } catch (err) {
      console.error("Error fetching environments:", err);
      setEnvironments([]);
    } finally {
      setEnvironmentsLoading(false);
    }
  };

  // Handle cluster change and navigation
  const handleClusterChange = (newCluster) => {
    setActiveCluster(newCluster);

    const pathSegments = currentPath.split('/');
    let newPath;

    if (activeEnvironments) {
      const [, namespace] = activeEnvironments.split('/');
      newPath = `/environments/${newCluster}/${namespace}`;
    } else if (currentPath.includes('environments')) {
      const environmentsIndex = pathSegments.indexOf('environments');
      const namespace = pathSegments[environmentsIndex + 2] || 'default';
      newPath = `/environments/${newCluster}/${namespace}`;
    } else {
      newPath = `/environments/${newCluster}/default`;
    }

    router.push(newPath);
  };

  // Handle environment change and navigation
  const handleEnvironmentChange = (value) => {
    setActiveEnvironments(value);
    setActiveGlobalEnv(value);

    const [cluster, namespace] = value.split('/');
    const newPath = `/environments/${cluster}/${namespace}`;
    router.push(newPath);

    if (cluster !== activeCluster) {
      setActiveCluster(cluster);
    }
  };

  // Handle logout
  const handleLogout = () => {
    signOut();
  };

  // Load initial data and sync with global state
  useEffect(() => {
    fetchClusters();
    fetchEnvironments();

    // Sync local state with global state from localStorage
    if (activeGlobalEnv) {
      setActiveEnvironments(activeGlobalEnv);
    }
  }, [accessToken, activeGlobalEnv]);

  // Environment selector component
  const EnvironmentSelect = () => {
    const combobox = useCombobox({
      onDropdownClose: () => combobox.resetSelectedOption(),
    });

    const options = environments.map((item) => {
      const statusConfig = getStatusIcon(item.status);
      const StatusIcon = statusConfig.icon;

      return (
        <Combobox.Option value={item.value} key={item.value}>
          <Group justify="space-between" wrap="nowrap" w="100%">
            <div style={{ fontFamily: 'monospace' }}>{item.label}</div>
            <Group gap="xs" wrap="nowrap">
              <Badge size="sm" variant="light" color="gray" radius="xl">
                {item.namespace}
              </Badge>
              <StatusIcon
                style={{ width: rem(16), height: rem(16) }}
                color={statusConfig.color}
              />
            </Group>
          </Group>
        </Combobox.Option>
      );
    });

    return (
      <Combobox
        store={combobox}
        onOptionSubmit={handleEnvironmentChange}
        style={{ flex: 1, minWidth: 120 }}
      >
        <Combobox.Target>
          <InputBase
            component="button"
            type="button"
            pointer
            rightSection={<IconChevronDown style={{ width: rem(18), height: rem(18) }} stroke={1.5} />}
            onClick={() => combobox.toggleDropdown()}
            rightSectionPointerEvents="none"
            style={{ fontFamily: 'monospace' }}
          >
            {activeEnvironments || activeGlobalEnv || 'Select Environment'}
          </InputBase>
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options>{options}</Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    );
  };

  // User menu component
  const UserMenu = () => (
    <Menu
      width={200}
      position="bottom"
      transitionProps={{ transition: 'pop-top-left' }}
      onClose={() => setUserMenuOpened(false)}
      onOpen={() => setUserMenuOpened(true)}
      withinPortal
    >
      <Menu.Target>
        <UnstyledButton
          className={cx(classes.user, { [classes.userActive]: userMenuOpened })}
        >
          <Group gap={7}>
            <Text fw={500} size="sm" lh={1} mr={3}>
              {sessionData?.user?.email}
            </Text>
            <IconChevronDown style={{ width: rem(12), height: rem(12) }} stroke={1.5} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconLogout style={{ width: rem(16), height: rem(16) }} stroke={1.5} />}
          onClick={handleLogout}
        >
          Logout
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <Group
      h="100%"
      px="md"
      justify="space-between"
      align="center"
      grow
      preventGrowOverflow={false}
      wrap="nowrap"
    >
      {/* Left side: Burger menus and selectors */}
      <Group wrap="nowrap" gap="xs" align="center">
        <Burger
          opened={mobileOpened}
          onClick={toggleMobile}
          hiddenFrom="sm"
          size="sm"
        />
        <Burger
          opened={desktopOpened}
          onClick={toggleDesktop}
          visibleFrom="sm"
          size="sm"
        />

        {/* Environment selector and refresh button */}
        <Group wrap="wrap" gap="xs" style={{ flexGrow: 1 }}>
          <EnvironmentSelect />
          <Button
            onClick={fetchEnvironments}
            loading={environmentsLoading}
          >
            <IconRefresh />
          </Button>
        </Group>
      </Group>

      {/* Right side: Theme toggle and user menu */}
      <Box visibleFrom='sm'>
        <Group justify="flex-end">
          <ColorSchemeToggle />
          <UserMenu />
        </Group>
      </Box>
    </Group>
  );
}
