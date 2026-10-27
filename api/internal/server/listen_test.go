package server

import "testing"

func TestListenHostIsLoopbackUnderMockAuth(t *testing.T) {
	t.Setenv("MOCK_AUTH", "true")
	if got := listenHost(); got != "127.0.0.1" {
		t.Errorf("listenHost() = %q under MOCK_AUTH, want loopback", got)
	}
	t.Setenv("BIND_ADDRESS", "0.0.0.0")
	if got := listenHost(); got != "0.0.0.0" {
		t.Errorf("listenHost() = %q, want the BIND_ADDRESS override", got)
	}
}

func TestListenHostIsAllInterfacesWithRealAuth(t *testing.T) {
	t.Setenv("MOCK_AUTH", "false")
	if got := listenHost(); got != "" {
		t.Errorf("listenHost() = %q, want all interfaces", got)
	}
}
