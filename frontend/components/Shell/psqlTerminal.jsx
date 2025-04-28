'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

import { useViewportSize } from '@mantine/hooks';

export default function TerminalComponent({ agentId }) {
  const terminalRef = useRef(null);
  const term = useRef(null);
  const socket = useRef(null);

  const { height, width } = useViewportSize();

  useEffect(() => {
    // Initialize terminal
    term.current = new Terminal({
      cursorBlink: true,
      scrollback: 1000,
      tabStopWidth: 4,
      fontSize: 14,
      rows: 40,
      theme: {
        background: '#1e1e1e',
      },
    });

    if (terminalRef.current) {
      term.current.open(terminalRef.current);
      term.current.focus();
    }

    // Connect to your WebSocket terminal endpoint
    socket.current = new WebSocket(`ws://localhost:8002/api/agents/${agentId}/terminal/test`);

    socket.current.onopen = () => {
      term.current?.writeln('Connected to remote terminal...');
    };

    socket.current.onmessage = (event) => {
      term.current?.write(event.data);
    };

    socket.current.onclose = () => {
      term.current?.writeln('\r\nConnection closed');
    };

    socket.current.onerror = () => {
      term.current?.writeln('\r\nError connecting to terminal session');
    };

    term.current.onData((data) => {
      socket.current?.send(data);
    });

    return () => {
      socket.current?.close();
      term.current?.dispose();
    };
  }, [agentId]);

  return (
    <div
      ref={terminalRef}
      style={{
        height: height - 100,
        // width: 100%,
        backgroundColor: '#1e1e1e',
        borderRadius: '4px',
      }}
    />
  );
}
