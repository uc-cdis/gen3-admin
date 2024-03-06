package pods

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"path/filepath"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	v1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/client-go/util/homedir"
	"k8s.io/kubectl/pkg/scheme"
)

const END_OF_TRANSMISSION = "\u0004"

// TerminalSession implements PtyHandler (using a SockJS connection)
type TerminalSession struct {
	id               string
	websocketSession *websocket.Conn
	sizeChan         chan remotecommand.TerminalSize
}

// // TerminalMessage is the messaging protocol between ShellController and TerminalSession.
// //
// // OP      DIRECTION  FIELD(S) USED  DESCRIPTION
// // ---------------------------------------------------------------------
// // bind    fe->be     SessionID      Id sent back from TerminalResponse
// // stdin   fe->be     Data           Keystrokes/paste buffer
// // resize  fe->be     Rows, Cols     New terminal size
// // stdout  be->fe     Data           Output from the process
// // toast   be->fe     Data           OOB message to be shown to the user
// type TerminalMessage struct {
// 	Op, Data, SessionID string
// 	Rows, Cols          uint16
// }

// Next handles pty->process resize events
// Called in a loop from remotecommand as long as the process is running
func (t TerminalSession) Next() *remotecommand.TerminalSize {
	size := <-t.sizeChan
	if size.Height == 0 && size.Width == 0 {
		return nil
	}
	return &size
}

// Read handles pty->process messages (stdin, resize)
// Called in a loop from remotecommand as long as the process is running
func (t TerminalSession) Read(p []byte) (int, error) {
	_, m, err := t.websocketSession.ReadMessage()
	if err != nil {
		// Send terminated signal to process to avoid resource leak
		return copy(p, END_OF_TRANSMISSION), err
	}

	// var msg TerminalMessage
	// if err := json.Unmarshal([]byte(m), &msg); err != nil {
	// 	return copy(p, END_OF_TRANSMISSION), err
	// }

	// switch msg.Op {
	// case "stdin":
	return copy(p, m), nil
	// case "resize":
	// 	t.sizeChan <- remotecommand.TerminalSize{Width: msg.Cols, Height: msg.Rows}
	// 	return 0, nil
	// default:
	// 	return copy(p, END_OF_TRANSMISSION), fmt.Errorf("unknown message type '%s'", msg.Op)
	// }
}

// Write handles process->pty stdout
// Called from remotecommand whenever there is any output
func (t TerminalSession) Write(p []byte) (int, error) {
	if err := t.websocketSession.WriteMessage(websocket.TextMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// SessionMap stores a map of all TerminalSession objects and a lock to avoid concurrent conflict
type SessionMap struct {
	Sessions map[string]TerminalSession
	Lock     sync.RWMutex
}

// Get return a given terminalSession by sessionId
func (sm *SessionMap) Get(sessionId string) TerminalSession {
	sm.Lock.RLock()
	defer sm.Lock.RUnlock()
	return sm.Sessions[sessionId]
}

// Set store a TerminalSession to SessionMap
func (sm *SessionMap) Set(sessionId string, session TerminalSession) {
	sm.Lock.Lock()
	defer sm.Lock.Unlock()
	sm.Sessions[sessionId] = session
}

// Close shuts down the SockJS connection and sends the status code and reason to the client
// Can happen if the process exits or if there is an error starting up the process
// For now the status code is unused and reason is shown to the user (unless "")
func (sm *SessionMap) Close(sessionId string, status uint32, reason string) {
	sm.Lock.Lock()
	defer sm.Lock.Unlock()
	ses := sm.Sessions[sessionId]
	err := ses.websocketSession.Close()
	if err != nil {
		log.Println(err)
	}
	close(ses.sizeChan)
	delete(sm.Sessions, sessionId)
}

var terminalSessions = SessionMap{Sessions: make(map[string]TerminalSession)}

// genTerminalSessionId generates a random session ID string. The format is not really interesting.
// This ID is used to identify the session when the client opens the SockJS connection.
// Not the same as the SockJS session id! We can't use that as that is generated
// on the client side and we don't have it yet at this point.
func genTerminalSessionId() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	id := make([]byte, hex.EncodedLen(len(bytes)))
	hex.Encode(id, bytes)
	return string(id), nil
}

func ExecIntoPod(conn *websocket.Conn) error {
	// Set these variables
	// namespace := "default"
	// podName := "example-pod"
	// containerName := "example-container"

	// Load kubeconfig
	kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "config")
	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return err
	}

	// Create clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return err
	}

	// exec into pod
	req := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		// Name("sheepdog-deployment-d4dc7486d-vhklx").
		Name("nginx-test").
		Namespace("default").
		SubResource("exec").
		VersionedParams(&v1.PodExecOptions{
			Command: []string{"/bin/sh"},
			Stdin:   true,
			Stdout:  true,
			Stderr:  true,
			TTY:     true,
		}, scheme.ParameterCodec)

	// exec, err := remotecommand.NewWebSocketExecutor(config, "POST", req.URL().String())
	// Proxy this request using the websocket
	exec, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		return err
	}

	id, err := genTerminalSessionId()

	terminalSession := TerminalSession{
		id:               id,
		websocketSession: conn,
	}
	if err != nil {
		fmt.Println("Failed to generate terminal session ID: %+v", err)
		return err
	}
	// terminalSession.websocketSession = conn
	terminalSessions.Set(terminalSession.id, terminalSession)

	err = exec.StreamWithContext(&gin.Context{}, remotecommand.StreamOptions{
		Stdin:  terminalSession,
		Stdout: terminalSession,
		Stderr: terminalSession,
		Tty:    true,
	})
	if err != nil {
		return err
	}
	return nil

}
