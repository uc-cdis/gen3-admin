package server

import (
	"testing"

	"github.com/gin-contrib/cors"
)

// corsConfig must produce a config that cors.New accepts. A config permitting
// no origins at all makes cors.New panic with "conflict settings: all origins
// disabled", which killed the API at startup whenever CORS_ALLOWED_ORIGINS was
// unset -- a crash loop rather than a degraded-but-running service.
func TestCorsConfigNeverPanicsWithoutOrigins(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	cfg := corsConfig()

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("cors.New panicked on the unset-origins config: %v", r)
		}
	}()
	_ = cors.New(cfg)
}

// With no origins configured, every cross-origin request must still be refused.
func TestCorsConfigRejectsAllOriginsWhenUnset(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	cfg := corsConfig()

	if len(cfg.AllowOrigins) != 0 {
		t.Errorf("AllowOrigins = %v, want empty", cfg.AllowOrigins)
	}
	if cfg.AllowOriginFunc == nil {
		t.Fatal("AllowOriginFunc is nil; cors.New will panic on an empty allowlist")
	}
	for _, origin := range []string{
		"https://admin.planx-pla.net",
		"https://evil.example",
		"http://localhost:3000",
		"",
	} {
		if cfg.AllowOriginFunc(origin) {
			t.Errorf("AllowOriginFunc(%q) = true, want false", origin)
		}
	}
}

func TestCorsConfigUsesConfiguredOrigins(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://admin.planx-pla.net, https://other.example ,")

	cfg := corsConfig()

	want := []string{"https://admin.planx-pla.net", "https://other.example"}
	if len(cfg.AllowOrigins) != len(want) {
		t.Fatalf("AllowOrigins = %v, want %v", cfg.AllowOrigins, want)
	}
	for i, w := range want {
		if cfg.AllowOrigins[i] != w {
			t.Errorf("AllowOrigins[%d] = %q, want %q", i, cfg.AllowOrigins[i], w)
		}
	}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("cors.New panicked on a configured-origins config: %v", r)
		}
	}()
	_ = cors.New(cfg)
}

// Credentials require an explicit origin list; the CORS spec forbids pairing
// them with a wildcard, and cors.New enforces that.
func TestCorsConfigAllowsCredentials(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://admin.planx-pla.net")

	if cfg := corsConfig(); !cfg.AllowCredentials {
		t.Error("AllowCredentials = false; the keycloak-access-token cookie will not be sent")
	}
}
