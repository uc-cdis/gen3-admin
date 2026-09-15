package argocd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// Credentials for the ArgoCD API. Either a pre-issued Token, or a
// username/password pair to exchange for a session token.
type Credentials struct {
	Token    string
	Username string
	Password string
}

type CredentialResolver interface {
	Resolve(ctx context.Context) (Credentials, error)
}

// KubeReader reads a Kubernetes resource, used to fetch the initial admin secret
// through whichever path can reach the target cluster.
type KubeReader interface {
	Get(ctx context.Context, path string) ([]byte, error)
}

// envCredentials resolves credentials from the environment, preferring per-agent
// overrides so a multi-cluster deployment can hold distinct credentials.
//
// Precedence, highest first:
//  1. ARGOCD_AUTH_TOKEN_<AGENT> / ARGOCD_AUTH_TOKEN
//  2. ARGOCD_USERNAME_<AGENT>+ARGOCD_PASSWORD_<AGENT> / ARGOCD_USERNAME+ARGOCD_PASSWORD
//  3. the argocd-initial-admin-secret in the cluster
//
// The env paths are the recommended production configuration: they work with a
// dedicated ArgoCD local account or project token, and they keep working after the
// initial admin secret is deleted (which ArgoCD's own docs recommend).
type defaultCredentialResolver struct {
	agentName string
	namespace string
	kube      KubeReader
}

func NewCredentialResolver(agentName, namespace string, kube KubeReader) CredentialResolver {
	return &defaultCredentialResolver{agentName: agentName, namespace: namespace, kube: kube}
}

// envSuffix normalises an agent name for use in an env var, e.g. "my-cluster" ->
// "MY_CLUSTER".
func envSuffix(agentName string) string {
	upper := strings.ToUpper(agentName)
	return strings.Map(func(r rune) rune {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return '_'
	}, upper)
}

func (r *defaultCredentialResolver) Resolve(ctx context.Context) (Credentials, error) {
	suffix := envSuffix(r.agentName)

	if token := firstNonEmpty(
		os.Getenv("ARGOCD_AUTH_TOKEN_"+suffix),
		os.Getenv("ARGOCD_AUTH_TOKEN"),
	); token != "" {
		return Credentials{Token: token}, nil
	}

	username := firstNonEmpty(os.Getenv("ARGOCD_USERNAME_"+suffix), os.Getenv("ARGOCD_USERNAME"))
	password := firstNonEmpty(os.Getenv("ARGOCD_PASSWORD_"+suffix), os.Getenv("ARGOCD_PASSWORD"))
	if username != "" && password != "" {
		return Credentials{Username: username, Password: password}, nil
	}

	// Fall back to the bootstrap secret so a freshly-installed ArgoCD works with
	// no configuration.
	if r.kube == nil {
		return Credentials{}, newError(KindUnauthorized, 0,
			"no ArgoCD credentials configured and no way to read argocd-initial-admin-secret", nil)
	}

	ns := r.namespace
	if ns == "" {
		ns = "argocd"
	}

	raw, err := r.kube.Get(ctx, fmt.Sprintf(
		"/api/v1/namespaces/%s/secrets/argocd-initial-admin-secret", url.PathEscape(ns)))
	if err != nil {
		return Credentials{}, newError(KindUnauthorized, 0,
			"could not read argocd-initial-admin-secret; set ARGOCD_AUTH_TOKEN or "+
				"ARGOCD_USERNAME/ARGOCD_PASSWORD instead", err)
	}

	var secret struct {
		Data map[string]string `json:"data"`
	}
	if err := json.Unmarshal(raw, &secret); err != nil {
		return Credentials{}, newError(KindUpstream, 0, "failed to decode argocd-initial-admin-secret", err)
	}

	encoded, ok := secret.Data["password"]
	if !ok || encoded == "" {
		return Credentials{}, newError(KindUnauthorized, http.StatusNotFound,
			"argocd-initial-admin-secret has no password field; it may have been rotated or deleted", nil)
	}

	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return Credentials{}, newError(KindUpstream, 0, "failed to base64-decode admin password", err)
	}

	return Credentials{Username: "admin", Password: string(decoded)}, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// ResolveServerURL determines the ArgoCD API base URL for a cluster.
//
// Prefers the plaintext http port so we sidestep ArgoCD's self-signed
// certificate; the hop is inside the cluster either way.
func ResolveServerURL(ctx context.Context, agentName, namespace string, kube KubeReader) string {
	suffix := envSuffix(agentName)
	if override := firstNonEmpty(
		os.Getenv("ARGOCD_SERVER_URL_"+suffix),
		os.Getenv("ARGOCD_SERVER_URL"),
	); override != "" {
		trimmed := strings.TrimRight(override, "/")
		// A loopback override is a developer port-forward. Those die with the
		// terminal that started them, and a stale one is worse than no override:
		// it masks the Service lookup below, which the agent can satisfy on its
		// own. Only skip it when nothing is actually listening -- an explicit,
		// working override still wins.
		if isDeadLoopback(trimmed) {
			log.Warn().Str("url", trimmed).
				Msg("ignoring ARGOCD_SERVER_URL: nothing listening on that loopback port")
		} else {
			return trimmed
		}
	}

	ns := namespace
	if ns == "" {
		ns = "argocd"
	}

	insecure := serverRunsInsecure(ctx, ns, kube)

	if kube != nil {
		if raw, err := kube.Get(ctx, fmt.Sprintf(
			"/api/v1/namespaces/%s/services/argocd-server", url.PathEscape(ns))); err == nil {
			if base := serviceBaseURL(raw, ns, insecure); base != "" {
				return base
			}
		}
	}

	if insecure {
		return fmt.Sprintf("http://argocd-server.%s.svc", ns)
	}

	// Same reasoning as serviceBaseURL: https is the port that serves the API.
	return fmt.Sprintf("https://argocd-server.%s.svc", ns)
}

// serviceBaseURL picks a base URL from the argocd-server Service definition.
func serviceBaseURL(raw []byte, namespace string, insecure bool) string {
	var svc struct {
		Spec struct {
			Ports []struct {
				Name string `json:"name"`
				Port int    `json:"port"`
			} `json:"ports"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(raw, &svc); err != nil {
		return ""
	}

	host := fmt.Sprintf("argocd-server.%s.svc", namespace)

	// Which port actually serves the API depends on how argocd-server was
	// started, and it differs between real clusters:
	//
	//   without --insecure  port 80 answers 307 to the https URL; 443 serves TLS
	//   with    --insecure  port 80 serves the API; 443 resets, because both
	//                       Service ports target the same plaintext container
	//                       port and nothing terminates TLS
	//
	// So neither port is right everywhere, and picking one breaks the other
	// kind of cluster. insecure is passed by the caller after inspecting the
	// Deployment.
	if insecure {
		for _, p := range svc.Spec.Ports {
			if p.Name == "http" || p.Port == 80 {
				if p.Port == 80 {
					return fmt.Sprintf("http://%s", host)
				}
				return fmt.Sprintf("http://%s:%d", host, p.Port)
			}
		}
	}

	for _, p := range svc.Spec.Ports {
		if p.Name == "https" || p.Port == 443 {
			if p.Port == 443 {
				return fmt.Sprintf("https://%s", host)
			}
			return fmt.Sprintf("https://%s:%d", host, p.Port)
		}
	}
	for _, p := range svc.Spec.Ports {
		if p.Name == "http" || p.Port == 80 {
			if p.Port == 80 {
				return fmt.Sprintf("http://%s", host)
			}
			return fmt.Sprintf("http://%s:%d", host, p.Port)
		}
	}
	if len(svc.Spec.Ports) > 0 {
		scheme := "https"
		if insecure {
			scheme = "http"
		}
		return fmt.Sprintf("%s://%s:%d", scheme, host, svc.Spec.Ports[0].Port)
	}
	return ""
}

// serverRunsInsecure reports whether argocd-server was started with --insecure,
// in which case it serves plaintext only.
//
// The Deployment args are authoritative: devplanetv2 has server.insecure=false
// in argocd-cmd-params-cm while the Deployment passes --insecure, and the flag
// is what the process actually honours.
func serverRunsInsecure(ctx context.Context, namespace string, kube KubeReader) bool {
	if kube == nil {
		return false
	}
	raw, err := kube.Get(ctx, fmt.Sprintf(
		"/apis/apps/v1/namespaces/%s/deployments/argocd-server", url.PathEscape(namespace)))
	if err != nil {
		return false
	}

	var dep struct {
		Spec struct {
			Template struct {
				Spec struct {
					Containers []struct {
						Name    string   `json:"name"`
						Command []string `json:"command"`
						Args    []string `json:"args"`
					} `json:"containers"`
				} `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(raw, &dep); err != nil {
		return false
	}

	for _, c := range dep.Spec.Template.Spec.Containers {
		if c.Name != "argocd-server" && c.Name != "server" {
			continue
		}
		for _, tok := range append(append([]string{}, c.Command...), c.Args...) {
			if tok == "--insecure" || tok == "--insecure=true" {
				return true
			}
		}
	}
	return false
}

// isDeadLoopback reports whether a URL points at a loopback address with nothing
// accepting connections. Used to disregard a stale developer port-forward while
// honouring one that works.
func isDeadLoopback(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host != "localhost" && host != "127.0.0.1" && host != "::1" {
		return false
	}

	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 750*time.Millisecond)
	if err != nil {
		return true
	}
	conn.Close()
	return false
}
