import { useParams } from 'next/navigation';

import { SimpleGrid, Card, Text, Group, ThemeIcon, Badge } from '@mantine/core';
import { IconDatabase, IconHardDrive, IconCloudUpload, IconServer } from '@tabler/icons-react';

import Link from 'next/link';

export default function Storage() {

    const activeCluster = useParams()?.clustername;

    const resources = [
        { label: 'Persistent Volumes', description: 'Cluster-wide storage resources backed by physical storage', link: `/clusters/${activeCluster}/storage/persistentvolumes`, icon: IconHardDrive, color: 'blue' },
        { label: 'Persistent Volume Claims', description: 'Requests for storage resources by a user or workload', link: `/clusters/${activeCluster}/storage/persistentvolumeclaims`, icon: IconCloudUpload, color: 'green' },
        { label: 'Storage Classes', description: 'Describe classes of storage offered by the cluster', link: `/clusters/${activeCluster}/storage/storageclasses`, icon: IconServer, color: 'orange' },
    ];

    return (
        <>
            <div>
                <Group mb="md">
                    <ThemeIcon size="lg" radius="md" variant="light" color="blue">
                        <IconDatabase size={20} />
                    </ThemeIcon>
                    <Text size="xl" fw={600}>Storage</Text>
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
