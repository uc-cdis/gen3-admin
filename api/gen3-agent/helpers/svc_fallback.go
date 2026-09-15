package agentHelper

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

// Reaching cluster-internal Services from an out-of-cluster agent.
//
// The agent normally runs in-cluster, where `argocd-server.argocd.svc` resolves
// and a plain HTTP dial works -- that is the production path and needs nothing
// from this file.
//
// In development the agent runs on a laptop with a remote kubeconfig. Cluster
// DNS does not exist there, so the same dial fails with "no such host". Rather
// than requiring a hand-run `kubectl port-forward` per service, this transparently
// establishes one on demand using the agent's existing credentials, via the
// API server -> kubelet -> pod path (see tunnel.go). That route does not touch the
// pod network, so it works even where a CNI blocks direct access.

// Indirection points so the SPDY plumbing can be swapped in tests.
var (
	spdyRoundTripperFor = spdy.RoundTripperFor
	newPortForwarder    = func(
		rt http.RoundTripper, upgrader spdy.Upgrader, reqURL *url.URL,
		targetPort int, stop, ready chan struct{},
	) (*portforward.PortForwarder, error) {
		dialer := spdy.NewDialer(upgrader, &http.Client{Transport: rt}, http.MethodPost, reqURL)
		// Local port 0 lets the OS choose, so concurrent forwards never collide.
		// Bind loopback only -- this must not be reachable off-host.
		return portforward.NewOnAddresses(
			dialer,
			[]string{"127.0.0.1"},
			[]string{fmt.Sprintf("0:%d", targetPort)},
			stop, ready, io.Discard, io.Discard,
		)
	}
)

// resolveServicePod finds a ready pod behind a Service and the container port
// that the Service's port maps to.
func (a *Agent) resolveServicePod(t clusterServiceTarget) (string, int, error) {
	clientset, err := tunnelClientset()
	if err != nil {
		return "", 0, fmt.Errorf("kubernetes client: %w", err)
	}
	ctx := context.Background()

	svc, err := clientset.CoreV1().Services(t.Namespace).Get(ctx, t.Service, metav1.GetOptions{})
	if err != nil {
		return "", 0, fmt.Errorf("get service %s/%s: %w", t.Namespace, t.Service, err)
	}
	if len(svc.Spec.Selector) == 0 {
		return "", 0, fmt.Errorf("service %s/%s has no selector", t.Namespace, t.Service)
	}

	// A Service port and its container targetPort are frequently different
	// (argocd-server exposes 80 -> 8080), so forward to the target, not the
	// service port.
	targetPort := t.Port
	for _, p := range svc.Spec.Ports {
		if int(p.Port) == t.Port {
			if p.TargetPort.IntValue() > 0 {
				targetPort = p.TargetPort.IntValue()
			}
			break
		}
	}

	pods, err := clientset.CoreV1().Pods(t.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labels.SelectorFromSet(svc.Spec.Selector).String(),
	})
	if err != nil {
		return "", 0, fmt.Errorf("list pods for %s/%s: %w", t.Namespace, t.Service, err)
	}
	for _, p := range pods.Items {
		if p.Status.Phase != "Running" {
			continue
		}
		for _, cond := range p.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				return p.Name, targetPort, nil
			}
		}
	}
	return "", 0, fmt.Errorf("no ready pod backing service %s/%s", t.Namespace, t.Service)
}

// svcForward is a port-forward held open for reuse.
type svcForward struct {
	localPort int
	stop      chan struct{}
	createdAt time.Time
}

var (
	svcForwardMu sync.Mutex
	svcForwards  = map[string]*svcForward{}
)

// runningInCluster reports whether cluster DNS is available to this process.
//
// Cached: the answer cannot change over a process lifetime, and this is consulted
// on every proxied request.
var (
	inClusterOnce sync.Once
	inClusterVal  bool
)

func runningInCluster() bool {
	inClusterOnce.Do(func() {
		_, err := netLookupInCluster()
		inClusterVal = err == nil
		log.Info().Bool("in_cluster", inClusterVal).
			Msg("[svc-fallback] resolved agent network position")
	})
	return inClusterVal
}

// netLookupInCluster is separated so tests can exercise both branches.
var netLookupInCluster = func() (string, error) {
	// The kubernetes API service is always resolvable from inside a cluster and
	// never from outside, which makes it a cheap, dependency-free probe.
	addrs, err := net.LookupHost("kubernetes.default.svc")
	if err != nil || len(addrs) == 0 {
		return "", fmt.Errorf("not in cluster")
	}
	return addrs[0], nil
}

// clusterServiceTarget describes a parsed `<name>.<namespace>.svc[.cluster.local]`
// host, which is the only shape this fallback rewrites.
type clusterServiceTarget struct {
	Service   string
	Namespace string
	Port      int
}

// parseClusterServiceHost recognises in-cluster Service DNS names. Anything else
// (an IP, localhost, a public hostname) returns false and is left untouched.
func parseClusterServiceHost(rawURL string) (clusterServiceTarget, bool) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return clusterServiceTarget{}, false
	}

	host := u.Hostname()
	if !strings.Contains(host, ".svc") {
		return clusterServiceTarget{}, false
	}

	trimmed := strings.TrimSuffix(strings.TrimSuffix(host, ".cluster.local"), ".svc")
	parts := strings.Split(trimmed, ".")
	if len(parts) < 2 {
		// A bare `<name>.svc` gives no namespace to target.
		return clusterServiceTarget{}, false
	}

	port := 80
	if p := u.Port(); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil {
			port = parsed
		}
	} else if u.Scheme == "https" {
		port = 443
	}

	return clusterServiceTarget{
		Service:   parts[0],
		Namespace: parts[1],
		Port:      port,
	}, true
}

// rewriteForLocalAgent maps a cluster-internal URL onto a local port-forward.
//
// Returns the URL unchanged when the agent is in-cluster, when the host is not a
// Service name, or when a forward cannot be established -- in which case the
// caller's own error handling reports the original failure.
func (a *Agent) rewriteForLocalAgent(rawURL string) string {
	if runningInCluster() {
		return rawURL
	}

	target, ok := parseClusterServiceHost(rawURL)
	if !ok {
		return rawURL
	}

	localPort, err := a.ensureServiceForward(target)
	if err != nil {
		log.Warn().
			Err(err).
			Str("service", fmt.Sprintf("%s/%s:%d", target.Namespace, target.Service, target.Port)).
			Msg("[svc-fallback] could not establish port-forward")
		return rawURL
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	// Always plain http to the forwarded port: TLS was terminated (or never
	// started) at the Service, and re-wrapping it would fail certificate checks
	// against 127.0.0.1.
	u.Scheme = "http"
	u.Host = fmt.Sprintf("127.0.0.1:%d", localPort)

	log.Debug().
		Str("from", rawURL).
		Str("to", u.String()).
		Msg("[svc-fallback] rewrote cluster URL to local forward")
	return u.String()
}

// alive reports whether a forward is still accepting connections. A forward dies
// when its backing pod restarts, so a cached entry cannot be trusted blindly.
func alive(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// ensureServiceForward returns a local port forwarding to the Service, creating
// one on first use and reusing it afterwards.
//
// The lock is held across creation so two concurrent requests for the same
// Service do not race into two forwards; establishing one is fast enough that
// serialising it is preferable to leaking ports.
func (a *Agent) ensureServiceForward(t clusterServiceTarget) (int, error) {
	key := fmt.Sprintf("%s/%s:%d", t.Namespace, t.Service, t.Port)

	svcForwardMu.Lock()
	defer svcForwardMu.Unlock()

	if existing, ok := svcForwards[key]; ok {
		if alive(existing.localPort) {
			return existing.localPort, nil
		}
		close(existing.stop)
		delete(svcForwards, key)
	}

	localPort, stop, err := a.startServiceForward(t)
	if err != nil {
		return 0, err
	}
	svcForwards[key] = &svcForward{localPort: localPort, stop: stop, createdAt: time.Now()}

	log.Info().
		Str("service", key).
		Int("local_port", localPort).
		Msg("[svc-fallback] port-forward established")
	return localPort, nil
}

// startServiceForward resolves the Service to a ready pod and opens a
// port-forward to it on an OS-assigned local port.
//
// This reuses client-go's PortForwarder (rather than the raw SPDY streams the
// TCP tunnel uses) precisely because a local listener is what we want here: the
// rewritten URL points at it.
func (a *Agent) startServiceForward(t clusterServiceTarget) (int, chan struct{}, error) {
	pod, targetPort, err := a.resolveServicePod(t)
	if err != nil {
		return 0, nil, err
	}

	config, err := tunnelConfig()
	if err != nil {
		return 0, nil, fmt.Errorf("client config: %w", err)
	}
	clientset, err := tunnelClientset()
	if err != nil {
		return 0, nil, fmt.Errorf("kubernetes client: %w", err)
	}

	reqURL := clientset.CoreV1().RESTClient().Post().
		Resource("pods").Namespace(t.Namespace).Name(pod).SubResource("portforward").URL()

	roundTripper, upgrader, err := spdyRoundTripperFor(config)
	if err != nil {
		return 0, nil, fmt.Errorf("spdy transport: %w", err)
	}

	stop := make(chan struct{})
	ready := make(chan struct{})
	fw, err := newPortForwarder(roundTripper, upgrader, reqURL, targetPort, stop, ready)
	if err != nil {
		return 0, nil, err
	}

	errCh := make(chan error, 1)
	go func() { errCh <- fw.ForwardPorts() }()

	select {
	case <-ready:
	case err := <-errCh:
		return 0, nil, fmt.Errorf("port-forward failed: %w", err)
	case <-time.After(15 * time.Second):
		close(stop)
		return 0, nil, fmt.Errorf("timed out establishing port-forward to %s/%s", t.Namespace, pod)
	}

	ports, err := fw.GetPorts()
	if err != nil || len(ports) == 0 {
		close(stop)
		return 0, nil, fmt.Errorf("port-forward produced no local port")
	}
	return int(ports[0].Local), stop, nil
}
