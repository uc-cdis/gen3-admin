import React, { useState } from 'react';
import {
    Card,
    Grid,
    Text,
    Stack,
    Group,
    Code,
    SimpleGrid,
    Title,
    Table,
    Box,
    Badge,
    Accordion,
    Button,
    Divider,
    ScrollArea,
} from '@mantine/core';
import { IconBox, IconDisc, IconServer, IconClipboardCheck, IconLock, IconSettings, IconDatabase, IconMapPin, IconFolderPlus, IconFolder, IconContainer, IconVariable, IconAlertCircle, IconPackage, IconCircleCheck, IconTag, IconInfoCircle } from '@tabler/icons-react';

const SecretValueCell = ({ raw, decoded }) => {
    const [showRaw, setShowRaw] = useState(false);
    const value = showRaw ? raw : decoded;

    return (
        <Group gap={4} align="flex-start">
            <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontSize: 12,
                flex: 1,
                margin: 0,
                padding: '4px 8px',
                borderRadius: 4,
                background: 'var(--mantine-color-gray-0)',
                border: '1px solid var(--mantine-color-gray-2)',
                maxHeight: showRaw ? undefined : 150,
                overflow: 'auto',
                color: 'var(--mantine-color-text)',
            }}>
                {value}
            </pre>
            <Button
                variant="subtle"
                size="compact-xs"
                onClick={() => setShowRaw(!showRaw)}
                title={showRaw ? 'Show decoded' : 'Show base64'}
            >
                {showRaw ? 'b64' : 'dec'}
            </Button>
        </Group>
    );
};

const KubernetesResourceViewer = ({ resource, columns = [], columnConfig = {}, type }) => {
    const { leftColumns = [], rightColumns = [] } = columnConfig.layout || { leftColumns: columns, rightColumns: [] };

    const getNestedValue = (obj, path) => {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : null;
        }, obj);
    };

    // --- Summary Section ---
    const DetailItem = ({ column }) => {
        const value = getNestedValue(resource, column.path);
        if (value === undefined || value === null) return null;
        if (typeof value === 'boolean') {
            return (
                <Group gap="sm" justify="space-between" w="100%">
                    <Text size="sm" c="dimmed">{column.label}</Text>
                    <Badge size="sm" color={value ? 'green' : 'gray'} variant="filled">{value ? 'Yes' : 'No'}</Badge>
                </Group>
            );
        }
        if (Array.isArray(value)) {
            const display = value.map(v =>
                typeof v === 'object' ? JSON.stringify(v) : String(v)
            ).join(', ');
            return (
                <Group gap="sm" justify="space-between" w="100%">
                    <Text size="sm" c="dimmed">{column.label}</Text>
                    <Text size="sm" className="font-mono">{display}</Text>
                </Group>
            );
        }
        return (
            <Group gap="sm" justify="space-between" w="100%">
                <Text size="sm" c="dimmed">{column.label}</Text>
                <Text size="sm" className="font-mono">{String(value)}</Text>
            </Group>
        );
    };

    const renderSummary = () => {
        if (!leftColumns.length && !rightColumns.length) return null;
        return (
            <Card p="lg" radius="md" withBorder>
                <Group gap="xs" mb="md">
                    <IconInfoCircle size={18} />
                    <Text fw={600} size="lg">Summary</Text>
                </Group>
                <Grid gutter="xl">
                    <Grid.Col span={{ base: 12, md: 6 }}>
                        <Stack gap="sm">
                            {leftColumns.map((col) => <DetailItem key={col.path} column={col} />)}
                        </Stack>
                    </Grid.Col>
                    {rightColumns.length > 0 && (
                        <Grid.Col span={{ base: 12, md: 6 }}>
                            <Stack gap="sm">
                                {rightColumns.map((col) => <DetailItem key={col.path} column={col} />)}
                            </Stack>
                        </Grid.Col>
                    )}
                </Grid>
            </Card>
        );
    };

    // --- Metadata Section (Labels / Annotations) ---
    const renderMetadata = () => {
        const annotations = resource?.metadata?.annotations || {};
        const labels = resource?.metadata?.labels || {};

        const hasContent = Object.keys(annotations).length > 0 || Object.keys(labels).length > 0;
        if (!hasContent) return null;

        const KeyValueTable = ({ data, title }) => (
            <Accordion.Item value={title.toLowerCase()}>
                <Accordion.Control>
                    <Group justify="space-between">
                        <Group gap="xs">
                            <IconTag size={16} />
                            <Text fw={500}>{title}</Text>
                            <Badge size="sm" variant="light">{Object.keys(data).length}</Badge>
                        </Group>
                    </Group>
                </Accordion.Control>
                <Accordion.Panel>
                    <ScrollArea.Autosize mah={300}>
                        <Table striped highlightOnHover size="xs">
                            <thead>
                                <tr><th>Key</th><th>Value</th></tr>
                            </thead>
                            <tbody>
                                {Object.entries(data).map(([key, value]) => (
                                    <tr key={key}>
                                        <td className="font-mono" style={{ maxWidth: 300 }}><Text size="sm" truncate>{key}</Text></td>
                                        <td className="font-mono"><Code block>{String(value)}</Code></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </ScrollArea.Autosize>
                </Accordion.Panel>
            </Accordion.Item>
        );

        return (
            <Card p="lg" radius="md" withBorder>
                <Accordion variant="contained" radius="md">
                    {Object.keys(labels).length > 0 && <KeyValueTable data={labels} title="Labels" />}
                    {Object.keys(annotations).length > 0 && <KeyValueTable data={annotations} title="Annotations" />}
                </Accordion>
            </Card>
        );
    };

    // --- Resource Data Section (ConfigMaps, Secrets, etc.) ---
    const renderData = () => {
        const data = resource?.data;
        if (!data || typeof data !== 'object') return null;

        const entries = Object.entries(data);
        if (entries.length === 0) return null;

        const isSecret = type === 'Secret';

        const decodeValue = (val) => {
            if (!isSecret) return String(val);
            try {
                return atob(String(val));
            } catch {
                return String(val);
            }
        };

        const isMultiline = (val) => val.includes('\n') || val.length > 200;

        return (
            <Card p="lg" radius="md" withBorder>
                <Group gap="xs" mb="md">
                    <IconDatabase size={18} />
                    <Text fw={600} size="lg">Data</Text>
                    <Badge size="sm" variant="light">{entries.length} keys</Badge>
                    {isSecret && <Badge size="sm" color="indigo" variant="light">base64 decoded</Badge>}
                </Group>
                <ScrollArea.Autosize mah={500}>
                    <Table striped highlightOnHover size="xs">
                        <thead>
                            <tr><th style={{ width: '25%', position: 'sticky', left: 0, zIndex: 1, background: 'inherit' }}>Key</th><th>Value</th></tr>
                        </thead>
                        <tbody>
                            {entries.map(([key, value]) => {
                                const raw = String(value);
                                const decoded = decodeValue(value);
                                return (
                                    <tr key={key}>
                                        <td style={{ position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }} className="font-mono"><Text fw={500} size="sm">{key}</Text></td>
                                        <td>
                                            {isSecret ? (
                                                <SecretValueCell raw={raw} decoded={decoded} />
                                            ) : isMultiline(decoded) ? (
                                                <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
                                                    {decoded}
                                                </Code>
                                            ) : (
                                                <Code block style={{ fontSize: 13 }}>{decoded}</Code>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </ScrollArea.Autosize>
            </Card>
        );
    };

    // --- Containers ---
    const renderContainers = (containersSpec, containersStatus = [], title = 'Containers', containerType = 'containers') => {
        if (!containersSpec || containersSpec.length === 0) return null;

        const containers = containersSpec.map(container => {
            const status = containersStatus.find(s => s.name === container.name) || {};
            return { ...container, ...status };
        });

        const ContainerCard = ({ container }) => {
            const isReady = container.ready === true;

            const InfoRow = ({ label, value }) => (
                <Group justify="space-between" mb={4}>
                    <Text size="xs" c="dimmed">{label}</Text>
                    <Text size="xs" className="font-mono" truncate style={{ maxWidth: '60%' }}>{value || '\u2014'}</Text>
                </Group>
            );

            return (
                <Card key={container.name} p="md" radius="md" withBorder mb="sm">
                    <Group justify="space-between" mb="sm">
                        <Group gap="xs">
                            <IconBox size={16} />
                            <Text fw={600}>{container.name}</Text>
                            {containerType === 'init' && <Badge size="xs" color="grape">Init</Badge>}
                        </Group>
                        {type === 'Pod' && (
                            <Badge size="sm" color={isReady ? 'green' : 'orange'} variant="filled"
                                leftSection={isReady ? <IconCircleCheck size={12} /> : <IconAlertCircle size={12} />}>
                                {isReady ? 'Ready' : 'Not Ready'}
                            </Badge>
                        )}
                    </Group>

                    <SimpleGrid cols={2} spacing="xs">
                        <div>
                            <InfoRow label="Image" value={container.image} />
                            <InfoRow label="Pull Policy" value={container.imagePullPolicy} />
                        </div>
                        {type === 'Pod' && (
                            <div>
                                <InfoRow label="Restarts" value={String(container.restartCount || 0)} />
                                <InfoRow label="State" value={Object.keys(container.state || {})[0] || 'Unknown'} />
                            </div>
                        )}
                    </SimpleGrid>

                    {container.env && container.env.length > 0 && (
                        <Accordion variant="separated" mt="xs">
                            <Accordion.Item value="env">
                                <Accordion.Control>
                                    <Group gap="xs">
                                        <IconVariable size={14} />
                                        <Text size="sm" fw={500}>Environment ({container.env.length})</Text>
                                    </Group>
                                </Accordion.Control>
                                <Accordion.Panel>
                                    <Table striped highlightOnHover size="xs">
                                        <thead><tr><th>Name</th><th>Value</th></tr></thead>
                                        <tbody>
                                            {container.env.map((e, i) => (
                                                <tr key={i}>
                                                    <td className="font-mono" style={{ fontSize: 12 }}>{e.name}</td>
                                                    <td className="font-mono" style={{ fontSize: 12 }}>
                                                        {e.valueFrom
                                                            ? <Badge size="xs" color="blue">From Reference</Badge>
                                                            : <span>{e.value || '\u2014'}</span>}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </Accordion.Panel>
                            </Accordion.Item>
                        </Accordion>
                    )}
                </Card>
            );
        };

        return (
            <Accordion variant="contained" radius="md" mb="lg">
                <Accordion.Item value={title.toLowerCase()}>
                    <Accordion.Control>
                        <Group gap="xs">
                            <IconContainer size={18} />
                            <Text fw={600}>{title}</Text>
                            <Badge size="sm">{containers.length}</Badge>
                        </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                        {containers.map(c => <ContainerCard key={c.name} container={c} />)}
                    </Accordion.Panel>
                </Accordion.Item>
            </Accordion>
        );
    };

    // --- Volumes ---
    const renderVolumes = (volumes = [], volumeMounts = []) => {
        if (!volumes || volumes.length === 0) return null;

        const getVolumeType = (vol) => {
            for (const t of ['configMap', 'secret', 'persistentVolumeClaim', 'emptyDir', 'hostPath', 'csi', 'nfs']) {
                if (vol[t]) return t;
            }
            return 'unknown';
        };

        const VolumeCard = ({ vol }) => {
            const vType = getVolumeType(vol);
            const mounts = volumeMounts.filter(m => m.name === vol.name);

            let source = '';
            switch (vType) {
                case 'configMap': source = `ConfigMap: ${vol.configMap.name}`; break;
                case 'secret': source = `Secret: ${vol.secret.secretName}`; break;
                case 'persistentVolumeClaim': source = `PVC: ${vol.persistentVolumeClaim.claimName}`; break;
                case 'emptyDir': source = 'Empty Directory'; break;
                case 'hostPath': source = `Host Path: ${vol.hostPath.path}`; break;
                default: source = vType;
            }

            return (
                <Card key={vol.name} p="md" radius="md" withBorder mb="sm">
                    <Group justify="space-between" mb="xs">
                        <Group gap="xs">
                            <IconDisc size={16} />
                            <Text fw={600}>{vol.name}</Text>
                        </Group>
                        <Badge size="xs" color="indigo">{vType}</Badge>
                    </Group>
                    <Group justify="space-between" mb="xs">
                        <Text size="xs" c="dimmed">Source</Text>
                        <Text size="xs" className="font-mono">{source}</Text>
                    </Group>
                    {mounts.length > 0 && (
                        <Group gap="xs">
                            <Text size="xs" c="dimmed">Mounts:</Text>
                            {mounts.map((m, i) => (
                                <Code key={i} size="xs">{m.mountPath}{m.readOnly ? ' (RO)' : ''}</Code>
                            ))}
                        </Group>
                    )}
                </Card>
            );
        };

        return (
            <Accordion variant="contained" radius="md" mb="lg">
                <Accordion.Item value="volumes">
                    <Accordion.Control>
                        <Group gap="xs">
                            <IconFolderPlus size={18} />
                            <Text fw={600}>Volumes</Text>
                            <Badge size="sm">{volumes.length}</Badge>
                        </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                        {volumes.map(v => <VolumeCard key={v.name} vol={v} />)}
                    </Accordion.Panel>
                </Accordion.Item>
            </Accordion>
        );
    };

    // --- Conditions ---
    const renderConditions = (conditions = []) => {
        if (!conditions || conditions.length === 0) return null;

        const timeAgo = (ts) => {
            if (!ts) return '\u2014';
            try {
                const diff = Date.now() - new Date(ts).getTime();
                const d = Math.floor(diff / 86400000), h = Math.floor(diff / 3600000) % 24;
                const m = Math.floor(diff / 60000) % 60;
                if (d > 0) return `${d}d${h}h ago`;
                if (h > 0) return `${h}h${m}m ago`;
                return `${m}m ago`;
            } catch { return ts; }
        };

        return (
            <Card p="lg" radius="md" withBorder>
                <Group gap="xs" mb="md">
                    <IconClipboardCheck size={18} />
                    <Text fw={600} size="lg">Conditions</Text>
                </Group>
                <Table striped highlightOnHover size="xs">
                    <thead>
                        <tr><th>Type</th><th>Status</th><th>Last Transition</th><th>Reason</th><th>Message</th></tr>
                    </thead>
                    <tbody>
                        {conditions.map((c, i) => (
                            <tr key={i}>
                                <td><Text fw={500} size="sm">{c.type}</Text></td>
                                <td>
                                    <Badge size="sm" color={c.status === 'True' ? 'green' : c.status === 'False' ? 'red' : 'yellow'} variant="filled">
                                        {c.status}
                                    </Badge>
                                </td>
                                <td><Text size="sm">{timeAgo(c.lastTransitionTime)}</Text></td>
                                <td><Text size="sm">{c.reason || '\u2014'}</Text></td>
                                <td><Text size="sm" truncate style={{ maxWidth: 300 }}>{c.message || '\u2014'}</Text></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </Card>
        );
    };

    // --- Main Render ---
    const podSpec = resource?.spec?.template?.spec || resource?.spec;
    const podStatus = resource?.status;
    const containers = podSpec?.containers || [];
    const initContainers = podSpec?.initContainers || [];
    const containerStatuses = podStatus?.containerStatuses || [];
    const initContainerStatuses = podStatus?.initContainerStatuses || [];

    return (
        <Stack spacing="lg">
            {renderSummary()}
            {renderMetadata()}
            {renderData()}
            {renderContainers(containers, containerStatuses, 'Containers', 'regular')}
            {renderContainers(initContainers, initContainerStatuses, 'Init Containers', 'init')}
            {renderVolumes(podSpec?.volumes, containers.flatMap(c => (c.volumeMounts || []).map(m => ({ ...m, containerName: c.name }))))}
            {renderConditions(podStatus?.conditions)}
        </Stack>
    );
};

export default KubernetesResourceViewer;
