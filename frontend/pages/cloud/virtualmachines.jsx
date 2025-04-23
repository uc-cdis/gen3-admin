import React, { useState, useEffect, useCallback } from 'react';
import { DataTable } from 'mantine-datatable';
import { TextInput, Loader, Alert, Collapse, Text, Box, Anchor } from '@mantine/core';
import { IconAlertCircle, IconSearch } from '@tabler/icons-react';
import Link from 'next/link';

function InstancesTable() {
    const [allInstances, setAllInstances] = useState([]);
    const [instances, setInstances] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(1);
    const [recordsPerPage, setRecordsPerPage] = useState(10);
    const [sortBy, setSortBy] = useState(null);
    const [sortOrder, setSortOrder] = useState('asc');
    const [filter, setFilter] = useState('');
    const [totalRecords, setTotalRecords] = useState(0);
    // No longer using a shared opened state

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(`/api/aws/instances`);
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`HTTP error! status: ${response.status}.\n Message: ${errorData.error || "Unknown error"}`);
                }
                const rawData = await response.json();
                const flattenedInstances = rawData?.reduce((acc, reservation) => {
                    if (Array.isArray(reservation.Instances)) {
                        return acc.concat(
                            reservation.Instances.map((instance) => {
                                const nameTag = instance.Tags?.find((tag) => tag.Key === 'Name');
                                const instanceName = nameTag ? nameTag.Value : '';
                                return {
                                    ...instance,
                                    ReservationId: reservation.ReservationId,
                                    OwnerId: reservation.OwnerId,
                                    Name: instanceName, // Add the Name property
                                };
                            })
                        );
                    }
                    return acc;
                }, []);
                setAllInstances(flattenedInstances);
                setLoading(false);
            } catch (err) {
                setError(err.message);
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    useEffect(() => {
        let filteredAndSortedInstances = [...allInstances];

        // --- Filtering ---
        if (filter) {
            filteredAndSortedInstances = filteredAndSortedInstances.filter(
                (instance) => {
                    const name = instance.Name || ''; // Get the instance Name
                    const imageId = instance.ImageId || ''; // Get the ImageId

                    return (
                        name.toLowerCase().includes(filter.toLowerCase()) ||
                        imageId.toLowerCase().includes(filter.toLowerCase())
                    );
                }
            );
        }

        // --- Sorting ---
        if (sortBy) {
            filteredAndSortedInstances.sort((a, b) => {
                const aValue = getSortValue(a, sortBy);
                const bValue = getSortValue(b, sortBy);

                if (aValue < bValue) {
                    return sortOrder === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortOrder === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }

        // --- Pagination ---
        const startIndex = (page - 1) * recordsPerPage;
        const endIndex = startIndex + recordsPerPage;
        const paginatedInstances = filteredAndSortedInstances.slice(
            startIndex,
            endIndex
        );

        setInstances(paginatedInstances);
        setTotalRecords(filteredAndSortedInstances.length);
    }, [allInstances, page, recordsPerPage, sortBy, sortOrder, filter]);

    // Helper function to get sort values and handle nested properties
    const getSortValue = (instance, sortBy) => {
        switch (sortBy) {
            case 'State.Name':
                return instance.State?.Name || '';
            case 'Placement.AvailabilityZone':
                return instance.Placement?.AvailabilityZone || '';
            case 'LaunchTime': //added for date sorting.
                return new Date(instance[sortBy]);
            default:
                return instance[sortBy] || '';
        }
    };


    const onSort = ({ columnAccessor }) => {
        if (columnAccessor === sortBy) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(columnAccessor);
            setSortOrder('asc');
        }
    };

    // **Key Change: Collapse state within the render function**
    const renderCollapsibleContent = (record, accessor) => {
        const [isOpen, setIsOpen] = useState(false); // Local state for EACH collapse

        const toggle = useCallback(() => setIsOpen((prev) => !prev), []); // Use useCallback for optimization

        let content;
        switch (accessor) {
            case 'BlockDeviceMappings':
                content = (
                    <ul>
                        {record.BlockDeviceMappings?.map((bdm, index) => (
                            <li key={index}>
                                {bdm.DeviceName}: {bdm.Ebs?.VolumeId} (Status: {bdm.Ebs?.Status},
                                DeleteOnTermination: {bdm.Ebs?.DeleteOnTermination?.toString()})
                            </li>
                        ))}
                    </ul>
                );
                break;
            case 'Tags':
                content = (
                    <ul>
                        {record.Tags?.map((tag) => (
                            <li key={tag.Key}>
                                {tag.Key}: {tag.Value}
                            </li>
                        ))}
                    </ul>
                );
                break;
            case 'SecurityGroups':
                content = (
                    <ul>
                        {record.SecurityGroups?.map((sg, index) => (
                            <li key={index}>
                                {sg.GroupName} ({sg.GroupId})
                            </li>
                        ))}
                    </ul>
                );
                break;
            default:
                content = null;
        }

        return (
            <Box>
                <Text
                    component="a"
                    href="#"
                    onClick={(event) => {
                        event.preventDefault();
                        toggle();
                    }}
                >
                    {isOpen ? `Hide ${accessor}` : `Show ${accessor}`}
                </Text>
                <Collapse in={isOpen}>{content}</Collapse>
            </Box>
        );
    };


    const columns = [
        { accessor: 'InstanceId', title: 'Instance ID', sortable: true, render: (record) => <Anchor component={Link} href={"/cloud/ssm/"+record.InstanceId}>{record.InstanceId}</Anchor> },
        { accessor: 'Name', title: 'Name', sortable: true },
        { accessor: 'ImageId', title: 'Image ID / AMI', sortable: true },
        { accessor: 'InstanceType', title: 'Instance Type', sortable: true },
        { accessor: 'State.Name', title: 'State', sortable: true },
        { accessor: 'LaunchTime', title: 'Launch Time', sortable: true, render: (record) => new Date(record.LaunchTime).toLocaleString() },
        { accessor: 'Placement.AvailabilityZone', title: 'AZ', sortable: true },
        { accessor: 'PrivateIpAddress', title: 'Private IP', sortable: true },
        { accessor: 'ReservationId', title: 'Reservation ID' },
        { accessor: 'OwnerId', title: 'Owner ID' },
        {
            accessor: 'BlockDeviceMappings',
            title: 'Block Devices',
            render: (record) => renderCollapsibleContent(record, 'BlockDeviceMappings'), // Call the function
        },
        {
            accessor: 'Tags',
            title: 'Tags',
            render: (record) => renderCollapsibleContent(record, 'Tags'), // Call the function
        },
        {
            accessor: 'SecurityGroups',
            title: 'Security Groups',
            render: (record) => renderCollapsibleContent(record, 'SecurityGroups'), // Call the function
        },
    ];


    return (
        <div>
            <TextInput
                label="Filter by Name or Image ID"
                placeholder="Search..."
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                mb="sm"
                icon={<IconSearch size="0.8rem" />} //Added Search Icon
            />
            {loading ? (
                <Loader />
            ) : error ? (
                <Alert icon={<IconAlertCircle size="1rem" />} title="Error!" color="red">
                    {error}
                </Alert>
            ) : (
                <DataTable
                    columns={columns}
                    records={instances}
                    fetching={loading}
                    totalRecords={totalRecords}
                    recordsPerPage={recordsPerPage}
                    page={page}
                    onPageChange={(p) => setPage(p)}
                    onRecordsPerPageChange={(rpp) => setRecordsPerPage(rpp)}
                    sortStatus={{ columnAccessor: sortBy, direction: sortOrder }}
                    onSortStatusChange={onSort}
                    noRecordsText="No instances found"
                />
            )}
        </div>
    );
}

export default InstancesTable;