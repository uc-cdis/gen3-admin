'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

import { useViewportSize } from '@mantine/hooks';


export default function TerminalComponent({instanceid}) {
  const terminalRef = useRef(null);
  const term = useRef(null);
  const socket = useRef(null);

  const { height, width } = useViewportSize();

  useEffect(() => {
    term.current = new Terminal({
      cursorBlink: true,
      scrollback: 1000,
      tabStopWidth: 4,
      rows: 40,
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
      },
    });

    if (terminalRef.current) {
      term.current.open(terminalRef.current);
      term.current.focus();
    }

    socket.current = new WebSocket('ws://localhost:8002/api/ssm/exec?instanceId=' + instanceid); // adjust to match your deployment

    socket.current.onopen = () => {
      term.current?.writeln('Connected to SSM shell...');
    };

    socket.current.onmessage = (event) => {
      term.current?.write(event.data);
    };

    term.current.onData((data) => {
      socket.current?.send(data);
    });

    socket.current.onclose = () => {
      term.current?.writeln('\r\nConnection closed');
    };

    socket.current.onerror = () => {
      term.current?.writeln('\r\nError connecting to session');
    };

    return () => {
      socket.current?.close();
      term.current?.dispose();
    };
  }, []);

  return <div ref={terminalRef} style={{ height: "1000px", width: '100%' }} />;
}
