import React from 'react';
import {
    Card,
    Grid,
    Text,
    Stack,
    Group,
} from '@mantine/core';

const KubernetesResourceViewer = ({ resource, columns = [], columnConfig = {} }) => {
    // Default to showing columns in single group if no config provided
    const defaultConfig = {
        leftColumns: columns,
        rightColumns: []
    };

    // Use provided column configuration or default
    const { leftColumns = [], rightColumns = [] } = columnConfig.layout || defaultConfig;

    // Helper to get nested value from object using dot notation
    const getNestedValue = (obj, path) => {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : null;
        }, obj);
    };

    // Format the value for display
    const formatValue = (value) => {
        if (value === undefined || value === null) return '-';
        if (typeof value === 'boolean') return value.toString();
        if (typeof value === 'number') return value.toString();
        if (Array.isArray(value)) return value.join(', ');
        return value;
    };

    const DetailItem = ({ column }) => {
        const value = getNestedValue(resource, column.path);
        const displayValue = formatValue(value);

        if (!displayValue) return null;

        return (
            <Group gap="sm" justify="space-between" w="100%">
                <Text size="sm" c="dimmed">{column.label}</Text>
                <Text size="sm" className="font-mono">
                    {displayValue}
                </Text>
            </Group>
        );
    };

    // If no columns defined, show nothing
    if (!columns.length && !Object.keys(columnConfig).length) {
        return null;
    }

    const annotations = resource?.metadata?.annotations || {};
    const filteredAnnotations = Object.entries(annotations)
        .filter(([key]) => !key.includes('last-applied-configuration'))
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});


    const labels = resource?.metadata?.labels || {};

    return (
        <Stack>

            <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                <Text fw={500}>Metadata</Text>
                <Grid gutter="xl" mt="md">
                    <Grid.Col span={6}>
                        <Stack gap="xs">
                            {leftColumns.map((column) => (
                                <DetailItem
                                    key={column.path}
                                    column={column}
                                />
                            ))}
                        </Stack>
                    </Grid.Col>

                    {rightColumns.length > 0 && (
                        <Grid.Col span={6}>
                            <Stack gap="xs">
                                {rightColumns.map((column) => (
                                    <DetailItem
                                        key={column.path}
                                        column={column}
                                    />
                                ))}
                            </Stack>
                        </Grid.Col>
                    )}
                </Grid>
            </Card>
            {/* Check if annotations without the last applied configuration exist */}
            {(filteredAnnotations.length > 0) && (
                <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                    <Text fw={500}>Annotations</Text>
                    <Group gap="sm" justify="space-between" w="100%">
                        <Text size="sm" className="font-mono">
                            {/* Loop over annotations and format them as key-value pairs */}
                            {/* But omit if it has "last-applied-configuration" as key */}
                            {Object.entries(resource?.metadata?.annotations).map(([key, value]) => {
                                if (key.includes('last-applied-configuration')) return null;
                                return `${key}: ${value}`;
                            }).join('\n')}
                        </Text>
                    </Group>
                </Card>)}

            {/* Check if labels exist */}
            {(Object.keys(labels).length > 0) && (
                <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                    <Text fw={500}>Labels</Text>
                    <Group gap="sm" justify="space-between" w="100%">
                        <Text size="sm" className="font-mono">
                            {/* Loop over labels and format them as key-value pairs */}
                            {Object.entries(labels).map(([key, value]) => {
                                return `${key}: ${value}`;
                            }).join('\n')}
                        </Text>
                    </Group>
                </Card>)}

            <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                <Text fw={500}>Events</Text>
                <Group gap="sm" justify="space-between" w="100%">
                    <Text size="sm" className="font-mono">
                        {/* Loop over events and format them as key-value pairs */}
                        {resource?.status?.conditions?.map((event) => {
                            return `${event.type}: ${event.message}`;
                        }).join('\n')}
                    </Text>
                </Group>
            </Card>

            {/* Data section */}
            {resource?.data && (
                <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                    <Text fw={500}>Data</Text>
                    <Group gap="sm" justify="space-between" w="100%">
                        <Text size="sm" className="font-mono">
                            {/* Loop over data and format them as key-value pairs */}
                            {Object.entries(resource?.data).map(([key, value]) => {
                                return `${key}: ${value}`;
                            }).join('\n')}
                        </Text>
                    </Group>
                </Card>)}
        </Stack>
    );
};

export default KubernetesResourceViewer;