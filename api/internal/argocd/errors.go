package argocd

import (
	"fmt"
	"net/http"
)

// ErrorKind classifies why an ArgoCD call failed, so callers can react
// differently rather than seeing one opaque failure. The frontend keys its
// degraded-mode behaviour off the corresponding `reason` string: "not installed"
// prompts an install, while "no credentials" is an operator configuration
// problem and should not.
type ErrorKind string

const (
	// KindNotInstalled means ArgoCD is absent from the cluster.
	KindNotInstalled ErrorKind = "not_installed"
	// KindUnauthorized means we reached ArgoCD but could not authenticate.
	KindUnauthorized ErrorKind = "no_credentials"
	// KindUnreachable means the server could not be contacted (DNS, timeout).
	KindUnreachable ErrorKind = "unreachable"
	// KindNotFound means the specific application or resource does not exist.
	KindNotFound ErrorKind = "not_found"
	// KindUnsupported means the deployed ArgoCD version lacks this endpoint.
	KindUnsupported ErrorKind = "unsupported"
	// KindAgentTooOld means the agent cannot forward request bodies, so writes
	// silently fail. Distinguished because the fix is redeploying the agent.
	KindAgentTooOld ErrorKind = "agent_too_old"
	// KindUpstream is any other error reported by ArgoCD itself.
	KindUpstream ErrorKind = "upstream_error"
)

// Error is a classified ArgoCD failure.
type Error struct {
	Kind    ErrorKind
	Status  int
	Message string
	Err     error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("argocd: %s: %s: %v", e.Kind, e.Message, e.Err)
	}
	return fmt.Sprintf("argocd: %s: %s", e.Kind, e.Message)
}

func (e *Error) Unwrap() error { return e.Err }

// HTTPStatus maps a failure onto the status this API should return.
//
// Availability problems are 503 rather than 500: they are expected states for a
// cluster without ArgoCD, and the UI renders them as a degraded banner instead of
// an error.
func (e *Error) HTTPStatus() int {
	switch e.Kind {
	case KindNotInstalled, KindUnreachable:
		return http.StatusServiceUnavailable
	case KindUnauthorized:
		return http.StatusBadGateway
	case KindNotFound:
		return http.StatusNotFound
	case KindUnsupported:
		return http.StatusNotImplemented
	case KindAgentTooOld:
		return http.StatusServiceUnavailable
	default:
		if e.Status >= 400 {
			return e.Status
		}
		return http.StatusBadGateway
	}
}

// Payload is the JSON body handlers return for this error. `argocdAvailable`
// lets the frontend switch to CRD-backed reads without inspecting the message.
func (e *Error) Payload() map[string]interface{} {
	return map[string]interface{}{
		"error":           e.Message,
		"reason":          string(e.Kind),
		"argocdAvailable": e.Kind != KindNotInstalled && e.Kind != KindUnreachable && e.Kind != KindUnauthorized,
	}
}

func newError(kind ErrorKind, status int, message string, err error) *Error {
	return &Error{Kind: kind, Status: status, Message: message, Err: err}
}

// AsError converts any error into a classified *Error, defaulting to upstream.
func AsError(err error) *Error {
	if err == nil {
		return nil
	}
	if e, ok := err.(*Error); ok {
		return e
	}
	return newError(KindUpstream, http.StatusBadGateway, err.Error(), err)
}
