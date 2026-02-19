import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

export default function TerminalComponent({ namespace, pod, container, cluster }: { namespace: string; pod: string; container: string; cluster: string }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [nonce, setNonce] = useState(0); // triggers restart

  useEffect(() => {
    if (!elRef.current) return;

    // Cleanup any existing terminal/session
    socketRef.current?.close();
    termRef.current?.dispose();

    const term = new Terminal({ cursorBlink: true });
    termRef.current = term;
    term.open(elRef.current);
    term.focus();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/agents/${cluster}/terminal/exec/${namespace}/${pod}/${container}`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.binaryType = "arraybuffer";

    socket.onopen = () => term.writeln(`Connected to ${pod} / ${container}`);
    socket.onmessage = (evt) => {
      const data =
        evt.data instanceof ArrayBuffer
          ? new Uint8Array(evt.data)
          : evt.data;
      term.write(data as any);
    };
    socket.onclose = () => term.writeln("\r\n[terminal closed]\r\n");
    socket.onerror = () => term.writeln("\r\n[connection error]\r\n");

    const onData = term.onData((data) => {
      // send bytes (safer for special keys)
      socket.send(new TextEncoder().encode(data));
    });

    return () => {
      onData.dispose();
      socket.close();
      term.dispose();
    };
  }, [namespace, pod, container, cluster, nonce]);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button
          onClick={() => setNonce((n) => n + 1)}
          style={{ padding: "6px 10px", cursor: "pointer" }}
        >
          Kill & New Terminal
        </button>
      </div>
      <div ref={elRef} style={{ height: 500, width: "100%" }} />
    </div>
  );
}
