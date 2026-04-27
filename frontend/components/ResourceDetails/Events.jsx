import callK8sApi from "@/lib/k8s"
import { Alert, Group, Loader, Text, Badge, Paper, Center, Stack } from "@mantine/core";
import { IconAlertCircle, IconActivityHeartbeat } from "@tabler/icons-react";
import { DataTable } from "mantine-datatable";
import { useEffect, useState } from "react";

export default function Events({ resource, namespace, type, cluster, accessToken }) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [eventsData, setEventsData] = useState(null);

    const fetchEvents = async () => {
        setIsLoading(true);
        setError(null);

        const url = `/api/v1/namespaces/${namespace}/events?fieldSelector=involvedObject.name=${resource}`;

        try {
            const response = await callK8sApi(url, 'GET', null, null, cluster, accessToken);
            if (response) setEventsData(response);
        } catch (error) {
            setError(error.message || 'Failed to fetch events');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!resource || !namespace || !cluster || !type) return;
        fetchEvents();
    }, [type, resource, namespace, cluster]);

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

    const columns = [
        {
            accessor: "type",
            title: "Type",
            render: (event) => (
                <Badge size="sm" color={event.type === 'Normal' ? 'green' : event.type === 'Warning' ? 'orange' : 'gray'} variant="filled">
                    {event.type}
                </Badge>
            ),
            width: 90,
        },
        {
            accessor: "lastTimestamp",
            title: "Time",
            render: (event) => <Text size="sm">{timeAgo(event.lastTimestamp)}</Text>,
            width: 110,
        },
        { accessor: "reason", title: "Reason", width: 140 },
        {
            accessor: "message",
            title: "Message",
            render: (event) => <Text size="sm" truncate style={{ maxWidth: 400 }}>{event.message}</Text>,
        },
        {
            accessor: "count",
            title: "Count",
            width: 60,
            render: (event) => <Badge size="xs" variant="light">{event.count}</Badge>,
        },
    ];

    if (isLoading) {
        return (
            <Center py="xl">
                <Stack align="center" gap="xs">
                    <Loader />
                    <Text c="dimmed" size="sm">Loading events...</Text>
                </Stack>
            </Center>
        );
    }

    if (error) {
        return <Alert icon={<IconAlertCircle size={16} />} title="Error loading events" color="red">{error}</Alert>;
    }

    const items = eventsData?.items || [];

    return (
        <div>
            <Group gap="xs" mb="md">
                <IconActivityHeartbeat size={18} />
                <Text fw={600}>Events</Text>
                {items.length > 0 && <Badge size="sm">{items.length}</Badge>}
            </Group>

            {items.length > 0 ? (
                <Paper withBorder radius="md">
                    <DataTable
                        columns={columns}
                        records={items}
                        striped
                        highlightOnHover
                        minHeight={150}
                        noRecordsText="No events found"
                    />
                </Paper>
            ) : (
                <Center py="xl"><Text c="dimmed">No events for this resource</Text></Center>
            )}
        </div>
    );
}
