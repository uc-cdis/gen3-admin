package argocd

import (
	"context"
	"sync"
	"time"
)

// Registry caches one Client per agent so session tokens are reused instead of
// re-authenticating on every request.
type Registry struct {
	mu      sync.RWMutex
	clients map[string]*Client

	doer AgentDoer
	kube KubeReaderFactory
}

// KubeReaderFactory builds a KubeReader for a named agent, used to read the
// initial admin secret and discover the argocd-server Service.
type KubeReaderFactory func(agentName string) KubeReader

func NewRegistry(doer AgentDoer, kube KubeReaderFactory) *Registry {
	return &Registry{clients: make(map[string]*Client), doer: doer, kube: kube}
}

// Get returns a client for the agent, creating one on first use.
//
// Discovery (server URL) happens once per agent rather than per request, since it
// costs a Kubernetes round trip through the tunnel.
func (r *Registry) Get(ctx context.Context, agentName, namespace string) (*Client, error) {
	r.mu.RLock()
	client, ok := r.clients[agentName]
	r.mu.RUnlock()
	if ok {
		return client, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	// Re-check: another goroutine may have created it while we waited.
	if client, ok := r.clients[agentName]; ok {
		return client, nil
	}

	var reader KubeReader
	if r.kube != nil {
		reader = r.kube(agentName)
	}

	baseURL := ResolveServerURL(ctx, agentName, namespace, reader)
	creds := NewCredentialResolver(agentName, namespace, reader)

	transport := Transport(&AgentTransport{AgentName: agentName, Doer: r.doer})
	client = NewClient(transport, baseURL, creds)

	r.clients[agentName] = client
	return client, nil
}

// Invalidate drops a cached client, so a reconnecting agent or rotated
// credentials are picked up rather than failing against a stale token.
func (r *Registry) Invalidate(agentName string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.clients, agentName)
}

// InvalidateAll clears every cached client.
func (r *Registry) InvalidateAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clients = make(map[string]*Client)
}

// DefaultRequestTimeout bounds a single ArgoCD call. Generous because
// managed-resources and manifests on a large app can be slow to render.
const DefaultRequestTimeout = 60 * time.Second
