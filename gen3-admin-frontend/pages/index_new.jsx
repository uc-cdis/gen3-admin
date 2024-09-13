// A page where you can see all the clusters you have access to

import React, { useState, useEffect } from 'react';

import { Container, Title, Text, Box, Group, Button, Badge, Anchor, TextInput } from '@mantine/core';
import Clusters from '@/components/Clusters';

export default function Ind() {
    return (
        <Container fluid>

            <Clusters />

        </Container>
    );
}