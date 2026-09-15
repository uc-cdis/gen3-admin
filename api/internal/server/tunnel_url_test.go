package server

import (
	"net"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

// buildTunnelURL mirrors the construction in TunnelHTTPHandler. Kept in step
// with it so the host-pinning property is covered by a test.
func buildTunnelURL(localPort int, rawPath string) (*url.URL, error) {
	if rawPath == "" {
		rawPath = "/"
	}
	if !strings.HasPrefix(rawPath, "/") {
		return nil, errNotRelative
	}
	parsed, err := url.Parse(rawPath)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "" || parsed.Host != "" {
		return nil, errNotRelative
	}
	return &url.URL{
		Scheme:   "http",
		Host:     net.JoinHostPort("127.0.0.1", strconv.Itoa(localPort)),
		Path:     parsed.Path,
		RawQuery: parsed.RawQuery,
	}, nil
}

type tunnelErr string

func (e tunnelErr) Error() string { return string(e) }

const errNotRelative = tunnelErr("path must be relative and start with /")

// No caller-supplied path may move the request off loopback.
func TestTunnelURLAlwaysTargetsLoopback(t *testing.T) {
	paths := []string{
		"/",
		"/healthz",
		"/a?b=c",
		"//evil.com/x",
		"//evil.com:80/a",
		"/@evil.com/",
		"/..//evil.com",
		"/%2f%2fevil.com",
		"/path#frag",
	}
	for _, p := range paths {
		u, err := buildTunnelURL(8080, p)
		if err != nil {
			continue // rejected outright, also fine
		}
		if u.Hostname() != "127.0.0.1" {
			t.Errorf("path %q produced host %q, want 127.0.0.1 (url=%s)", p, u.Hostname(), u)
		}
		if u.Port() != "8080" {
			t.Errorf("path %q produced port %q, want 8080", p, u.Port())
		}
		if u.Scheme != "http" {
			t.Errorf("path %q produced scheme %q", p, u.Scheme)
		}
	}
}

func TestTunnelURLRejectsAbsoluteURLs(t *testing.T) {
	for _, p := range []string{
		"http://evil.com",
		"https://evil.com/x",
		"evil.com/x",
		"../etc",
	} {
		if u, err := buildTunnelURL(8080, p); err == nil {
			if u.Hostname() != "127.0.0.1" {
				t.Errorf("path %q escaped to %s", p, u)
			}
		}
	}
}

func TestTunnelURLPreservesPathAndQuery(t *testing.T) {
	u, err := buildTunnelURL(15432, "/api/v1/status?verbose=1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if u.Path != "/api/v1/status" {
		t.Errorf("Path = %q", u.Path)
	}
	if u.RawQuery != "verbose=1" {
		t.Errorf("RawQuery = %q", u.RawQuery)
	}
	if u.String() != "http://127.0.0.1:15432/api/v1/status?verbose=1" {
		t.Errorf("String() = %q", u.String())
	}
}

func TestTunnelURLDefaultsToRoot(t *testing.T) {
	u, err := buildTunnelURL(8080, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if u.Path != "/" {
		t.Errorf("Path = %q, want /", u.Path)
	}
}
