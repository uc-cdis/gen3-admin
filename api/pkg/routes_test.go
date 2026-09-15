package routes

import (
	"net/http"
	"testing"
)

func TestValidInstanceID(t *testing.T) {
	valid := []string{
		"i-1234567a",
		"i-0abcdef1234567890",
	}
	for _, id := range valid {
		if !validInstanceID.MatchString(id) {
			t.Errorf("validInstanceID.MatchString(%q) = false, want true", id)
		}
	}

	invalid := []string{
		"",
		"i-",
		"i-XYZ",              // non-hex
		"i-1234567",          // too short
		"1234567890",         // missing prefix
		"i-1234567a; rm -rf", // injection attempt
		"../../etc/passwd",
		"i-1234567a1234567890", // too long
	}
	for _, id := range invalid {
		if validInstanceID.MatchString(id) {
			t.Errorf("validInstanceID.MatchString(%q) = true, want false", id)
		}
	}
}

func TestCheckWebSocketOrigin(t *testing.T) {
	tests := []struct {
		name           string
		origin         string
		host           string
		allowedOrigins string
		want           bool
	}{
		{
			name:   "no origin header (non-browser client) is allowed",
			origin: "",
			host:   "csoc.example.com",
			want:   true,
		},
		{
			name:   "same-origin is allowed without configuration",
			origin: "https://csoc.example.com",
			host:   "csoc.example.com",
			want:   true,
		},
		{
			// The cross-origin hijacking case: an attacker page cannot open a
			// socket using the victim's cookie.
			name:   "cross-origin is rejected when not allowlisted",
			origin: "https://evil.example.com",
			host:   "csoc.example.com",
			want:   false,
		},
		{
			name:           "cross-origin is allowed when explicitly allowlisted",
			origin:         "https://console.example.com",
			host:           "csoc.example.com",
			allowedOrigins: "https://console.example.com",
			want:           true,
		},
		{
			name:           "allowlist tolerates surrounding whitespace",
			origin:         "https://console.example.com",
			host:           "csoc.example.com",
			allowedOrigins: "https://a.example.com , https://console.example.com",
			want:           true,
		},
		{
			name:           "origin not in a populated allowlist is rejected",
			origin:         "https://evil.example.com",
			host:           "csoc.example.com",
			allowedOrigins: "https://console.example.com",
			want:           false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CORS_ALLOWED_ORIGINS", tc.allowedOrigins)

			req := &http.Request{
				Host:   tc.host,
				Header: http.Header{},
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}

			if got := checkWebSocketOrigin(req); got != tc.want {
				t.Errorf("checkWebSocketOrigin(origin=%q, host=%q) = %v, want %v",
					tc.origin, tc.host, got, tc.want)
			}
		})
	}
}
