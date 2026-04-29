import { useParams } from 'next/navigation';

import { SimpleGrid, Card, Text, Group, ThemeIcon, Badge } from '@mantine/core';
import { IconSettings, IconFileDatabase, IconLock, IconChartLine, IconShield, IconBulb, IconDeviceDesktop } from '@tabler/icons-react';

import Link from 'next/link';

export default function Configurations() {

    const activeCluster = useParams()?.clustername;

    const resources = [
        { label: 'Secrets', description: 'Sensitive information such as passwords, keys, and tokens', link: `/clusters/${activeCluster}/configurations/secrets`, icon: IconLock, color: 'red' },
        { label: 'ConfigMaps', description: 'Non-confidential configuration data as key-value pairs', link: `/clusters/${activeCluster}/configurations/configmaps`, icon: IconFileDatabase, color: 'yellow' },
        { label: 'Horizontal Pod Autoscalers', description: 'Automatically scale Pod replicas based on metrics', link: `/clusters/${activeCluster}/configurations/hpa`, icon: IconChartLine, color: 'green' },
        { label: 'Custom Resource Definitions', description: 'Browse installed Kubernetes API extensions and their versions', link: `/clusters/${activeCluster}/configurations/crds`, icon: IconSettings, color: 'blue' },
        { label: 'Priority Classes', description: 'Set priority classes for pod scheduling', link: `/clusters/${activeCluster}/configurations/priorityclasses`, icon: IconShield, color: 'indigo' },
        { label: 'Runtime Classes', description: 'Define container runtime configurations', link: `/clusters/${activeCluster}/configurations/runtimeclasses`, icon: IconDeviceDesktop, color: 'cyan' },
        { label: 'Pod Disruption Budgets', description: 'Control voluntary disruptions to Pods', link: `/clusters/${activeCluster}/configurations/poddisruptionbudgets`, icon: IconBulb, color: 'orange' },
    ];

    return (
        <>
            <div>
                <Group mb="md">
                    <ThemeIcon size="lg" radius="md" variant="light" color="yellow">
                        <IconSettings size={20} />
                    </ThemeIcon>
                    <Text size="xl" fw={600}>Configurations</Text>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {resources.map((resource) => (
                        <Card key={resource.label} component={Link} href={resource.link} shadow="sm" padding="lg" radius="md" withBorder
                            style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                        >
                            <Group justify="space-between" mb="xs">
                                <ThemeIcon color={resource.color} variant="light" size="sm" radius="sm">
                                    <resource.icon size={18} />
                                </ThemeIcon>
                                <Badge size="sm" variant="light">{resource.label}</Badge>
                            </Group>
                            <Text size="sm" c="dimmed">{resource.description}</Text>
                        </Card>
                    ))}
                </SimpleGrid>
            </div>
        </>
    )
}
