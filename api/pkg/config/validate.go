package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Validate checks configuration that the server depends on at request time, so a
// misconfiguration fails at startup instead of turning into a running pod that
// rejects every request. It is intentionally permissive about optional settings:
// only values whose absence or malformation would break authentication are fatal.
func Validate() error {
	mockAuth := os.Getenv("MOCK_AUTH") == "true"

	// Keycloak settings are only consulted when real auth is enabled. Under
	// MOCK_AUTH the middleware never parses a token, so requiring them would
	// break local and workshop setups.
	if !mockAuth {
		if err := validateKeycloak(); err != nil {
			return err
		}
	}

	if err := validateCORSOrigins(); err != nil {
		return err
	}

	return nil
}

func validateKeycloak() error {
	rawURL := strings.TrimSpace(os.Getenv("KEYCLOAK_URL"))
	realm := strings.TrimSpace(os.Getenv("KEYCLOAK_REALM"))

	// Both are interpolated into the expected token issuer. If either is empty the
	// issuer degenerates to "/realms/" and no real token can ever match it.
	if rawURL == "" {
		return fmt.Errorf("KEYCLOAK_URL must be set when MOCK_AUTH is not enabled")
	}
	if realm == "" {
		return fmt.Errorf("KEYCLOAK_REALM must be set when MOCK_AUTH is not enabled")
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("KEYCLOAK_URL is not a valid URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("KEYCLOAK_URL must use http or https, got %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return fmt.Errorf("KEYCLOAK_URL must include a host, got %q", rawURL)
	}
	if strings.HasSuffix(rawURL, "/") {
		return fmt.Errorf("KEYCLOAK_URL must not end with a trailing slash (it is joined with /realms/%s)", realm)
	}

	return nil
}

func validateCORSOrigins() error {
	raw := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if raw == "" {
		return nil
	}

	for _, origin := range strings.Split(raw, ",") {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}

		if origin == "*" {
			// Credentialed requests cannot use a wildcard origin, and this server
			// authenticates via a cookie.
			return fmt.Errorf(`CORS_ALLOWED_ORIGINS cannot be "*" because credentials are enabled; list explicit origins`)
		}

		parsed, err := url.Parse(origin)
		if err != nil {
			return fmt.Errorf("CORS_ALLOWED_ORIGINS entry %q is not a valid URL: %w", origin, err)
		}
		if parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("CORS_ALLOWED_ORIGINS entry %q must be a full origin such as https://example.com", origin)
		}
		if parsed.Path != "" && parsed.Path != "/" {
			return fmt.Errorf("CORS_ALLOWED_ORIGINS entry %q must not include a path", origin)
		}
	}

	return nil
}
