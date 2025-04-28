import React from 'react';
import {
    Card,
    Grid,
    Text,
    Stack,
    Group,
    Code,
    Pill,
    SimpleGrid,
    Title,
    Collapse,
    Table,
    Box,
    Badge,
    Accordion,
    Divider,
} from '@mantine/core';
import { IconBox, IconDisc, IconServer, IconClipboardCheck, IconLock, IconSettings, IconDatabase, IconMapPin, IconFolderPlus, IconFolder, IconContainer, IconVariable, IconAlertCircle, IconPackage, IconCircleCheck } from '@tabler/icons-react';

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


    const renderContainers = (containersSpec, containersStatus = [], title = 'Containers', type = 'containers') => {
        if (!containersSpec || containersSpec.length === 0) return null;

        // Combine spec and status information
        const containers = containersSpec.map(container => {
            const status = containersStatus.find(s => s.name === container.name) || {};
            return { ...container, ...status };
        });

        console.log(containers)

        // Container details component
        const ContainerCard = ({ container }) => {
            // Helper for key-value pairs
            const InfoItem = ({ label, value, divider = true }) => (
                <>
                    <Group position="apart" mb={5}>
                        <Text size="sm" c="dimmed" fw={500}>{label}</Text>
                        <Text size="sm" className="font-mono" truncate>
                            {value || "—"}
                        </Text>
                    </Group>
                    {divider && <Divider my="xs" />}
                </>
            );

            // Render environment variables
            const EnvVarsTable = ({ envVars }) => {
                if (!envVars || envVars.length === 0) return <Text size="sm" fs="italic">No environment variables</Text>;

                return (
                    <Table striped highlightOnHover size="xs">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {envVars.map((env, i) => (
                                <tr key={`env-${i}`}>
                                    <td className="font-mono">{env.name}</td>
                                    <td className="font-mono">
                                        {env.valueFrom ? (
                                            <Badge color="blue" variant="dot">From Reference</Badge>
                                        ) : (
                                            env.value || "—"
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                );
            };

            // Determine ready state from status
            const isReady = container.ready === true;

            return (
                <Card key={container.name} p="md" radius="md" withBorder mb="md">
                    <Card.Section inheritPadding py="xs" withBorder>
                        <Group position="apart">
                            <Group>
                                <IconBox size={18} />
                                <Text fw={600}>{container.name}</Text>
                                {type === 'init' && <Badge size="sm" color="grape">Init</Badge>}
                            </Group>
                            {type === 'Pod' ?

                                <Badge
                                    color={container.ready ? "green" : "orange"}
                                    variant="light"
                                    leftSection={container.ready ? <IconCircleCheck size={14} /> : <IconAlertCircle size={14} />}
                                >
                                    {container.ready ? "Ready" : "Not Ready"}
                                </Badge> : null
                            }
                        </Group>
                    </Card.Section>

                    <SimpleGrid cols={2} mt="md" breakpoints={[{ maxWidth: 'sm', cols: 1 }]}>
                        <div>
                            <Title order={5} mb="md">Configuration</Title>
                            <InfoItem label="Image" value={container.image} />
                            <InfoItem label="ImagePullPolicy" value={container.imagePullPolicy} />
                            <InfoItem label="Command" value={container.command?.join(' ')} />
                            <InfoItem label="Arguments" value={container.args?.join(' ')} />
                        </div>
                        {type === 'Pod' ?
                        <div>
                            <Title order={5} mb="md">Status</Title>
                            <InfoItem label="Restarts" value={container.restartCount || "0"} />
                            <InfoItem label="State" value={Object.keys(container.state || {})[0] || "Unknown"} />
                            {container.lastState && Object.keys(container.lastState).length > 0 && (
                                <InfoItem label="Last State" value={Object.keys(container.lastState)[0]} />
                            )}
                        </div> : null
                        }
                    </SimpleGrid>

                    {/* Environment Variables Section - Simplified */}
                    <Accordion variant="separated" mt="md">
                        <Accordion.Item value="env-vars">
                            <Accordion.Control>
                                <Group>
                                    <IconVariable size={16} />
                                    <Text fw={500}>Environment Variables</Text>
                                    {container.env && <Badge size="sm" color="cyan">{container.env.length}</Badge>}
                                </Group>
                            </Accordion.Control>
                            <Accordion.Panel>
                                <EnvVarsTable envVars={container.env} />
                            </Accordion.Panel>
                        </Accordion.Item>
                    </Accordion>
                </Card>
            );
        };

        return (
            <Accordion variant="contained" defaultValue={title.toLowerCase()} radius="md" mb="lg">
                <Accordion.Item value={title.toLowerCase()}>
                    <Accordion.Control>
                        <Group>
                            {type === 'init' ? <IconPackage size={18} /> : <IconContainer size={18} />}
                            <Text fw={600}>{title}</Text>
                            <Badge size="sm" color="blue">{containers.length}</Badge>
                        </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                        {containers.map(container => <ContainerCard key={container.name} container={container} />)}
                    </Accordion.Panel>
                </Accordion.Item>
            </Accordion>
        );
    };

    const renderVolumes = (volumes = [], volumeMounts = [], title = 'Volumes') => {
        if (!volumes || volumes.length === 0) return null;

        // Volume details component
        const VolumeCard = ({ volume, mounts = [] }) => {
            // Helper for key-value pairs
            const InfoItem = ({ label, value, divider = true }) => (
                <>
                    <Group position="apart" mb={5}>
                        <Text size="sm" c="dimmed" fw={500}>{label}</Text>
                        <Text size="sm" className="font-mono" truncate>
                            {value || "—"}
                        </Text>
                    </Group>
                    {divider && <Divider my="xs" />}
                </>
            );

            // Get related mounts for this volume
            const relatedMounts = mounts.filter(mount => mount.name === volume.name);

            // Determine volume type based on which field is present
            const getVolumeType = () => {
                const types = [
                    'configMap', 'secret', 'persistentVolumeClaim', 'emptyDir',
                    'hostPath', 'projected', 'downwardAPI', 'csi', 'nfs'
                ];

                for (const type of types) {
                    if (volume[type]) return type;
                }
                return 'unknown';
            };

            const volumeType = getVolumeType();

            // Get volume source details based on type
            const getVolumeSourceDetails = () => {
                switch (volumeType) {
                    case 'configMap':
                        return `ConfigMap: ${volume.configMap.name}`;
                    case 'secret':
                        return `Secret: ${volume.secret.secretName}`;
                    case 'persistentVolumeClaim':
                        return `PVC: ${volume.persistentVolumeClaim.claimName}`;
                    case 'emptyDir':
                        return 'Empty Directory';
                    case 'hostPath':
                        return `Host Path: ${volume.hostPath.path}`;
                    default:
                        return volumeType.charAt(0).toUpperCase() + volumeType.slice(1);
                }
            };

            // Get icon based on volume type
            const getVolumeIcon = () => {
                switch (volumeType) {
                    case 'configMap':
                        return <IconSettings size={18} />;
                    case 'secret':
                        return <IconLock size={18} />;
                    case 'persistentVolumeClaim':
                        return <IconDatabase size={18} />;
                    case 'emptyDir':
                        return <IconFolderPlus size={18} />;
                    case 'hostPath':
                        return <IconServer size={18} />;
                    default:
                        return <IconFolder size={18} />;
                }
            };

            // Mount points table
            const MountPointsTable = ({ mounts }) => {
                if (!mounts || mounts.length === 0) return <Text size="sm" fs="italic">Not mounted by any container</Text>;

                return (
                    <Table striped highlightOnHover size="xs">
                        <thead>
                            <tr>
                                <th>Container</th>
                                <th>Mount Path</th>
                                <th>Read Only</th>
                                <th>Sub-Path</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mounts.map((mount, i) => (
                                <tr key={`mount-${i}`}>
                                    <td className="font-mono">{mount.containerName || "—"}</td>
                                    <td className="font-mono">{mount.mountPath}</td>
                                    <td>{mount.readOnly ? <Badge color="orange">Yes</Badge> : <Badge color="green">No</Badge>}</td>
                                    <td className="font-mono">{mount.subPath || "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                );
            };

            return (
                <Card key={volume.name} p="md" radius="md" withBorder mb="md">
                    <Card.Section inheritPadding py="xs" withBorder>
                        <Group position="apart">
                            <Group>
                                {getVolumeIcon()}
                                <Text fw={600}>{volume.name}</Text>
                                <Badge size="sm" color="indigo">{volumeType}</Badge>
                            </Group>
                            <Badge color="blue" variant="light">
                                {relatedMounts.length ? `${relatedMounts.length} mounts` : 'Not mounted'}
                            </Badge>
                        </Group>
                    </Card.Section>

                    <Box mt="md">
                        <Title order={5} mb="md">Configuration</Title>
                        <InfoItem label="Volume Type" value={volumeType} />
                        <InfoItem label="Source" value={getVolumeSourceDetails()} />

                        {/* Volume-type specific details */}
                        {volumeType === 'persistentVolumeClaim' && (
                            <InfoItem
                                label="Access Mode"
                                value={volume.persistentVolumeClaim.readOnly ? 'ReadOnly' : 'ReadWrite'}
                            />
                        )}

                        {volumeType === 'configMap' && volume.configMap.items && (
                            <InfoItem
                                label="Item Count"
                                value={volume.configMap.items.length}
                            />
                        )}
                    </Box>

                    {/* Mount Points Section */}
                    <Accordion variant="separated" mt="md">
                        <Accordion.Item value="mount-points">
                            <Accordion.Control>
                                <Group>
                                    <IconMapPin size={16} />
                                    <Text fw={500}>Mount Points</Text>
                                    {relatedMounts.length > 0 && (
                                        <Badge size="sm" color="cyan">{relatedMounts.length}</Badge>
                                    )}
                                </Group>
                            </Accordion.Control>
                            <Accordion.Panel>
                                <MountPointsTable mounts={relatedMounts} />
                            </Accordion.Panel>
                        </Accordion.Item>
                    </Accordion>
                </Card>
            );
        };

        // Process volume mounts to add container names
        const processedMounts = containers?.reduce((acc, container) => {
            const containerMounts = (container.volumeMounts || []).map(mount => ({
                ...mount,
                containerName: container.name
            }));
            return [...acc, ...containerMounts];
        }, []) || volumeMounts;

        return (
            <Accordion variant="contained" defaultValue={title.toLowerCase()} radius="md" mb="lg">
                <Accordion.Item value={title.toLowerCase()}>
                    <Accordion.Control>
                        <Group>
                            <IconDisc size={18} />
                            <Text fw={600}>{title}</Text>
                            <Badge size="sm" color="blue">{volumes.length}</Badge>
                        </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                        {volumes.map(volume => (
                            <VolumeCard
                                key={volume.name}
                                volume={volume}
                                mounts={processedMounts}
                            />
                        ))}
                    </Accordion.Panel>
                </Accordion.Item>
            </Accordion>
        );
    };

    // Render conditions function for Kubernetes resources
    const renderConditions = (conditions = [], title = 'Conditions') => {
        if (!conditions || conditions.length === 0) return null;

        // Get appropriate color based on condition status
        const getStatusColor = (status, type) => {
            if (status === 'True') {
                // Special case for certain negative conditions
                if (['Unschedulable', 'PodScheduled', 'ContainersReady'].includes(type)) {
                    return 'green';
                }
                return 'green';
            } else if (status === 'False') {
                // Special case for certain negative conditions
                if (['Unschedulable'].includes(type)) {
                    return 'green';
                }
                return 'red';
            } else if (status === 'Unknown') {
                return 'yellow';
            }
            return 'gray';
        };

        // Format timestamp to readable format
        const formatTimestamp = (timestamp) => {
            if (!timestamp) return '—';
            try {
                const date = new Date(timestamp);
                return date.toLocaleString();
            } catch (e) {
                return timestamp;
            }
        };

        // Calculate time since last transition
        const getTimeSince = (timestamp) => {
            if (!timestamp) return '—';
            try {
                const transitionTime = new Date(timestamp);
                const now = new Date();
                const diffMs = now - transitionTime;

                const diffSecs = Math.floor(diffMs / 1000);
                const diffMins = Math.floor(diffSecs / 60);
                const diffHours = Math.floor(diffMins / 60);
                const diffDays = Math.floor(diffHours / 24);

                if (diffDays > 0) return `${diffDays}d ago`;
                if (diffHours > 0) return `${diffHours}h ago`;
                if (diffMins > 0) return `${diffMins}m ago`;
                return `${diffSecs}s ago`;
            } catch (e) {
                return '—';
            }
        };

        return (
            <Card p="lg" radius="md" withBorder className="bg-gray-900 text-white">
                <Group mb="md">
                    <IconClipboardCheck size={20} />
                    <Text fw={600}>{title}</Text>
                </Group>

                <Table striped highlightOnHover>
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Last Transition</th>
                            <th>Reason</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        {conditions.map((condition, index) => (
                            <tr key={`condition-${index}`}>
                                <td>
                                    <Text fw={500}>{condition.type}</Text>
                                </td>
                                <td>
                                    <Badge
                                        color={getStatusColor(condition.status, condition.type)}
                                        variant="filled"
                                    >
                                        {condition.status}
                                    </Badge>
                                </td>
                                <td>
                                    <Group spacing={5}>
                                        <Text size="sm">{getTimeSince(condition.lastTransitionTime)}</Text>
                                        <Badge
                                            size="xs"
                                            color="gray"
                                            variant="outline"
                                            title={formatTimestamp(condition.lastTransitionTime)}
                                        >
                                            {formatTimestamp(condition.lastTransitionTime).split(',')[0]}
                                        </Badge>
                                    </Group>
                                </td>
                                <td>
                                    <Text size="sm" fw={500}>{condition.reason || '—'}</Text>
                                </td>
                                <td>
                                    <Text size="sm">{condition.message || '—'}</Text>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </Card>
        );
    };

    // Extract container specs and statuses
    const podSpec = resource?.spec?.template?.spec || resource?.spec;
    const podStatus = resource?.status;

    // Get containers from different possible locations
    const containers = podSpec?.containers || [];
    const initContainers = podSpec?.initContainers || [];

    // Get container statuses
    const containerStatuses = podStatus?.containerStatuses || [];
    const initContainerStatuses = podStatus?.initContainerStatuses || [];

    return (
        <Stack spacing={20}>
            {/* Other render functions can go here */}
            {renderResourceSummary()}
            {renderMetadata()}
            {renderData()}
            {renderContainers(containers, containerStatuses, 'Containers', 'regular')}
            {renderContainers(initContainers, initContainerStatuses, 'Init Containers', 'init')}
            {/* Add the new renderers */}
            {renderVolumes(podSpec?.volumes, null, 'Volumes')}
            {renderConditions(podStatus?.conditions, 'Conditions')}

        </Stack>
    );
};

export default KubernetesResourceViewer;
