package keycloak

import (
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/rs/zerolog/log"
)

type JWK struct {
	Kty string   `json:"kty"`
	Kid string   `json:"kid"`
	Use string   `json:"use"`
	N   string   `json:"n"`
	E   string   `json:"e"`
	X5c []string `json:"x5c"`
}

type JWKS struct {
	Keys []JWK `json:"keys"`
}

var (
	jwksCache    *JWKS
	jwksCacheExp time.Time
)

func fetchJWKS() (*JWKS, error) {
	keycloakURL := os.Getenv("KEYCLOAK_URL")
	realm := os.Getenv("KEYCLOAK_REALM")

	if keycloakURL == "" || realm == "" {
		return nil, fmt.Errorf("KEYCLOAK_URL and KEYCLOAK_REALM must be set")
	}

	jwksURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", keycloakURL, realm)
	log.Debug().Str("jwks_url", jwksURL).Msg("Attempting to fetch JWKS")

	resp, err := http.Get(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()
	var jwks JWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("failed to decode JWKS: %w", err)
	}

	log.Debug().Int("key_count", len(jwks.Keys)).Msg("Successfully fetched JWKS")
	return &jwks, nil
}

func getJWKS() (*JWKS, error) {
	if jwksCache != nil && time.Now().Before(jwksCacheExp) {
		return jwksCache, nil
	}

	jwks, err := fetchJWKS()
	if err != nil {
		return nil, err
	}

	jwksCache = jwks
	jwksCacheExp = time.Now().Add(time.Hour)

	return jwks, nil
}

func getPublicKey(kid string) (*rsa.PublicKey, error) {
	jwks, err := getJWKS()
	if err != nil {
		return nil, err
	}

	for _, key := range jwks.Keys {
		if key.Kid == kid && key.Kty == "RSA" {
			return jwt.ParseRSAPublicKeyFromPEM([]byte(fmt.Sprintf(
				"-----BEGIN CERTIFICATE-----\n%s\n-----END CERTIFICATE-----",
				key.X5c[0],
			)))
		}
	}

	return nil, fmt.Errorf("key with kid %s not found", kid)
}

func keyFunc(token *jwt.Token) (interface{}, error) {
	// Verify the signing method
	if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
		return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
	}

	// Get the kid from token header
	kid, ok := token.Header["kid"].(string)
	if !ok {
		return nil, fmt.Errorf("kid not found in token header")
	}

	// Get the public key
	return getPublicKey(kid)
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {

		url := c.Request.URL.Path
		method := c.Request.Method

		// -------------------------
		// Public routes
		// -------------------------

		if url == "/ping" {
			c.Next()
			return
		}

		// -------------------------
		// Extract token
		// -------------------------

		authHeader := c.GetHeader("Authorization")
		var tokenString string

		if authHeader != "" {
			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization header format"})
				c.Abort()
				return
			}
			tokenString = parts[1]
		} else {
			cookie, err := c.Cookie("keycloak-access-token")
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header or access-token cookie required"})
				c.Abort()
				return
			}
			tokenString = cookie
		}

		token, err := jwt.Parse(tokenString, keyFunc)
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Token verification failed"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			c.Abort()
			return
		}

		// -------------------------
		// Validate issuer
		// -------------------------

		expectedIssuer := fmt.Sprintf("%s/realms/%s",
			os.Getenv("KEYCLOAK_URL"),
			os.Getenv("KEYCLOAK_REALM"),
		)

		if iss, ok := claims["iss"].(string); ok {

			legacyIssuer := fmt.Sprintf("%s/auth/realms/%s",
				os.Getenv("KEYCLOAK_URL"),
				os.Getenv("KEYCLOAK_REALM"),
			)

			if iss != expectedIssuer && iss != legacyIssuer {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token issuer"})
				c.Abort()
				return
			}
		}

		// -------------------------
		// Check expiration
		// -------------------------

		if exp, ok := claims["exp"].(float64); ok {
			if time.Now().Unix() > int64(exp) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Token expired"})
				c.Abort()
				return
			}
		}

		// -------------------------
		// Extract roles
		// -------------------------

		roleMap := map[string]bool{}

		if realmAccess, ok := claims["realm_access"].(map[string]interface{}); ok {
			if roles, ok := realmAccess["roles"].([]interface{}); ok {
				for _, r := range roles {
					if roleStr, ok := r.(string); ok {
						roleMap[roleStr] = true
					}
				}
			}
		}

		if len(roleMap) == 0 {
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: no roles assigned"})
			c.Abort()
			return
		}

		userInfo := map[string]interface{}{
			"id":       claims["sub"],
			"name":     claims["name"],
			"email":    claims["email"],
			"username": claims["preferred_username"],
			"roles":    roleMap,
		}

		c.Set("userInfo", userInfo)

		// -------------------------
		// /api/agents listing
		// -------------------------

		if url == "/api/agents" && method == http.MethodGet {

			accessibleAgents := []string{}

			for role := range roleMap {

				if role == "superadmin" {
					c.Set("visibleAgents", []string{"*"})
					c.Next()
					return
				}

				if strings.HasSuffix(role, "-read") {
					agent := strings.TrimSuffix(role, "-read")
					accessibleAgents = append(accessibleAgents, agent)
				}

				if strings.HasSuffix(role, "-write") {
					agent := strings.TrimSuffix(role, "-write")
					accessibleAgents = append(accessibleAgents, agent)
				}
			}

			c.Set("visibleAgents", accessibleAgents)

			c.Next()
			return
		}

		// -------------------------
		// Superadmin-only routes
		// -------------------------

		superAdminPrefixes := []string{
			"/api/aws",
			"/api/terraform",
			"/api/runner",
		}

		for _, prefix := range superAdminPrefixes {
			if strings.HasPrefix(url, prefix) {

				if !roleMap["superadmin"] {
					c.JSON(http.StatusForbidden, gin.H{
						"error": "Access denied: superadmin required",
					})
					c.Abort()
					return
				}

				c.Next()
				return
			}
		}

		// -------------------------
		// Extract agent (k8s or agents routes)
		// -------------------------

		var agent string

		if strings.HasPrefix(url, "/api/k8s/") {
			parts := strings.Split(strings.TrimPrefix(url, "/api/k8s/"), "/")
			if len(parts) > 0 {
				agent = parts[0]
			}
		}

		if strings.HasPrefix(url, "/api/agents/") {
			parts := strings.Split(strings.TrimPrefix(url, "/api/agents/"), "/")
			if len(parts) > 0 {
				agent = parts[0]
			}
		}

		// -------------------------
		// RBAC for agent routes
		// -------------------------

		if agent != "" {

			readRole := agent + "-read"
			writeRole := agent + "-write"

			if method == http.MethodGet {

				if !(roleMap[readRole] || roleMap[writeRole] || roleMap["superadmin"]) {
					c.JSON(http.StatusForbidden, gin.H{"error": "Read permission required"})
					c.Abort()
					return
				}

			} else if method == http.MethodPost ||
				method == http.MethodPut ||
				method == http.MethodPatch ||
				method == http.MethodDelete {

				if !(roleMap[writeRole] || roleMap["superadmin"]) {
					c.JSON(http.StatusForbidden, gin.H{"error": "Write permission required"})
					c.Abort()
					return
				}
			}

			c.Next()
			return
		}

		// -------------------------
		// Default deny
		// -------------------------

		c.JSON(http.StatusForbidden, gin.H{
			"error": "Access denied: route not allowed",
		})
		c.Abort()
	}
}

func SuccessMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		fakeUser := os.Getenv("MOCK_USER")
		if fakeUser == "" {
			fakeUser = "mockuser"
		}

		fakeEmail := os.Getenv("MOCK_EMAIL")
		if fakeEmail == "" {
			fakeEmail = fakeUser + "@example.com"
		}

		rolesEnv := os.Getenv("MOCK_ROLES")
		var fakeRoles []string
		if rolesEnv != "" {
			fakeRoles = strings.Split(rolesEnv, ",")
		} else {
			fakeRoles = []string{"superadmin"}
		}

		groupsEnv := os.Getenv("MOCK_GROUPS")
		var fakeGroups []interface{}
		if groupsEnv != "" {
			fakeGroups = make([]interface{}, 0)
			for _, g := range strings.Split(groupsEnv, ",") {
				fakeGroups = append(fakeGroups, strings.TrimSpace(g))
			}
		} else {
			fakeGroups = []interface{}{"superadmin"}
		}

		userInfo := map[string]interface{}{
			"id":             "mock-user-id",
			"username":       fakeUser,
			"name":           "Mock User",
			"email":          fakeEmail,
			"email_verified": true,
			"groups":         fakeGroups,
			"user_roles":     fakeRoles,
			"account_roles":  fakeRoles,
			"roles":          fakeRoles,
			"issuer":         "mock-issuer",
			"audience":       "mock-client",
			"issued_at":      time.Now(),
			"expires_at":     time.Now().Add(24 * time.Hour),
		}

		c.Set("userInfo", userInfo)
		c.Set("visibleAgents", []string{"*"})

		groupStrings := make([]string, len(fakeGroups))
		for i, g := range fakeGroups {
			groupStrings[i] = fmt.Sprintf("%v", g)
		}

		// log.Warn().
		// 	Str("username", fakeUser).
		// 	Str("email", fakeEmail).
		// 	Strs("groups", groupStrings).
		// 	Strs("roles", fakeRoles).
		// 	Msg("⚠️  MOCK_AUTH mode active — requests are NOT authenticated! This must NEVER be used in production.")

		c.Next()
	}
}

func ForbiddenMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		log.Warn().Msg("Not allowing due to authZ")
		c.AbortWithStatus(http.StatusForbidden) // Immediately abort and return 403
	}
}
