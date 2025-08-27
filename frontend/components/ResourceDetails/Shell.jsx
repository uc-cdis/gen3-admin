import { useState, useEffect, useRef } from 'react';
import { Container, Select, LoadingOverlay, Button, Group, Text } from '@mantine/core';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { IconRefresh, IconX } from '@tabler/icons-react';

export default function Shell({ namespace, cluster, accessToken, pod, containers }) {
    const [selectedContainer, setSelectedContainer] = useState(containers[0]);
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(false);
    const [connectionError, setConnectionError] = useState(null);
    const terminalRef = useRef(null);
    const [terminal, setTerminal] = useState(null);
    const [ws, setWs] = useState(null);
    const fitAddon = useRef(new FitAddon());
    const terminalContainerRef = useRef(null);
    const autoScrollRef = useRef(true);

    const connectToTerminal = () => {
        if (!selectedContainer || !cluster || !namespace || !pod) return;

        // Clean up existing connections
        if (ws) {
            ws.close(1000, 'Reconnecting');
        }
        if (terminal) {
            terminal.dispose();
        }

        const term = new Terminal({
            cursorBlink: true,
            theme: { 
                background: '#1e1e1e', 
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                selection: '#264f78'
            },
            fontSize: 14,
            fontFamily: 'Consolas, "Courier New", Monaco, Menlo, "Ubuntu Mono", monospace',
            scrollback: 10000,
            allowTransparency: false,
        });

        term.loadAddon(fitAddon.current);
        term.loadAddon(new WebLinksAddon());
        term.open(terminalRef.current);
        
        // Fit terminal to container
        setTimeout(() => {
            fitAddon.current.fit();
            // Force initial scroll to bottom
            const viewport = term.element.querySelector('.xterm-viewport');
            if (viewport) {
                viewport.scrollTop = viewport.scrollHeight;
            }
        }, 100);

        setLoading(true);
        setConnectionError(null);
        autoScrollRef.current = true;

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = window.location.host;
        
        const wsUrl = `${protocol}://${host}/api/agents/${cluster}/terminal?namespace=${encodeURIComponent(namespace)}&pod=${encodeURIComponent(pod)}&container=${encodeURIComponent(selectedContainer)}&command=${encodeURIComponent('/bin/bash')}`;
        
        const socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            setLoading(false);
            setConnected(true);
            setConnectionError(null);
            term.write('\x1b[32m✓ Connected to pod terminal\x1b[0m\r\n');
            
            // Send initial terminal size
            const dimensions = fitAddon.current.proposeDimensions();
            if (dimensions) {
                const resizeData = JSON.stringify({ 
                    cols: dimensions.cols, 
                    rows: dimensions.rows 
                });
                socket.send(`resize:${resizeData}`);
            }

            // Force scroll to bottom after connection
            setTimeout(() => {
                const viewport = term.element.querySelector('.xterm-viewport');
                if (viewport) {
                    viewport.scrollTop = viewport.scrollHeight;
                }
            }, 50);
        };

        socket.onclose = (event) => {
            setLoading(false);
            setConnected(false);
            if (event.code !== 1000) {
                const errorMsg = `Connection closed: ${event.reason || 'Unknown reason'} (Code: ${event.code})`;
                setConnectionError(errorMsg);
                term.write(`\x1b[31m\r\n✗ ${errorMsg}\x1b[0m`);
            }
        };

        socket.onerror = (err) => {
            setLoading(false);
            setConnected(false);
            const errorMsg = `Connection error: ${err.message || 'Network error'}`;
            setConnectionError(errorMsg);
            term.write(`\x1b[31m\r\n✗ ${errorMsg}\x1b[0m`);
        };

        socket.onmessage = (event) => {
            const processData = (data) => {
                term.write(data);
                
                // Force scroll to bottom after writing
                if (autoScrollRef.current) {
                    requestAnimationFrame(() => {
                        const viewport = term.element.querySelector('.xterm-viewport');
                        const screen = term.element.querySelector('.xterm-screen');
                        if (viewport && screen) {
                            viewport.scrollTop = viewport.scrollHeight;
                            
                            // Also ensure the terminal rows are properly sized
                            const lineHeight = parseInt(getComputedStyle(screen).lineHeight) || 18;
                            const expectedHeight = term.rows * lineHeight;
                            if (screen.clientHeight !== expectedHeight) {
                                screen.style.height = `${expectedHeight}px`;
                            }
                        }
                    });
                }
            };

            if (typeof event.data === 'string') {
                processData(event.data);
            } else if (event.data instanceof Blob) {
                event.data.arrayBuffer().then(buffer => {
                    processData(new Uint8Array(buffer));
                });
            }
        };

        term.onData((data) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(data);
            }
        });

        term.onResize(({ cols, rows }) => {
            if (socket.readyState === WebSocket.OPEN) {
                const resizeData = JSON.stringify({ cols, rows });
                socket.send(`resize:${resizeData}`);
            }
        });

        // Add scroll event listener
        const handleScroll = () => {
            const viewport = term.element.querySelector('.xterm-viewport');
            if (viewport) {
                const isAtBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2;
                autoScrollRef.current = isAtBottom;
            }
        };

        const viewport = term.element.querySelector('.xterm-viewport');
        if (viewport) {
            viewport.addEventListener('scroll', handleScroll);
            term._scrollHandler = handleScroll;
        }

        setTerminal(term);
        setWs(socket);
    };

    const disconnectTerminal = () => {
        if (ws) {
            ws.close(1000, 'Manual disconnect');
        }
        setConnected(false);
    };

    const clearTerminal = () => {
        if (terminal) {
            terminal.clear();
            autoScrollRef.current = true;
            // Reset scroll position
            setTimeout(() => {
                const viewport = terminal.element.querySelector('.xterm-viewport');
                if (viewport) {
                    viewport.scrollTop = viewport.scrollHeight;
                }
            }, 50);
        }
    };

    const scrollToBottom = () => {
        if (terminal) {
            const viewport = terminal.element.querySelector('.xterm-viewport');
            if (viewport) {
                viewport.scrollTop = viewport.scrollHeight;
                autoScrollRef.current = true;
            }
        }
    };

    useEffect(() => {
        connectToTerminal();

        const resizeObserver = new ResizeObserver(() => {
            if (terminal && fitAddon.current) {
                fitAddon.current.fit();
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const dimensions = fitAddon.current.proposeDimensions();
                    if (dimensions) {
                        const resizeData = JSON.stringify({ 
                            cols: dimensions.cols, 
                            rows: dimensions.rows 
                        });
                        ws.send(`resize:${resizeData}`);
                    }
                }

                // Scroll to bottom after resize
                if (autoScrollRef.current && terminal) {
                    setTimeout(() => {
                        const viewport = terminal.element.querySelector('.xterm-viewport');
                        if (viewport) {
                            viewport.scrollTop = viewport.scrollHeight;
                        }
                    }, 50);
                }
            }
        });

        if (terminalContainerRef.current) {
            resizeObserver.observe(terminalContainerRef.current);
        }

        return () => {
            if (ws) {
                ws.close(1000, 'Component unmounted');
            }
            if (terminal) {
                const viewport = terminal.element.querySelector('.xterm-viewport');
                if (viewport && terminal._scrollHandler) {
                    viewport.removeEventListener('scroll', terminal._scrollHandler);
                }
                terminal.dispose();
            }
            resizeObserver.disconnect();
        };
    }, [selectedContainer, namespace, cluster, pod]);

    return (
        <Container fluid p={0} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <LoadingOverlay visible={loading} />
            
            {/* Header Controls */}
            <div style={{ 
                padding: '12px',
                flexShrink: 0
            }}>
                <Group justify="space-between" align="center">
                    <Group>
                        <Select
                            data={containers}
                            value={selectedContainer}
                            onChange={setSelectedContainer}
                            style={{ width: '200px' }}
                            disabled={loading || connected}
                            size="sm"
                        />
                    </Group>
                    
                    <Group gap="xs">
                        <Button
                            size="xs"
                            onClick={clearTerminal}
                            disabled={!connected}
                        >
                            Clear
                        </Button>
                        <Button
                            size="xs"
                            onClick={scrollToBottom}
                            disabled={!connected}
                        >
                            Scroll to Bottom
                        </Button>
                        {connected ? (
                            <Button
                                size="xs"
                                leftSection={<IconX size={14} />}
                                onClick={disconnectTerminal}
                            >
                                Disconnect
                            </Button>
                        ) : (
                            <Button
                                size="xs"
                                variant="light"
                                leftSection={<IconRefresh size={14} />}
                                onClick={connectToTerminal}
                                loading={loading}
                            >
                                Reconnect
                            </Button>
                        )}
                    </Group>
                </Group>
                
                {connectionError && (
                    <Text size="xs" c="red" mt="xs">
                        {connectionError}
                    </Text>
                )}
            </div>
            
            {/* Terminal Container */}
            <div 
                ref={terminalContainerRef}
                style={{ 
                    backgroundColor: '#1e1e1e',
                    height: '25rem',
                    overflowY: 'scroll',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column'
                }}
            >
                <div 
                    ref={terminalRef}
                    style={{ 
                        flex: 1,
                        width: '100%',
                        minHeight: 0 // Important for flex children to shrink properly
                    }}
                />
            </div>
        </Container>
    );
}