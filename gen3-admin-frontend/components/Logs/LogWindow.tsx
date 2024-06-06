import { FixedSizeList } from "react-window";
import React from "react"

import { LogMessage } from "@/types/Logs";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";

import EventEmitter from 'events';

import LogLine from "./LogLine";

import _ from 'lodash';




function createLogStream(url: string): any | Error {
    const logStream = new EventEmitter();
    let sse: EventSource | null = null

    async function startLogStream() {
        const eventSource = new EventSource(url);
        sse = eventSource

        eventSource.addEventListener("open", (e) => {
            console.log("connection established")
        })
        eventSource.addEventListener("log", (e) => {
            const logMessage = JSON.parse(e.data) as LogMessage;
            logStream.emit("log", logMessage)
        });

        eventSource.addEventListener("error", (e) => {
            console.error("an error occurred", e)
            logStream.emit("error", e)
        });
    }

    function stopLogStream(): void {
        if (sse) {
            sse.close() // closes connection
        }
        logStream.removeAllListeners(); // removes all event listeners
    }

    return Object.assign(logStream, { startLogStream, stopLogStream });
}




export default function LogWindow({ namespace, pod, container } : { namespace: string, pod: string, container: string }) {

    const [logs, setLogs] = useState([] as LogMessage[])
    const [highlightedLines, setHighlightedLines] = useState([] as number[])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const listRef = useRef(null);
    const logStreamRef = useRef<EventEmitter | Error | null>(null);

    const handleListReady = useCallback(() => {
        // When the list has finished rendering its initial set of items,
        // you can perform additional actions or update state if needed.

      }, []);
    

    // Memoized Row component that renders a single log line
    const Row = React.memo(({ index, style }: { index: number, style: React.CSSProperties }) => {
        const isHighlighted = highlightedLines.indexOf(index) !== -1;
        const log = logs[index];
        return <LogLine key={log.timestamp} log={log} highlighted={isHighlighted} sx={style} />;
    });

    const bufferRef = useRef<Array<LogMessage>>([]);

    // updates logs
    const updateLogs = useCallback(() => {
        if (bufferRef.current.length > 0) {
            setLogs((prevLogs) =>
                [...prevLogs, ...bufferRef.current].sort((a: any, b: any) => a.unix - b.unix)
            );
            bufferRef.current = [];
            setLoading(false)
        }
    }, [])

    const debouncedUpdateLogs = useMemo(() => _.debounce(updateLogs, 1000, {
        leading: false,
        trailing: true,
    }), [updateLogs])

    // debounced function that updates logs
    const debouncedSetLogs = useCallback(() => {
        debouncedUpdateLogs()
    }, [debouncedUpdateLogs])

    // hook to cleanup debounced function
    useEffect(() => {
        return () => {
            debouncedUpdateLogs.cancel()
        }
    }, [debouncedUpdateLogs])


    useEffect(() => {
        if (!namespace) {
            return
        }
        const proxy = false
        const endpoint = proxy ? "/admin-api-go" : "http://localhost:8002" 
        const logStreamUrl = `${endpoint}/pods/logs/${namespace}/${pod}/${container}`;
        const logStream = createLogStream(logStreamUrl);

        logStreamRef.current = logStream;

        logStream.on('log', (logMessage: LogMessage) => {
            bufferRef.current.push(logMessage);
            debouncedSetLogs();
        });

        logStream.on('error', (err: Error) => {
            setError(err);
        });

        logStream.startLogStream();

        return () => {
            logStream.stopLogStream();
            debouncedUpdateLogs.cancel();
        };
    }, [namespace, pod, container, debouncedSetLogs, debouncedUpdateLogs]);


    return (
        <div>
            <h1>Log Window</h1>
            <p>Namespace: {namespace}</p>
            <p>Pod: {pod}</p>
            <p>Container: {container}</p>

            {/* <div style={border: 2px solid red}> */}
            <div style={{ border: '0px solid red' }}>
                <p>Logs for {pod}</p>
                <FixedSizeList
                    onItemsRendered={handleListReady}
                    width="100%"
                    height={500}
                    itemCount={logs.length}
                    itemSize={22}
                    ref={listRef}
                >
                    {Row}
                </FixedSizeList>
            </div>

        </div>
    )
}