package gitops

import "testing"

func TestGuard(t *testing.T) {
	refuse := map[string]string{
		"pem":         "key: |\n  -----BEGIN RSA PRIVATE KEY-----\n  abc\n",
		"aws key":     "id: AKIAABCDEFGHIJKLMNOP\n",
		"github pat":  "x: ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789AB\n",
		"slack hook":  "url: https://hooks.slack.com/services/T000/B000/XXXX\n",
		"password":    "global:\n  postgres:\n    master:\n      password: hunter2hunter2\n",
		"client sec":  "fence:\n  OPENID_CONNECT:\n    google:\n      client_secret: abc123\n",
		"aws secret":  "global:\n  aws:\n    awsSecretAccessKey: abc/def\n",
		"in a list":   "env:\n  - name: X\n    token: abc\n",
		"second doc":  "a: 1\n---\nb:\n  password: x1\n",
		"invalid yml": "a: [\n",
	}
	for name, content := range refuse {
		if err := Guard("x/values.yaml", []byte(content)); err == nil {
			t.Errorf("%s: allowed, want refused", name)
		}
	}
	allow := map[string]string{
		"secret names":  "externalSecrets:\n  dbcreds: gen3-fence-creds\n  fenceJwtKeys: x\nexistingSecret: csoc-nextauth\nsecretEnv:\n  - {name: K, secretName: s, key: client-secret}\n",
		"k8s secret":    "bootstrapAdmin:\n  user:\n    secret: keycloak-admin-credentials\n",
		"placeholders":  "credentials:\n  - value: \"${ADMIN_PASSWORD}\"\nclientSecret: \"${CLIENT_SECRET}\"\ngithubAppPrivateKey: \"{{ .private_key }}\"\n",
		"empty":         "password: \"\"\ntoken: null\n",
		"secretKey ref": "data:\n  - secretKey: password\n    remoteRef: {key: x, property: password}\n",
	}
	for name, content := range allow {
		if err := Guard("x/values.yaml", []byte(content)); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestCheckPath(t *testing.T) {
	for _, p := range []string{"", "/etc/x", "a/../b", "a//b", ".git/config", "a\\b"} {
		if checkPath(p) == nil {
			t.Errorf("checkPath(%q) allowed", p)
		}
	}
	if err := checkPath("csoc/apps/csoc.yaml"); err != nil {
		t.Error(err)
	}
}
