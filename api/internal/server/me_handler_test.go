package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func meRequest(t *testing.T, userInfo interface{}, setUserInfo bool) (*httptest.ResponseRecorder, MeResponse) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	if setUserInfo {
		c.Set("userInfo", userInfo)
	}

	HandleMe(c)

	var resp MeResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("response is not valid MeResponse JSON: %v", err)
		}
	}
	return rec, resp
}

func info(roles map[string]bool) map[string]interface{} {
	return map[string]interface{}{
		"username": "jdoe",
		"email":    "jdoe@example.com",
		"name":     "J Doe",
		"roles":    roles,
	}
}

func TestHandleMeDerivesAgentsFromRoles(t *testing.T) {
	_, resp := meRequest(t, info(map[string]bool{
		"dev0-read":  true,
		"perf-write": true,
	}), true)

	if resp.Username != "jdoe" || resp.Email != "jdoe@example.com" {
		t.Errorf("identity not passed through: %+v", resp)
	}
	if len(resp.ReadableAgents) != 2 || resp.ReadableAgents[0] != "dev0" || resp.ReadableAgents[1] != "perf" {
		t.Errorf("ReadableAgents = %v, want [dev0 perf]", resp.ReadableAgents)
	}
	if len(resp.WritableAgents) != 1 || resp.WritableAgents[0] != "perf" {
		t.Errorf("WritableAgents = %v, want [perf]", resp.WritableAgents)
	}
	if resp.IsSuperAdmin {
		t.Error("IsSuperAdmin = true for a user with only agent roles")
	}
}

// The middleware accepts either role on a GET, so write must imply read here
// or the UI would hide views the API would happily serve.
func TestHandleMeWriteImpliesRead(t *testing.T) {
	_, resp := meRequest(t, info(map[string]bool{"dev0-write": true}), true)

	if len(resp.ReadableAgents) != 1 || resp.ReadableAgents[0] != "dev0" {
		t.Errorf("ReadableAgents = %v, want [dev0] (write implies read)", resp.ReadableAgents)
	}
}

// Holding both roles must not list the agent twice.
func TestHandleMeDeduplicates(t *testing.T) {
	_, resp := meRequest(t, info(map[string]bool{
		"dev0-read":  true,
		"dev0-write": true,
	}), true)

	if len(resp.ReadableAgents) != 1 {
		t.Errorf("ReadableAgents = %v, want one entry", resp.ReadableAgents)
	}
}

func TestHandleMeSuperAdmin(t *testing.T) {
	_, resp := meRequest(t, info(map[string]bool{"superadmin": true}), true)

	if !resp.IsSuperAdmin {
		t.Error("IsSuperAdmin = false for a superadmin")
	}
	// The lists stay empty: a superadmin reaches every agent, including ones
	// registered after this response, so enumerating is misleading.
	if len(resp.ReadableAgents) != 0 || len(resp.WritableAgents) != 0 {
		t.Errorf("superadmin should not enumerate agents, got r=%v w=%v",
			resp.ReadableAgents, resp.WritableAgents)
	}
}

// Empty slices, not null: the frontend iterates these without guarding.
func TestHandleMeReturnsEmptySlicesNotNull(t *testing.T) {
	rec, _ := meRequest(t, info(map[string]bool{"someotherrole": true}), true)

	body := rec.Body.String()
	for _, want := range []string{`"readableAgents":[]`, `"writableAgents":[]`} {
		if !strings.Contains(body, want) {
			t.Errorf("body %s missing %s", body, want)
		}
	}
}

func TestHandleMeOrderIsStable(t *testing.T) {
	roles := map[string]bool{"zeta-read": true, "alpha-read": true, "mid-read": true}
	_, first := meRequest(t, info(roles), true)
	_, second := meRequest(t, info(roles), true)

	// Map iteration order is random in Go, so without sorting this response
	// would differ between identical calls.
	if len(first.ReadableAgents) != 3 {
		t.Fatalf("expected 3 agents, got %v", first.ReadableAgents)
	}
	for i := range first.ReadableAgents {
		if first.ReadableAgents[i] != second.ReadableAgents[i] {
			t.Fatalf("order not stable: %v vs %v", first.ReadableAgents, second.ReadableAgents)
		}
	}
	if first.ReadableAgents[0] != "alpha" {
		t.Errorf("not sorted: %v", first.ReadableAgents)
	}
}

func TestHandleMeRejectsMissingUserInfo(t *testing.T) {
	rec, _ := meRequest(t, nil, false)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 when userInfo is absent", rec.Code)
	}
}

func TestHandleMeRejectsMalformedUserInfo(t *testing.T) {
	rec, _ := meRequest(t, "not a map", true)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 for malformed userInfo", rec.Code)
	}
}

// AuthMiddleware sets roles as map[string]bool; SuccessMiddleware (mock auth)
// sets []string. Handling only the map meant a mock superadmin reported no
// roles at all, so every write control rendered disabled -- the opposite of
// what that mode exists for.
func TestHandleMeAcceptsMockAuthRoleShape(t *testing.T) {
	_, resp := meRequest(t, map[string]interface{}{
		"username": "mockuser",
		"roles":    []string{"superadmin"},
	}, true)

	if !resp.IsSuperAdmin {
		t.Error("mock auth superadmin not recognised; []string roles were ignored")
	}
}

func TestHandleMeAcceptsInterfaceSliceRoles(t *testing.T) {
	_, resp := meRequest(t, map[string]interface{}{
		"username": "jdoe",
		"roles":    []interface{}{"dev0-write", 42, "perf-read"},
	}, true)

	// The non-string entry is skipped rather than crashing the request.
	if len(resp.WritableAgents) != 1 || resp.WritableAgents[0] != "dev0" {
		t.Errorf("WritableAgents = %v, want [dev0]", resp.WritableAgents)
	}
	if len(resp.ReadableAgents) != 2 {
		t.Errorf("ReadableAgents = %v, want dev0 and perf", resp.ReadableAgents)
	}
}

func TestHandleMeToleratesUnknownRoleShape(t *testing.T) {
	rec, resp := meRequest(t, map[string]interface{}{
		"username": "jdoe",
		"roles":    12345,
	}, true)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for an unusable roles claim", rec.Code)
	}
	if len(resp.Roles) != 0 {
		t.Errorf("Roles = %v, want empty", resp.Roles)
	}
}
