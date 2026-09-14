package server

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

// Local TCP listeners that forward to in-cluster services via the agent.
//
// This is the third proxy fallback. The Kubernetes Service proxy and the agent's
// direct HTTP dial both require reaching the pod network, which is unavailable
// when the agent runs outside the cluster under an isolating CNI. The agent's
// port-forward goes API server -> kubelet -> pod instead, and because this path
// carries raw TCP it also serves non-HTTP protocols such as Postgres.
//
// Listeners bind to loopback only: the tunnel bypasses the agent's HTTP proxy
// allowlist, so it must never be reachable off-host.

const (
	// How long to wait for the agent to confirm a port-forward before giving up.
	tunnelOpenTimeout = 15 * time.Second
	// Idle listeners are reaped so a forgotten tunnel doesn't hold a port forever.
	tunnelIdleTimeout = 30 * time.Minute
)

type tunnelListener struct {
	ID        string    `json:"id"`
	Agent     string    `json:"agent"`
	Namespace string    `json:"namespace"`
	Service   string    `json:"service"`
	Port      int32     `json:"port"`
	LocalPort int       `json:"localPort"`
	CreatedAt time.Time `json:"createdAt"`

	listener net.Listener
	lastUsed time.Time
	mu       sync.Mutex
}

func (t *tunnelListener) touch() {
	t.mu.Lock()
	t.lastUsed = time.Now()
	t.mu.Unlock()
}

func (t *tunnelListener) idleFor() time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	return time.Since(t.lastUsed)
}

var (
	tunnelsMu sync.Mutex
	tunnels   = map[string]*tunnelListener{}
)

// closeTunnel drops a single forwarded connection and notifies the agent.
// Safe to call repeatedly.
func (a *AgentConnection) closeTunnel(streamID string) {
	a.mutex.Lock()
	conn, exists := a.tunnelConns[streamID]
	delete(a.tunnelConns, streamID)
	// Deliberately not closed: the receive loop may be mid-send on this channel,
	// and closing it would panic that goroutine. Dropping the map entry is enough
	// to signal teardown -- the ack is buffered, and any waiter falls through to
	// its timeout.
	delete(a.tunnelOpened, streamID)
	a.mutex.Unlock()

	if !exists {
		return
	}
	conn.Close()

	if err := a.sendMessage(&pb.ServerMessage{
		Message: &pb.ServerMessage_TunnelClose{
			TunnelClose: &pb.TunnelClose{StreamId: streamID},
		},
	}); err != nil {
		log.Debug().Err(err).Msgf("Failed to notify agent of tunnel close: %s", streamID)
	}
}

// CreateTunnelHandler opens a loopback listener that forwards to a cluster
// service through the agent. Returns the port the caller should connect to.
func CreateTunnelHandler(c *gin.Context) {
	agentName := c.Param("agent")

	var req struct {
		Namespace string `json:"namespace"`
		Service   string `json:"service"`
		Pod       string `json:"pod"`
		Port      int32  `json:"port"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if req.Service == "" && req.Pod == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service or pod is required"})
		return
	}
	if req.Port <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "port is required"})
		return
	}

	agent, exists := AgentConnections[agentName]
	if !exists || !agent.agent.Connected {
		c.JSON(http.StatusNotFound, gin.H{"error": "agent not connected: " + agentName})
		return
	}

	// Port 0 lets the OS pick; loopback only, never 0.0.0.0.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Error().Err(err).Msg("Failed to open tunnel listener")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open local listener"})
		return
	}

	t := &tunnelListener{
		ID:        uuid.New().String(),
		Agent:     agentName,
		Namespace: req.Namespace,
		Service:   req.Service,
		Port:      req.Port,
		LocalPort: listener.Addr().(*net.TCPAddr).Port,
		CreatedAt: time.Now(),
		listener:  listener,
		lastUsed:  time.Now(),
	}

	tunnelsMu.Lock()
	tunnels[t.ID] = t
	tunnelsMu.Unlock()

	go acceptTunnelConns(t, agent, req.Pod)
	go reapWhenIdle(t)

	log.Info().
		Str("agent", agentName).
		Str("target", fmt.Sprintf("%s/%s:%d", req.Namespace, req.Service, req.Port)).
		Int("local_port", t.LocalPort).
		Msg("Tunnel listener open")

	c.JSON(http.StatusOK, gin.H{
		"id":        t.ID,
		"localPort": t.LocalPort,
		"address":   fmt.Sprintf("127.0.0.1:%d", t.LocalPort),
	})
}

// acceptTunnelConns bridges each accepted TCP connection to its own agent stream.
func acceptTunnelConns(t *tunnelListener, agent *AgentConnection, pod string) {
	for {
		conn, err := t.listener.Accept()
		if err != nil {
			// Accept fails permanently once the listener is closed, which is the
			// normal teardown path.
			return
		}
		t.touch()
		go bridgeTunnelConn(t, agent, conn, pod)
	}
}

func bridgeTunnelConn(t *tunnelListener, agent *AgentConnection, conn net.Conn, pod string) {
	streamID := uuid.New().String()
	ack := make(chan *pb.TunnelOpened, 1)

	agent.mutex.Lock()
	agent.tunnelConns[streamID] = conn
	agent.tunnelOpened[streamID] = ack
	agent.mutex.Unlock()

	if err := agent.sendMessage(&pb.ServerMessage{
		Message: &pb.ServerMessage_TunnelOpen{
			TunnelOpen: &pb.TunnelOpen{
				StreamId:  streamID,
				Namespace: t.Namespace,
				Service:   t.Service,
				Pod:       pod,
				Port:      t.Port,
			},
		},
	}); err != nil {
		log.Error().Err(err).Msg("Failed to request tunnel from agent")
		agent.closeTunnel(streamID)
		return
	}

	// Wait for the forward to exist before relaying bytes; otherwise a client
	// that writes immediately (Postgres does) would have its first packet dropped.
	select {
	case opened := <-ack:
		if opened.Error != "" {
			log.Warn().Msgf("Agent could not open tunnel %s: %s", streamID, opened.Error)
			agent.closeTunnel(streamID)
			return
		}
	case <-time.After(tunnelOpenTimeout):
		log.Warn().Msgf("Timed out opening tunnel %s", streamID)
		agent.closeTunnel(streamID)
		return
	}

	agent.mutex.Lock()
	delete(agent.tunnelOpened, streamID)
	agent.mutex.Unlock()

	// local -> agent. The reverse direction is driven by the gRPC receive loop.
	//
	// Note this does NOT close the tunnel when the local reader hits EOF. An HTTP
	// client finishes writing its request and then waits for the response, so
	// tearing down here would close the socket before the response arrives --
	// which surfaces as "connection reset by peer". Teardown is driven by the
	// agent's TunnelClose (pod side closed) or by the idle reaper.
	buf := make([]byte, 32*1024)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			t.touch()
			if sendErr := agent.sendMessage(&pb.ServerMessage{
				Message: &pb.ServerMessage_TunnelData{
					TunnelData: &pb.TunnelData{
						StreamId: streamID,
						Data:     append([]byte(nil), buf[:n]...),
					},
				},
			}); sendErr != nil {
				log.Warn().Err(sendErr).Msgf("Failed forwarding tunnel data: %s", streamID)
				agent.closeTunnel(streamID)
				return
			}
		}
		if err != nil {
			if err == io.EOF {
				// Half-close: stop sending, keep reading the response.
				log.Debug().Msgf("Tunnel local half-closed: %s", streamID)
			} else {
				log.Debug().Err(err).Msgf("Tunnel read ended: %s", streamID)
				agent.closeTunnel(streamID)
			}
			return
		}
	}
}

func reapWhenIdle(t *tunnelListener) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		tunnelsMu.Lock()
		_, alive := tunnels[t.ID]
		tunnelsMu.Unlock()
		if !alive {
			return
		}
		if t.idleFor() > tunnelIdleTimeout {
			log.Info().Str("id", t.ID).Msg("Reaping idle tunnel")
			closeTunnelListener(t.ID)
			return
		}
	}
}

func closeTunnelListener(id string) bool {
	tunnelsMu.Lock()
	t, exists := tunnels[id]
	delete(tunnels, id)
	tunnelsMu.Unlock()

	if !exists {
		return false
	}
	t.listener.Close()
	return true
}

// DeleteTunnelHandler closes a tunnel listener. In-flight connections are torn
// down by their own read loops once the socket closes.
func DeleteTunnelHandler(c *gin.Context) {
	if !closeTunnelListener(c.Param("id")) {
		c.JSON(http.StatusNotFound, gin.H{"error": "tunnel not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "tunnel closed"})
}

// TunnelHTTPHandler performs an HTTP request against an open tunnel.
//
// The tunnel listener lives on this process, so the request must originate here
// -- routing it through the agent's HTTP proxy would make the *agent* dial its
// own loopback instead. This is the HTTP convenience path; raw TCP clients
// (psql, pgweb) connect to the loopback port directly.
func TunnelHTTPHandler(c *gin.Context) {
	id := c.Param("id")

	tunnelsMu.Lock()
	t, exists := tunnels[id]
	tunnelsMu.Unlock()
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "tunnel not found"})
		return
	}
	t.touch()

	// Build the URL structurally rather than by interpolating into a format
	// string. Host and scheme are set as fields here, so the caller's `path`
	// can only ever land in URL.Path/RawQuery -- it cannot move the request off
	// loopback no matter what it contains.
	rawPath := c.Query("path")
	if rawPath == "" {
		rawPath = "/"
	}
	if !strings.HasPrefix(rawPath, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path must start with /"})
		return
	}

	parsedPath, err := url.Parse(rawPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
		return
	}
	// A path parsed from a caller-supplied string must not carry its own scheme
	// or authority; those only appear if it was an absolute URL.
	if parsedPath.Scheme != "" || parsedPath.Host != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path must be relative"})
		return
	}

	target := &url.URL{
		Scheme:   "http",
		Host:     net.JoinHostPort("127.0.0.1", strconv.Itoa(t.LocalPort)),
		Path:     parsedPath.Path,
		RawQuery: parsedPath.RawQuery,
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target.String(), c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	if ct := c.GetHeader("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}

	// The target host and port come from server-side tunnel state, so `path`
	// cannot redirect this off loopback. Redirects can, though: a tunneled
	// service answering 302 would otherwise be followed to wherever it points,
	// so return the redirect to the caller instead of chasing it.
	client := &http.Client{
		Timeout: 60 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		log.Warn().Err(err).Str("tunnel", id).Msg("Tunnel HTTP request failed")
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed reading response: " + err.Error()})
		return
	}
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), body)
}

// RegisterTunnelRoutes registers the TCP tunnel routes.
func RegisterTunnelRoutes(r *gin.Engine) {
	r.POST("/api/agents/:agent/tunnel", CreateTunnelHandler)
	r.GET("/api/agents/:agent/tunnel", ListTunnelsHandler)
	r.DELETE("/api/agents/:agent/tunnel/:id", DeleteTunnelHandler)
	r.Any("/api/agents/:agent/tunnel/:id/http", TunnelHTTPHandler)
}

// ListTunnelsHandler reports the open tunnels, for debugging and cleanup.
func ListTunnelsHandler(c *gin.Context) {
	tunnelsMu.Lock()
	defer tunnelsMu.Unlock()

	out := make([]*tunnelListener, 0, len(tunnels))
	for _, t := range tunnels {
		if agent := c.Param("agent"); agent == "" || t.Agent == agent {
			out = append(out, t)
		}
	}
	c.JSON(http.StatusOK, gin.H{"tunnels": out})
}
