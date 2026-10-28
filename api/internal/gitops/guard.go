package gitops

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// Guard refuses a file that looks like it carries a secret. It runs on every
// file before it is committed, whoever rendered it, so a template or values
// bug fails the PR instead of publishing a credential. It errs on the side of
// refusing: a false positive costs a rename, a false negative a rotation.
//
// Two checks:
//   - the raw text, for things that are secrets whatever key holds them
//     (PEM keys, AWS access keys, GitHub and Slack tokens, JWTs);
//   - for YAML, any non-empty scalar under a key whose name means "the
//     secret itself" (password, clientSecret, secretAccessKey, ...). Keys
//     that *name* a secret -- secretName, existingSecret, secretKey,
//     dbcreds -- are not on that list, which is how ESO references pass.
func Guard(path string, content []byte) error {
	for _, p := range secretPatterns {
		if p.re.Match(content) {
			return fmt.Errorf("%s looks like it contains %s; secrets belong in Secrets Manager, not the GitOps repo", path, p.what)
		}
	}
	if !strings.HasSuffix(path, ".yaml") && !strings.HasSuffix(path, ".yml") {
		return nil
	}
	dec := yaml.NewDecoder(bytes.NewReader(content))
	for {
		var doc yaml.Node
		if err := dec.Decode(&doc); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("%s is not valid YAML: %w", path, err)
		}
		if key := findSecretKey(&doc); key != "" {
			return fmt.Errorf("%s sets %q; secrets belong in Secrets Manager, not the GitOps repo", path, key)
		}
	}
}

var secretPatterns = []struct {
	what string
	re   *regexp.Regexp
}{
	{"a private key", regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`)},
	{"an AWS access key", regexp.MustCompile(`\b(AKIA|ASIA)[A-Z0-9]{16}\b`)},
	{"a GitHub token", regexp.MustCompile(`\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b`)},
	{"a Slack token or webhook", regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}|hooks\.slack\.com/services/`)},
	{"a JWT", regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`)},
}

// secretKeys are compared after lowercasing and dropping '_', '-' and '.'.
// A bare "secret" is not on the list: Kubernetes and Keycloak use it for the
// *name* of a Secret (bootstrapAdmin.user.secret, volumes[].secret).
var secretKeys = map[string]bool{
	"password":            true,
	"passwd":              true,
	"clientsecret":        true,
	"secretaccesskey":     true,
	"awssecretaccesskey":  true,
	"privatekey":          true,
	"githubappprivatekey": true,
	"token":               true,
	"accesstoken":         true,
	"apikey":              true,
	"apitoken":            true,
	"webhookurl":          true,
	"slackwebhook":        true,
	"nextauthsecret":      true,
	"nextauthjwtsecret":   true,
	"cookiesecret":        true,
	"encryptionkey":       true,
}

func normalizeKey(k string) string {
	k = strings.ToLower(k)
	return strings.NewReplacer("_", "", "-", "", ".", "").Replace(k)
}

// placeholder values are allowed under secret keys: they are how a manifest
// says "filled in elsewhere" (Keycloak realm placeholders, ESO templates).
var placeholder = regexp.MustCompile(`^(\$\{[A-Za-z0-9_]+\}|\{\{[^}]*\}\}|<[^>]+>|)$`)

func findSecretKey(n *yaml.Node) string {
	switch n.Kind {
	case yaml.DocumentNode, yaml.SequenceNode:
		for _, c := range n.Content {
			if k := findSecretKey(c); k != "" {
				return k
			}
		}
	case yaml.MappingNode:
		for i := 0; i+1 < len(n.Content); i += 2 {
			key, val := n.Content[i], n.Content[i+1]
			if val.Kind == yaml.ScalarNode && secretKeys[normalizeKey(key.Value)] &&
				val.Tag != "!!null" && val.Tag != "!!bool" && !placeholder.MatchString(strings.TrimSpace(val.Value)) {
				return key.Value
			}
			if k := findSecretKey(val); k != "" {
				return k
			}
		}
	}
	return ""
}
