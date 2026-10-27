package gitops

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/gin-gonic/gin"

	"github.com/uc-cdis/gen3-admin/internal/environments"
	"github.com/uc-cdis/gen3-admin/internal/keycloakadmin"
)

// Getting back into a CSOC whose admin password is lost. The password is
// not kept anywhere; the Keycloak master admin's is, in Secrets Manager
// (gen3-csoc/<name>/keycloak-admin). With it, the wizard can show who the
// CSOC admin is and give them a new password, through Keycloak's public
// address, which the operator's allowlisted IP reaches.

const csocAdminUser = "admin"

var validCSOCPassword = regexp.MustCompile(`^[A-Za-z0-9 !#%&()*+,./:;<=>?@\[\]^_{|}~-]{12,128}$`)

// newKeycloakAdmin is replaced in tests.
var newKeycloakAdmin = func(ctx context.Context, secrets SecretsAPI, e *environments.Environment) (*keycloakadmin.Admin, error) {
	var host string
	if raw, ok := e.Outputs["keycloak_hostname"]; ok {
		_ = json.Unmarshal(raw, &host)
	}
	if host == "" {
		return nil, errors.New("this environment has no keycloak_hostname output; is it applied?")
	}
	name := SecretName(e.Name, "keycloak-admin")
	out, err := secrets.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{SecretId: &name})
	if err != nil {
		return nil, err
	}
	var login struct{ Username, Password string }
	if out.SecretString == nil || json.Unmarshal([]byte(*out.SecretString), &login) != nil || login.Password == "" {
		return nil, errors.New(name + " does not hold the Keycloak admin login")
	}
	if login.Username == "" {
		login.Username = "admin"
	}
	base := "https://" + host
	return &keycloakadmin.Admin{BaseURL: base, PublicURL: base, Realm: "csoc-realm",
		User: login.Username, Password: login.Password, HTTP: &http.Client{Timeout: 20 * time.Second}}, nil
}

// POST /api/gitops/csoc-admin  {bucket, environment, ...target}
// Who the CSOC admin is: username and email.
func HandleCSOCAdmin(c *gin.Context) {
	var r request
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	s, cancel, ok := open(c, &r)
	if !ok {
		return
	}
	defer cancel()
	kc, err := newKeycloakAdmin(s.ctx, s.secrets, s.env)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	u, err := kc.FindUser(s.ctx, csocAdminUser)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	// A realm imported before the template set them gets workshop-length
	// sessions here, the first time the Done step is shown.
	extended, err := kc.EnsureSessionLifetimes(s.ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "session lifetimes: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": u.Username, "email": u.Email, "keycloak": kc.PublicURL,
		"session_idle_hours": keycloakadmin.SessionIdle / 3600, "sessions_extended": extended})
}

// POST /api/gitops/csoc-admin/reset  {bucket, environment, password, ...target}
func HandleCSOCAdminReset(c *gin.Context) {
	var r struct {
		request
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if !validCSOCPassword.MatchString(r.Password) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the password must be 12-128 characters, without quotes, backslashes, $ or `"})
		return
	}
	s, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	kc, err := newKeycloakAdmin(s.ctx, s.secrets, s.env)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	u, err := kc.FindUser(s.ctx, csocAdminUser)
	if err == nil {
		err = kc.ResetPassword(s.ctx, u.ID, r.Password)
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": u.Username, "email": u.Email})
}
