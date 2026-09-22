package terraform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"testing"

	"github.com/gin-gonic/gin"
)

func checkImage(t *testing.T, query string) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/img", HandleCheckRunnerImage())

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/img"+query, nil))

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	body["_status"] = w.Code
	return body
}

// The wizard needs to distinguish "image is there" from "you have not built it
// yet", since it is built locally rather than pulled.
func TestRunnerImagePresent(t *testing.T) {
	if err := exec.Command("docker", "info").Run(); err != nil {
		t.Skip("docker is not available")
	}
	if err := exec.Command("docker", "image", "inspect", defaultRunnerImage).Run(); err != nil {
		t.Skipf("%s has not been built; run scripts/build-terraform-image.sh", defaultRunnerImage)
	}

	got := checkImage(t, "?image="+defaultRunnerImage)
	if got["present"] != true {
		t.Errorf("present = %v, want true for an image docker can inspect", got["present"])
	}
}

func TestRunnerImageMissingReportsBuildCommand(t *testing.T) {
	got := checkImage(t, "?image=gen3-terraform:definitely-not-built")
	if got["present"] != false {
		t.Fatalf("present = %v, want false", got["present"])
	}
	if got["build_command"] != "./scripts/build-terraform-image.sh" {
		t.Errorf("build_command = %v, want the build script path", got["build_command"])
	}
}

func TestRunnerImageRejectsShellishReference(t *testing.T) {
	got := checkImage(t, "?image=evil%3B+rm+-rf+%2F")
	if got["_status"] != 400 {
		t.Errorf("status = %v, want 400 for a non-image reference", got["_status"])
	}
}
