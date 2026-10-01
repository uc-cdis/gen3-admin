package server

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

// An agent loaded from api/certs at boot, or minted through POST /api/agents,
// exists before it ever connects. Requests routed to it used to panic with
// "assignment to entry in nil map" (proxy_handlers.go) and, past that, a nil
// stream dereference in sendMessage.
func registerDisconnectedAgent(t *testing.T, name string) {
	t.Helper()
	agentsMutex.Lock()
	AgentConnections[name] = newAgentConnection(nil, Agent{Name: name})
	agentsMutex.Unlock()
	t.Cleanup(func() {
		agentsMutex.Lock()
		delete(AgentConnections, name)
		agentsMutex.Unlock()
	})
}

func TestProxyToRegisteredButDisconnectedAgentIs503(t *testing.T) {
	registerDisconnectedAgent(t, "local-test")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterProxyRoutes(r.Group("/"))

	for _, path := range []string{
		"/api/k8s/local-test/proxy/apis/apiextensions.k8s.io/v1/customresourcedefinitions",
		"/api/agents/local-test/http?url=http://example.svc",
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("GET %s = %d %s, want 503", path, w.Code, w.Body.String())
		}
	}
}

func TestNewAgentConnectionInitialisesEveryMap(t *testing.T) {
	a := newAgentConnection(nil, Agent{Name: "x"})
	// Each of these is written by some handler; none may be nil.
	a.requestChannels["s"] = make(chan *pb.ProxyResponse)
	a.cancelFuncs["s"] = func() {}
	a.contexts["s"] = nil
	a.terminalStreams["s"] = nil
	a.tunnelConns["s"] = nil
	a.tunnelOpened["s"] = nil
	a.sqlResponses["s"] = nil
}

func TestSendOnDisconnectedAgentReturnsError(t *testing.T) {
	a := newAgentConnection(nil, Agent{Name: "x"})
	if err := a.sendMessage(&pb.ServerMessage{}); !errors.Is(err, errAgentNotConnected) {
		t.Fatalf("sendMessage on nil stream = %v, want errAgentNotConnected", err)
	}
	if a.connected() {
		t.Error("connected() = true for an agent with no stream")
	}
}
