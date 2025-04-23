import callK8sApi from "@/lib/k8s"
import { Alert, Group, Loader, Text, Badge } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { DataTable } from "mantine-datatable";
import { useEffect, useState } from "react";

export default function Events({ resource, namespace, type, cluster }) {

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [eventsData, setEventsData] = useState(null)

    console.log(resource, namespace, type, cluster)

    const fetchEvents = async () => {
        setIsLoading(true);
        setError(null);

        const url = `/api/v1/namespaces/${namespace}/events?fieldSelector=involvedObject.name=${resource}`

        try {
            const response = await callK8sApi(url, 'GET', null, null, cluster, null);
            return response;
        } catch (error) {
            console.error('Failed to fetch resource:', error);
            setError(error.message || 'Failed to fetch resource');
            return null;
        } finally {
            setIsLoading(false);
        }

    }

    useEffect(() => {
        if (!resource || !namespace || !cluster || !type) {
            const missing = [];
            if (!resource) missing.push("resource");
            if (!namespace) missing.push("namespace");
            if (!cluster) missing.push("cluster");
            if (!type) missing.push("type");

            console.error(`Cannot fetch events: Missing required parameters: ${missing.join(", ")}`);
            return;
        }

        fetchEvents().then((data) => {
            if (data) {
                setEventsData(data);
            }
        });
    }, [type, resource, namespace, cluster]);

    // Function to format the event time
    const formatTime = (timestamp) => {
        if (!timestamp) return "Unknown";
        const date = new Date(timestamp);
        return date.toLocaleString();
    };

    // Function to determine badge color based on event type
    const getTypeColor = (eventType) => {
        switch (eventType) {
            case "Normal":
                return "green";
            case "Warning":
                return "orange";
            default:
                return "gray";
        }
    };

    const columns = [
        {
            accessor: "type",
            title: "Type",
            render: (event) => (
                <Badge color={getTypeColor(event.type)}>{event.type}</Badge>
            ),
            width: 100,
        },
        {
            accessor: "lastTimestamp",
            title: "Time",
            render: (event) => formatTime(event.lastTimestamp),
            width: 180,
        },
        {
            accessor: "reason",
            title: "Reason",
            width: 150,
        },
        {
            accessor: "message",
            title: "Message",
            render: (event) => <Text>{event.message}</Text>,
        },
        {
            accessor: "count",
            title: "Count",
            width: 80,
            render: (event) => (
                <Badge variant="light" radius="sm">
                    {event.count}
                </Badge>
            ),
        },
    ];

    if (isLoading) {
        return (
            <div style={{ textAlign: "center", padding: "20px" }}>
                <Loader size="md" />
                <Text size="sm" mt="md">
                    Loading events...
                </Text>
            </div>
        );
    }

    if (error) {
        return (
            <Alert
                icon={<IconAlertCircle size={16} />}
                title="Error loading events"
                color="red"
            >
                {error}
            </Alert>
        );
    }

    return (
        <div style={{ marginTop: "1rem" }}>
            <Group position="apart" mb="md">
                <Text weight={700} size="lg">
                    Events for {resource}
                </Text>
            </Group>

            {eventsData && eventsData.items && eventsData.items.length > 0 ? (
                <DataTable
                    columns={columns}
                    records={eventsData.items}
                    striped
                    highlightOnHover
                    minHeight={200}
                    noRecordsText="No events found"
                />
            ) : (
                <Text c="dimmed" align="center" py="lg">
                    No events found for this resource
                </Text>
            )}
        </div>
    );
}

