package agentHelper

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"

	"github.com/rs/zerolog/log"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"

	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

// tunnelConfig returns a rest.Config suitable for both a clientset and SPDY.
//
// getClientConfig() pre-builds config.Transport, which client-go rejects when
// TLS options are also present ("using a custom transport with TLS certificate
// options or the insecure flag is not allowed"). That affects both
// kubernetes.NewForConfig and spdy.RoundTripperFor, so the tunnel builds its own
// config and leaves Transport unset, letting client-go construct it.
func tunnelConfig() (*rest.Config, error) {
	if inCluster, err := rest.InClusterConfig(); err == nil {
		return inCluster, nil
	}
	config, err := clientcmd.BuildConfigFromFlags("", Kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("building kubeconfig: %w", err)
	}
	return config, nil
}

func tunnelClientset() (*kubernetes.Clientset, error) {
	config, err := tunnelConfig()
	if err != nil {
		return nil, fmt.Errorf("client config: %w", err)
	}
	return kubernetes.NewForConfig(config)
}

// TCP tunnelling over the agent's existing gRPC connection.
//
// This is the third proxy fallback, after (1) the Kubernetes Service proxy and
// (2) a direct HTTP dial from the agent. Both of those need the caller -- or the
// API server -- to reach the pod network, which is unavailable when the agent
// runs outside a cluster using a CNI that isolates it (e.g. Cilium).
//
// Here the agent forwards through the pod's `portforward` subresource, so traffic
// goes API server -> kubelet -> pod and never touches the pod network. Because it
// carries raw bytes it also supports non-HTTP protocols such as Postgres, which
// the HTTP proxy cannot express.

// tunnelConn is one forwarded connection: bytes moving between the gRPC stream
// and an SPDY stream that the kubelet has wired to the target pod's port.
type tunnelConn struct {
	streamID string
	// remote accepts bytes destined for the pod.
	remote io.WriteCloser
	// closeOnce guards teardown, which can be triggered by either side.
	closeOnce sync.Once
	stop      func()
}

type tunnelRegistry struct {
	mu    sync.Mutex
	conns map[string]*tunnelConn
}

func newTunnelRegistry() *tunnelRegistry {
	return &tunnelRegistry{conns: make(map[string]*tunnelConn)}
}

func (r *tunnelRegistry) add(c *tunnelConn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.conns[c.streamID] = c
}

func (r *tunnelRegistry) get(streamID string) (*tunnelConn, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.conns[streamID]
	return c, ok
}

func (r *tunnelRegistry) remove(streamID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.conns, streamID)
}

// closeAll tears down every tunnel, used when the gRPC connection drops so we
// don't leak port-forwards across reconnects.
func (r *tunnelRegistry) closeAll() {
	r.mu.Lock()
	conns := make([]*tunnelConn, 0, len(r.conns))
	for _, c := range r.conns {
		conns = append(conns, c)
	}
	r.conns = make(map[string]*tunnelConn)
	r.mu.Unlock()

	for _, c := range conns {
		c.close()
	}
}

func (c *tunnelConn) close() {
	c.closeOnce.Do(func() {
		if c.remote != nil {
			c.remote.Close()
		}
		if c.stop != nil {
			c.stop()
		}
	})
}

// handleTunnelOpen establishes a port-forward and starts pumping bytes back to
// the server. It returns immediately; the forward runs in its own goroutine.
func (a *Agent) handleTunnelOpen(req *pb.TunnelOpen) {
	streamID := req.GetStreamId()

	pod, err := a.resolveTunnelPod(req)
	if err != nil {
		log.Error().Err(err).Str("stream_id", streamID).Msg("[tunnel] target resolution failed")
		a.sendTunnelOpened(streamID, "", err)
		return
	}

	log.Info().
		Str("stream_id", streamID).
		Str("namespace", req.GetNamespace()).
		Str("pod", pod).
		Int32("port", req.GetPort()).
		Msg("[tunnel] opening port-forward")

	if err := a.startPortForward(req, pod); err != nil {
		log.Error().Err(err).Str("stream_id", streamID).Msg("[tunnel] port-forward failed")
		a.sendTunnelOpened(streamID, pod, err)
		return
	}
}

// resolveTunnelPod picks the pod to forward to. An explicit pod wins; otherwise
// the Service's selector is used to find a ready backing pod.
//
// Only one pod is chosen, so this deliberately does no load balancing: for a
// stateful protocol like Postgres, spreading a session across replicas would be
// incorrect, and for a dev fallback the simplicity is worth more than balance.
func (a *Agent) resolveTunnelPod(req *pb.TunnelOpen) (string, error) {
	if req.GetPod() != "" {
		return req.GetPod(), nil
	}
	if req.GetService() == "" {
		return "", fmt.Errorf("either service or pod must be set")
	}

	ns := req.GetNamespace()
	if ns == "" {
		ns = "default"
	}

	clientset, err := tunnelClientset()
	if err != nil {
		return "", fmt.Errorf("kubernetes client: %w", err)
	}

	ctx := context.Background()
	svc, err := clientset.CoreV1().Services(ns).Get(ctx, req.GetService(), metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("get service %s/%s: %w", ns, req.GetService(), err)
	}
	if len(svc.Spec.Selector) == 0 {
		return "", fmt.Errorf("service %s/%s has no selector (headless or external?)", ns, req.GetService())
	}

	pods, err := clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{
		LabelSelector: labels.SelectorFromSet(svc.Spec.Selector).String(),
	})
	if err != nil {
		return "", fmt.Errorf("list pods for %s/%s: %w", ns, req.GetService(), err)
	}

	for _, p := range pods.Items {
		if p.Status.Phase != "Running" {
			continue
		}
		for _, cond := range p.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				return p.Name, nil
			}
		}
	}
	return "", fmt.Errorf("no ready pod backing service %s/%s", ns, req.GetService())
}

// startPortForward dials the pod's portforward subresource over SPDY and wires
// the resulting stream to the gRPC tunnel.
//
// We drive the SPDY streams directly rather than using client-go's
// portforward.PortForwarder, because that type insists on binding a local TCP
// listener. Here the "local end" is the gRPC stream, so a listener would just be
// an extra hop.
func (a *Agent) startPortForward(req *pb.TunnelOpen, pod string) error {
	streamID := req.GetStreamId()
	ns := req.GetNamespace()
	if ns == "" {
		ns = "default"
	}

	config, err := tunnelConfig()
	if err != nil {
		return fmt.Errorf("client config: %w", err)
	}
	clientset, err := tunnelClientset()
	if err != nil {
		return fmt.Errorf("kubernetes client: %w", err)
	}

	url := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(ns).
		Name(pod).
		SubResource("portforward").
		URL()

	roundTripper, upgrader, err := spdy.RoundTripperFor(config)
	if err != nil {
		return fmt.Errorf("spdy transport: %w", err)
	}

	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: roundTripper}, http.MethodPost, url)
	streamConn, _, err := dialer.Dial(portforward.PortForwardProtocolV1Name)
	if err != nil {
		return fmt.Errorf("dial portforward: %w", err)
	}

	// The kubelet requires the error stream to be created first, and both streams
	// must carry a matching requestID.
	headers := http.Header{}
	headers.Set(corev1.StreamType, corev1.StreamTypeError)
	headers.Set(corev1.PortHeader, fmt.Sprintf("%d", req.GetPort()))
	headers.Set(corev1.PortForwardRequestIDHeader, streamID)

	errorStream, err := streamConn.CreateStream(headers)
	if err != nil {
		streamConn.Close()
		return fmt.Errorf("create error stream: %w", err)
	}
	// We never write to the error stream; closing our half signals that.
	errorStream.Close()

	headers.Set(corev1.StreamType, corev1.StreamTypeData)
	dataStream, err := streamConn.CreateStream(headers)
	if err != nil {
		streamConn.Close()
		return fmt.Errorf("create data stream: %w", err)
	}

	conn := &tunnelConn{
		streamID: streamID,
		remote:   dataStream,
		stop:     func() { streamConn.Close() },
	}
	a.tunnels.add(conn)

	a.sendTunnelOpened(streamID, pod, nil)

	// Surface kubelet-reported errors (e.g. "port not open") rather than showing
	// the caller a bare EOF.
	go func() {
		message, err := io.ReadAll(errorStream)
		if err == nil && len(message) > 0 {
			log.Error().Str("stream_id", streamID).Msgf("[tunnel] %s", string(message))
			a.closeTunnel(streamID, fmt.Errorf("%s", string(message)))
		}
	}()

	// pod -> server.
	//
	// This direction owns teardown: when the pod closes its side, the exchange is
	// genuinely over. The server deliberately does not tear down on its own read
	// EOF, since an HTTP client half-closes after sending its request.
	go func() {
		defer a.closeTunnel(streamID, nil)
		buf := make([]byte, 32*1024)
		for {
			n, err := dataStream.Read(buf)
			if n > 0 {
				if sendErr := a.sendMessage(&pb.AgentMessage{
					Message: &pb.AgentMessage_TunnelData{
						TunnelData: &pb.TunnelData{
							StreamId: streamID,
							Data:     append([]byte(nil), buf[:n]...),
						},
					},
				}); sendErr != nil {
					log.Warn().Err(sendErr).Str("stream_id", streamID).Msg("[tunnel] send failed")
					return
				}
			}
			if err != nil {
				if err != io.EOF {
					log.Debug().Err(err).Str("stream_id", streamID).Msg("[tunnel] read ended")
				}
				return
			}
		}
	}()

	return nil
}

// handleTunnelData writes server-sent bytes to the forwarded port.
func (a *Agent) handleTunnelData(msg *pb.TunnelData) {
	conn, ok := a.tunnels.get(msg.GetStreamId())
	if !ok {
		log.Debug().Str("stream_id", msg.GetStreamId()).Msg("[tunnel] data for unknown stream")
		return
	}
	if _, err := conn.remote.Write(msg.GetData()); err != nil {
		log.Warn().Err(err).Str("stream_id", msg.GetStreamId()).Msg("[tunnel] write failed")
		a.closeTunnel(msg.GetStreamId(), err)
	}
}

// handleTunnelClose tears down a tunnel the server no longer wants.
func (a *Agent) handleTunnelClose(msg *pb.TunnelClose) {
	if conn, ok := a.tunnels.get(msg.GetStreamId()); ok {
		conn.close()
		a.tunnels.remove(msg.GetStreamId())
	}
}

// closeTunnel tears down locally and tells the server, so the caller's socket
// closes instead of hanging.
func (a *Agent) closeTunnel(streamID string, cause error) {
	conn, ok := a.tunnels.get(streamID)
	if !ok {
		return
	}
	conn.close()
	a.tunnels.remove(streamID)

	errText := ""
	if cause != nil {
		errText = cause.Error()
	}
	if err := a.sendMessage(&pb.AgentMessage{
		Message: &pb.AgentMessage_TunnelClose{
			TunnelClose: &pb.TunnelClose{StreamId: streamID, Error: errText},
		},
	}); err != nil {
		log.Debug().Err(err).Str("stream_id", streamID).Msg("[tunnel] close notify failed")
	}
}

func (a *Agent) sendTunnelOpened(streamID, pod string, cause error) {
	errText := ""
	if cause != nil {
		errText = cause.Error()
	}
	if err := a.sendMessage(&pb.AgentMessage{
		Message: &pb.AgentMessage_TunnelOpened{
			TunnelOpened: &pb.TunnelOpened{StreamId: streamID, Pod: pod, Error: errText},
		},
	}); err != nil {
		log.Warn().Err(err).Str("stream_id", streamID).Msg("[tunnel] ack failed")
	}
}
