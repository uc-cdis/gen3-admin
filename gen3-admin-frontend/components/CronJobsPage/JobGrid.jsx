// ResponsiveCards.jsx
import React, { useState } from 'react';
import { Grid, Modal } from '@mantine/core';
import JobStatusCard from './JobStatusCard';

const JobGrid = ({ data, parent }) => {
    return (
        <>
            <Grid>
                {data?.length === 0 ? <div>No jobs</div> :
                data?.map((item, index) => {
                    return (
                    <Grid.Col key={index} span={{ base: 12, md: 6, lg: 4, xl: 3 }}>
                        <JobStatusCard item={item} parent={parent} />
                    </Grid.Col>
                )})}
            </Grid>
        </>
    );
};

export default JobGrid;
