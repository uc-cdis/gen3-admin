// A page where you can see all the clusters you have access to

import React, { useState, useEffect } from 'react';

import Clusters from '@/components/Clusters';
import { Container, Title, Text, Drawer, Button } from '@mantine/core';



export default function Page({ data }) {
    

    return (

        <Container fluid>
            <Clusters />
        </Container>

    );
}