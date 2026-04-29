import { useParams } from 'next/navigation';

import { Anchor, SimpleGrid, Card, Text, Group, ThemeIcon, Badge } from '@mantine/core';
import { IconNetwork, IconPlug, IconRoute, IconWorldWww } from '@tabler/icons-react';

import Link from 'next/link';

export default function Network() {

    const activeCluster = useParams()?.clustername;

    const resources = [
        { label: 'Ingresses', description: 'External access rules to services in a cluster', link: `/clusters/${activeCluster}/network/ingresses`, icon: IconWorldWww, color: 'violet' },
        { label: 'Services', description: 'Expose applications running in Pods', link: `/clusters/${activeCluster}/network/services`, icon: IconPlug, color: 'blue' },
        { label: 'Endpoints', description: 'Network addresses that implement a Service', link: `/clusters/${activeCluster}/network/endpoints`, icon: IconRoute, color: 'gray' },
    ];

    return (
        <>
            <div>
                <Group mb="md">
                    <ThemeIcon size="lg" radius="md" variant="light" color="violet">
                        <IconNetwork size={20} />
                    </ThemeIcon>
                    <Text size="xl" fw={600}>Network</Text>
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
