package config

import "testing"

func TestValidateKeycloak(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		realm   string
		wantErr bool
	}{
		{name: "valid https", url: "https://keycloak.example.com", realm: "gen3", wantErr: false},
		{name: "valid http with port", url: "http://keycloak.local:8080", realm: "gen3", wantErr: false},
		{name: "missing url", url: "", realm: "gen3", wantErr: true},
		{name: "missing realm", url: "https://keycloak.example.com", realm: "", wantErr: true},
		{name: "whitespace-only realm", url: "https://keycloak.example.com", realm: "   ", wantErr: true},
		// A trailing slash yields "https://host//realms/gen3", which never matches
		// the issuer in a real token.
		{name: "trailing slash rejected", url: "https://keycloak.example.com/", realm: "gen3", wantErr: true},
		{name: "missing scheme", url: "keycloak.example.com", realm: "gen3", wantErr: true},
		{name: "unsupported scheme", url: "ftp://keycloak.example.com", realm: "gen3", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("KEYCLOAK_URL", tc.url)
			t.Setenv("KEYCLOAK_REALM", tc.realm)

			err := validateKeycloak()
			if (err != nil) != tc.wantErr {
				t.Errorf("validateKeycloak(url=%q, realm=%q) error = %v, wantErr = %v",
					tc.url, tc.realm, err, tc.wantErr)
			}
		})
	}
}

func TestValidateCORSOrigins(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "empty is allowed", value: "", wantErr: false},
		{name: "single origin", value: "https://csoc.example.com", wantErr: false},
		{name: "multiple origins", value: "https://a.example.com,https://b.example.com", wantErr: false},
		{name: "tolerates whitespace", value: " https://a.example.com , https://b.example.com ", wantErr: false},
		{name: "trailing slash origin is accepted", value: "https://a.example.com/", wantErr: false},
		// Credentials are enabled, so a wildcard would be rejected by the browser
		// anyway; failing at startup is clearer than failing per request.
		{name: "wildcard rejected", value: "*", wantErr: true},
		{name: "missing scheme rejected", value: "csoc.example.com", wantErr: true},
		{name: "path not allowed", value: "https://csoc.example.com/app", wantErr: true},
		{name: "one bad entry fails the whole list", value: "https://ok.example.com,*", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CORS_ALLOWED_ORIGINS", tc.value)

			err := validateCORSOrigins()
			if (err != nil) != tc.wantErr {
				t.Errorf("validateCORSOrigins(%q) error = %v, wantErr = %v", tc.value, err, tc.wantErr)
			}
		})
	}
}

func TestValidateSkipsKeycloakUnderMockAuth(t *testing.T) {
	// Local and workshop setups run with MOCK_AUTH and no Keycloak configured;
	// startup must not fail for them.
	t.Setenv("MOCK_AUTH", "true")
	t.Setenv("KEYCLOAK_URL", "")
	t.Setenv("KEYCLOAK_REALM", "")
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	if err := Validate(); err != nil {
		t.Errorf("Validate() with MOCK_AUTH=true returned error = %v, want nil", err)
	}
}

func TestValidateRequiresKeycloakWithoutMockAuth(t *testing.T) {
	t.Setenv("MOCK_AUTH", "false")
	t.Setenv("KEYCLOAK_URL", "")
	t.Setenv("KEYCLOAK_REALM", "")

	if err := Validate(); err == nil {
		t.Error("Validate() without MOCK_AUTH and without Keycloak config returned nil, want error")
	}
}
