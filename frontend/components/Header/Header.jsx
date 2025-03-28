'use client'

import { useState, useContext, useEffect } from 'react';
import cx from 'clsx';

import Image from 'next/image'
import { Group, Button, Burger, Box, Loader, Menu, UnstyledButton, Text, rem, useMantineTheme, Select } from '@mantine/core';
import AuthContext from '@/contexts/auth';

import { ColorSchemeToggle } from '@/components/ColorSchemeToggle/ColorSchemeToggle';
import { EnvSelector } from '@/components/EnvSelector';
import { useSession, signOut } from "next-auth/react"

import { useGlobalState } from '@/contexts/global';

import {
    IconLogout,
    IconHeart,
    IconStar,
    IconMessage,
    IconSettings,
    IconPlayerPause,
    IconTrash,
    IconRefresh,
    IconSwitchHorizontal,
    IconChevronDown,
    IconPlus,
} from '@tabler/icons-react';


import classes from './Header.module.css';

import { callGoApi } from '@/lib/k8s';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';


export function Header({ mobileOpened, toggleMobile, desktopOpened, toggleDesktop }) {
    const [userMenuOpened, setUserMenuOpened] = useState(false);

    // const { user, logout } = useContext(AuthContext)

    // const { cluster, setCluster } = useGlobalStore()
    const router = useRouter();
    const currentPath = usePathname()

    const [clusters, setClusters] = useState([])
    const [loading, setLoading] = useState(false)
    const { activeCluster, setActiveCluster } = useGlobalState();

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
                        style={{ flexGrow: 1 }}
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