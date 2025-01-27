import React from 'react';
import {
    Card,
    Grid,
    Text,
    Stack,
    Group,
    Code,
    Pill,
    Collapse,
    Badge,
    Accordion,
    Divider,
} from '@mantine/core';
import { IconBox } from '@tabler/icons-react';

const KubernetesResourceViewer = ({ resource, columns = [], columnConfig = {}, type }) => {
    // Default to showing columns in single group if no config provided
    const defaultConfig = {
        leftColumns: columns,
        rightColumns: [],
        expandable: false,
        transforms: {},
        validations: {},
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

    // Detail item component
    const DetailItem = ({ column }) => {
        const value = getNestedValue(resource, column.path);
        const displayValue = formatValue(value);

        const context = { resource }; // Pass the entire resource for context

        // If a render function is provided, use it
        if (column.render) {
            return (
                <Group gap="sm" justify="space-between" w="100%">
                    <Text size="sm" c="dimmed">{column.label}</Text>
                    <Text size="sm" className="font-mono">
                        {column.render({ value, ...context })}
                    </Text>
                </Group>
            );
        }

        return (
            <Group gap="sm" justify="space-between" w="100%">
                <Text size="sm" c="dimmed">{column.label}</Text>
                <Text size="sm" className="font-mono">
                    {displayValue}
                </Text>
            </Group>
        );

    };

    // Display resource summary
    const renderResourceSummary = () => {
        if (!columns.length && !Object.keys(columnConfig).length) {
            return null;
        }

        return (
            <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                <Text fw={500}>Resource Summary</Text>
                <Grid gutter="xl" mt="md">
                    <>
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
                    </>
                </Grid>
            </Card>
        );
    };

    // Display resource metadata
    const renderMetadata = () => {
        const annotations = resource?.metadata?.annotations || {};
        const labels = resource?.metadata?.labels || {};

        return (
            <Stack spacing={0}>
                {(Object.keys(annotations).length > 0 || Object.keys(labels).length > 0) && (
                    <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                        <Text fw={500}>Resource Metadata</Text>
                        <Stack mt="md">
                            {Object.keys(labels).length > 0 && (
                                <Group gap="sm" justify="space-between" w="100%">
                                    <Text fw={500}>Labels</Text>
                                    <Group gap="sm" justify="space-between" w="100%">
                                        {Object.entries(labels).map(([key, value]) => (
                                            <Pill key={key}>
                                                {key}: {value}
                                            </Pill>
                                        ))}
                                    </Group>
                                </Group>
                            )}
                            {Object.keys(annotations).length > 0 && (
                                <Group gap="sm" justify="space-between" w="100%">
                                    <Text fw={500}>Annotations</Text>
                                    <Group gap="sm" justify="space-between" w="100%">
                                        {Object.entries(annotations).map(([key, value]) => (
                                            <Pill key={key}>
                                                {key}: {value}
                                            </Pill>
                                        ))}
                                    </Group>
                                </Group>
                            )}
                        </Stack>
                    </Card>
                )}
            </Stack>
        );
    };

    // Display resource-specific data
    const renderData = () => {
        if (!resource?.data) return null;

        return (
            <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                <Text fw={500}>Resource Data</Text>
                <Group gap="sm" w="100%" mt="md">
                    {Object.entries(resource?.data).map(([key, value]) => (
                        <React.Fragment key={key}>
                            <Group gap="sm" align="flex-start">
                                <Text size="sm" c="dimmed">{key}</Text>
                                <Text size="sm" className="font-mono">
                                    <Code>{value}</Code>
                                </Text>
                            </Group>
                            <Divider mx={-15} my="sm" />
                        </React.Fragment>
                    ))}
                </Group>
            </Card>
        );
    };

    // Display containers (including init containers)
    const renderContainers = (containers, title = 'Containers', type = 'containers') => {
        if (!containers) return null;

        const containerDetails = (container, index) => (
            <Card key={`${container.name}-${index}`} p="lg" radius="md" withBorder shadow="lg">
                <Card.Section inheritPadding py="md">
                    <Group gap={5} align="center">
                        <IconBox size={16} />
                        <Text fw={500}>{container.name}</Text>
                        <Text size="sm" c="dimmed">({type === 'init' ? 'Init' : 'Regular'})</Text>
                    </Group>
                </Card.Section>
                <Card.Section inheritPadding py="md">
                    <Stack spacing={0}>
                        <Text size="sm" c="dimmed">Image</Text>
                        <Text size="sm" className="font-mono">{container.image}</Text>
                        <Divider my="sm" />
                        <Text size="sm" c="dimmed">Command</Text>
                        <Text size="sm" className="font-mono">{container.command || "—"}</Text>
                        <Divider my="sm" />
                        {container.args && (
                            <>
                                <Text size="sm" c="dimmed">Args</Text>
                                <Text size="sm" className="font-mono">{container.args}</Text>
                                <Divider my="sm" />
                            </>
                        )}
                        <Text size="sm" c="dimmed">Ready</Text>
                        <Text size="sm" className="font-mono">{container.ready ? "Yes" : "No"}</Text>
                        <Divider my="sm" />
                        <Text size="sm" c="dimmed">Restarts</Text>
                        <Text size="sm" className="font-mono">{container.restarts || "—"}</Text>
                        {container.restartReason && (
                            <>
                                <Divider my="sm" />
                                <Text size="sm" c="dimmed">Restart Reason</Text>
                                <Text size="sm" className="font-mono">{container.restartReason}</Text>
                            </>
                        )}
                        {container.lastRestart && (
                            <>
                                <Divider my="sm" />
                                <Text size="sm" c="dimmed">Last Restart</Text>
                                <Text size="sm" className="font-mono">{container.lastRestart}</Text>
                            </>
                        )}
                        <Divider my="sm" />
                        <Text size="sm" c="dimmed">Termination Policy</Text>
                        <Text size="sm" className="font-mono">{container.terminationMessagePolicy || "File"}</Text>
                    </Stack>
                </Card.Section>
            </Card>
        );

        return (
            <Accordion variant="contained" defaultValue={title.toLowerCase()}>
                <Accordion.Item value={title.toLowerCase()}>
                    <Accordion.Control>
                        <Group gap={5}>
                            <Text fw={500}>{title}</Text>
                            <Badge size="sm" variant="filled" color="blue">
                                {containers.length}
                            </Badge>
                        </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                        {containers.map((container, index) =>
                            containerDetails(container, index)
                        )}
                    </Accordion.Panel>
                </Accordion.Item>
            </Accordion>
        );
    };

    return (
        <Stack spacing={20}>
            {renderResourceSummary()}
            {renderMetadata()}
            {renderData()}
            {renderContainers(resource?.spec?.containers, 'Containers', 'regular')}
            {renderContainers(resource?.spec?.initContainers, 'Init Containers', 'init')}
        </Stack>
    );
};

export default KubernetesResourceViewer;