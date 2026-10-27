package keycloakadmin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeKeycloak is the admin API for one realm.
type fakeKeycloak struct {
	mu      sync.Mutex
	clients map[string]client // id -> client
	writes  []string
}

func (f *fakeKeycloak) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.URL.Path == "/realms/master/protocol/openid-connect/token":
		if r.FormValue("username") != "admin" || r.FormValue("password") != "pw" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"access_token": "tok"})
		return
	case r.Header.Get("Authorization") != "Bearer tok":
		w.WriteHeader(http.StatusUnauthorized)
		return
	case r.Method == http.MethodGet && r.URL.Path == "/admin/realms/csoc-realm/clients":
		var out []client
		for _, c := range f.clients {
			if c.ClientID == r.URL.Query().Get("clientId") {
				out = append(out, c)
			}
		}
		json.NewEncoder(w).Encode(out)
	case r.Method == http.MethodPost && r.URL.Path == "/admin/realms/csoc-realm/clients":
		var c client
		json.NewDecoder(r.Body).Decode(&c)
		c.ID = "id-" + c.ClientID
		f.clients[c.ID] = c
		f.writes = append(f.writes, "create "+c.ClientID)
		w.WriteHeader(http.StatusCreated)
	case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/admin/realms/csoc-realm/clients/"):
		var c client
		json.NewDecoder(r.Body).Decode(&c)
		f.clients[c.ID] = c
		f.writes = append(f.writes, "update "+c.ClientID)
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodGet && r.URL.Path == "/admin/realms/csoc-realm/users":
		if r.URL.Query().Get("username") == "admin" {
			json.NewEncoder(w).Encode([]User{{ID: "u1", Username: "admin", Email: "admin@portal.example.org"}})
			return
		}
		json.NewEncoder(w).Encode([]User{})
	case r.Method == http.MethodPut && r.URL.Path == "/admin/realms/csoc-realm/users/u1/reset-password":
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		f.writes = append(f.writes, fmt.Sprintf("reset %v temporary=%v", body["value"], body["temporary"]))
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/client-secret"):
		json.NewEncoder(w).Encode(map[string]string{"value": "s3cret"})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func newAdmin(t *testing.T) (*Admin, *fakeKeycloak) {
	t.Helper()
	fake := &fakeKeycloak{clients: map[string]client{}}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	return &Admin{BaseURL: srv.URL, PublicURL: "https://auth.example.org", Realm: "csoc-realm",
		User: "admin", Password: "pw", HTTP: srv.Client()}, fake
}

func TestEnsureCommonsClientCreatesThenUpdates(t *testing.T) {
	admin, fake := newAdmin(t)
	res, err := ensureCommonsClient(context.Background(), admin, "commons-a.example.org", "commons-a")
	if err != nil {
		t.Fatal(err)
	}
	if res.ClientID != "fence-commons-a" || res.ClientSecret != "s3cret" ||
		res.DiscoveryURL != "https://auth.example.org/realms/csoc-realm/.well-known/openid-configuration" ||
		res.RedirectURL != "{{BASE_URL}}/login/generic_oidc_idp/login" {
		t.Errorf("result = %+v", res)
	}
	c := fake.clients["id-fence-commons-a"]
	if c.PublicClient || !c.StandardFlowEnabled ||
		len(c.RedirectURIs) != 1 || c.RedirectURIs[0] != "https://commons-a.example.org/user/login/generic_oidc_idp/login" {
		t.Errorf("client = %+v", c)
	}
	if _, err := ensureCommonsClient(context.Background(), admin, "commons-a.example.org", "commons-a"); err != nil {
		t.Fatal(err)
	}
	if strings.Join(fake.writes, ",") != "create fence-commons-a,update fence-commons-a" {
		t.Errorf("a second call must update, not create again: %v", fake.writes)
	}
}

func TestEnsureCommonsClientReportsBadAdminLogin(t *testing.T) {
	admin, _ := newAdmin(t)
	admin.Password = "wrong"
	if _, err := ensureCommonsClient(context.Background(), admin, "commons-a.example.org", "commons-a"); err == nil ||
		!strings.Contains(err.Error(), "admin login") {
		t.Errorf("err = %v", err)
	}
}

func TestFromEnvNeedsTheAdminLogin(t *testing.T) {
	t.Setenv("KEYCLOAK_URL", "https://auth.example.org")
	t.Setenv("KEYCLOAK_REALM", "csoc-realm")
	t.Setenv("KEYCLOAK_ADMIN_USERNAME", "")
	t.Setenv("KEYCLOAK_ADMIN_PASSWORD", "")
	if _, err := FromEnv(); err == nil {
		t.Error("FromEnv accepted no admin login")
	}
	t.Setenv("KEYCLOAK_ADMIN_USERNAME", "admin")
	t.Setenv("KEYCLOAK_ADMIN_PASSWORD", "pw")
	a, err := FromEnv()
	if err != nil || a.BaseURL != "https://auth.example.org" {
		t.Errorf("FromEnv = %+v, %v; the admin URL defaults to the public one", a, err)
	}
}

func TestFindUserAndResetPassword(t *testing.T) {
	admin, fake := newAdmin(t)
	u, err := admin.FindUser(context.Background(), "admin")
	if err != nil || u.Email != "admin@portal.example.org" {
		t.Fatalf("user = %+v, %v", u, err)
	}
	if err := admin.ResetPassword(context.Background(), u.ID, "a-new-password-123"); err != nil {
		t.Fatal(err)
	}
	if len(fake.writes) != 1 || fake.writes[0] != "reset a-new-password-123 temporary=false" {
		t.Errorf("writes = %v", fake.writes)
	}
	if _, err := admin.FindUser(context.Background(), "nobody"); err == nil {
		t.Error("a missing user was found")
	}
}
