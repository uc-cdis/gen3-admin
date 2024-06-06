// components/terminal-component
import { useEffect } from 'react';
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'



function TerminalComponent({ namespace, pod, container }) {
    useEffect(() => {
        console.log(namespace, pod, container)
        const term = new Terminal()
        term.open(document.getElementById('terminal'));
        const basePath = window.location.host;
        // console.log(term)
        // // Update this URL with your WebSocket URL
        // var wsUrl = 'ws://localhost:8002/pods/ws';
        var wsUrl = `ws://`+  basePath  + `/admin-api-go/pods/ws/${namespace}/${pod}/${container}`
        // // var wsUrl = 'ws://localhost:8001/api/v1/namespaces/default/pods/sheepdog-deployment-d4dc7486d-vhklx/exec?command=sh&stdin=true&stdout=true&tty=true';
        var socket = new WebSocket(wsUrl);
    
        socket.onopen = function () {
            term.write('Connected to \x1B[1;3;31m' + pod + '\x1B[0m \n\r');
        };
    
        socket.onclose = function () {
            term.write('\r\n\x1B[1;3;31mConnection closed\x1B[0m\r\n');
        };
    
        // Handle incoming messages
        socket.onmessage = function (evt) {
            term.write(evt.data);
        };
    
        // Send data to server
        term.onData(function (data) {
            socket.send(data);
        });
    
        socket.onerror = function (error) {
            term.write('WebSocket error: ' + error + '\r\n');
            console.error('WebSocket error:', error);
        };

    }, [])
    return (
        <div>
            <div id="terminal">
            </div>
        </div>
    )
}

export default TerminalComponent
