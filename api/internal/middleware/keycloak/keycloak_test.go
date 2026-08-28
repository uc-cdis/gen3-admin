package keycloak

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt"
)

func TestAudienceMatches(t *testing.T) {
	const client = "gen3-admin"

	tests := []struct {
		name   string
		claims jwt.MapClaims
		want   bool
	}{
		{
			name:   "aud as string matches",
			claims: jwt.MapClaims{"aud": client},
			want:   true,
		},
		{
			name:   "aud as string does not match",
			claims: jwt.MapClaims{"aud": "other-client"},
			want:   false,
		},
		{
			name:   "aud as array contains client",
			claims: jwt.MapClaims{"aud": []interface{}{"account", client}},
			want:   true,
		},
		{
			name:   "aud as array without client",
			claims: jwt.MapClaims{"aud": []interface{}{"account", "realm-management"}},
			want:   false,
		},
		{
			// Keycloak commonly omits the client from aud and records it in azp.
			name:   "azp fallback when aud omits client",
			claims: jwt.MapClaims{"aud": []interface{}{"account"}, "azp": client},
			want:   true,
		},
		{
			name:   "no aud and no azp",
			claims: jwt.MapClaims{},
			want:   false,
		},
		{
			name:   "aud of unexpected type falls back to azp",
			claims: jwt.MapClaims{"aud": 42, "azp": client},
			want:   true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := audienceMatches(tc.claims, client); got != tc.want {
				t.Errorf("audienceMatches() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestIntervalLimiter(t *testing.T) {
	t.Run("first call allowed, immediate second call suppressed", func(t *testing.T) {
		l := &intervalLimiter{interval: time.Hour}

		if !l.Allow() {
			t.Fatal("first Allow() = false, want true")
		}
		if l.Allow() {
			t.Error("second Allow() = true, want false (should be rate limited)")
		}
	})

	t.Run("allows again once interval has elapsed", func(t *testing.T) {
		l := &intervalLimiter{interval: time.Millisecond}

		if !l.Allow() {
			t.Fatal("first Allow() = false, want true")
		}
		time.Sleep(5 * time.Millisecond)
		if !l.Allow() {
			t.Error("Allow() after interval = false, want true")
		}
	})
}
