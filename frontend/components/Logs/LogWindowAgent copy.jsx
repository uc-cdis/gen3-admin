import React from "react"

import { useRef, useState, useEffect, useCallback, useMemo } from "react";

import { FixedSizeList } from "react-window";
import LogLine from "./LogLine";

import callK8sApi from '@/lib/k8s';

import { Code, Group, Select, Button } from '@mantine/core';


export default function LogWindow({ namespace, pod, cluster, containers }) {

    const [logs, setLogs] = useState([])
    const [loading, setLoading] = useState(false)
    const listRef = useRef(null);
    const [container, setContainer] = useState(containers?.length > 0 ? containers[0] : "")

    useEffect(() => {
        console.log(containers)
        if (containers?.length > 0) {
            setContainer(containers[0])
        }
    }, [containers])

    const scrollToBottom = () =>
        listRef?.current.scrollToItem(logs.length);

    useEffect(() => {
        scrollToBottom();
    }, [logs]);


    useEffect(() => {
        if (!namespace) {
            console.log("no namespace")
            return
        }

        if (!container) {
            console.log("no container")
            return
        }
        const proxy = false
        // const endpoint = proxy ? "/admin-api-go" : "http://localhost:8002" 
        const endpoint = `/api/v1/namespaces/${namespace}/pods/${pod}/log?container=${container}`
        setLoading(true)
        callK8sApi(endpoint, 'GET', null, null, cluster, null, 'text').then((data) => {
            if (data) {
                setLogs(data.split('\n'))
            }
            setLoading(false);
        });
    }, [namespace, pod, container, cluster]);


    const Row = React.memo(({ index, style }) => {
        const log = logs[index];
        // Memoized Row component that renders a single log line
        // const isHighlighted = highlightedLines.indexOf(index) !== -1;
        return (
            <div style={style}>
                <Group grow wrap="nowrap">
                    <Code>
                        {log}
                    </Code>
                </Group>
            </div>
        )
    });

    return (
        <div>
            {/* <div style={border: 2px solid red}> */}
            <div style={{ border: '0px solid red' }}>
                {/* <p>Logs for {pod}</p> */}
                <Group grow wrap="nowrap">
                    <Select
                        placeholder="Pick container"
                        label="Container"
                        value={container} onChange={setContainer} data={containers} />
                    <Button onClick={() => listRef.current.scrollToItem(logs.length - 1)}>Jump to bottom</Button>
                </Group>
                <FixedSizeList
                    // onItemsRendered={handleListReady}
                    width="100%"
                    height={500}
                    itemCount={logs.length}
                    itemSize={20}
                    ref={listRef}
                >
                    {Row}
                </FixedSizeList>
            </div>

        </div>
    )
}