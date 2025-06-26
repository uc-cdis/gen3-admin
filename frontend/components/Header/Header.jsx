'use client'

import { useState, useContext, useEffect } from 'react';
import cx from 'clsx';

import Image from 'next/image'
import { Group, Button, Burger, Box, Loader, Menu, UnstyledButton, Text, rem, Badge, useMantineTheme, Select, Combobox, useCombobox, InputBase } from '@mantine/core';
import AuthContext from '@/contexts/auth';

import { ColorSchemeToggle } from '@/components/ColorSchemeToggle/ColorSchemeToggle';
import { EnvSelector } from '@/components/EnvSelector';
import { useSession, signOut } from "next-auth/react"

import { useGlobalState } from '@/contexts/global';

import {
    IconLogout,
    IconPlus,
    IconCircleCheck,      // deployed
    IconCircleX,          // failed
    IconCircleMinus,      // unknown
    IconTrash,            // uninstalled
    IconReplace,          // superseded
    IconLoader,           // uninstalling
    IconClock,            // pending-install
    IconRefresh,          // pending-upgrade
    IconArrowBackUp,      // pending-rollback
    IconChevronDown 
} from '@tabler/icons-react';


import classes from './Header.module.css';

import { callGoApi } from '@/lib/k8s';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';


const getStatusIcon = (status) => {
    const statusConfig = {
        'deployed': {
            icon: IconCircleCheck,
            color: 'var(--mantine-color-green-6)',
            badgeColor: 'green'
        },
        'failed': {
            icon: IconCircleX,
            color: 'var(--mantine-color-red-6)',
            badgeColor: 'red'
        },
        'unknown': {
            icon: IconCircleMinus,
            color: 'var(--mantine-color-gray-6)',
            badgeColor: 'gray'
        },
        'uninstalled': {
            icon: IconTrash,
            color: 'var(--mantine-color-gray-6)',
            badgeColor: 'gray'
        },
        'superseded': {
            icon: IconReplace,
            color: 'var(--mantine-color-orange-6)',
            badgeColor: 'orange'
        },
        'uninstalling': {
            icon: IconLoader,
            color: 'var(--mantine-color-yellow-6)',
            badgeColor: 'yellow'
        },
        'pending-install': {
            icon: IconClock,
            color: 'var(--mantine-color-blue-6)',
            badgeColor: 'blue'
        },
        'pending-upgrade': {
            icon: IconRefresh,
            color: 'var(--mantine-color-blue-6)',
            badgeColor: 'blue'
        },
        'pending-rollback': {
            icon: IconArrowBackUp,
            color: 'var(--mantine-color-cyan-6)',
            badgeColor: 'cyan'
        }
    };

    return statusConfig[status] || statusConfig['unknown'];
};


export function Header({ mobileOpened, toggleMobile, desktopOpened, toggleDesktop }) {
    const [userMenuOpened, setUserMenuOpened] = useState(false);

    // const { user, logout } = useContext(AuthContext)

    // const { cluster, setCluster } = useGlobalStore()
    const router = useRouter();
    const currentPath = usePathname()

    const [clusters, setClusters] = useState([])
    const [loading, setLoading] = useState(false)
    const [loading2, setLoading2] = useState(false);
    const { activeCluster, setActiveCluster, setActiveGlobalEnv } = useGlobalState();
    const [environments, setEnvironments] = useState();
    const [activeEnvironments, setActiveEnvironments] = useState();

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;


    // next-auth stuff
    const { data, status } = useSession()

    const handleLogout = () => {
        signOut();
        // Add any additional logout logic here (e.g., redirect to login page)
    };

    const handleClusterChange = (newCluster) => {
        setActiveCluster(newCluster);

        // Check if the current path matches the pattern

        console.log(currentPath)
        // Split the path into segments
        const pathSegments = currentPath.split('/');

        // Assuming the cluster is the third segment in the path (e.g., `/cluster/old-cluster/something/else/here`)
        const clusterIndex = 2;
        const currentCluster = pathSegments[clusterIndex];


        if (currentCluster !== newCluster && currentPath.includes('cluster')) {
            // Construct the new path
            const newPath = currentPath.replace(currentCluster, newCluster);
            router.push(newPath);
        }
    };


    const fetchClusters = async () => {
        setLoading(true)
        try {
            const data = await callGoApi('/agents', 'GET', null, null, accessToken)
            // Only show clusters that are active
            // setClusters(data.filter(cluster => cluster.connected))
            const connectedClusterNames = data
                .filter(cluster => cluster.connected)
                .map(cluster => cluster.name);

            console.log(connectedClusterNames);
            setClusters(connectedClusterNames)
            setLoading(false)
        } catch (error) {
            console.error('Failed to fetch clusters:', error);
            setLoading(false)
        }
    };

    useEffect(() => {
        fetchClusters(accessToken).then((data) => {
            if (data) {
                setClusters(data);
            } else {
                setActiveCluster(null);
            }
        });
    }, []);

    const fetchEnvironments = async () => {
        setLoading2(true);
        try {
            const agentsResponse = await callGoApi('/agents', 'GET', null, null, accessToken);
            if (!agentsResponse?.length) {
                console.log("No agents registered");
                setEnvironments([]);
                return;
            }

            const environmentsData = await Promise.all(
                agentsResponse.map(async (agent) => {
                    try {
                        const chartsResponse = await callGoApi(
                            `/agents/${agent.name}/helm/list`,
                            'GET',
                            null,
                            null,
                            accessToken
                        );
                        console.log({"agents":agentsResponse,"charts": chartsResponse})
                        return chartsResponse?.map(chart => ({
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
            setLoading2(false);
        }
    };

    useEffect(() => {
        fetchEnvironments();
    }, []);

    const EnvironmentSelect = () => {
        const combobox = useCombobox({
            onDropdownClose: () => combobox.resetSelectedOption(),
        });

        const handleEnvironmentChange = (value) => {
            setActiveEnvironments(value);
            setActiveGlobalEnv(value); // Update the global state
            combobox.closeDropdown();
        };

        const options = (environments || []).map((item) => {
            const statusConfig = getStatusIcon(item.status);
            const StatusIcon = statusConfig.icon;

            return (
                <Combobox.Option value={item.value} key={item.value}>
                    <Group justify="space-between" wrap="nowrap" w="100%">
                        <div style={{ fontFamily: 'monospace' }}>{item.label}</div>
                        <Group gap="xs" wrap="nowrap">
                            <Badge 
                                size="sm" 
                                variant="light" 
                                color="gray"
                                radius="xl"
                            >
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
                        {activeEnvironments || 'Select Environment'}
                    </InputBase>
                </Combobox.Target>

                <Combobox.Dropdown>
                    <Combobox.Options>{options}</Combobox.Options>
                </Combobox.Dropdown>
            </Combobox>
        );
    };

    const menu = (
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
                        {/* <Avatar src={user.image} alt={user.name} radius="xl" size={20} /> */}
                        <Text fw={500} size="sm" lh={1} mr={3}>
                            {data?.user?.email}
                        </Text>
                        <IconChevronDown style={{ width: rem(12), height: rem(12) }} stroke={1.5} />
                    </Group>
                </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
                {/* <Menu.Item
                    leftSection={
                        <IconHeart
                            style={{ width: rem(16), height: rem(16) }}
                            color={theme.colors.red[6]}
                            stroke={1.5}
                        />
                    }
                >
                    Liked posts
                </Menu.Item>
                <Menu.Item
                    leftSection={
                        <IconStar
                            style={{ width: rem(16), height: rem(16) }}
                            color={theme.colors.yellow[6]}
                            stroke={1.5}
                        />
                    }
                >
                    Saved posts
                </Menu.Item> */}
                {/* <Menu.Item
                    leftSection={
                        <IconMessage
                            style={{ width: rem(16), height: rem(16) }}
                            color={theme.colors.blue[6]}
                            stroke={1.5}
                        />
                    }
                >
                    Your comments
                </Menu.Item> */}

                {/* <Menu.Label>Settings</Menu.Label>
            <Menu.Item
                leftSection={
                    <IconSettings style={{ width: rem(16), height: rem(16) }} stroke={1.5} />
                }
            >
                Account settings
            </Menu.Item>
            <Menu.Item
                leftSection={
                    <IconSwitchHorizontal style={{ width: rem(16), height: rem(16) }} stroke={1.5} />
                }
            >
                Change account
            </Menu.Item> */}
                <Menu.Item
                    leftSection={
                        <IconLogout style={{ width: rem(16), height: rem(16) }} stroke={1.5} />
                    }
                    onClick={handleLogout}
                >
                    Logout
                </Menu.Item>

                {/* <Menu.Divider />
    
            <Menu.Label>Danger zone</Menu.Label>
            <Menu.Item
                leftSection={
                    <IconPlayerPause style={{ width: rem(16), height: rem(16) }} stroke={1.5} />
                }
            >
                Pause subscription
            </Menu.Item>
            <Menu.Item
                color="red"
                leftSection={<IconTrash style={{ width: rem(16), height: rem(16) }} stroke={1.5} />}
            >
                Delete account
            </Menu.Item> */}
            </Menu.Dropdown>

        </Menu>
    )

    return (
        <>
            <Group
                h="100%"
                px="md"
                justify="space-between"
                align="center"
                grow preventGrowOverflow={false} wrap="nowrap"
            // bg="var(--mantine-color-red-light)"
            >
                {/* <Group
                    justify="space-between" align="center" wrap="nowrap" preventGrowOverflow={false}
                    bg="var(--mantine-color-yellow-light)"
                    w={20}
                  >
                      
                  </Group> */}

                <Group
                    // bg="var(--mantine-color-green-light)"
                    wrap="nowrap"
                    gap="xs"
                    align="center"
                >
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
                    <Group
                        wrap="wrap"
                        gap="xs"
                        style={{ flexGrow: 1, display: 'none' }}
                    >
                        {loading ? <Loader size="sm" /> : null}
                        <Select
                            placeholder="Select Cluster"
                            data={clusters}
                            value={activeCluster}
                            allowDeselect={false}
                            searchable
                            onChange={handleClusterChange}
                            miw={120}
                            flex={1}
                        />
                        <Button
                            onClick={fetchClusters}
                        >
                            <IconRefresh />
                        </Button>
                        <Button
                            component={Link}
                            href="/clusters">
                            <IconPlus />
                        </Button>
                    </Group>
                    <Group
                        wrap="wrap"
                        gap="xs"
                        style={{ flexGrow: 1 }}
                    >
                        {/* {loading2 ? <Loader size="sm" /> : null} */}
                        <EnvironmentSelect />
                        <Button
                            onClick={fetchEnvironments}
                            loading={loading2}  // Show loading state on the button
                        >
                            <IconRefresh />
                        </Button>
                    </Group>
                </Group>
                <Box visibleFrom='sm'>
                    <Group
                        justify="flex-end"
                    >
                        <ColorSchemeToggle />
                        {/* <EnvSelector /> */}

                        {menu}

                    </Group>
                </Box>
            </Group>
        </>
    )
}
