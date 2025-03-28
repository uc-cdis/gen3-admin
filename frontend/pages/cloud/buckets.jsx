import React, { useState, useEffect } from 'react';
import { DataTable } from 'mantine-datatable';
import { TextInput, Loader, Alert } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

function S3BucketsTable() {
    const [buckets, setBuckets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(1);
    const [recordsPerPage, setRecordsPerPage] = useState(10);
    const [sortBy, setSortBy] = useState(null);
    const [sortOrder, setSortOrder] = useState('asc');
    const [filter, setFilter] = useState('');
    const [totalRecords, setTotalRecords] = useState(0);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(`/api/aws/s3`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                setBuckets(data?.Buckets);
                setLoading(false);
            } catch (err) {
                setError(err.message);
                setLoading(false);
            }
        };

        fetchData();
    }, []);


    const onSort = ({ columnAccessor }) => {
        if (columnAccessor === sortBy) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(columnAccessor);
            setSortOrder('asc');
        }
    };

    const columns = [
        { accessor: 'Name', title: 'Bucket Name', sortable: true },
        { accessor: 'CreationDate', title: 'Creation Date', sortable: true, render: (record) => new Date(record.CreationDate).toLocaleString() },
        { accessor: 'Region', title: 'Region', sortable: true },
    ];

    return (
        <div>
            <TextInput
                label="Filter by Bucket Name"
                placeholder="Search..."
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                mb="sm"
                icon={<IconSearch size="0.8rem" />}
            />

            {loading ? (
                <Loader />
            ) : error ? (
                <Alert title="Error!" color="red">
                    {error}
                </Alert>
            ) : (
                <DataTable
                    columns={columns}
                    records={buckets}
                    fetching={loading}
                    totalRecords={totalRecords}
                    recordsPerPage={recordsPerPage}
                    page={page}
                    onPageChange={(p) => setPage(p)}
                    onRecordsPerPageChange={(rpp) => setRecordsPerPage(rpp)}
                    sortStatus={{ columnAccessor: sortBy, direction: sortOrder }}
                    onSortStatusChange={onSort}
                    noRecordsText="No buckets found"
                />
            )}
        </div>
    );
}

export default S3BucketsTable;