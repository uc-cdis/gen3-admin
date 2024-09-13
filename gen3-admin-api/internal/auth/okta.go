package auth

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"crypto/rsa"
	"math/big"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v4"
	"github.com/rs/zerolog/log"
)

type OktaJWKS struct {
	Keys []struct {
		Kty string `json:"kty"`
		Kid string `json:"kid"`
		Use string `json:"use"`
		N   string `json:"n"`
		E   string `json:"e"`
		Alg string `json:"alg"`
	} `json:"keys"`
}

func fetchJWKS(jwksURL string) (*OktaJWKS, error) {
	resp, err := http.Get(jwksURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var jwks OktaJWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, err
	}

	return &jwks, nil
}

func parseRSAPublicKey(n, e string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(n)
	if err != nil {
		return nil, fmt.Errorf("failed to decode modulus: %v", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(e)
	if err != nil {
		return nil, fmt.Errorf("failed to decode exponent: %v", err)
	}

	nInt := new(big.Int).SetBytes(nBytes)
	eInt := new(big.Int).SetBytes(eBytes)

	if eInt.Sign() == 0 {
		eInt.SetInt64(65537) // Default exponent if not specified
	}

	return &rsa.PublicKey{
		N: nInt,
		E: int(eInt.Int64()),
	}, nil
}

func ValidateToken(tokenString, jwksURL, issuer, clientID string) (*jwt.Token, error) {
	jwks, err := fetchJWKS(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("error fetching JWKS: %v", err)
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}

		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, fmt.Errorf("kid header not found")
		}

		var key interface{}
		for _, jwk := range jwks.Keys {
			if jwk.Kid == kid {
				if jwk.Kty != "RSA" {
					return nil, fmt.Errorf("unsupported key type: %v", jwk.Kty)
				}

				key, err = parseRSAPublicKey(jwk.N, jwk.E)
				if err != nil {
					return nil, fmt.Errorf("failed to parse public key: %v", err)
				}
				break
			}
		}

		if key == nil {
			return nil, fmt.Errorf("unable to find appropriate key")
		}

		return key, nil
	})

	if err != nil {
		return nil, fmt.Errorf("error parsing token: %v", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	if err := claims.Valid(); err != nil {
		return nil, fmt.Errorf("token claims validation failed: %v", err)
	}

	if claims["iss"].(string) != issuer {
		log.Warn().Msg(issuer)
		log.Warn().Msg(claims["iss"].(string))
		return nil, fmt.Errorf("invalid issuer")
	}

	// TODO:Validate audience
	// if aud, ok := claims["aud"].(string); !ok || aud != clientID {
	// 	log.Warn().Msg(aud)
	// 	log.Warn().Msg(clientID)
	// 	return nil, fmt.Errorf("invalid audience")
	// }

	return token, nil
}

func AuthMiddleware(jwksURL, issuer, clientID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			c.Abort()
			return
		}

		bearerToken := strings.SplitN(authHeader, " ", 2)
		if len(bearerToken) != 2 || strings.ToLower(bearerToken[0]) != "bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization header format"})
			c.Abort()
			return
		}

		tokenString := bearerToken[1]

		// Validate the token using oktaauth package
		token, err := ValidateToken(tokenString, jwksURL, issuer, clientID)
		if err != nil {
			log.Error().Err(err).Msg("Token validation failed")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid claims"})
			c.Abort()
			return
		}

		// Call AuthZ Service
		authzEndpoint := issuer + "/auth/mapping"
		reqBody, _ := json.Marshal(claims)
		authzResp, err := http.Post(authzEndpoint, "application/json", bytes.NewBuffer(reqBody))
		if err != nil {
			log.Error().Err(err).Msg("Error calling authZ service")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Authorization service error"})
			c.Abort()
			return
		}
		defer authzResp.Body.Close()

		log.Info().Msg("User is authorized")
		c.Next()
	}
}
