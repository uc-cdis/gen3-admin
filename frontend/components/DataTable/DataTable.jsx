import React, { useEffect, useState, useMemo, useCallback } from "react";
import { DataTable } from 'mantine-datatable';
import {
    Loader,
    Center,
    Container,
    Button,
    Group,
    TextInput,
    Popover,
    Text,
    Stack,
    Badge,
    ScrollArea,
    Modal
} from "@mantine/core";
import { IconFilter, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import PropTypes from 'prop-types';

import callK8sApi from '@/lib/k8s';
import { useSession } from "next-auth/react";

// Constants
const SEARCH_DEBOUNCE_MS = 300;
const MAX_EVENTS_DISPLAY = 5;

// Helper function to safely get nested properties
const getNestedValue = (obj, keyPath) => {
    if (!obj) return '';
    const value = keyPath.split('.').reduce((acc, keyPart) => {
        if (keyPart.includes('[')) {
            const [baseKey, indexStr] = keyPart.split(/\[|\]/).filter(Boolean);
            const index = parseInt(indexStr, 10);
            return acc?.[baseKey]?.[index];
        }
        return acc?.[keyPart];
    }, obj);

    // Convert complex objects to readable strings
    return safeStringify(value);
};

// Helper function to safely convert values to strings
const safeStringify = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map(safeStringify).join(', ');
    }
    if (typeof value === 'object') {
        // For objects, try to find a reasonable display value
        if (value.name) return String(value.name);
        if (value.type) return String(value.type);
        if (value.status) return String(value.status);
        // Otherwise return JSON string
        try {
            return JSON.stringify(value);
        } catch (e) {
            return '[Complex Object]';
        }
    }
    return String(value);
};

// Helper function to format event timestamps
const formatEventTime = (timestamp) => {
    if (!timestamp) return 'Unknown time';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
};

// Status badge component with event popover
const StatusBadgeWithEvents = ({ status, resourceName, resourceNamespace, agent, accessToken }) => {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [opened, setOpened] = useState(false);
    const [modalOpened, setModalOpened] = useState(false);
    const [eventsFetched, setEventsFetched] = useState(false);
    const [isSticky, setIsSticky] = useState(false); // Track if popover is "stuck" open

    const fetchEvents = useCallback(async () => {
        if (!resourceName || !agent || eventsFetched) return;

        setLoading(true);
        try {
            // Construct the events API endpoint
            // Adjust this based on your K8s API structure
            const eventsEndpoint = resourceNamespace
                ? `/api/v1/namespaces/${resourceNamespace}/events`
                : `/api/v1/events`;

            const response = await callK8sApi(
                eventsEndpoint,
                'GET',
                null,
                null,
                agent,
                accessToken
            );

            // Filter events related to this specific resource
            const relatedEvents = (response.items || [])
                .filter(event =>
                    event.involvedObject?.name === resourceName ||
                    event.regarding?.name === resourceName
                )
                .sort((a, b) => {
                    const timeA = new Date(a.lastTimestamp || a.eventTime);
                    const timeB = new Date(b.lastTimestamp || b.eventTime);
                    return timeB - timeA;
                })
                .slice(0, MAX_EVENTS_DISPLAY);

            setEvents(relatedEvents);
            setEventsFetched(true);
        } catch (err) {
            console.error("Error fetching events:", err);
            setEvents([]);
        } finally {
            setLoading(false);
        }
    }, [resourceName, resourceNamespace, agent, accessToken, eventsFetched]);

    const handleOpenChange = (isOpen) => {
        // If sticky, don't close on mouse leave
        if (isSticky && !isOpen) return;

        setOpened(isOpen);
        if (isOpen && !eventsFetched) {
            fetchEvents();
        }
    };

    const handleClick = (e) => {
        e.stopPropagation();
        // Toggle sticky state and ensure popover is open
        if (!isSticky) {
            setIsSticky(true);
            setOpened(true);
            if (!eventsFetched) {
                fetchEvents();
            }
        } else {
            // If already sticky, close it
            setIsSticky(false);
            setOpened(false);
        }
    };

    const handleMouseEnter = () => {
        // Only auto-open on hover if not sticky
        if (!isSticky) {
            handleOpenChange(true);
        }
    };

    const handleMouseLeave = () => {
        // Only auto-close on leave if not sticky
        if (!isSticky) {
            handleOpenChange(false);
        }
    };

    const openModal = (e) => {
        e.stopPropagation();
        setModalOpened(true);
        if (!eventsFetched) {
            fetchEvents();
        }
    };

    // Determine badge color based on status
    const getBadgeColor = (status) => {
        const statusLower = String(status).toLowerCase();
        if (statusLower.includes('running') || statusLower.includes('ready')) return 'green';
        if (statusLower.includes('pending')) return 'yellow';
        if (statusLower.includes('failed') || statusLower.includes('error')) return 'red';
        if (statusLower.includes('succeeded')) return 'blue';
        return 'gray';
    };

    const EventsList = ({ compact = false }) => (
        <>
            {loading ? (
                <Center p="md">
                    <Loader size="sm" />
                </Center>
            ) : events.length > 0 ? (
                <Stack gap="sm">
                    {events.map((event, idx) => (
                        <div key={event.metadata?.uid || idx} style={{
                            borderLeft: '3px solid var(--mantine-color-gray-4)',
                            paddingLeft: '8px'
                        }}>
                            <Group gap="xs" mb={4}>
                                <Badge
                                    size="xs"
                                    color={event.type === 'Warning' ? 'red' : 'blue'}
                                >
                                    {event.type}
                                </Badge>
                                <Text size="xs" c="dimmed">
                                    {formatEventTime(event.lastTimestamp || event.eventTime)}
                                </Text>
                                {!compact && event.count > 1 && (
                                    <Badge size="xs" variant="light" color="gray">
                                        {event.count}x
                                    </Badge>
                                )}
                            </Group>
                            <Text size="xs" fw={500}>{event.reason}</Text>
                            <Text size="xs" c="dimmed" lineClamp={compact ? 2 : undefined}>
                                {event.message}
                            </Text>
                            {!compact && (
                                <Text size="xs" c="dimmed" mt={4}>
                                    Component: {event.source?.component || 'N/A'}
                                </Text>
                            )}
                        </div>
                    ))}
                </Stack>
            ) : (
                <Text size="sm" c="dimmed">No recent events found</Text>
            )}
        </>
    );

    return (
        <>
            <Popover
                width={400}
                position="bottom"
                withArrow
                shadow="md"
                opened={opened}
                onChange={handleOpenChange}
                closeOnClickOutside={true}
                onClose={() => {
                    setIsSticky(false);
                    setOpened(false);
                }}
            >
                <Popover.Target>
                    <Badge
                        color={getBadgeColor(status)}
                        style={{
                            cursor: 'pointer',
                            outline: isSticky ? '2px solid var(--mantine-color-blue-5)' : 'none'
                        }}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                        onClick={handleClick}
                    >
                        {status}
                    </Badge>
                </Popover.Target>
                <Popover.Dropdown>
                    <Stack gap="xs">
                        <Group justify="space-between">
                            <Text size="sm" fw={600}>Recent Events</Text>
                            <Group gap="xs">
                                <Button
                                    size="xs"
                                    variant="subtle"
                                    onClick={openModal}
                                >
                                    View All
                                </Button>
                                {isSticky && (
                                    <Button
                                        size="xs"
                                        variant="subtle"
                                        color="gray"
                                        onClick={() => {
                                            setIsSticky(false);
                                            setOpened(false);
                                        }}
                                    >
                                        Close
                                    </Button>
                                )}
                            </Group>
                        </Group>
                        <ScrollArea h={250}>
                            <EventsList compact />
                        </ScrollArea>
                        {!isSticky && (
                            <Text size="xs" c="dimmed" ta="center">
                                Click badge to pin
                            </Text>
                        )}
                    </Stack>
                </Popover.Dropdown>
            </Popover>

            {/* Modal for detailed event viewing */}
            <Modal
                opened={modalOpened}
                onClose={() => setModalOpened(false)}
                title={
                    <Group>
                        <Text fw={600}>Events for {resourceName}</Text>
                        <Badge color={getBadgeColor(status)}>{status}</Badge>
                    </Group>
                }
                size="lg"
            >
                <ScrollArea h={500}>
                    <EventsList />
                </ScrollArea>
                <Group justify="flex-end" mt="md">
                    <Button variant="light" onClick={() => setModalOpened(false)}>
                        Close
                    </Button>
                    <Button
                        onClick={() => {
                            setEventsFetched(false);
                            fetchEvents();
                        }}
                        loading={loading}
                    >
                        Refresh
                    </Button>
                </Group>
            </Modal>
        </>
    );
};

const GenericDataTable = ({
    agent,
    endpoint,
    fields,
    metricsEndpoint,
    buttonsConfig,
    searchableFields // Optional: specify which fields to search
}) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [metricsData, setMetricsData] = useState([]);
    const [metricsError, setMetricsError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRecords, setSelectedRecords] = useState([]);

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    // Debounce search term for better performance
    const [debouncedSearchTerm] = useDebouncedValue(searchTerm, SEARCH_DEBOUNCE_MS);

    const fetchData = useCallback(async () => {
        if (!agent) {
            setData([]);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            setError(null);
            console.log("Fetching data from:", endpoint);
            const response = await callK8sApi(endpoint, 'GET', null, null, agent, accessToken);
            setData(response.items || []);
        } catch (err) {
            console.error("Error fetching data:", err);
            setError(err.message || "Failed to fetch data");
            setData([]);
        } finally {
            setLoading(false);
        }
    }, [agent, endpoint, accessToken]);

    const fetchMetrics = useCallback(async () => {
        if (!metricsEndpoint || !agent) {
            setMetricsData([]);
            return;
        }
        try {
            setMetricsError(null);
            console.log("Fetching metrics from:", metricsEndpoint);
            const response = await callK8sApi(metricsEndpoint, 'GET', null, null, agent, accessToken);
            setMetricsData(response.items || []);
        } catch (err) {
            console.error("Error fetching metrics:", err);
            setMetricsError(err.message || "Failed to fetch metrics");
            setMetricsData([]);
        }
    }, [agent, metricsEndpoint, accessToken]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (metricsEndpoint) {
            fetchMetrics();
        }
    }, [fetchMetrics, metricsEndpoint]);

    // Format columns with enhanced status rendering
    const columns = useMemo(() => fields.map((field) => {
        const baseColumn = {
            accessor: field.label,
            title: field.label || field.key,
            resizable: true,
            sortable: true,
        };

        // Use custom render if provided
        if (field.render) {
            return {
                ...baseColumn,
                render: (record) => {
                    try {
                        return field.render(record);
                    } catch (e) {
                        console.error('Error in custom render function:', e);
                        return safeStringify(record[field.label]);
                    }
                }
            };
        }

        // Special handling for Status column
        if (field.label.toLowerCase() === 'status' || field.key.toLowerCase().includes('status')) {
            return {
                ...baseColumn,
                render: (record) => {
                    const status = safeStringify(record[field.label]);
                    return (
                        <StatusBadgeWithEvents
                            status={status}
                            resourceName={record['metadata.name'] || record.Name}
                            resourceNamespace={record['metadata.namespace'] || record.Namespace}
                            agent={agent}
                            accessToken={accessToken}
                        />
                    );
                }
            };
        }

        // Default render - ensure we always return a string
        return {
            ...baseColumn,
            render: (record) => safeStringify(record[field.label])
        };
    }), [fields, agent, accessToken]);

    // Create base rows with all necessary data
    const baseRows = useMemo(() => {
        return data.map((item, index) => {
            const row = {
                id: item.metadata?.uid || `temp-id-${index}`,
                original: item, // Keep original item for actions
                'metadata.name': item.metadata?.name,
                'metadata.namespace': item.metadata?.namespace,
            };

            // Extract field values and ensure they're all strings
            fields.forEach(field => {
                const rawValue = getNestedValue(item, field.key);
                row[field.label] = rawValue; // Already stringified by getNestedValue
            });

            return row;
        });
    }, [data, fields]);

    // Merge metrics data
    const rowsWithMetrics = useMemo(() => {
        if (metricsData.length === 0) {
            return baseRows;
        }

        const metricsMap = new Map(
            metricsData.map(metric => [metric.metadata?.name, metric.usage])
        );

        return baseRows.map(row => {
            const metrics = metricsMap.get(row['metadata.name']);
            return metrics ? { ...row, ...metrics } : row;
        });
    }, [baseRows, metricsData]);

    // Filter rows based on search term
    const filteredRows = useMemo(() => {
        const sourceRows = metricsData.length > 0 ? rowsWithMetrics : baseRows;

        if (!debouncedSearchTerm.trim()) {
            return sourceRows;
        }

        const lowerCaseSearchTerm = debouncedSearchTerm.trim().toLowerCase();

        return sourceRows.filter(row => {
            // If searchableFields is specified, only search those fields
            if (searchableFields && searchableFields.length > 0) {
                return searchableFields.some(fieldLabel => {
                    const value = row[fieldLabel];
                    return String(value).toLowerCase().includes(lowerCaseSearchTerm);
                });
            }

            // Otherwise, search all field values (excluding metadata and original)
            return fields.some(field => {
                const value = row[field.label];
                return String(value).toLowerCase().includes(lowerCaseSearchTerm);
            });
        });
    }, [debouncedSearchTerm, baseRows, rowsWithMetrics, metricsData.length, fields, searchableFields]);

    // Clear selection when filtered data changes
    useEffect(() => {
        setSelectedRecords([]);
    }, [filteredRows]);

    return (
        <>
            {/* Search and Actions Header */}
            <Container fluid size="lg" p="md" radius="md" my="md">
                <Group justify="space-between" mb="md">
                    <TextInput
                        placeholder={`Search ${fields.map(f => f.label).join(', ')}...`}
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.currentTarget.value)}
                        style={{ flexGrow: 1, maxWidth: 400 }}
                    />
                    <Group>
                        <Button onClick={fetchData} loading={loading}>
                            Refresh
                        </Button>
                    </Group>
                </Group>
            </Container>

            {/* Data Table Container */}
            <Container
                fluid
                size="lg"
                p="md"
                radius="md"
                my="md"
                style={{ border: '1px solid #dee2e6', borderRadius: '4px' }}
            >
                {/* Error Messages */}
                {error && !loading && (
                    <Center mb="md">
                        <Text c="red" size="sm">Failed to load data: {error}</Text>
                    </Center>
                )}
                {metricsError && (
                    <Center mb="md">
                        <Text c="orange" size="xs">Metrics unavailable: {metricsError}</Text>
                    </Center>
                )}

                <DataTable
                    highlightOnHover
                    striped
                    columns={columns}
                    records={filteredRows}
                    fetching={loading}
                    selectedRecords={selectedRecords}
                    onSelectedRecordsChange={setSelectedRecords}
                    withColumnBorders
                    loaderVariant="dots"
                    minHeight={150}
                    noRecordsText={debouncedSearchTerm ? "No matching records found" : "No records found"}
                />
            </Container>
        </>
    );
};

// PropTypes for better documentation and runtime checks
GenericDataTable.propTypes = {
    agent: PropTypes.string,
    endpoint: PropTypes.string.isRequired,
    fields: PropTypes.arrayOf(PropTypes.shape({
        key: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        render: PropTypes.func,
    })).isRequired,
    metricsEndpoint: PropTypes.string,
    buttonsConfig: PropTypes.object,
    searchableFields: PropTypes.arrayOf(PropTypes.string),
};

StatusBadgeWithEvents.propTypes = {
    status: PropTypes.string.isRequired,
    resourceName: PropTypes.string,
    resourceNamespace: PropTypes.string,
    agent: PropTypes.string,
    accessToken: PropTypes.string,
};

export default GenericDataTable;
