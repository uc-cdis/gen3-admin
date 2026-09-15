package argocd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"
)

// fakeTransport records requests and replays canned responses.
type fakeTransport struct {
	responses []fakeResponse
	calls     []fakeCall
}

type fakeResponse struct {
	status int
	body   string
	err    error
}

type fakeCall struct {
	method  string
	url     string
	query   url.Values
	body    []byte
	headers map[string]string
}

func (f *fakeTransport) Do(
	_ context.Context,
	method, rawURL string,
	query url.Values,
	body []byte,
	headers map[string]string,
) (int, []byte, error) {
	f.calls = append(f.calls, fakeCall{method: method, url: rawURL, query: query, body: body, headers: headers})
	if len(f.responses) == 0 {
		return http.StatusOK, []byte("{}"), nil
	}
	next := f.responses[0]
	f.responses = f.responses[1:]
	return next.status, []byte(next.body), next.err
}

type staticCreds struct{ creds Credentials }

func (s staticCreds) Resolve(context.Context) (Credentials, error) { return s.creds, nil }

func TestClientUsesPreIssuedTokenWithoutLogin(t *testing.T) {
	transport := &fakeTransport{responses: []fakeResponse{
		{status: 200, body: `{"items":[]}`},
	}}
	client := NewClient(transport, "http://argocd-server.argocd.svc", staticCreds{Credentials{Token: "preissued"}})

	if _, err := client.ListApplications(context.Background(), ListOptions{}); err != nil {
		t.Fatalf("ListApplications: %v", err)
	}

	if len(transport.calls) != 1 {
		t.Fatalf("expected 1 call (no login exchange), got %d", len(transport.calls))
	}
	// The agent strips Authorization, so the upstream credential must travel as
	// X-Proxy-Authorization instead.
	if got := transport.calls[0].headers["X-Proxy-Authorization"]; got != "Bearer preissued" {
		t.Errorf("X-Proxy-Authorization = %q, want %q", got, "Bearer preissued")
	}
	if _, present := transport.calls[0].headers["Authorization"]; present {
		t.Error("Authorization header must not be set; the agent strips it")
	}
}

func TestClientLogsInWithUsernamePassword(t *testing.T) {
	transport := &fakeTransport{responses: []fakeResponse{
		{status: 200, body: `{"token":"session-token"}`}, // login
		{status: 200, body: `{"items":[]}`},              // list
	}}
	client := NewClient(transport, "http://argo", staticCreds{Credentials{Username: "admin", Password: "pw"}})

	if _, err := client.ListApplications(context.Background(), ListOptions{}); err != nil {
		t.Fatalf("ListApplications: %v", err)
	}

	if len(transport.calls) != 2 {
		t.Fatalf("expected login + list, got %d calls", len(transport.calls))
	}
	if transport.calls[0].url != "http://argo/api/v1/session" {
		t.Errorf("first call = %q, want the session endpoint", transport.calls[0].url)
	}
	// The login body must actually be sent -- this is the case the broken agent
	// transport silently dropped.
	var sent SessionRequest
	if err := json.Unmarshal(transport.calls[0].body, &sent); err != nil {
		t.Fatalf("login body not valid JSON: %v", err)
	}
	if sent.Username != "admin" || sent.Password != "pw" {
		t.Errorf("login body = %+v, want admin/pw", sent)
	}
}

func TestClientDetectsAgentDroppingBody(t *testing.T) {
	// A 200 with no token means ArgoCD saw an empty request body, which is the
	// signature of an agent too old to forward bodies. It must be reported as
	// such rather than as a credentials problem.
	transport := &fakeTransport{responses: []fakeResponse{
		{status: 200, body: `{}`},
	}}
	client := NewClient(transport, "http://argo", staticCreds{Credentials{Username: "admin", Password: "pw"}})

	_, err := client.ListApplications(context.Background(), ListOptions{})
	if err == nil {
		t.Fatal("expected an error")
	}
	if got := AsError(err).Kind; got != KindAgentTooOld {
		t.Errorf("Kind = %q, want %q", got, KindAgentTooOld)
	}
}

func TestClientRetriesOnceOn401(t *testing.T) {
	transport := &fakeTransport{responses: []fakeResponse{
		{status: 200, body: `{"token":"first"}`},  // initial login
		{status: 401, body: `{"message":"expired"}`}, // list rejected
		{status: 200, body: `{"token":"second"}`}, // re-login
		{status: 200, body: `{"items":[]}`},       // list succeeds
	}}
	client := NewClient(transport, "http://argo", staticCreds{Credentials{Username: "admin", Password: "pw"}})

	if _, err := client.ListApplications(context.Background(), ListOptions{}); err != nil {
		t.Fatalf("expected retry to succeed, got %v", err)
	}
	if len(transport.calls) != 4 {
		t.Errorf("expected 4 calls (login, 401, re-login, ok), got %d", len(transport.calls))
	}
}

func TestClientDoesNotRetryForever(t *testing.T) {
	transport := &fakeTransport{responses: []fakeResponse{
		{status: 200, body: `{"token":"t"}`},
		{status: 401, body: `{}`},
		{status: 200, body: `{"token":"t"}`},
		{status: 401, body: `{}`},
	}}
	client := NewClient(transport, "http://argo", staticCreds{Credentials{Username: "admin", Password: "pw"}})

	_, err := client.ListApplications(context.Background(), ListOptions{})
	if err == nil {
		t.Fatal("expected failure after one retry")
	}
	if got := AsError(err).Kind; got != KindUnauthorized {
		t.Errorf("Kind = %q, want %q", got, KindUnauthorized)
	}
}

func TestClassifyTransportError(t *testing.T) {
	cases := []struct {
		name   string
		status int
		err    error
		want   ErrorKind
	}{
		{"dns failure means not installed", 0, fmt.Errorf(`dial tcp: lookup argocd-server.argocd.svc: no such host`), KindNotInstalled},
		{"connection refused means unreachable", 0, fmt.Errorf("connection refused"), KindUnreachable},
		{"timeout means unreachable", 0, fmt.Errorf("context deadline exceeded"), KindUnreachable},
		{"missing agent means unreachable", 0, fmt.Errorf("agent not found: local"), KindUnreachable},
		{"ssrf rejection means unreachable", http.StatusForbidden, fmt.Errorf(`target host "x" is not cluster-internal`), KindUnreachable},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyTransportError(tc.status, nil, tc.err)
			if got.Kind != tc.want {
				t.Errorf("Kind = %q, want %q", got.Kind, tc.want)
			}
		})
	}
}

func TestErrorHTTPStatusAndPayload(t *testing.T) {
	// Availability problems are 503 and mark argocdAvailable=false, which is what
	// drives the UI into degraded mode rather than showing a hard error.
	notInstalled := newError(KindNotInstalled, 0, "absent", nil)
	if got := notInstalled.HTTPStatus(); got != http.StatusServiceUnavailable {
		t.Errorf("HTTPStatus = %d, want 503", got)
	}
	if available := notInstalled.Payload()["argocdAvailable"]; available != false {
		t.Errorf("argocdAvailable = %v, want false", available)
	}
	if reason := notInstalled.Payload()["reason"]; reason != "not_installed" {
		t.Errorf("reason = %v, want not_installed", reason)
	}

	// A missing application is a genuine 404 and does not mean ArgoCD is down.
	notFound := newError(KindNotFound, 404, "no such app", nil)
	if got := notFound.HTTPStatus(); got != http.StatusNotFound {
		t.Errorf("HTTPStatus = %d, want 404", got)
	}
	if available := notFound.Payload()["argocdAvailable"]; available != true {
		t.Errorf("argocdAvailable = %v, want true", available)
	}
}

func TestTokenExpiryParsesJWT(t *testing.T) {
	exp := time.Now().Add(2 * time.Hour).Unix()
	claims := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"exp":%d}`, exp)))
	token := "header." + claims + ".signature"

	got := tokenExpiry(token)
	if got.Unix() != exp {
		t.Errorf("tokenExpiry = %v, want unix %d", got, exp)
	}
}

func TestTokenExpiryFallsBackForOpaqueTokens(t *testing.T) {
	// Project tokens are not always JWTs; a conservative default beats failing.
	got := tokenExpiry("not-a-jwt")
	if time.Until(got) < time.Hour {
		t.Errorf("expected a far-future fallback expiry, got %v", got)
	}
}

func TestPrimarySourceHandlesBothForms(t *testing.T) {
	single := ApplicationSpec{Source: &ApplicationSource{RepoURL: "r", TargetRevision: "main", Path: "p"}}
	if got := single.PrimarySource(); got.RepoURL != "r" || got.TargetRevision != "main" || got.Path != "p" {
		t.Errorf("single-source lost fields: %+v", got)
	}
	if single.IsMultiSource() {
		t.Error("single source reported as multi-source")
	}

	multi := ApplicationSpec{Sources: []ApplicationSource{
		{RepoURL: "a", TargetRevision: "v1"},
		{RepoURL: "b"},
	}}
	if got := multi.PrimarySource(); got.RepoURL != "a" || got.TargetRevision != "v1" {
		t.Errorf("multi-source primary wrong: %+v", got)
	}
	if !multi.IsMultiSource() {
		t.Error("two sources should report multi-source")
	}

	// Neither form present must not panic.
	if got := (ApplicationSpec{}).PrimarySource(); got.RepoURL != "" {
		t.Errorf("empty spec = %+v, want zero value", got)
	}
}

func TestApplicationOwnershipHelpers(t *testing.T) {
	generated := Application{Metadata: ObjectMeta{
		OwnerReferences: []OwnerReference{{Kind: "ApplicationSet", Name: "gen"}},
	}}
	if !generated.OwnedByApplicationSet() {
		t.Error("expected ApplicationSet ownership to be detected")
	}

	plain := Application{Metadata: ObjectMeta{
		OwnerReferences: []OwnerReference{{Kind: "Something", Name: "x"}},
	}}
	if plain.OwnedByApplicationSet() {
		t.Error("non-ApplicationSet owner misreported")
	}

	auto := Application{Spec: ApplicationSpec{
		SyncPolicy: &SyncPolicy{Automated: &SyncPolicyAutomated{Prune: true}},
	}}
	if !auto.HasAutomatedSync() {
		t.Error("expected automated sync to be detected")
	}
	if (Application{}).HasAutomatedSync() {
		t.Error("empty app should not report automated sync")
	}
}

func TestServiceBaseURLPrefersPlaintextPort(t *testing.T) {
	// Preferring http avoids ArgoCD's self-signed certificate entirely.
	both := []byte(`{"spec":{"ports":[{"name":"https","port":443},{"name":"http","port":80}]}}`)
	if got := serviceBaseURL(both, "argocd"); got != "http://argocd-server.argocd.svc" {
		t.Errorf("got %q, want the http URL", got)
	}

	httpsOnly := []byte(`{"spec":{"ports":[{"name":"https","port":443}]}}`)
	if got := serviceBaseURL(httpsOnly, "argocd"); got != "https://argocd-server.argocd.svc" {
		t.Errorf("got %q, want the https URL", got)
	}

	nonStandard := []byte(`{"spec":{"ports":[{"name":"http","port":8080}]}}`)
	if got := serviceBaseURL(nonStandard, "argocd"); got != "http://argocd-server.argocd.svc:8080" {
		t.Errorf("got %q, want an explicit port", got)
	}

	if got := serviceBaseURL([]byte(`{"spec":{"ports":[]}}`), "argocd"); got != "" {
		t.Errorf("got %q, want empty for a service with no ports", got)
	}
}

func TestEnvSuffixNormalisesAgentNames(t *testing.T) {
	if got := envSuffix("my-cluster"); got != "MY_CLUSTER" {
		t.Errorf("envSuffix = %q, want MY_CLUSTER", got)
	}
	if got := envSuffix("prod.eks.1"); got != "PROD_EKS_1" {
		t.Errorf("envSuffix = %q, want PROD_EKS_1", got)
	}
}
