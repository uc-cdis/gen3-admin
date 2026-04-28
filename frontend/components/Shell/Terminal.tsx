import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { Box, Group, Text, ActionIcon, Tooltip, Card } from "@mantine/core";
import { IconTerminal, IconRefresh, IconCopy } from '@tabler/icons-react';

export default function TerminalComponent({ namespace, pod, container, cluster }: { namespace: string; pod: string; container: string; cluster: string }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [nonce, setNonce] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!elRef.current) return;

    // Cleanup any existing terminal/session
    socketRef.current?.close();
    termRef.current?.dispose();

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(56, 139, 253, 0.4)',
        black: '#484f58',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#f85149',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      lineHeight: 1.4,
      scrollback: 5000,
    });
    termRef.current = term;
    term.open(elRef.current);
    term.focus();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/agents/${cluster}/terminal/exec/${namespace}/${pod}/${container}`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      setConnected(true);
      term.writeln(`\x1b[32m\u2713 Connected\x1b[0m to \x1b[36m${pod}\x1b[0m / \x1b[33m${container}\x1b[0m`);
    };
    socket.onmessage = (evt) => {
      const data =
        evt.data instanceof ArrayBuffer
          ? new Uint8Array(evt.data)
          : evt.data;
      term.write(data as any);
    };
    socket.onclose = () => {
      setConnected(false);
      term.writeln("\r\n\x1b[33m[terminal closed]\x1b[0m\r\n");
    };
    socket.onerror = () => {
      setConnected(false);
      term.writeln("\r\n\x1b[31m[connection error]\x1b[0m\r\n");
    };

    const onData = term.onData((data) => {
      socket.send(new TextEncoder().encode(data));
    });

    return () => {
      onData.dispose();
      socket.close();
      term.dispose();
      setConnected(false);
    };
  }, [namespace, pod, container, cluster, nonce]);

  const copyFromTerminal = () => {
    if (termRef.current) {
      const selection = termRef.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    }
  };

  return (
    <Card p={0} radius="md" style={{ overflow: 'hidden' }}>
      {/* Header bar */}
      <Box
        px="md"
        py="xs"
        style={{
          background: '#161b22',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Group gap="sm">
          <IconTerminal size={16} color="#8b949e" />
          <Text size="sm" c="gray.5" fw={600}>
            {pod} / {container}
          </Text>
          {connected && (
            <Box
              px={6}
              py={2}
              style={{ background: '#238636', borderRadius: 999 }}
            >
              <Text size={9} c="white" fw={700} tt="uppercase" lh={1}>
                Connected
              </Text>
            </Box>
          )}
        </Group>
        <Group gap={4}>
          <Tooltip label="Restart terminal" position="bottom">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setNonce(n => n + 1)}
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Copy selection" position="bottom">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={copyFromTerminal}
            >
              <IconCopy size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>

      {/* Terminal */}
      <div ref={elRef} style={{ height: 500 }} />
    </Card>
  );
}
