package argocd

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// AgentDoer is satisfied by the server's agent-tunnel helper. Declared as an
// interface here so this package does not import internal/server (which imports
// this one).
type AgentDoer interface {
	DoAgentHTTP(ctx context.Context, agentName, method, rawURL string, body []byte, headers map[string]string) (status int, respBody []byte, err error)
}

// AgentTransport reaches ArgoCD through a cluster agent's gRPC tunnel. This is
// the path for any cluster the API server cannot address directly.
type AgentTransport struct {
	AgentName string
	Doer      AgentDoer
}

func (t *AgentTransport) Do(
	ctx context.Context,
	method, rawURL string,
	query url.Values,
	body []byte,
	headers map[string]string,
) (int, []byte, error) {
	full := rawURL
	if len(query) > 0 {
		separator := "?"
		if strings.Contains(full, "?") {
			separator = "&"
		}
		full = full + separator + query.Encode()
	}
	return t.Doer.DoAgentHTTP(ctx, t.AgentName, method, full, body, headers)
}

// LocalTransport talks to ArgoCD directly, for when the API server runs in the
// same cluster.
type LocalTransport struct {
	Client *http.Client
}

func NewLocalTransport(timeout time.Duration) *LocalTransport {
	return &LocalTransport{
		Client: &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				// ArgoCD serves a self-signed certificate by default and the hop
				// is intra-cluster.
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}
}

func (t *LocalTransport) Do(
	ctx context.Context,
	method, rawURL string,
	query url.Values,
	body []byte,
	headers map[string]string,
) (int, []byte, error) {
	full := rawURL
	if len(query) > 0 {
		separator := "?"
		if strings.Contains(full, "?") {
			separator = "&"
		}
		full = full + separator + query.Encode()
	}

	var reader io.Reader
	if len(body) > 0 {
		reader = strings.NewReader(string(body))
	}

	req, err := http.NewRequestWithContext(ctx, method, full, reader)
	if err != nil {
		return 0, nil, fmt.Errorf("failed to build request: %w", err)
	}

	for k, v := range headers {
		// The agent transport uses X-Proxy-Authorization so the tunnel does not
		// confuse it with the caller's token; locally it is just Authorization.
		if strings.EqualFold(k, "X-Proxy-Authorization") {
			req.Header.Set("Authorization", v)
			continue
		}
		req.Header.Set(k, v)
	}

	resp, err := t.Client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("failed to read response: %w", err)
	}
	return resp.StatusCode, respBody, nil
}

const maxResponseBytes = 32 << 20 // 32 MiB
