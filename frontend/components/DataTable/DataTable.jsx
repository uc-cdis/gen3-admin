import React, { useEffect, useState } from "react";
import { DataTable } from 'mantine-datatable';
import { Loader, Center, Container, Button, Group, TextInput, Tooltip, Switch } from "@mantine/core";

import { IconFilter, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

import callK8sApi from '@/lib/k8s';

// Helper function to safely get nested properties (e.g., "metadata.name" or "status.conditions[0].type")
const getNestedValue = (obj, keyPath) => {
    return keyPath.split('.').reduce((acc, keyPart) => {
        // Check if we are dealing with array indices (e.g., "status.conditions[0].type")
        if (keyPart.includes('[')) {
            const [baseKey, index] = keyPart.split(/\[|\]/).filter(Boolean);
            return acc && acc[baseKey] && acc[baseKey][index];
        }
        return acc && acc[keyPart];
    }, obj);
};


const GenericDataTable = ({ agent, endpoint, fields, accessToken, metricsEndpoint, buttonsConfig }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [metricsData, setMetricsData] = useState([]);

    const [searchTerm, setSearchTerm] = useState('');

    const [selectedRecords, setSelectedRecords] = useState([]);

    const fetchData = async () => {
        if (!agent) {
            return;
        }
        try {
            setLoading(true);
            console.log("calling k8s api", endpoint)
            const response = await callK8sApi(endpoint, 'GET', null, null, agent, accessToken);
            setData(response.items);
            setLoading(false);
            setError(null);
        } catch (err) {
            setError("Error fetching data");
            setLoading(false);
        }
    };

    const fetchMetrics = async () => {
        if (!metricsEndpoint) {
            return;
        }
        if (!agent) {
            return;
        }
        try {
            const response = await callK8sApi(metricsEndpoint, 'GET', null, null, agent, accessToken);
            setMetricsData(response.items);
        } catch (err) {
            console.log("Error fetching metrics", err)
        }
    };



    useEffect(() => {
        console.log("fetching data")
        fetchData();
    }, [agent, endpoint, accessToken]);

    useEffect(() => {
        fetchMetrics();
    }, [agent, metricsEndpoint, accessToken]);

    // // If there is an error, display a message
    // if (error) {
    //     return <Center>{error}</Center>;
    // }



    // Format columns based on the fields passed as props
    const columns = fields.map((field) => ({
        accessor: field.label,
        title: field.label || field.key,
        render: field.render,
    }));


    // Map the data into rows, extracting only the relevant fields
    const rows = data.map((item, index) => ({
        id: item.metadata?.uid || `temp-id-${index}`, // Use UID if available, fallback to index
        ...fields.reduce((acc, field) => {
            acc[field.label] = getNestedValue(item, field.key) || 0;
            return acc;
        }, {})
    }));
    

    // Add metrics to rows 
    const rowsWithMetrics = rows.map((row) => {
        const metrics = metricsData.items?.find(metric => metric.metadata.name === row?.metadata?.name);
        if (metrics) {
            console.log("metrics", metrics)
            return {
                ...row,
                ...metrics.usage,
            };
        }
        return row;
    });

    return (
        <>
            <Container fluid size="lg" p="md" radius="md" my="md">
                <Group mb="md">
                    <TextInput
                        placeholder="Find clusters or charts"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.currentTarget.value)}
                        style={{ flexGrow: 1 }}
                    />
                    <Tooltip label="Not yet implemented">
                        <Switch label="Show system apps" disabled />
                    </Tooltip>
                    <Tooltip label="Not yet implemented">
                        <Button leftSection={<IconFilter size={14} />} variant="light" disabled>Advanced filters</Button>
                    </Tooltip>
                    <Button onClick={fetchData}>Refresh</Button>
                </Group>
            </Container>
            <Container fluid size="lg" p="md" radius="md" my="md">
                <DataTable
                    //   withBorder
                    highlightOnHover
                    striped
                    columns={columns}
                    // records={metricsData.length > 0 ? rowsWithMetrics : rows}
                    records={rows}
                    fetching={loading}
                    error={error}
                    selectedRecords={selectedRecords}
                    onSelectedRecordsChange={setSelectedRecords}
                    withColumnBorders
                    withTableBorder
                    loaderVariant="dots"
                />
            </Container>
        </>
    );
};

export default GenericDataTable;
