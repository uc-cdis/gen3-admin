import React, { useEffect, useState, useMemo } from "react"; // Import useMemo
import { DataTable } from 'mantine-datatable';
import { Loader, Center, Container, Button, Group, TextInput, Tooltip, Switch } from "@mantine/core";

import { IconFilter, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

import callK8sApi from '@/lib/k8s';

// Helper function to safely get nested properties (e.g., "metadata.name" or "status.conditions[0].type")
const getNestedValue = (obj, keyPath) => {
    // Return an empty string if obj is null/undefined to prevent errors later
    if (!obj) return '';
    return keyPath.split('.').reduce((acc, keyPart) => {
        // Check if we are dealing with array indices (e.g., "status.conditions[0].type")
        if (keyPart.includes('[')) {
            const [baseKey, indexStr] = keyPart.split(/\[|\]/).filter(Boolean);
            const index = parseInt(indexStr, 10); // Ensure index is a number
            // Check if acc, baseKey, and the index exist
            return acc && acc[baseKey] && Array.isArray(acc[baseKey]) && acc[baseKey].length > index
                   ? acc[baseKey][index]
                   : undefined; // Return undefined if path is invalid
        }
        // Check if acc and the keyPart exist
        return acc && typeof acc === 'object' && acc[keyPart] !== undefined ? acc[keyPart] : undefined; // Return undefined if path is invalid
    }, obj);
};


const GenericDataTable = ({ agent, endpoint, fields, accessToken, metricsEndpoint, buttonsConfig }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [metricsData, setMetricsData] = useState([]); // Note: metricsData structure seems slightly off in original usage

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRecords, setSelectedRecords] = useState([]);

    const fetchData = async () => {
        if (!agent) {
             setData([]); // Clear data if no agent
             setLoading(false);
            return;
        }
        try {
            setLoading(true);
            setError(null); // Reset error before fetching
            console.log("calling k8s api", endpoint)
            const response = await callK8sApi(endpoint, 'GET', null, null, agent, accessToken);
            setData(response.items || []); // Ensure data is always an array
            setLoading(false);
        } catch (err) {
            console.error("Error fetching data:", err); // Log the actual error
            setError(err.message || "Error fetching data");
            setData([]); // Clear data on error
            setLoading(false);
        }
    };

    const fetchMetrics = async () => {
        if (!metricsEndpoint || !agent) {
            setMetricsData([]); // Clear metrics if no endpoint/agent
            return;
        }
        try {
            // Note: Assuming metrics endpoint returns { items: [...] } like the main endpoint
            const response = await callK8sApi(metricsEndpoint, 'GET', null, null, agent, accessToken);
            setMetricsData(response.items || []); // Ensure metrics data is always an array
        } catch (err) {
            console.error("Error fetching metrics:", err); // Log the actual error
            // Optionally set an error state for metrics specifically if needed
            setMetricsData([]); // Clear metrics on error
        }
    };

    useEffect(() => {
        console.log("fetching data for agent:", agent);
        fetchData();
    }, [agent, endpoint, accessToken]); // Dependencies are correct

    useEffect(() => {
        fetchMetrics();
    }, [agent, metricsEndpoint, accessToken]); // Dependencies are correct

    // Format columns based on the fields passed as props
    // Use useMemo to prevent recalculating columns on every render unless fields change
    const columns = useMemo(() => fields.map((field) => ({
        accessor: field.label, // Accessor should match the key in the row object
        title: field.label || field.key,
        resizable: true,
        sortable: true, // Make columns sortable if desired
        render: field.render,
    })), [fields]);

    // Map the data into rows, extracting only the relevant fields
    // Use useMemo to prevent recalculating rows unless data or fields change
    const baseRows = useMemo(() => {
       return data.map((item, index) => ({
            id: item.metadata?.uid || `temp-id-${index}`, // Use UID if available, fallback to index
            // Add the original item for potential complex render functions or actions
            // original: item,
            ...fields.reduce((acc, field) => {
                // Use the field's label as the key in the row object
                // Default to empty string for easier filtering/display
                acc[field.label] = getNestedValue(item, field.key) ?? '';
                return acc;
            }, {}),
             // Include metadata name explicitly if needed for metrics merging and not already a field
            'metadata.name': item.metadata?.name // Example: If needed and not in fields
        }));
    }, [data, fields]);


    // Add metrics to rows (Optional - based on your original code, needs refinement)
    // Note: The original metrics logic needed adjustments.
    // This example assumes metricsData is an array of objects with metadata.name and usage properties.
    const rowsWithMetrics = useMemo(() => {
        if (metricsData.length === 0) {
            return baseRows; // Return base rows if no metrics
        }
        const metricsMap = new Map(metricsData.map(metric => [metric.metadata?.name, metric.usage]));

        return baseRows.map((row) => {
            // Ensure row has 'metadata.name' or adjust access path accordingly
            const metrics = metricsMap.get(row['metadata.name']);
            if (metrics) {
                // console.log("Metrics found for:", row['metadata.name'], metrics);
                // Spread metrics usage data into the row. Adjust keys as needed.
                return {
                    ...row,
                    ...metrics, // e.g., adds cpu, memory properties if they exist in usage
                };
            }
            return row;
        });
    }, [baseRows, metricsData]);


    // --- Filtering Logic ---
    const filteredRows = useMemo(() => {
        // Decide which rows to filter (base or with metrics)
        const sourceRows = metricsData.length > 0 ? rowsWithMetrics : baseRows; // Or just always use baseRows if metrics aren't integrated yet

        if (!searchTerm.trim()) {
            return sourceRows; // No filter applied
        }

        const lowerCaseSearchTerm = searchTerm.trim().toLowerCase();

        return sourceRows.filter(row => {
            // Iterate over the *values* of the row object
            // This searches across all columns defined by 'fields'
            return Object.values(row).some(value =>
                String(value).toLowerCase().includes(lowerCaseSearchTerm)
            );

            // --- Alternative: Only search specific fields defined in the 'fields' prop ---
            // return fields.some(field => {
            //     const value = row[field.label]; // Access row data using the label/accessor
            //     return String(value).toLowerCase().includes(lowerCaseSearchTerm);
            // });
        });
    }, [searchTerm, baseRows, rowsWithMetrics, metricsData.length]); // Add dependencies

     // Clear selection when filtered data changes to avoid stale selections
     useEffect(() => {
        setSelectedRecords([]);
    }, [filteredRows]);


    // // Display error directly if needed (can be integrated into DataTable's error prop)
    // if (error && !loading) {
    //     return <Center><p style={{ color: 'red' }}>{error}</p></Center>;
    // }

    return (
        <>
            {/* Keep Header outside the scrollable data area */}
            <Container fluid size="lg" p="md" radius="md" my="md">
                <Group justify="space-between" mb="md">
                    <TextInput
                        placeholder="Search across all fields..." // Updated placeholder
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.currentTarget.value)}
                        style={{ flexGrow: 1 }}
                        // maw={400} // Max width for search bar
                    />
                    <Group> {/* Group buttons */}
                        {/* <Tooltip label="Not yet implemented">
                            <Switch label="Show system apps" disabled />
                        </Tooltip> */}
                        {/* <Tooltip label="Not yet implemented">
                            <Button leftSection={<IconFilter size={14} />} variant="light" disabled>Advanced filters</Button>
                        </Tooltip> */}
                        <Button onClick={fetchData} loading={loading}>Refresh</Button>
                    </Group>
                </Group>
            </Container>
            {/* Data Table Container */}
            <Container fluid size="lg" p="md" radius="md" my="md" style={{ border: '1px solid #dee2e6', borderRadius: '4px' }}>
                 {/* Conditionally render error message above the table */}
                 {error && !loading && (
                     <Center mb="md">
                         <p style={{ color: 'red' }}>Failed to load data: {error}</p>
                     </Center>
                 )}
                <DataTable
                    //   withBorder // Redundant if container has border
                    highlightOnHover
                    striped
                    columns={columns}
                    records={filteredRows} // Use the filtered rows
                    fetching={loading}
                    // error={error} // Can show error state within the table itself, but might conflict with the message above
                    selectedRecords={selectedRecords}
                    onSelectedRecordsChange={setSelectedRecords}
                    withColumnBorders
                    // withTableBorder // Redundant if container has border
                    loaderVariant="dots"
                    minHeight={150} // Ensure table doesn't collapse when empty/loading
                    noRecordsText="No records found" // Text for empty state
                    // Add pagination if needed for large datasets
                    // page={page}
                    // onPageChange={setPage}
                    // totalRecords={filteredRows.length} // Or total before filtering if doing server-side pagination
                    // recordsPerPage={PAGE_SIZE}
                />
            </Container>
        </>
    );
};

export default GenericDataTable;