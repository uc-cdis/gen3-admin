package aws

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func post(t *testing.T, h gin.HandlerFunc, body any) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/x", h)
	b, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/x", bytes.NewReader(b)))
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestLoadConfigRejectsBadInput(t *testing.T) {
	ctx := context.Background()
	cases := map[string]Target{
		"region with shell":  {Region: "us-east-1;id"},
		"profile with shell": {Profile: "dev$(id)"},
		"key without secret": {Credentials: &Credentials{AccessKeyID: "AKIA"}},
	}
	for name, target := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := loadConfig(ctx, target); err == nil {
				t.Errorf("loadConfig(%+v) succeeded, want an error", target)
			}
		})
	}
}

func TestExplicitCredentialsAreUsedAsGiven(t *testing.T) {
	// The identity check must run as the credentials the operator typed, not
	// the server's own.
	cfg, err := loadConfig(context.Background(), Target{
		Region:      "us-west-2",
		Credentials: &Credentials{AccessKeyID: "AKIAEXAMPLE", SecretAccessKey: "secret", SessionToken: "tok"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := cfg.Credentials.Retrieve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessKeyID != "AKIAEXAMPLE" || got.SessionToken != "tok" || cfg.Region != "us-west-2" {
		t.Errorf("config = %+v region %q, want the supplied keys and region", got, cfg.Region)
	}
}

func TestHostedZoneRejectsInvalidDomain(t *testing.T) {
	for _, d := range []string{"", "localhost", "a b.com", "evil.com;id", "-x.example.org"} {
		if code, _ := post(t, HostedZoneHandler, map[string]string{"domain": d}); code != http.StatusBadRequest {
			t.Errorf("domain %q: status %d, want 400", d, code)
		}
	}
}
