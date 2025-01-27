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
} from '@mantine/core';

import { IconBox } from '@tabler/icons-react';

const KubernetesResourceViewer = ({ resource, columns = [], columnConfig = {}, type }) => {
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
    console.log(resource)
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
                                // return `${key}: ${value}`;
                                return (
                                    <Pill key={key}><b>{key}</b>: {value}</Pill>
                                );
                            })}
                        </Text>
                    </Group>
                </Card>)}

            {/* Annotations section */}
            {Object.keys(annotations).length > 0 && (
                <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                    <Text fw={500}>Annotations</Text>
                    <Group gap="sm" justify="space-between" w="100%">
                        <Text size="sm" className="font-mono">
                            {/* Loop over annotations and format them as key-value pairs */}
                            {Object.entries(annotations).map(([key, value]) => {
                                return (
                                    <Pill key={key}><b>{key}</b>: {value}</Pill>
                                );
                            })}
                        </Text>
                    </Group>
                </Card>)}


            {/* Data section - only show if data exists */}
            {resource?.data && (
                <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                    <Text fw={500}>Data</Text>
                    <Group gap="sm" justify="space-between" w="100%">
                        <Text size="sm" className="font-mono">
                            {/* Loop over data and format them as key-value pairs */}
                            {Object.entries(resource?.data).map(([key, value]) => {
                                return (
                                    <React.Fragment key={key}>
                                        <Text size="sm" className="font-mono" key={key}>
                                            {key} :
                                        </Text>
                                        <br />
                                        <Text size="sm" className="font-mono">
                                            <Code>{value}</Code>
                                        </Text>
                                    </React.Fragment>
                                );
                            })}
                        </Text>
                    </Group>
                </Card>)}

            {/* Containers section */}
            {resource?.spec?.containers && (
                <>
                    <Accordion variant="contained" defaultValue="containers">
                        <Accordion.Item value="containers">
                            <Accordion.Control>
                                <Group justify='space-between' align='flex-start'>
                                    <Text fw={500} mb="md">Containers</Text>
                                    <Badge size="sm" variant="filled" color="blue">{resource?.spec?.containers.length}</Badge>
                                </Group>
                            </Accordion.Control>
                            <Accordion.Panel>
                                {resource?.spec?.containers.map((container, index) => (
                                    <React.Fragment key={container.name}>
                                        <Card key={`${container.name}-${index}`} p="lg" radius="md" withBorder shadow="lg">
                                            <Card.Section inheritPadding py="md">
                                                <Group justify='space-between' align='flex-start'>
                                                    <Group justify='space-between' align='flex-start'>
                                                        <IconBox size={16} />
                                                        <Text fw={500} mb="md">{container.name}</Text>
                                                    </Group>
                                                </Group>
                                            </Card.Section>
                                            <Card.Section inheritPadding py="md">
                                                <Stack spacing={0}>
                                                    <Group position="apart" py="xs" px="md">
                                                        <Text size="sm" c="dimmed">Image</Text>
                                                        <Text size="sm" ff="monospace">{container.image}</Text>
                                                    </Group>

                                                    <Group position="apart" py="xs" px="md" >
                                                        <Text size="sm" c="dimmed">Command</Text>
                                                        <Text size="sm" ff="monospace">{container.command || "—"}</Text>
                                                    </Group>
                                                    <Accordion variant="contained">
                                                        <Accordion.Item value="args" >
                                                            <Accordion.Control>
                                                                <Text size="sm" c="dimmed">Args</Text>
                                                            </Accordion.Control>
                                                            <Accordion.Panel>
                                                                <Text size="sm" ff="monospace">{container.args || "—"}</Text>
                                                            </Accordion.Panel>
                                                        </Accordion.Item>
                                                    </Accordion>
                                                    <Group position="apart" py="xs" px="md" >
                                                        <Text size="sm" c="dimmed">Ready</Text>
                                                        <Text size="sm" ff="monospace">{container.ready ? "Yes" : "No"}</Text>
                                                    </Group>
                                                    <Group position="apart" py="xs" px="md" >
                                                        <Text size="sm" c="dimmed">Restarts</Text>
                                                        <Text size="sm" ff="monospace">{container.restarts || "—"}</Text>
                                                    </Group>

                                                    <Group position="apart" py="xs" px="md">
                                                        <Text size="sm" c="dimmed">Restart Reason</Text>
                                                        <Text size="sm" ff="monospace">{container.restartReason || "—"}</Text>
                                                    </Group>

                                                    <Group position="apart" py="xs" px="md">
                                                        <Text size="sm" c="dimmed">Last Restart</Text>
                                                        <Text size="sm" ff="monospace">{container.lastRestart || "—"}</Text>
                                                    </Group>

                                                    <Group position="apart" py="xs" px="md">
                                                        <Text size="sm" c="dimmed">Termination Message Policy</Text>
                                                        <Text size="sm" ff="monospace">{container.terminationMessagePolicy || "File"}</Text>
                                                    </Group>

                                                </Stack>
                                            </Card.Section>
                                        </Card>
                                    </React.Fragment>
                                ))}
                            </Accordion.Panel>
                        </Accordion.Item>
                    </Accordion>

                </>
            )}

            {/* Init Containers section */}
            {resource?.spec?.initContainers && (
                <Accordion variant="contained" defaultValue="containers">
                    <Accordion.Item value="containers">
                        <Accordion.Control>
                            <Group justify='space-between' align='flex-start'>
                                <Text fw={500} mb="md">Init Containers</Text>
                                <Badge size="sm" variant="filled" color="blue">{resource?.spec?.containers.length}</Badge>
                            </Group>
                        </Accordion.Control>
                        <Accordion.Panel>
                            {resource?.spec?.initContainers.map((container, index) => (
                                <Card key={`${container.name}-${index}`} p="lg" radius="md" withBorder shadow="lg">
                                    <Card.Section inheritPadding py="md">
                                        <Group justify='space-between' align='flex-start'>
                                            <Group justify='space-between' align='flex-start'>
                                                <IconBox size={16} />
                                                <Text fw={500} mb="md">{container.name}</Text>
                                            </Group>
                                        </Group>
                                    </Card.Section>
                                    <Card.Section inheritPadding py="md">
                                        <Stack spacing={0}>
                                            <Group position="apart" py="xs" px="md">
                                                <Text size="sm" c="dimmed">Image</Text>
                                                <Text size="sm" ff="monospace">{container.image}</Text>
                                            </Group>

                                            <Group position="apart" py="xs" px="md" >
                                                <Text size="sm" c="dimmed">Command</Text>
                                                <Text size="sm" ff="monospace">{container.command || "—"}</Text>
                                            </Group>
                                            <Group position="apart" py="xs" px="md" >
                                                <Text size="sm" c="dimmed">Args</Text>
                                                <Text size="sm" ff="monospace">{container.args || "—"}</Text>
                                            </Group>
                                            <Group position="apart" py="xs" px="md" >
                                                <Text size="sm" c="dimmed">Ready</Text>
                                                <Text size="sm" ff="monospace">{container.ready ? "Yes" : "No"}</Text>
                                            </Group>
                                            <Group position="apart" py="xs" px="md" >
                                                <Text size="sm" c="dimmed">Restarts</Text>
                                                <Text size="sm" ff="monospace">{container.restarts || "—"}</Text>
                                            </Group>

                                            <Group position="apart" py="xs" px="md">
                                                <Text size="sm" c="dimmed">Restart Reason</Text>
                                                <Text size="sm" ff="monospace">{container.restartReason || "—"}</Text>
                                            </Group>

                                            <Group position="apart" py="xs" px="md">
                                                <Text size="sm" c="dimmed">Last Restart</Text>
                                                <Text size="sm" ff="monospace">{container.lastRestart || "—"}</Text>
                                            </Group>

                                            <Group position="apart" py="xs" px="md">
                                                <Text size="sm" c="dimmed">Termination Message Policy</Text>
                                                <Text size="sm" ff="monospace">{container.terminationMessagePolicy || "File"}</Text>
                                            </Group>

                                        </Stack>
                                    </Card.Section>
                                </Card>
                            ))}
                        </Accordion.Panel>
                    </Accordion.Item>
                </Accordion>
            )}
        </Stack>

    );
};

export default KubernetesResourceViewer;