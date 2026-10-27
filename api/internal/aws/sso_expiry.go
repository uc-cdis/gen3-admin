package aws

import (
	"bufio"
	"crypto/sha1" //nolint:gosec // the CLI names its SSO cache files by SHA-1; not a security use
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// An SSO profile's role credentials last an hour but renew themselves for
// as long as the SSO sign-in does, which is what actually ends a long run
// part-way. It is in the CLI's cache, keyed by the profile's sso-session
// name (or, for an older profile, its start URL); a profile that assumes a
// role reaches it through source_profile.

func awsConfigPath() string {
	if p := os.Getenv("AWS_CONFIG_FILE"); p != "" {
		return p
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".aws", "config")
}

// readAWSConfig maps "profile x" / "default" / "sso-session y" sections to
// their keys.
func readAWSConfig(path string) map[string]map[string]string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	out := map[string]map[string]string{}
	section := ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSpace(line[1 : len(line)-1])
			if section == "default" {
				section = "profile default"
			}
			if out[section] == nil {
				out[section] = map[string]string{}
			}
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok && section != "" {
			out[section][strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out
}

// ssoSessionExpiry is when the SSO sign-in behind profile ends, if it has
// one and has signed in.
func ssoSessionExpiry(profile string) (time.Time, bool) {
	if profile == "" {
		profile = os.Getenv("AWS_PROFILE")
	}
	if profile == "" {
		profile = "default"
	}
	cfg := readAWSConfig(awsConfigPath())
	for hops := 0; hops < 5; hops++ {
		p := cfg["profile "+profile]
		if p == nil {
			return time.Time{}, false
		}
		key := ""
		switch {
		case p["sso_session"] != "":
			key = p["sso_session"]
		case p["sso_start_url"] != "":
			key = p["sso_start_url"]
		case p["source_profile"] != "":
			profile = p["source_profile"]
			continue
		default:
			return time.Time{}, false
		}
		sum := sha1.Sum([]byte(key)) //nolint:gosec
		raw, err := os.ReadFile(filepath.Join(filepath.Dir(awsConfigPath()), "sso", "cache", hex.EncodeToString(sum[:])+".json"))
		if err != nil {
			return time.Time{}, false
		}
		var tok struct {
			ExpiresAt string `json:"expiresAt"`
		}
		if json.Unmarshal(raw, &tok) != nil {
			return time.Time{}, false
		}
		t, err := time.Parse(time.RFC3339, tok.ExpiresAt)
		if err != nil {
			return time.Time{}, false
		}
		return t, true
	}
	return time.Time{}, false
}
