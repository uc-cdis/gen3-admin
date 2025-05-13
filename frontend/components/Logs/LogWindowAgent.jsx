"use client";

import React, { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { Container, Group, Select, Button, Checkbox } from "@mantine/core";
import callK8sApi from "@/lib/k8s";

import stripAnsi from 'strip-ansi';

import { useViewportSize } from '@mantine/hooks';

export default function LogWindow({ namespace, pod, cluster, containers }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [wrap, setWrap] = useState(false);
    const [container, setContainer] = useState(
        containers && containers.length > 0 ? containers[0] : ""
    );
    const editorRef = useRef(null);

    const { height, width } = useViewportSize();

    // Set initial container value when containers prop changes
    useEffect(() => {
        if (containers && containers.length > 0) {
            setContainer(containers[0]);
        }
    }, [containers]);

    // Fetch logs whenever namespace, pod, container, or cluster changes
    useEffect(() => {
        if (!namespace) {
            console.log("no namespace");
            return;
        }
        if (!container) {
            console.log("no container");
            return;
        }
        const endpoint = `/api/v1/namespaces/${namespace}/pods/${pod}/log?container=${container}`;
        setLoading(true);
        callK8sApi(endpoint, "GET", null, null, cluster, null, "text").then(
            (data) => {
                if (data) {
                    data = stripAnsi(data);
                    setLogs(data.split("\n"));
                }
                setLoading(false);
            }
        ).catch((error) => {
            setError(error?.message || "Failed to fetch logs.");
            setLoading(false);
        });
    }, [namespace, pod, container, cluster]);

    // Function to scroll the editor to the bottom
    const jumpToBottom = () => {
        if (editorRef.current) {
            const editor = editorRef.current;
            const model = editor.getModel();
            if (model) {
                const lineCount = model.getLineCount();
                editor.revealLine(lineCount);
            }
        }
    };

    // Auto-scroll to bottom whenever logs update
    useEffect(() => {
        if (logs.length > 0) {
            jumpToBottom();
        }
    }, [logs]);

    // Capture the editor instance on mount
    const handleEditorDidMount = (editor) => {
        editorRef.current = editor;
    };

    return (
        <Container fluid size="lg" p="md" radius="md" my="md">
            <Group
                grow
                preventGrowOverflow={false}
                wrap="nowrap"
                mb="md"
                spacing="md" // Controls spacing between Select and the sub-Group
            >
                <Select
                    placeholder="Pick container"
                    width={width}
                    value={container}
                    onChange={setContainer}
                    data={containers}
                />

                <Group spacing={0}> {/* No gap between Checkbox and Button */}
                    <Checkbox
                        label="Wrap lines"
                        checked={wrap}
                        onChange={(event) => setWrap(event.currentTarget.checked)}
                    />
                    <Button onClick={jumpToBottom}>Jump to bottom</Button>
                </Group>
            </Group>

            <Editor
                height={height}
                defaultLanguage="plaintext"
                value={logs.join("\n")}
                options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    automaticLayout: true,
                    wordWrap: wrap ? "on" : "off",            // Wrap long lines
                    lineNumbers: "on",         // Show line numbers for reference
                    folding: false,            // Disable code folding
                    contextmenu: false,        // Disable the context menu
                    quickSuggestions: false,   // Disable suggestions pop-up
                    renderLineHighlight: "none", // No need to highlight the current line
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    scrollbar: {
                        vertical: "visible",
                        horizontal: "visible",
                        useShadows: false,
                    },
                }}
                onMount={handleEditorDidMount}
                theme="vs-dark"
            />

        </Container>
    );
}
