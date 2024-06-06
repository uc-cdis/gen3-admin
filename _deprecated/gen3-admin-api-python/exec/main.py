from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from kubernetes import client, config
from kubernetes.stream import stream
from fastapi import APIRouter

router = APIRouter()


@router.websocket("/pod/{pod_name}")
async def websocket_endpoint(websocket: WebSocket, pod_name: str):
    try:
        await websocket.accept()
        print("Accepted connection")
        v1 = client.CoreV1Api()
        # print("Sent command to pod")
        # await websocket.send_text(resp.read_stdout())
        # print(resp.read_stdout())
        # await websocket.send_text(resp.read_stdout())
        # while True:
        resp = stream(
            v1.connect_get_namespaced_pod_exec,
            name=pod_name,
            namespace="default",
            stderr=True,
            stdin=True,
            stdout=True,
            tty=True,
            _preload_content=False,
            command=["/bin/bash"],
        )
        # print(resp.read_stdout())
        while True:
            data = await websocket.receive_text()
            resp.write_stdin(data)
            stdout = resp.read_stdout()
            await websocket.send_text(stdout)
            stderr = resp.read_stderr()
            # print(f"Received data: {stdout}")
            # await websocket.send_text(data)
            if resp.is_open():
                # print(f"Resp is open, sending command: {data}")
                # resp.write_stdin(data)
                while resp.peek_stdout():
                    stdout = resp.read_stdout()
                    # print(f"STDOUT: {stdout}")
                    await websocket.send_text(stdout)
                if resp.peek_stderr():
                    # print("STDERR: " + resp.read_stderr())
                    await websocket.send_text(resp.read_stderr())
            
    except WebSocketDisconnect:
        resp.close()
    except client.ApiException as e:
        print(f"Exception when calling CoreV1Api->connect_get_namespaced_pod_exec: {e}")
        await websocket.send_text(f"Error: {e}")
        websocket.close()
