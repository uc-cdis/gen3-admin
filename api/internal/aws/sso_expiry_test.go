package aws

import (
	"crypto/sha1" //nolint:gosec
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSSOSessionExpiryFollowsSourceProfile(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config")
	_ = os.WriteFile(cfg, []byte(`[default]
sso_session = corp
region = us-east-1

[profile workshop]
role_arn = arn:aws:iam::123456789012:role/admin
source_profile = default

[profile keys]
region = us-east-1

[sso-session corp]
sso_start_url = https://corp.awsapps.com/start
`), 0o600)
	t.Setenv("AWS_CONFIG_FILE", cfg)
	sum := sha1.Sum([]byte("corp")) //nolint:gosec
	_ = os.MkdirAll(filepath.Join(dir, "sso", "cache"), 0o700)
	_ = os.WriteFile(filepath.Join(dir, "sso", "cache", hex.EncodeToString(sum[:])+".json"),
		[]byte(`{"accessToken":"x","expiresAt":"2030-01-02T03:04:05Z"}`), 0o600)

	got, ok := ssoSessionExpiry("workshop")
	if !ok || !got.Equal(time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)) {
		t.Errorf("expiry = %v, %v", got, ok)
	}
	if _, ok := ssoSessionExpiry("keys"); ok {
		t.Error("a profile without SSO reported an expiry")
	}
	// A renewable sign-in has no end to warn about.
	_ = os.WriteFile(filepath.Join(dir, "sso", "cache", hex.EncodeToString(sum[:])+".json"),
		[]byte(`{"accessToken":"x","refreshToken":"r","expiresAt":"2030-01-02T03:04:05Z"}`), 0o600)
	if _, ok := ssoSessionExpiry("workshop"); ok {
		t.Error("a refreshable session reported an expiry")
	}
}
