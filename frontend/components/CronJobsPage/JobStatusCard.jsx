// DataCard.jsx
import React from 'react';
import { Card, Text, Badge, Anchor, useMantineTheme } from '@mantine/core';
import { IconCheck, IconX, IconClock } from '@tabler/icons-react';
import { useRouter } from 'next/router';

const JobStatusCard = ({ item, parent }) => {
    const theme = useMantineTheme();
    const statusColors = {
        'Succeeded': { color: 'green', icon: <IconCheck size={16} /> },
        'Failed': { color: 'red', icon: <IconX size={16} /> },
        'Running': { color: 'blue', icon: <IconClock size={16} /> },
        'Unknown': { color: 'gray', icon: <IconClock size={16} /> }
    };

    const jobStatus = item.status.succeeded > 0 ? 'Succeeded' :
                  item.status.failed > 0 ? 'Failed' :
                  item.status.active > 0 ? 'Running' : 'Unknown';  // Fallback status if none apply

    const status = statusColors[jobStatus] || statusColors['Failed'];
    const router = useRouter()
    let href = router.asPath + "/" + parent + "/" + item.metadata.name;
    return (
        <Card
            shadow="sm"
            p="md"
            style={{
                borderColor: theme.colors.gray[2],
                borderWidth: 1,
                borderStyle: 'solid',
                borderRadius: theme.radius.md,
                marginBottom: theme.spacing.lg,
                transition: 'box-shadow 0.3s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = theme.shadows.md}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
        >
            <Text fw={500} style={{ marginBottom: theme.spacing.xs, fontSize: theme.fontSizes.lg }}>
                {item.metadata?.name}
            </Text>
            <Badge color={status.color} variant="light" leftSection={status.icon} style={{ marginBottom: theme.spacing.sm }}>
                {item.status?.ready}
            </Badge>
            <Text size="sm" style={{ color: theme.colors.gray[7], marginBottom: theme.spacing.xs }}>
                Created: {new Date(item.metadata?.creationTimestamp).toLocaleString()}
            </Text>
            <Text size="sm" style={{ color: theme.colors.gray[7], marginBottom: theme.spacing.xs }}>
                Finished: {new Date(item.date_finished).toLocaleString()}
            </Text>
            <Anchor 
                variant="light"
                color={status.color}
                fullWidth
                style={{ marginTop: theme.spacing.md }}
                href={href}
            >
                View Details
            </Anchor>
        </Card>
    );
};

export default JobStatusCard;
