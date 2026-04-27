import { useParams } from 'next/navigation';

import { Anchor, SimpleGrid, Card, Text, Group, ThemeIcon, Badge } from '@mantine/core';
import { IconContainer, IconServer, IconCpu, IconRefresh, IconList, IconClock, IconCalendarStats, IconBrandKubernetes } from '@tabler/icons-react';

import Link from 'next/link';

const iconMap = {
    IconContainer,
    IconServer,
    IconCpu,
    IconRefresh,
    IconList,
    IconClock,
    IconCalendarStats,
};

export default function Workloads() {

    const activeCluster = useParams()?.clustername;

    const resources = [
        { label: 'Pods', description: 'One or more containers running in your cluster', link: `/clusters/${activeCluster}/workloads/pods`, icon: 'IconContainer', color: 'blue' },
        { label: 'Deployments', description: 'Declarative updates for Pods and ReplicaSets', link: `/clusters/${activeCluster}/workloads/deployments`, icon: 'IconServer', color: 'indigo' },
        { label: 'DaemonSets', description: 'Ensure a Pod runs on every node', link: `/clusters/${activeCluster}/workloads/daemonsets`, icon: 'IconCpu', color: 'grape' },
        { label: 'StatefulSets', description: 'Stateful workload management for persistent storage', link: `/clusters/${activeCluster}/workloads/statefulsets`, icon: 'IconList', color: 'teal' },
        { label: 'ReplicaSets', description: 'Maintain a stable set of replica Pods', link: `/clusters/${activeCluster}/workloads/replicasets`, icon: 'IconRefresh', color: 'cyan' },
        { label: 'Jobs', description: 'Run to completion workloads', link: `/clusters/${activeCluster}/workloads/jobs`, icon: 'IconClock', color: 'orange' },
        { label: 'CronJobs', description: 'Scheduled Jobs (cron-like)', link: `/clusters/${activeCluster}/workloads/cronjobs`, icon: 'IconCalendarStats', color: 'pink' },
    ];

    return (
        <>
            <div>
                <Group mb="md">
                    <ThemeIcon size="lg" radius="md" variant="light" color="blue">
                        <IconBrandKubernetes size={20} />
                    </ThemeIcon>
                    <Text size="xl" fw={600}>Workloads</Text>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {resources.map((resource) => {
                        const IconComponent = iconMap[resource.icon] || IconContainer;
                        return (
                            <Card key={resource.label} component={Link} href={resource.link} shadow="sm" padding="lg" radius="md" withBorder
                                style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                            >
                                <Group justify="space-between" mb="xs">
                                    <ThemeIcon color={resource.color} variant="light" size="sm" radius="sm">
                                        <IconComponent size={18} />
                                    </ThemeIcon>
                                    <Badge size="sm" variant="light">{resource.label}</Badge>
                                </Group>
                                <Text size="sm" c="dimmed">{resource.description}</Text>
                            </Card>
                        );
                    })}
                </SimpleGrid>
            </div>
        </>
    )
}
