#!/bin/bash
# Start the gen3-admin dev stack: Go API and Next.js frontend, and optionally a
# locally-run agent.
#
# Both run under nodemon (Go) / next dev (frontend) so they restart on file
# changes. Logs stream to .dev-logs/ and Ctrl-C stops everything.
#
# There are two ways to bootstrap, and neither starts an agent by hand:
#
#   ./scripts/dev.sh --bootstrap cloud    # wizard only: provision VPC + EKS in AWS
#                                         # from scratch. No kube context needed.
#   ./scripts/dev.sh --bootstrap local    # normal UI against the current kube
#                                         # context; onboarding deploys the agent
#                                         # into that cluster. (Also the default.)
#
#   ./scripts/dev.sh --context <name>     # pin a specific context (local)
#   ./scripts/dev.sh --with-agent         # also run an agent process on this
#                                         # machine, the previous default
#   ./scripts/dev.sh --keycloak           # real auth instead of MOCK_AUTH
#
# Run --help for the full list.

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/.dev-logs"

# ── Configuration ────────────────────────────────────────────────────────────
AGENT_NAME="${AGENT_NAME:-local}"
API_PORT="${API_PORT:-8002}"
GRPC_PORT="${GRPC_PORT:-9090}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
KUBE_CONTEXT="${KUBE_CONTEXT:-}"
USE_KEYCLOAK=false
# The agent used to start by default. Bootstrapping now deploys it into the
# target cluster (local) or provisions the cluster first (cloud), so a
# host-run agent is opt-in.
WITH_AGENT=false
SKIP_FRONTEND=false
BOOTSTRAP_TARGET="local"
MODULES_DIR="${TERRAFORM_MODULES_DIR:-}"
RUNNER_IMAGE="gen3-terraform:latest"

usage() {
    cat <<EOF
Usage: ./scripts/dev.sh [options]

Options:
  --bootstrap <target>  cloud: bootstrap wizard for a new AWS stack; no kube
                        context needed. local: normal UI on the current
                        context (default)
  --modules-dir <path>  Local gen3-terraform checkout to run modules from,
                        instead of GitHub (cloud; also TERRAFORM_MODULES_DIR)
  --with-agent          Also run an agent on this machine (local only)
  --agent-name <name>   Agent name and cert basename (default: local)
  --context <name>      kubectl context to serve (default: current context)
  --api-port <port>     API HTTP port (default: 8002)
  --grpc-port <port>    Agent gRPC port (default: 9090)
  --frontend-port <p>   Frontend port (default: 3000, auto-bumps if taken)
  --keycloak            Use real Keycloak auth instead of MOCK_AUTH
  --skip-frontend       Do not start the frontend
  -h, --help            Show this help

Environment:
  KEYCLOAK_URL / KEYCLOAK_REALM / KEYCLOAK_CLIENT_ID   required with --keycloak
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bootstrap)     BOOTSTRAP_TARGET="$2"; shift 2 ;;
        --modules-dir)   MODULES_DIR="$2"; shift 2 ;;
        --with-agent)    WITH_AGENT=true; shift ;;
        --agent-name)    AGENT_NAME="$2"; shift 2 ;;
        --context)       KUBE_CONTEXT="$2"; shift 2 ;;
        --api-port)      API_PORT="$2"; shift 2 ;;
        --grpc-port)     GRPC_PORT="$2"; shift 2 ;;
        --frontend-port) FRONTEND_PORT="$2"; shift 2 ;;
        --keycloak)      USE_KEYCLOAK=true; shift ;;
        --skip-agent)    WITH_AGENT=false; shift ;;  # kept for old invocations; now the default
        --skip-frontend) SKIP_FRONTEND=true; shift ;;
        -h|--help)       usage; exit 0 ;;
        *) log_error "Unknown option: $1"; usage; exit 1 ;;
    esac
done

case "$BOOTSTRAP_TARGET" in
    cloud|local) ;;
    *) log_error "--bootstrap must be 'cloud' or 'local', got: $BOOTSTRAP_TARGET"; exit 1 ;;
esac
if [[ "$BOOTSTRAP_TARGET" == "cloud" && "$WITH_AGENT" == "true" ]]; then
    log_error "--with-agent needs a cluster to serve; cloud bootstrap creates one. Drop one of the two."
    exit 1
fi
if [[ -n "$MODULES_DIR" ]]; then
    # The wizard runs examples/csoc; a checkout on a branch without it fails
    # only at the first init, so check for the module itself.
    if [[ ! -f "$MODULES_DIR/examples/csoc/main.tf" ]]; then
        log_error "--modules-dir has no examples/csoc/main.tf: $MODULES_DIR"
        branch="$(git -C "$MODULES_DIR" branch --show-current 2>/dev/null || true)"
        [[ -n "$branch" ]] && log_info "That checkout is on branch '$branch'. Check out a branch with examples/csoc, or use a worktree:"
        log_info "  git -C $MODULES_DIR worktree add /tmp/gen3-terraform-csoc <branch>"
        exit 1
    fi
    MODULES_DIR="$(cd "$MODULES_DIR" && pwd)"
fi

# ── Pre-flight ───────────────────────────────────────────────────────────────
check_prerequisites() {
    local missing=()
    local required=(go node npm)
    # Cloud bootstrap runs Terraform in docker and needs no cluster yet; local
    # works against an existing cluster.
    if [[ "$BOOTSTRAP_TARGET" == "cloud" ]]; then required+=(docker); else required+=(kubectl); fi
    for cmd in "${required[@]}"; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        exit 1
    fi

    # nodemon gives us restart-on-change for the Go processes. It is optional:
    # without it we fall back to a plain `go run`, which still works but means
    # restarting by hand after every edit.
    if npx --no-install nodemon --version >/dev/null 2>&1; then
        NODEMON="npx --no-install nodemon"
    elif command -v nodemon >/dev/null 2>&1; then
        NODEMON="nodemon"
    else
        NODEMON=""
        log_warning "nodemon not found - Go services will not auto-restart on changes"
        log_warning "install it with: npm i -g nodemon"
    fi
}

# Resolve the target cluster into a dedicated kubeconfig.
#
# Two reasons this is worth the trouble:
#   1. The agent proxies live k8s calls, so whatever context is current becomes
#      reachable from the browser. Pinning it here means later `kubectl config
#      use-context` calls cannot silently repoint the dev stack at prod.
#   2. `internal/k8s.GetConfig()` reads the KUBECONFIG env var and ignores the
#      agent's --kubeconfig flag, so the env var is what actually takes effect.
setup_kubeconfig() {
    local ctx="$KUBE_CONTEXT"
    if [[ -z "$ctx" ]]; then
        ctx="$(kubectl config current-context 2>/dev/null || true)"
        if [[ -z "$ctx" ]]; then
            log_error "No kubectl context set. Pass --context <name>."
            exit 1
        fi
    fi

    if ! kubectl config get-contexts -o name 2>/dev/null | grep -qxF "$ctx"; then
        log_error "Context not found: $ctx"
        log_info "Available:"
        kubectl config get-contexts -o name 2>/dev/null | sed 's/^/    /'
        exit 1
    fi

    DEV_KUBECONFIG="$LOG_DIR/kubeconfig-${AGENT_NAME}.yaml"
    kubectl config view --raw --minify --context="$ctx" > "$DEV_KUBECONFIG"
    chmod 600 "$DEV_KUBECONFIG"
    export KUBECONFIG="$DEV_KUBECONFIG"

    log_info "Cluster context: $ctx"
    if ! kubectl --kubeconfig "$DEV_KUBECONFIG" version -o json >/dev/null 2>&1; then
        log_warning "Could not reach the cluster. If it uses an AWS/GCP exec plugin,"
        log_warning "refresh your credentials (e.g. aws sso login) or proxy calls will fail."
    fi

    # A live cluster is a real target: the UI can sync ArgoCD apps, delete
    # resources, and exec into pods.
    if [[ "$ctx" == *prod* ]]; then
        log_warning "================================================================"
        log_warning "Context name contains 'prod': $ctx"
        log_warning "The UI performs REAL writes (sync, delete, exec) against it."
        log_warning "================================================================"
        if [[ -t 0 ]]; then
            read -r -p "Continue? [y/N] " reply
            [[ "$reply" =~ ^[Yy]$ ]] || { log_info "Aborted."; exit 0; }
        fi
    fi
}

# The API log.Fatal()s at startup if certs/ is missing, and the agent needs a
# client cert issued by the API's CA. The CA and server certs are created on
# first boot; the per-agent pair is minted via POST /api/agents.
ensure_certs() {
    # The API creates its CA and server certs on first boot either way.
    mkdir -p "$REPO_ROOT/api/certs"
    [[ "$WITH_AGENT" == "true" ]] || return 0
    if [[ -f "$REPO_ROOT/api/certs/${AGENT_NAME}.crt" ]]; then
        log_info "Agent cert present: ${AGENT_NAME}.crt"
        return
    fi
    NEEDS_AGENT_CERT=true
    log_info "No cert for agent '${AGENT_NAME}' yet; will register it once the API is up"
}

register_agent() {
    [[ "${NEEDS_AGENT_CERT:-false}" == "true" ]] || return 0

    log_info "Registering agent '${AGENT_NAME}'..."
    if curl -sf -m 30 -X POST "http://localhost:${API_PORT}/api/agents" \
            -H 'Content-Type: application/json' \
            -d "{\"name\":\"${AGENT_NAME}\"}" >/dev/null 2>&1; then
        log_success "Agent cert issued"
    else
        log_error "Failed to register agent. Check $LOG_DIR/api.log"
        exit 1
    fi
}

# Find a free port starting at $1, so a stray dev server elsewhere does not
# wedge startup (and so the frontend port we advertise is the real one).
find_free_port() {
    local port="$1"
    local limit=$((port + 20))
    while [[ $port -lt $limit ]]; do
        if ! lsof -iTCP:"$port" -sTCP:LISTEN -P >/dev/null 2>&1; then
            echo "$port"; return 0
        fi
        port=$((port + 1))
    done
    log_error "No free port in range ${1}-${limit}"
    exit 1
}

check_ports() {
    for spec in "API:$API_PORT" "gRPC:$GRPC_PORT"; do
        local name="${spec%%:*}" port="${spec##*:}"
        if lsof -iTCP:"$port" -sTCP:LISTEN -P >/dev/null 2>&1; then
            log_error "$name port $port is already in use:"
            lsof -iTCP:"$port" -sTCP:LISTEN -P 2>/dev/null | tail -n +2 | sed 's/^/    /'
            log_info "Stop it, or pass --api-port / --grpc-port."
            exit 1
        fi
        # No listener, but the port can still be held as the local end of
        # someone else's outbound connection. macOS hands out ephemeral source
        # ports from 49152-65535, so a port in that range gets claimed at
        # random; bind() fails while -sTCP:LISTEN shows nothing at all.
        if netstat -an -p tcp 2>/dev/null | grep -qE "\.$port[[:space:]]+.*ESTABLISHED"; then
            log_error "$name port $port is tied up by an existing connection:"
            netstat -an -p tcp 2>/dev/null | grep -E "\.$port[[:space:]]" | sed 's/^/    /'
            if [[ "$port" -ge 49152 ]]; then
                log_warning "Port $port is in the macOS ephemeral range (49152-65535),"
                log_warning "so it gets handed out to outbound connections at random."
                log_info "Pick a port below 49152 to stop this recurring."
            fi
            log_info "Retry in a moment, or pass --api-port / --grpc-port."
            exit 1
        fi
    done

    if [[ "$SKIP_FRONTEND" == "false" ]]; then
        local wanted="$FRONTEND_PORT"
        FRONTEND_PORT="$(find_free_port "$FRONTEND_PORT")"
        if [[ "$FRONTEND_PORT" != "$wanted" ]]; then
            log_warning "Port $wanted in use; frontend will use $FRONTEND_PORT"
        fi
    fi
}

# Cloud bootstrap runs every Terraform operation in a locally-built image. A
# missing image or stopped daemon otherwise shows up as a failed first init.
ensure_runner_image() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Start Docker Desktop / OrbStack and retry."
        exit 1
    fi
    if docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1; then
        log_info "Runner image present: $RUNNER_IMAGE"
        return
    fi
    log_info "Runner image $RUNNER_IMAGE not built yet; building it (local only, not pushed)..."
    "$REPO_ROOT/scripts/build-terraform-image.sh" --tag "$RUNNER_IMAGE"
}

# Next refuses a second `next dev` from the same directory, and then exits
# after printing a message the readiness check would not recognise.
check_existing_frontend() {
    [[ "$SKIP_FRONTEND" == "false" ]] || return 0
    local pid cwd
    for pid in $(pgrep -f "next-server|next dev" 2>/dev/null); do
        cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
        if [[ "$cwd" == "$REPO_ROOT/frontend" ]]; then
            log_error "A next dev server is already running from frontend/ (PID $pid)."
            log_info "Stop it (kill $pid), or pass --skip-frontend to keep using it."
            exit 1
        fi
    done
}

# ── Process management ───────────────────────────────────────────────────────
PIDS=()

cleanup() {
    local code=$?
    trap - EXIT INT TERM
    echo
    log_info "Shutting down..."
    # Kill whole process groups: nodemon and next dev both spawn children that
    # would otherwise survive and hold onto ports.
    for pid in "${PIDS[@]:-}"; do
        [[ -n "$pid" ]] || continue
        kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    done
    sleep 2
    for pid in "${PIDS[@]:-}"; do
        [[ -n "$pid" ]] || continue
        kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    done
    log_success "Stopped."
    exit $code
}
trap cleanup EXIT INT TERM

# start_bg <logfile> <command...>
#
# Runs a command detached in the background with its output redirected. macOS has
# no setsid, so `set -m` is used to put the child in its own process group; that
# lets cleanup() signal the whole tree (nodemon and next dev both spawn children
# that would otherwise survive and keep holding ports).
start_bg() {
    local logfile="$1"; shift
    set -m
    { "$@" > "$logfile" 2>&1 & echo $! > "$LOG_DIR/.lastpid"; }
    set +m
    PIDS+=("$(cat "$LOG_DIR/.lastpid")")
    rm -f "$LOG_DIR/.lastpid"
}

# wait_for_http <url> <label> <logfile> [timeout]
wait_for_http() {
    local url="$1" label="$2" logfile="$3" timeout="${4:-90}"
    local waited=0
    while [[ $waited -lt $timeout ]]; do
        if curl -sf -m 3 -o /dev/null "$url" 2>/dev/null; then
            log_success "$label ready"
            return 0
        fi
        # Fail fast if the process already died rather than waiting out the clock.
        if grep -qE "command not found|bind: address already in use|panic:" "$logfile" 2>/dev/null; then
            log_error "$label failed to start:"
            tail -20 "$logfile" | sed 's/^/    /'
            exit 1
        fi
        sleep 1
        waited=$((waited + 1))
    done
    log_error "$label did not become ready within ${timeout}s. Recent log:"
    tail -20 "$logfile" 2>/dev/null | sed 's/^/    /'
    exit 1
}

start_api() {
    log_info "Starting API on :$API_PORT (gRPC :$GRPC_PORT)..."

    export PORT="$API_PORT"
    export GRPC_PORT
    export LOG_FORMAT=console
    if [[ -n "$MODULES_DIR" ]]; then
        # Mounted read-only into the runner; the csoc module is then taken from
        # this checkout instead of GitHub.
        export TERRAFORM_MODULES_DIR="$MODULES_DIR"
        log_info "Terraform modules from: $MODULES_DIR"
    fi
    # Must match the frontend's real origin or browser calls are rejected.
    export CORS_ALLOWED_ORIGINS="http://localhost:${FRONTEND_PORT}"

    if [[ "$USE_KEYCLOAK" == "true" ]]; then
        export MOCK_AUTH=false
        for var in KEYCLOAK_URL KEYCLOAK_REALM; do
            if [[ -z "${!var:-}" ]]; then
                log_error "--keycloak requires $var to be set"
                exit 1
            fi
        done
        log_info "Auth: Keycloak ($KEYCLOAK_URL, realm $KEYCLOAK_REALM)"
    else
        export MOCK_AUTH=true
        log_warning "Auth: MOCK_AUTH - every request is an unauthenticated superadmin"
    fi

    cd "$REPO_ROOT/api"
    if [[ -n "$NODEMON" ]]; then
        # Watch only Go sources; certs/ is written at runtime and would otherwise
        # trigger a restart loop when the agent registers.
        start_bg "$LOG_DIR/api.log" $NODEMON --quiet --signal SIGTERM \
            --watch . --ext go --ignore certs/ \
            --exec "go run ."
    else
        start_bg "$LOG_DIR/api.log" go run .
    fi
    cd "$REPO_ROOT"

    wait_for_http "http://localhost:${API_PORT}/ping" "API" "$LOG_DIR/api.log" 120
}

start_agent() {
    log_info "Starting agent '$AGENT_NAME'..."
    cd "$REPO_ROOT/api"
    # KUBECONFIG (exported by setup_kubeconfig) is what the proxy actually honors;
    # --kubeconfig is passed too since other code paths read the flag.
    if [[ -n "$NODEMON" ]]; then
        start_bg "$LOG_DIR/agent.log" $NODEMON --quiet --signal SIGTERM \
            --watch . --ext go --ignore certs/ \
            --exec "go run ./gen3-agent -name '$AGENT_NAME' -server-address localhost:$GRPC_PORT -kubeconfig '$DEV_KUBECONFIG'"
    else
        start_bg "$LOG_DIR/agent.log" go run ./gen3-agent \
            -name "$AGENT_NAME" \
            -server-address "localhost:$GRPC_PORT" \
            -kubeconfig "$DEV_KUBECONFIG"
    fi
    cd "$REPO_ROOT"

    # The agent exits on server disconnect rather than retrying, so confirm it
    # actually reached "connected" instead of assuming.
    local waited=0
    while [[ $waited -lt 60 ]]; do
        if grep -q "Agent connected" "$LOG_DIR/agent.log" 2>/dev/null; then
            log_success "Agent connected"
            return 0
        fi
        if grep -q "FTL" "$LOG_DIR/agent.log" 2>/dev/null; then
            log_error "Agent failed to start:"
            grep "FTL" "$LOG_DIR/agent.log" | tail -3 | sed 's/^/    /'
            exit 1
        fi
        sleep 1
        waited=$((waited + 1))
    done
    log_error "Agent did not connect within 60s. Recent log:"
    tail -20 "$LOG_DIR/agent.log" | sed 's/^/    /'
    exit 1
}

start_frontend() {
    log_info "Starting frontend on :$FRONTEND_PORT..."

    cd "$REPO_ROOT/frontend"
    [[ -d node_modules ]] || { log_info "Installing dependencies..."; npm install --no-audit --no-fund; }

    export API_BASE_URL="http://localhost:${API_PORT}"
    # NEXTAUTH_URL must match the port we actually bound, or the auth callback
    # redirects to the wrong origin.
    export NEXTAUTH_URL="http://localhost:${FRONTEND_PORT}"
    export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-dev-only-insecure-secret}"
    export NEXTAUTH_JWT_SECRET="${NEXTAUTH_JWT_SECRET:-dev-only-insecure-secret}"
    [[ "$USE_KEYCLOAK" == "true" ]] && export ENABLE_MOCK_AUTH=false || export ENABLE_MOCK_AUTH=true
    # Bootstrap mode locks every route to /bootstrap and hides the app chrome.
    # NEXT_PUBLIC_* is read when next dev starts, so it is fixed per run.
    if [[ "$BOOTSTRAP_TARGET" == "cloud" ]]; then
        export NEXT_PUBLIC_BOOTSTRAP_MODE=true
        export MOCK_AUTH=true
    else
        unset NEXT_PUBLIC_BOOTSTRAP_MODE
    fi

    start_bg "$LOG_DIR/frontend.log" npm run dev -- --port "$FRONTEND_PORT"
    cd "$REPO_ROOT"

    wait_for_http "http://localhost:${FRONTEND_PORT}/" "Frontend" "$LOG_DIR/frontend.log" 180
}

# ── Main ─────────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"

log_info "gen3-admin dev stack (bootstrap: $BOOTSTRAP_TARGET)"
check_prerequisites
if [[ "$BOOTSTRAP_TARGET" == "cloud" ]]; then
    ensure_runner_image
else
    setup_kubeconfig
fi
check_ports
check_existing_frontend
ensure_certs

start_api
register_agent
[[ "$WITH_AGENT" == "true" ]] && start_agent
[[ "$SKIP_FRONTEND" == "false" ]] && start_frontend

echo
log_success "Dev stack running"
echo
if [[ "$SKIP_FRONTEND" == "false" ]]; then
    if [[ "$BOOTSTRAP_TARGET" == "cloud" ]]; then
        echo -e "  ${GREEN}Wizard:${NC}  http://localhost:${FRONTEND_PORT}/bootstrap"
    else
        echo -e "  ${GREEN}UI:${NC}      http://localhost:${FRONTEND_PORT}"
        [[ "$WITH_AGENT" == "true" ]] || echo -e "           (onboarding on the home page deploys the agent into the cluster)"
    fi
fi
echo -e "  ${GREEN}API:${NC}     http://localhost:${API_PORT}"
echo -e "  ${GREEN}gRPC:${NC}    localhost:${GRPC_PORT}"
echo -e "  ${GREEN}Logs:${NC}    $LOG_DIR/*.log"
echo
log_info "Tail everything:  tail -f $LOG_DIR/*.log"
log_info "Press Ctrl-C to stop all services"
echo

# Stream logs so the terminal is useful, and keep the script in the foreground
# so the EXIT trap owns teardown.
tail -f "$LOG_DIR"/*.log 2>/dev/null &
PIDS+=($!)
wait
