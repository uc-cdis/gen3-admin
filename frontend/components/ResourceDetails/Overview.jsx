import { Card, Stack, Group, Text, Paper, Title } from '@mantine/core';

export default function Overview({ resource }) {
    return (
        <>
            <Stack spacing="xl">
                <Paper shadow="xs" p="md" radius="md">
                    <Title order={4}>Metadata</Title>
                    <Text size="sm" color="dimmed">
                        {JSON.stringify(resource?.metadata?.name)}
                    </Text>
                </Paper>
            </Stack>
        </>
    )
}