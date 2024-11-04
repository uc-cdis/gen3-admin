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


const GenericDataTable = ({ agent, endpoint, fields, accessToken }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [searchTerm, setSearchTerm] = useState('');

    const fetchData = async () => {
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

    useEffect(() => {
        console.log("fetching data")
        fetchData();
    }, [agent, endpoint, accessToken]);

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
    const rows = data.map((item) =>
        fields.reduce((acc, field) => {
            acc[field.label] = getNestedValue(item, field.key) || 0; // Use helper to get nested values
            return acc;
        }, {})
    );


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
                    records={rows}
                    fetching={loading}
                    error={error}
                    loaderVariant="dots"
                />
            </Container>
        </>
    );
};

export default GenericDataTable;
