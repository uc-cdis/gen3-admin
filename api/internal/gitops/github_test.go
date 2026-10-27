package gitops

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func testKey(t *testing.T) (*rsa.PrivateKey, []byte) {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return k, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(k)})
}

// fakeGitHub records requests and answers the few endpoints the client uses.
type fakeGitHub struct {
	t        *testing.T
	key      *rsa.PublicKey
	mu       sync.Mutex
	tree     []map[string]any
	baseTree string
	tokenReq map[string]any
	pr       map[string]any
	existing []string
}

func (f *fakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	body, _ := io.ReadAll(r.Body)
	var in map[string]any
	_ = json.Unmarshal(body, &in)
	auth := r.Header.Get("Authorization")
	reply := func(v any) { _ = json.NewEncoder(w).Encode(v) }
	switch {
	case r.Method == "POST" && r.URL.Path == "/app/installations/42/access_tokens":
		tok, err := jwt.Parse(strings.TrimPrefix(auth, "Bearer "), func(*jwt.Token) (any, error) { return f.key, nil },
			jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer("7"))
		if err != nil || !tok.Valid {
			w.WriteHeader(401)
			reply(map[string]string{"message": "bad jwt"})
			return
		}
		f.tokenReq = in
		reply(map[string]string{"token": "inst-token"})
		return
	}
	if auth != "Bearer inst-token" {
		w.WriteHeader(401)
		return
	}
	switch {
	case r.Method == "GET" && r.URL.Path == "/repos/o/r/git/ref/heads/main":
		reply(map[string]any{"object": map[string]string{"sha": "basecommit"}})
	case r.Method == "GET" && r.URL.Path == "/repos/o/r/git/commits/basecommit":
		reply(map[string]any{"tree": map[string]string{"sha": f.baseTree}})
	case r.Method == "GET" && r.URL.Path == "/repos/o/r/git/trees/basetree":
		var entries []map[string]string
		for _, p := range f.existing {
			entries = append(entries, map[string]string{"path": p, "type": "blob"})
		}
		reply(map[string]any{"tree": entries})
	case r.Method == "POST" && r.URL.Path == "/repos/o/r/git/trees":
		for _, e := range in["tree"].([]any) {
			f.tree = append(f.tree, e.(map[string]any))
		}
		reply(map[string]string{"sha": "newtree"})
	case r.Method == "POST" && r.URL.Path == "/repos/o/r/git/commits":
		reply(map[string]string{"sha": "newcommit"})
	case r.Method == "POST" && r.URL.Path == "/repos/o/r/git/refs":
		if in["ref"] != "refs/heads/gen3-csoc/x" || in["sha"] != "newcommit" {
			f.t.Errorf("create ref got %v", in)
		}
		w.WriteHeader(201)
	case r.Method == "POST" && r.URL.Path == "/repos/o/r/pulls":
		f.pr = in
		reply(map[string]any{"number": 5, "html_url": "https://github.com/o/r/pull/5", "state": "open"})
	case r.Method == "GET" && r.URL.Path == "/repos/o/r/pulls/5":
		reply(map[string]any{"number": 5, "html_url": "u", "state": "closed", "merged": true, "merge_commit_sha": "m1",
			"head": map[string]string{"ref": "gen3-csoc/x", "sha": "newcommit"}})
	default:
		w.WriteHeader(404)
		reply(map[string]string{"message": "Not Found"})
	}
}

func newFake(t *testing.T) (*fakeGitHub, AppCredentials) {
	k, pemBytes := testKey(t)
	f := &fakeGitHub{t: t, key: &k.PublicKey, baseTree: "basetree"}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	t.Setenv("GITHUB_API_URL", srv.URL)
	return f, AppCredentials{AppID: 7, InstallationID: 42, PrivateKey: pemBytes}
}

func TestOpenPR(t *testing.T) {
	f, creds := newFake(t)
	f.existing = []string{"csoc/apps/old.yaml", "csoc/apps/a.yaml", "other/keep.yaml"}
	c, err := NewClient(context.Background(), creds, Repo{Owner: "o", Name: "r", BaseBranch: "main"})
	if err != nil {
		t.Fatal(err)
	}
	if repos := f.tokenReq["repositories"].([]any); len(repos) != 1 || repos[0] != "r" {
		t.Errorf("token not scoped to the repo: %v", f.tokenReq)
	}
	pr, err := c.OpenPR(context.Background(), Change{
		Branch: "gen3-csoc/x", Title: "t", Body: "b", Prune: "csoc",
		Files: []File{{Path: "csoc/apps/a.yaml", Content: []byte("a: 1\n")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if pr.Number != 5 || pr.Branch != "gen3-csoc/x" {
		t.Errorf("pr = %+v", pr)
	}
	if f.pr["base"] != "main" || f.pr["head"] != "gen3-csoc/x" {
		t.Errorf("pull request opened as %v", f.pr)
	}
	var deleted, written []string
	for _, e := range f.tree {
		if sha, ok := e["sha"]; ok && sha == nil {
			deleted = append(deleted, e["path"].(string))
		} else if e["content"] != nil {
			written = append(written, e["path"].(string))
		}
	}
	if len(deleted) != 1 || deleted[0] != "csoc/apps/old.yaml" {
		t.Errorf("deleted %v, want only the stale file under the pruned dir", deleted)
	}
	if len(written) != 1 || written[0] != "csoc/apps/a.yaml" {
		t.Errorf("wrote %v", written)
	}

	got, err := c.GetPR(context.Background(), 5)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Merged || got.MergeSHA != "m1" {
		t.Errorf("GetPR = %+v", got)
	}
}

func TestOpenPRNoChanges(t *testing.T) {
	f, creds := newFake(t)
	f.baseTree = "newtree" // the tree GitHub builds equals the base
	c, err := NewClient(context.Background(), creds, Repo{Owner: "o", Name: "r", BaseBranch: "main"})
	if err != nil {
		t.Fatal(err)
	}
	pr, err := c.OpenPR(context.Background(), Change{Branch: "gen3-csoc/x", Title: "t",
		Files: []File{{Path: "csoc/a.yaml", Content: []byte("a: 1\n")}}})
	if err != nil {
		t.Fatal(err)
	}
	if !pr.NoChanges || f.pr != nil {
		t.Errorf("opened a PR for a no-op change: %+v", pr)
	}
}

func TestOpenPRRefusesSecrets(t *testing.T) {
	_, creds := newFake(t)
	c, err := NewClient(context.Background(), creds, Repo{Owner: "o", Name: "r", BaseBranch: "main"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.OpenPR(context.Background(), Change{Branch: "gen3-csoc/x", Title: "t",
		Files: []File{{Path: "c/values.yaml", Content: []byte("postgres:\n  password: abc\n")}}})
	if err == nil || !strings.Contains(err.Error(), "Secrets Manager") {
		t.Errorf("err = %v, want the guard to refuse", err)
	}
}

func TestNewClientBadKey(t *testing.T) {
	_, creds := newFake(t)
	_, other := testKey(t)
	creds.PrivateKey = other
	if _, err := NewClient(context.Background(), creds, Repo{Owner: "o", Name: "r"}); err == nil {
		t.Error("a JWT signed by the wrong key was accepted")
	}
	creds.PrivateKey = []byte("not a key")
	if _, err := NewClient(context.Background(), creds, Repo{Owner: "o", Name: "r"}); err == nil || strings.Contains(err.Error(), "not a key") {
		t.Errorf("err = %v", err)
	}
}
