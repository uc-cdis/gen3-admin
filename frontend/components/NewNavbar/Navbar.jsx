import { useState, useEffect } from 'react';
import { Group, ScrollArea, rem, Center, Tooltip, UnstyledButton, Stack, Menu, Avatar, Accordion, Text, NavLink } from '@mantine/core';
import {
    IconNotes,
    IconCalendarStats,
    IconGauge,
    IconAdjustments,
    IconLock,
    IconHome2,
    IconDeviceDesktopAnalytics,
    IconFingerprint,
    IconUser,
    IconSettings,
    IconLogout,
    IconSwitchHorizontal,
    IconPlus,
    IconRefresh,
    IconKey,
    IconNetwork,
    IconShip,
    IconLayoutGrid,
    IconServer,
    IconPentagonNumber3,
    IconChartBar,
    IconFile,
    IconStar,
} from '@tabler/icons-react';
// import { UserButton } from '../UserButton/UserButton';
// import { LinksGroup } from '../NavbarLinksGroup/NavbarLinksGroup';
// import { Logo } from './Logo';
import classes from './Navbar.module.css'; // New styles
// import { MantineLogo } from '@mantinex/mantine-logo'; // Placeholder logo



import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';

import Link from 'next/link';


import { callGoApi } from '@/lib/k8s';

const clusterData = [
    { icon: IconHome2, label: 'Cluster 1' },
    { icon: IconGauge, label: 'Cluster 2' },
    { icon: IconDeviceDesktopAnalytics, label: 'Cluster 3' },
];


function NavbarLink({ icon: Icon, label, active, setActiveCluster, cluster }) {
    return (
        <Tooltip label={label} position="right" transitionProps={{ duration: 0 }}>
            <UnstyledButton
                component={Link}
                href={`/clusters/${label}`}
                className={classes.link}
                onClick={cluster ? () => setActiveCluster(label) : null}
                data-active={active || undefined}
            >
                {Icon ? (
                    <Icon style={{ width: rem(20), height: rem(20) }} stroke={1.5} />
                ) : (
                    <Avatar color="blue" radius="xl">
                        {label.charAt(0).toUpperCase()}
                    </Avatar>
                )}
            </UnstyledButton>
        </Tooltip>
    );
}


function UserButton() {
    return (
        <Menu>
            <Menu.Target>
                <Avatar radius="xl" />
            </Menu.Target>
            <Menu.Dropdown>
                <Menu.Item>Profile</Menu.Item>
                <Menu.Item>Settings</Menu.Item>
                <Menu.Item>Logout</Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
}

// Function to render nested links, recursively if necessary
function LinksGroup({ label, links, icon: Icon }) {
    const router = useRouter();
    const currentPath = router.asPath;

    // Check if any of the nested links (or the parent link itself) is active
    const isActive = links.some(link => link.link === currentPath || 
      (link.links && link.links.some(subLink => subLink.link === currentPath)));

    return (
        <Accordion.Item value={label}>
            <Accordion.Control
                icon={<Icon style={{ width: rem(20), height: rem(20) }} stroke={1.5} />}
                className={isActive ? classes.activeLink : ''} // Highlight parent if any of its child links is active
            >
                <Text size="sm" c="">
                    {label}
                </Text>
            </Accordion.Control>
            <Accordion.Panel>
                {links.map((link) => {
                    return link.links ? (
                        <LinksGroup key={link.label} {...link} />
                    ) : (
                        <Group key={link.label}>
                            <NavLink
                                href={link.link}
                                label={link.label}
                                component={Link}
                                className={currentPath === link.link ? classes.activeLink : ''}
                                // Apply active class if the current link matches the path
                            />
                        </Group>
                    );
                })}
            </Accordion.Panel>
        </Accordion.Item>
    );
}






export function NavBar() {
    const router = useRouter()


    const [activeCluster, setActiveCluster] = useState(0);


    const [clusters, setClusters] = useState([]);
    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const fetchClusters = async () => {
        try {
            const data = await callGoApi('/agents', 'GET', null, null, accessToken)
            // Only show clusters that are active
            setClusters(data.filter(cluster => cluster.connected))
            setActiveCluster(data.filter(cluster => cluster.connected)[0].name)
        } catch (error) {
            console.error('Failed to fetch clusters:', error);
        }
    };

    useEffect(() => {
        fetchClusters(accessToken).then((data) => {
            if (data) {
                setClusters(data);
            }
        });
    }, []);

    const clusterLinks = clusters.map((link, index) => {
        return (
            <NavbarLink
                {...link}
                key={link.name}
                label={link.name}
                cluster={true}
                setActiveCluster={setActiveCluster}
                active={index === activeCluster}
            />
        )
    }
    );

    const nestedLinksData = [
        {
            label: 'Gen3',
            icon: IconPentagonNumber3,
            links: [
                { label: 'Helm deployments', link: '/projects', icon: IconChartBar },
                { label: 'Clusters', link: `/clusters/`, icon: IconChartBar },
                { label: 'Jobs', link: `/clusters/${activeCluster}/cronjobs`, icon: IconChartBar },
                { label: 'Workspaces', link: `/clusters/${activeCluster}/workspaces`, icon: IconChartBar },
                { label: 'Databases', link: '/', icon: IconChartBar },
            ],
        },
        {
            label: 'Kubernetes',
            icon: IconShip,
            links: [
                {
                    label: 'Cluster',
                    icon: IconServer,
                    links: [
                        { label: 'Nodes', link: `/clusters/${activeCluster}/cluster/nodes` },
                        { label: 'Namespaces', link: `/clusters/${activeCluster}/cluster/namespaces` },
                    ],
                },
                {
                    label: 'Workloads',
                    icon: IconLayoutGrid,
                    links: [
                        { label: 'Pods', link: `/clusters/${activeCluster}/workloads/pods` },
                        { label: 'Deployments', link: `/clusters/${activeCluster}/workloads/deployments` },
                        { label: 'DaemonSets', link: `/clusters/${activeCluster}/workloads/daemonsets` },
                        { label: 'StatefulSets', link: `/clusters/${activeCluster}/workloads/statefulsets` },
                        { label: 'ReplicaSets', link: `/clusters/${activeCluster}/workloads/replicasets` },
                        { label: 'Jobs', link: `/clusters/${activeCluster}/workloads/jobs` },
                        { label: 'CronJobs', link: `/clusters/${activeCluster}/workloads/cronjobs` },
                    ],
                },
                {
                    label: 'Configurations',
                    icon: IconSettings,
                    links: [
                        { label: 'Secrets', link: `/clusters/${activeCluster}/configurations/secrets`, icon: IconKey },
                        { label: 'ConfigMaps', link: `/clusters/${activeCluster}/configurations/configmaps`, icon: IconFile },
                        { label: 'HPA', link: `/clusters/${activeCluster}/configurations/hpa`, icon: IconGauge },
                        { label: 'Priority Classes', link: `/clusters/${activeCluster}/configurations/priorityclasses`, icon: IconStar },
                        { label: 'Runtime Classes', link: `/clusters/${activeCluster}/configurations/runtimeclasses`, icon: IconStar },
                        { label: 'Pod Disruption Budgets', link: `/clusters/${activeCluster}/configurations/poddisruptionbudgets`, icon: IconStar },
                    ],
                },
                {
                    label: 'Access Control',
                    icon: IconLock,
                    links: [
                        { label: 'Service Accounts', link: `/clusters/${activeCluster}/access-control/serviceaccounts` },
                        { label: 'Roles', link: `/clusters/${activeCluster}/access-control/roles` },
                        { label: 'Role Bindings', link: `/clusters/${activeCluster}/access-control/rolebindings` },
                        { label: 'Cluster Roles', link: `/clusters/${activeCluster}/access-control/clusterroles` },
                        { label: 'Cluster Role Bindings', link: `/clusters/${activeCluster}/access-control/clusterrolebindings` },
                    ],
                },
                {
                    label: 'Network',
                    icon: IconNetwork,
                    links: [
                        { label: 'Services', link: `/clusters/${activeCluster}/network/services` },
                        { label: 'Ingresses', link: `/clusters/${activeCluster}/network/ingresses` },
                        { label: 'Endpoints', link: `/clusters/${activeCluster}/network/endpoints` },
                    ],
                },
                {
                    label: 'Storage',
                    icon: IconServer,
                    links: [
                        { label: 'Persistent Volume Claims', link: `/clusters/${activeCluster}/storage/persistentvolumeclaims`, icon: IconFile },
                        { label: 'Persistent Volumes', link: `/clusters/${activeCluster}/storage/persistentvolumes`, icon: IconFile },  
                        { label: 'Storage Classes', link: `/clusters/${activeCluster}/storage/storageclasses`, icon: IconFile },
                    ],
                },
            ],
        },
    ];

    const nestedLinks = nestedLinksData.map((item) => <LinksGroup {...item} key={item.label} />);

    return (
        <div className={classes.container}>
            {/* Left Side: Cluster Selection */}
            <nav className={classes.leftNavbar}>
                <Center>
                    {/* <MantineLogo type="mark" size={30} /> */}
                    <Stack justify="center" gap={0}>
                        {clusterLinks}
                    </Stack>
                </Center>

                <Center>

                    <Stack justify="center" gap={0}>
                        <UnstyledButton component={Link} href="/clusters">
                            <IconPlus size={30} stroke={1.5} />
                        </UnstyledButton>
                        <UnstyledButton onClick={() => fetchClusters()}>
                            <IconRefresh size={30} stroke={1.5} />
                        </UnstyledButton>
                    </Stack>
                </Center>

                <Center>

                    <Stack justify="center" gap={0}>
                        <NavbarLink icon={IconSwitchHorizontal} label="Change account" />
                        <NavbarLink icon={IconLogout} label="Logout" />
                    </Stack>
                </Center>


            </nav>

            {/* Right Side: Nested Links */}
            {/* Don't display right navbar on `/` route, use Nextjs to determine the path */}
            {
                // router.pathname !== '/'
                true && (
                    <nav className={classes.rightNavbar}>
                        <div className={classes.header}>
                            <Group justify="space-between">
                                {/* <Logo style={{ width: rem(120) }} /> */}
                                <UserButton />
                            </Group>
                        </div>

                        <ScrollArea className={classes.links}>
                            <div className={classes.linksInner}>
                                <Accordion multiple>
                                    {nestedLinks}
                                </Accordion>
                            </div>
                        </ScrollArea>
                    </nav>
                )}
        </div>
    );
}
