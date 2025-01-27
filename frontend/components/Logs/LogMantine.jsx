import React, { useState, useEffect, useRef } from 'react';
import CallK8sApi from '@/lib/k8s';
import {
    ScrollArea,
    Code,
    Group,
    Select,
    Text,
    Loader,
    Badge,
    Button,
    TextInput,
    Box,
    Paper,
} from '@mantine/core';
import { FixedSizeList } from 'react-window';

export default function LogWindow({ namespace, pod, cluster, containers }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [container, setContainer] = useState(containers?.length > 0 ? containers[0] : "");
    const [atBottom, setAtBottom] = useState(true);
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (!namespace) return console.log("no namespace");
        console.log("namespace", namespace);
        console.log("pod", pod);
        console.log("container", container);
        console.log("cluster", cluster);

        const endpoint = `/api/v1/namespaces/${namespace}/pods/${pod}/log?container=${container}&timestamps=true`;
        setLoading(true);

        CallK8sApi(endpoint, 'GET', null, null, cluster, null, 'text')
            .then(data => {
                if (data) {
                    const logEntries = data.split('\n').map((line, index) => ({
                        id: index,
                        timestamp: line.split(' ')[0],
                        message: line.split(' ', 2).slice(-1).join(' ')
                    }));
                    setLogs(logEntries);
                }
                setLoading(false);
            })
            .catch(error => {
                console.error('Error fetching logs:', error);
                setLoading(false);
            });
    }, [namespace, pod, container, cluster]);

    const filteredLogs = logs.filter((log) =>
        log.message.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleJumpToBottom = () => {
        if (logsEndRef.current) {
            scrollToBottom();
            setAtBottom(true);
        }
    };

    const scrollToBottom = () =>
        logsEndRef?.current?.scrollToItem(filteredLogs.length);


    const LogRow = ({ index, style, data }) => {
        const log = data[index];
        console.log(log)
        return (
            <div style={style}>
                <Box
                    display="flex"
                    h={36}
                    al="center"
                    gap="sm"
                    px={16}
                    sx={{
                        ':hover': {
                            backgroundColor: 'var(--color-background-4)'
                        }
                    }}
                >
                    <Text size="sm" color="dimmed" inline>
                        {new Date(log.timestamp).toLocaleTimeString()}
                    </Text>
                    <Code inline sx={{ color: 'var(--color-text)', flex: 1 }}>
                        {log.message}
                    </Code>
                </Box>
            </div>
        );
    };

    return (
        <Box h="100vh" p="md">
            <Box display="flex" gap="md" justifyContent="space-between" alignItems="center">
                <Select
                    value={container}
                    onChange={setContainer}
                    data={containers}
                    label="Select Container"
                />
                <TextInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search logs..."
                    withAsterisk={false}
                    sx={{ flexGrow: 1 }}
                />
                <Button
                    onClick={handleJumpToBottom}
                    variant={atBottom ? 'subtle' : 'outline'}
                    compact
                >
                    {atBottom ? 'At bottom' : 'Jump to bottom'}
                </Button>
            </Box>

            <Paper withBorder p="sm" h="calc(100vh - 140px)" ref={logsEndRef}>
                <FixedSizeList
                    height={400}
                    width="100%"
                    itemCount={filteredLogs.length}
                    itemSize={36}
                >
                    {({ index, style }) => (
                        <LogRow
                            index={index}
                            style={style}
                            data={filteredLogs}
                        />
                    )}
                </FixedSizeList>
                {filteredLogs.length === 0 && !loading && (
                    <Text c="dimmed" ta="center" py="xl">
                        No logs available
                    </Text>
                )}
            </Paper>

            {loading && (
                <Box
                    mt={15}
                    display="flex"
                    justifyContent="center"
                    sx={{ pointerEvents: 'none' }}
                >
                    <Loader size={30} variant="dots" />
                </Box>
            )}
        </Box>
    );
}