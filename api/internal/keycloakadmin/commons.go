// Package keycloakadmin lets the CSOC manage clients in its own Keycloak
// realm: one per Gen3 commons, so the commons' Fence logs users in through
// the CSOC.
package keycloakadmin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Admin talks to Keycloak's admin REST API.
type Admin struct {
	// BaseURL is where the API reaches Keycloak; in the cluster, its service.
	BaseURL string
	// PublicURL is the address browsers and Fence use, in the issuer.
	PublicURL      string
	Realm          string
	User, Password string
	HTTP           *http.Client
}

// FromEnv reads the admin connection from the CSOC chart's environment:
// KEYCLOAK_URL and KEYCLOAK_REALM (as for login), KEYCLOAK_ADMIN_URL (the
// in-cluster service; defaults to KEYCLOAK_URL), and the admin login in
// KEYCLOAK_ADMIN_USERNAME and KEYCLOAK_ADMIN_PASSWORD.
func FromEnv() (*Admin, error) {
	a := &Admin{
		PublicURL: strings.TrimSuffix(os.Getenv("KEYCLOAK_URL"), "/"),
		BaseURL:   strings.TrimSuffix(os.Getenv("KEYCLOAK_ADMIN_URL"), "/"),
		Realm:     os.Getenv("KEYCLOAK_REALM"),
		User:      os.Getenv("KEYCLOAK_ADMIN_USERNAME"),
		Password:  os.Getenv("KEYCLOAK_ADMIN_PASSWORD"),
		HTTP:      &http.Client{Timeout: 20 * time.Second},
	}
	if a.BaseURL == "" {
		a.BaseURL = a.PublicURL
	}
	if a.PublicURL == "" || a.Realm == "" || a.User == "" || a.Password == "" {
		return nil, errors.New("this CSOC has no Keycloak admin access configured (KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_USERNAME, KEYCLOAK_ADMIN_PASSWORD)")
	}
	return a, nil
}

func (a *Admin) token(ctx context.Context) (string, error) {
	form := url.Values{"grant_type": {"password"}, "client_id": {"admin-cli"}, "username": {a.User}, "password": {a.Password}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.BaseURL+"/realms/master/protocol/openid-connect/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := a.do(req, &out); err != nil {
		return "", fmt.Errorf("keycloak admin login: %w", err)
	}
	return out.AccessToken, nil
}

func (a *Admin) do(req *http.Request, out any) error {
	resp, err := a.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s: %s", req.Method, req.URL.Path, resp.Status)
	}
	if out != nil && len(body) > 0 {
		return json.Unmarshal(body, out)
	}
	return nil
}

func (a *Admin) call(ctx context.Context, token, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.BaseURL+"/admin/realms/"+url.PathEscape(a.Realm)+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return a.do(req, out)
}

type client struct {
	ID                        string   `json:"id,omitempty"`
	ClientID                  string   `json:"clientId"`
	Name                      string   `json:"name,omitempty"`
	Protocol                  string   `json:"protocol"`
	PublicClient              bool     `json:"publicClient"`
	StandardFlowEnabled       bool     `json:"standardFlowEnabled"`
	DirectAccessGrantsEnabled bool     `json:"directAccessGrantsEnabled"`
	RedirectURIs              []string `json:"redirectUris"`
	WebOrigins                []string `json:"webOrigins"`
	Enabled                   bool     `json:"enabled"`
}

// EnsureClient creates the confidential OIDC client clientID, or sets its
// redirect URIs if it exists, and returns its secret.
func (a *Admin) EnsureClient(ctx context.Context, clientID, name string, redirects, origins []string) (string, error) {
	token, err := a.token(ctx)
	if err != nil {
		return "", err
	}
	want := client{
		ClientID: clientID, Name: name, Protocol: "openid-connect", Enabled: true,
		StandardFlowEnabled: true, RedirectURIs: redirects, WebOrigins: origins,
	}
	var found []client
	if err := a.call(ctx, token, http.MethodGet, "/clients?clientId="+url.QueryEscape(clientID), nil, &found); err != nil {
		return "", err
	}
	id := ""
	if len(found) > 0 {
		id = found[0].ID
		want.ID = id
		if err := a.call(ctx, token, http.MethodPut, "/clients/"+url.PathEscape(id), want, nil); err != nil {
			return "", err
		}
	} else {
		if err := a.call(ctx, token, http.MethodPost, "/clients", want, nil); err != nil {
			return "", err
		}
		if err := a.call(ctx, token, http.MethodGet, "/clients?clientId="+url.QueryEscape(clientID), nil, &found); err != nil || len(found) == 0 {
			return "", fmt.Errorf("client %s was created but cannot be read back: %v", clientID, err)
		}
		id = found[0].ID
	}
	var secret struct {
		Value string `json:"value"`
	}
	if err := a.call(ctx, token, http.MethodGet, "/clients/"+url.PathEscape(id)+"/client-secret", nil, &secret); err != nil {
		return "", err
	}
	return secret.Value, nil
}

var (
	validHost      = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	validNamespace = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
)

// FenceIDP is the key Fence's generic OIDC provider goes under, and so part
// of its login path.
const FenceIDP = "generic_oidc_idp"

// CommonsClient is what Fence needs to log users in through the CSOC.
type CommonsClient struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	DiscoveryURL string `json:"discovery_url"`
	// RedirectURL is in Fence's own form, {{BASE_URL}}/login/<idp>/login.
	RedirectURL string `json:"redirect_url"`
	Name        string `json:"name"`
}

// CommonsClientHandler: POST /api/keycloak/commons-client {hostname,
// namespace}. Creates (or updates) the commons' client in the CSOC realm.
func CommonsClientHandler(c *gin.Context) {
	var req struct {
		Hostname  string `json:"hostname"`
		Namespace string `json:"namespace"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	host := strings.ToLower(strings.TrimSpace(req.Hostname))
	if !validHost.MatchString(host) || !validNamespace.MatchString(req.Namespace) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hostname must be a DNS name and namespace a Kubernetes namespace name"})
		return
	}
	admin, err := FromEnv()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	res, err := ensureCommonsClient(c.Request.Context(), admin, host, req.Namespace)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

func ensureCommonsClient(ctx context.Context, admin *Admin, host, namespace string) (*CommonsClient, error) {
	clientID := "fence-" + namespace
	base := "https://" + host
	secret, err := admin.EnsureClient(ctx, clientID, "Gen3 "+host,
		[]string{base + "/user/login/" + FenceIDP + "/login"}, []string{base})
	if err != nil {
		return nil, err
	}
	return &CommonsClient{
		ClientID:     clientID,
		ClientSecret: secret,
		DiscoveryURL: admin.PublicURL + "/realms/" + admin.Realm + "/.well-known/openid-configuration",
		RedirectURL:  "{{BASE_URL}}/login/" + FenceIDP + "/login",
		Name:         "CSOC login",
	}, nil
}

// User is a realm user, as the admin API lists it.
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
}

// FindUser returns the realm user with exactly this username.
func (a *Admin) FindUser(ctx context.Context, username string) (*User, error) {
	token, err := a.token(ctx)
	if err != nil {
		return nil, err
	}
	var users []User
	if err := a.call(ctx, token, http.MethodGet, "/users?exact=true&username="+url.QueryEscape(username), nil, &users); err != nil {
		return nil, err
	}
	for i := range users {
		if strings.EqualFold(users[i].Username, username) {
			return &users[i], nil
		}
	}
	return nil, fmt.Errorf("no user %q in realm %s", username, a.Realm)
}

// ResetPassword sets a user's password, not to be changed at next sign-in.
func (a *Admin) ResetPassword(ctx context.Context, userID, password string) error {
	token, err := a.token(ctx)
	if err != nil {
		return err
	}
	body := map[string]any{"type": "password", "value": password, "temporary": false}
	return a.call(ctx, token, http.MethodPut, "/users/"+url.PathEscape(userID)+"/reset-password", body, nil)
}
