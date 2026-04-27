"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Group, Select, Button, Checkbox, Box, TextInput, ActionIcon, Tooltip, Text, ScrollArea, Stack, Badge } from "@mantine/core";
import callK8sApi from "@/lib/k8s";
import stripAnsi from 'strip-ansi';
import { useViewportSize } from '@mantine/hooks';
import { useSession } from "next-auth/react";
import { IconSearch, IconArrowsDiagonal, IconCopy, IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

const LOG_LEVEL_PATTERNS = [
    { regex: /\b(FATAL|PANIC)\b/i, label: 'FATAL', color: 'red' },
    { regex: /\b(ERROR|ERR|FAILED|FAILURE|EXCEPTION)\b/i, label: 'ERROR', color: 'red' },
    { regex: /\b(WARN|WARNING)\b/i, label: 'WARN', color: 'orange' },
    { regex: /\b(INFO)\b/i, label: 'INFO', color: 'blue' },
    { regex: /\b(DEBUG|TRACE|VERBOSE)\b/i, label: 'DEBUG', color: 'gray' },
];

function detectLogLevel(line) {
    // if (!line || typeof line !== 'string') return null;
    for (const { regex, label, color } of LOG_LEVEL_PATTERNS) {
        if (regex.test(line)) return { label, color };
    }
    return null;
}

// Try to parse common K8s log timestamp formats
const TIMESTAMP_REGEX = /^(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;

function parseTimestamp(line) {
    // if (!line || typeof line !== 'string') return { raw: null, rest: line || '' };
    const match = line?.match(TIMESTAMP_REGEX);
    if (match) {
        return { raw: match[1], rest: line.slice(match[0].length).trim() };
    }
    return { raw: null, rest: line };
}

function LogLine({ number, content, highlighted, searchMatch }) {
    const level = detectLogLevel(content);
    const ts = parseTimestamp(content);
    const isMatched = searchMatch;

    return (
        <Box
            px="sm"
            py={2}
            style={{
                fontFamily: '"SF Mono", Menlo, Consolas, monospace',
                fontSize: 12,
                lineHeight: 1.5,
                background: isMatched ? 'var(--mantine-color-yellow-3)' : undefined,
                borderBottom: '1px solid var(--mantine-color-dark-5)',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
            }}
        >
            <Text size="xs" c="dimmed" style={{ minWidth: 40, textAlign: 'right', userSelect: 'none', flexShrink: 0 }}>
                {number}
            </Text>
            {ts.raw && (
                <Text size="xs" c="dimmed" style={{ minWidth: 180, flexShrink: 0 }}>
                    {ts.raw}
                </Text>
            )}
            {level && (
                <Badge size="xs" variant="filled" color={level.color} style={{ flexShrink: 0, fontSize: 9 }}>
                    {level.label}
                </Badge>
            )}
            <Text
                size="xs"
                style={{ flex: 1, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}
                c={isMatched ? 'dark' : 'gray.0'}
            >
                {ts.rest || content}
            </Text>
        </Box>
    );
}

export default function LogWindow({ namespace, pod, cluster, containers }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [wrap, setWrap] = useState(false);
    const [container, setContainer] = useState(containers?.[0] || "");
    const [search, setSearch] = useState("");
    const [follow, setFollow] = useState(true);
    const scrollRef = useRef(null);
    const followRef = useRef(true);

    const { height } = useViewportSize();
    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    const editorHeight = Math.max(height - 280, 300);

    useEffect(() => {
        if (containers?.length > 0) setContainer(containers[0]);
    }, [containers]);

    // Fetch logs
    useEffect(() => {
        if (!namespace || !container) return;
        setLoading(true);
        const endpoint = `/api/v1/namespaces/${namespace}/pods/${pod}/log?container=${container}`;
        callK8sApi(endpoint, "GET", null, null, cluster, accessToken, "text")
            .then((data) => {
                if (data) {
                    const lines = stripAnsi(data).split("\n").filter(l => l && l.trim().length > 0);
                    setLogs(lines);
                } else {
                    setLogs([]);
                }
            })
            .catch((err) => {
                console.error('Failed to fetch logs:', err);
                setLogs([]);
            })
            .finally(() => setLoading(false));
    }, [namespace, pod, container, cluster]);

    // Auto-scroll when following
    useEffect(() => {
        if (follow && logs.length > 0 && scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [logs, follow]);

    const filteredLogs = useMemo(() => {
        const items = logs.map((line, i) => ({ content: line, number: i + 1 }));
        if (!search.trim()) return items;
        const q = search.toLowerCase();
        return items.filter(({ content }) => content.toLowerCase().includes(q));
    }, [logs, search]);

    const handleScroll = useCallback((position) => {
        if (!scrollRef.current) return;
        const el = scrollRef.current;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
        if (atBottom !== follow) {
            setFollow(atBottom);
            followRef.current = atBottom;
        }
    }, [follow]);

    const copyLogs = () => {
        navigator.clipboard.writeText(logs.join("\n"));
        notifications.show({ title: 'Copied', message: 'All logs copied to clipboard', color: 'green' });
    };

    return (
        <Box w="100%" p="md">
            {/* Controls */}
            <Group mb="sm" wrap="nowrap">
                <Select
                    placeholder="Container"
                    value={container}
                    onChange={setContainer}
                    data={containers}
                    style={{ width: 200 }}
                    size="sm"
                />
                <TextInput
                    placeholder="Filter logs..."
                    leftSection={<IconSearch size={14} />}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ flex: 1 }}
                    size="sm"
                    rightSection={search ? (
                        <Text size="xs" c="dimmed">{filteredLogs.length}/{logs.length}</Text>
                    ) : undefined}
                />
                <Checkbox
                    label="Wrap"
                    checked={wrap}
                    onChange={(e) => setWrap(e.currentTarget.checked)}
                    size="sm"
                />
                <Tooltip label={follow ? "Auto-follow: on" : "Auto-follow: off"}>
                    <ActionIcon
                        variant={follow ? "filled" : "subtle"}
                        color={follow ? "blue" : "default"}
                        onClick={() => { setFollow(!follow); followRef.current = !follow; }}
                        size="sm"
                    >
                        {follow ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />}
                    </ActionIcon>
                </Tooltip>
                <Tooltip label="Copy all logs">
                    <ActionIcon variant="subtle" onClick={copyLogs} size="sm">
                        <IconCopy size={14} />
                    </ActionIcon>
                </Tooltip>
                {loading && <Text size="xs" c="dimmed">Loading...</Text>}
            </Group>

            {/* Log output */}
            <Box
                h={editorHeight}
                style={{
                    background: '#1e1e1e',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '1px solid var(--mantine-color-dark-4)',
                }}
            >
                <ScrollArea
                    h="100%"
                    viewportRef={scrollRef}
                    onScrollPositionChange={handleScroll}
                >
                    <div style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>
                        {filteredLogs.length === 0 ? (
                            <Box p="xl"><Text c="dimmed" ta="center">
                                {loading ? 'Loading logs...' : search ? 'No matching logs' : 'No logs available'}
                            </Text></Box>
                        ) : (
                            filteredLogs.map(({ content, number }) => (
                                <LogLine
                                    key={number}
                                    number={number}
                                    content={content}
                                    searchMatch={!!search.trim()}
                                />
                            ))
                        )}
                    </div>
                </ScrollArea>
            </Box>
        </Box>
    );
}
