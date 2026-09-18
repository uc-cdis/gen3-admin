package server

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

// MeResponse describes the caller to the frontend.
//
// The UI previously had no way to ask what the current user may do. Keycloak
// roles were extracted at login and dropped on the floor, so every user saw
// every button and discovered their actual permissions by clicking one and
// getting a 403 rendered as "Something went wrong".
type MeResponse struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Name     string `json:"name"`

	// Realm roles verbatim, for display and for any check the frontend adds
	// later without needing a new endpoint.
	Roles []string `json:"roles"`

	// Agents this user may see, derived from <agent>-read / <agent>-write.
	// Sorted so the response is stable between calls.
	ReadableAgents []string `json:"readableAgents"`
	WritableAgents []string `json:"writableAgents"`

	// When true the two lists above are not exhaustive: a superadmin may reach
	// every agent, including ones registered after this response.
	IsSuperAdmin bool `json:"isSuperAdmin"`
}

// HandleMe reports the caller's identity and effective permissions.
//
// Deliberately derived from the same role claims AuthMiddleware enforces with,
// rather than from a second source: if this disagreed with the middleware the
// UI would enable actions the API then rejects, which is worse than showing
// nothing at all. This is a convenience for rendering, never the enforcement
// point -- every route is still checked server-side.
func HandleMe(c *gin.Context) {
	raw, exists := c.Get("userInfo")
	if !exists {
		// AuthMiddleware sets this before any handler runs, so its absence
		// means the route was mounted outside the middleware.
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No user information available"})
		return
	}

	userInfo, ok := raw.(map[string]interface{})
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Malformed user information"})
		return
	}

	resp := MeResponse{
		Username:       stringClaim(userInfo, "username"),
		Email:          stringClaim(userInfo, "email"),
		Name:           stringClaim(userInfo, "name"),
		Roles:          []string{},
		ReadableAgents: []string{},
		WritableAgents: []string{},
	}

	roleMap, _ := userInfo["roles"].(map[string]bool)
	for role := range roleMap {
		resp.Roles = append(resp.Roles, role)

		switch {
		case role == "superadmin":
			resp.IsSuperAdmin = true
		case strings.HasSuffix(role, "-write"):
			agent := strings.TrimSuffix(role, "-write")
			// Write implies read, matching the middleware, which accepts
			// either role on a GET.
			resp.WritableAgents = append(resp.WritableAgents, agent)
			resp.ReadableAgents = append(resp.ReadableAgents, agent)
		case strings.HasSuffix(role, "-read"):
			resp.ReadableAgents = append(resp.ReadableAgents, strings.TrimSuffix(role, "-read"))
		}
	}

	sort.Strings(resp.Roles)
	resp.ReadableAgents = sortedUnique(resp.ReadableAgents)
	resp.WritableAgents = sortedUnique(resp.WritableAgents)

	c.JSON(http.StatusOK, resp)
}

func stringClaim(info map[string]interface{}, key string) string {
	if v, ok := info[key].(string); ok {
		return v
	}
	return ""
}

// sortedUnique makes the response stable and drops the duplicate a user holding
// both <agent>-read and <agent>-write would otherwise produce.
func sortedUnique(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}
