import React, { useState } from 'react';
import {
    Card,
    Text,
    Stack,
    Group,
    Code,
    SimpleGrid,
    Table,
    Box,
    Badge,
    Accordion,
    Button,
    ScrollArea,
    Textarea,
    Modal,
    Alert,
} from '@mantine/core';
import { IconBox, IconDisc, IconClipboardCheck, IconDatabase, IconFolderPlus, IconContainer, IconVariable, IconAlertCircle, IconCircleCheck, IconTag, IconInfoCircle, IconPencil, IconDeviceFloppy } from '@tabler/icons-react';

const SecretValueCell = ({ raw, decoded, secretKey, onSave }) => {
    const [showRaw, setShowRaw] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [draft, setDraft] = useState(decoded);
    const [saving, setSaving] = useState(false);
    const value = showRaw ? raw : decoded;

    const save = async () => {
        setSaving(true);
        try {
            await onSave(secretKey, draft);
            setEditOpen(false);
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Stack gap="xs">
                <Group justify="flex-end" gap="xs" px="sm" pt="sm">
                    <Button variant="subtle" size="compact-xs" onClick={() => setShowRaw(!showRaw)}>
                        {showRaw ? 'Show decoded' : 'Show base64'}
                    </Button>
                    {onSave && (
                        <Button
                            variant="light"
                            size="compact-xs"
                            leftSection={<IconPencil size={14} />}
                            onClick={() => {
                                setDraft(decoded);
                                setEditOpen(true);
                            }}
                        >
                            Edit decoded value
                        </Button>
                    )}
                </Group>
                <pre style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 13,
                    lineHeight: 1.5,
                    margin: 0,
                    padding: '8px 12px 14px',
                    color: 'var(--mantine-color-text)',
                }}>
                    {value}
                </pre>
            </Stack>

            <Modal
                opened={editOpen}
                onClose={() => setEditOpen(false)}
                title={`Edit ${secretKey}`}
                size="xl"
                centered
            >
                <Stack gap="md">
                    <Alert color="orange" icon={<IconAlertCircle size={16} />} title="This changes the live Secret">
                        This value will be base64-encoded and patched into the cluster. If this Secret is managed by Helm or ArgoCD, the next Helm install/upgrade or ArgoCD sync may overwrite this change. Copy the decoded value into source control or values files if it should persist.
                    </Alert>
                    <Textarea
                        label="Decoded value"
                        value={draft}
                        onChange={(event) => setDraft(event.currentTarget.value)}
                        autosize
                        minRows={12}
                        maxRows={24}
                        styles={{
                            input: {
                                fontFamily: 'var(--mantine-font-family-monospace)',
                                fontSize: 13,
                            },
                        }}
                    />
                    <Group justify="flex-end">
                        <Button variant="subtle" onClick={() => setEditOpen(false)}>Cancel</Button>
                        <Button color="orange" leftSection={<IconDeviceFloppy size={16} />} loading={saving} onClick={save}>
                            Encode and save Secret
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
};

const KubernetesResourceViewer = ({ resource, columns = [], columnConfig = {}, type, onUpdateSecretKey }) => {
    const { leftColumns = [], rightColumns = [] } = columnConfig.layout || { leftColumns: columns, rightColumns: [] };

    const getNestedValue = (obj, path) => {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : null;
        }, obj);
    };

    const codeStyle = {
        fontFamily: 'var(--mantine-font-family-monospace)',
        wordBreak: 'break-word',
    };

    // --- Summary Section ---
    const DetailItem = ({ column }) => {
        const value = getNestedValue(resource, column.path);
        if (value === undefined || value === null) return null;

        const renderValue = () => {
            if (typeof value === 'boolean') {
                return <Badge size="sm" color={value ? 'green' : 'gray'} variant="filled">{value ? 'Yes' : 'No'}</Badge>;
            }

            if (Array.isArray(value)) {
                const display = value.map(v =>
                    typeof v === 'object' ? JSON.stringify(v) : String(v)
                ).join(', ');
                return <Text size="sm" style={codeStyle}>{display}</Text>;
            }

            return <Text size="sm" style={codeStyle}>{String(value)}</Text>;
        };

        return (
            <Card withBorder radius="sm" p="sm">
                <Text size="xs" c="dimmed" mb={4}>{column.label}</Text>
                {renderValue()}
            </Card>
        );
    };

    const renderSummary = () => {
        const summaryColumns = [...leftColumns, ...rightColumns];
        if (!summaryColumns.length) return null;
        return (
            <Card p="lg" radius="md" withBorder>
                <Group gap="xs" mb="md">
                    <IconInfoCircle size={18} />
                    <Text fw={600} size="lg">Summary</Text>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                    {summaryColumns.map((col) => <DetailItem key={col.path} column={col} />)}
                </SimpleGrid>
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
                </Group>
                <Stack gap="md">
                    {entries.map(([key, value]) => {
                        const raw = String(value);
                        const decoded = decodeValue(value);
                        const longValue = isMultiline(decoded);
                        const valueHeight = longValue ? (isSecret ? 760 : 560) : undefined;

                        return (
                            <Box
                                key={key}
                                style={{
                                    border: '1px solid var(--mantine-color-gray-3)',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                }}
                            >
                                <Box
                                    style={{
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 1,
                                        background: 'var(--mantine-color-body)',
                                        borderBottom: '1px solid var(--mantine-color-gray-3)',
                                        padding: '8px 12px',
                                    }}
                                >
                                    <Group justify="space-between">
                                        <Group gap="xs">
                                            <Text fw={600} size="sm" style={codeStyle}>{key}</Text>
                                        </Group>
                                    </Group>
                                </Box>

                                <Box
                                    style={{
                                        minWidth: 0,
                                        maxHeight: valueHeight,
                                        overflow: longValue ? 'auto' : undefined,
                                        background: 'var(--mantine-color-gray-0)',
                                    }}
                                >
                                    {isSecret ? (
                                        <SecretValueCell raw={raw} decoded={decoded} secretKey={key} onSave={onUpdateSecretKey} />
                                    ) : longValue ? (
                                        <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.5 }}>
                                            {decoded}
                                        </Code>
                                    ) : (
                                        <Code block style={{ fontSize: 13, wordBreak: 'break-word' }}>{decoded}</Code>
                                    )}
                                </Box>
                            </Box>
                        );
                    })}
                </Stack>
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
