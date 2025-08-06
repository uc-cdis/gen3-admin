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
		authHeader := c.GetHeader("Authorization")
		url := c.Request.URL.Path
		method := c.Request.Method

		var tokenString string

		// First try to get token from Authorization header
		if authHeader != "" {
			bearerToken := strings.Split(authHeader, " ")
			if len(bearerToken) != 2 || strings.ToLower(bearerToken[0]) != "bearer" {
				log.Error().Msg("error: Invalid Authorization header format")
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization header format"})
				c.Abort()
				return
			}
			tokenString = bearerToken[1]
		} else {
			// Try to get token from cookie if no Authorization header
			cookie, err := c.Cookie("keycloak-access-token")
			if err != nil {
				log.Error().Msg("error: Authorization header or access-token cookie is required")
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header or access-token cookie is required"})
				c.Abort()
				return
			}
			tokenString = cookie
		}

		token, err := jwt.Parse(tokenString, keyFunc)
		if err != nil {
			log.Error().Err(err).Msg("error: Token verification failed")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Token verification failed"})
			c.Abort()
			return
		}

		if !token.Valid {
			log.Error().Msg("error: Invalid token")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			log.Error().Msg("error: Invalid claims")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid claims"})
			c.Abort()
			return
		}

		expectedIssuer := fmt.Sprintf("%s/realms/%s", os.Getenv("KEYCLOAK_URL"), os.Getenv("KEYCLOAK_REALM"))
		if iss, ok := claims["iss"].(string); ok {
			if iss != expectedIssuer {
				legacyIssuer := fmt.Sprintf("%s/auth/realms/%s", os.Getenv("KEYCLOAK_URL"), os.Getenv("KEYCLOAK_REALM"))
				if iss != legacyIssuer {
					log.Error().Str("expected", expectedIssuer).Str("legacy_expected", legacyIssuer).Str("actual", iss).Msg("error: Invalid issuer")
					c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token issuer"})
					c.Abort()
					return
				}
			}
		}

		// Verify audience (client_id)
		// expectedAudience := os.Getenv("KEYCLOAK_CLIENT_ID")
		// if aud, ok := claims["aud"]; ok {
		// 	var validAudience bool
		// 	switch v := aud.(type) {
		// 	case string:
		// 		validAudience = v == expectedAudience
		// 	case []interface{}:
		// 		for _, audience := range v {
		// 			if audStr, ok := audience.(string); ok && audStr == expectedAudience {
		// 				validAudience = true
		// 				break
		// 			}
		// 		}
		// 	}
		// 	if !validAudience {
		// 		log.Error().Str("expected", expectedAudience).Interface("actual", aud).Msg("error: Invalid audience")
		// 		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token audience"})
		// 		c.Abort()
		// 		return
		// 	}
		// }

		if exp, ok := claims["exp"].(float64); ok {
			if time.Now().Unix() > int64(exp) {
				log.Error().Msg("error: Token has expired")
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Token has expired"})
				c.Abort()
				return
			}
		}

		userInfo := make(map[string]interface{})

		if sub, ok := claims["sub"]; ok {
			userInfo["id"] = sub
		}
		if name, ok := claims["name"]; ok {
			userInfo["name"] = name
		}
		if email, ok := claims["email"]; ok {
			userInfo["email"] = email
		}
		if username, ok := claims["preferred_username"]; ok {
			userInfo["username"] = username
		}
		if givenName, ok := claims["given_name"]; ok {
			userInfo["given_name"] = givenName
		}
		if familyName, ok := claims["family_name"]; ok {
			userInfo["family_name"] = familyName
		}
		if emailVerified, ok := claims["email_verified"]; ok {
			userInfo["email_verified"] = emailVerified
		}

		if groups, ok := claims["groups"].([]interface{}); ok {
			userInfo["groups"] = groups
		}

		if userRoles, ok := claims["roles"].([]interface{}); ok {
			userInfo["user_roles"] = userRoles
		}

		if resourceAccess, ok := claims["resource_access"].(map[string]interface{}); ok {
			if account, ok := resourceAccess["account"].(map[string]interface{}); ok {
				if roles, ok := account["roles"].([]interface{}); ok {
					var accRoleStrings []string
					for _, role := range roles {
						if roleStr, ok := role.(string); ok {
							accRoleStrings = append(accRoleStrings, roleStr)
						}
					}
					userInfo["account_roles"] = accRoleStrings
				}
			}
		}

		if iss, ok := claims["iss"].(string); ok {
			userInfo["issuer"] = iss
		}
		if aud, ok := claims["aud"]; ok {
			userInfo["audience"] = aud
		}
		if exp, ok := claims["exp"].(float64); ok {
			userInfo["expires_at"] = time.Unix(int64(exp), 0)
		}
		if iat, ok := claims["iat"].(float64); ok {
			userInfo["issued_at"] = time.Unix(int64(iat), 0)
		}

		c.Set("userInfo", userInfo)

		groupsIface, ok := userInfo["groups"].([]interface{})
		if !ok {
			log.Error().Msg("error: User groups missing or invalid")
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: missing groups"})
			c.Abort()
			return
		}

		var groups []string
		for _, g := range groupsIface {
			if groupStr, ok := g.(string); ok {
				cleanGroup := strings.TrimPrefix(groupStr, "/")
				groups = append(groups, cleanGroup)

			}
		}

		log.Info().Msgf("Groups: %s", groups)

		parts := strings.Split(strings.TrimPrefix(url, "/api/k8s/"), "/")
		if len(parts) < 1 {
			log.Error().Msg("error: Could not extract agent from URL")
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: invalid URL"})
			c.Abort()
			return
		}
		agent := parts[0]

		readGroup := fmt.Sprintf("%s-read", agent)
		writeGroup := fmt.Sprintf("%s-write", agent)

		hasGroup := func(target string) bool {
			for _, g := range groups {
				if g == target {
					return true
				}
			}
			return false
		}

		if method == http.MethodGet {
			if !hasGroup(readGroup) && !hasGroup(writeGroup) && !hasGroup("superadmin") {
				c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: read permission required"})
				log.Error().Msg("error: Access denied: read permission required")
				c.Abort()
				return
			}
		} else if method == http.MethodPost || method == http.MethodPatch || method == http.MethodPut || method == http.MethodDelete {
			if !hasGroup(writeGroup) && !hasGroup("superadmin") {
				c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: write or superadmin permission required"})
				log.Error().Msg("error: Access denied: write or superadmin permission required")
				c.Abort()
				return
			}
		}

		log.Info().
			Str("user", fmt.Sprintf("%v", userInfo["username"])).
			Str("email", fmt.Sprintf("%v", userInfo["email"])).
			Str("id", fmt.Sprintf("%v", userInfo["id"])).
			Str("grps", fmt.Sprintf("%v", userInfo["groups"])).
			Str("user_roles", fmt.Sprintf("%v", userInfo["user_roles"])).
			Str("acc_roles", fmt.Sprintf("%v", userInfo["account_roles"])).
			Msg("User authenticated and authorized")

		c.Next()
	}
}

func SuccessMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
	}
}

func ForbiddenMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		log.Warn().Msg("Not allowing due to authZ")
		c.AbortWithStatus(http.StatusForbidden) // Immediately abort and return 403
	}
}
