#!/bin/bash
# =============================================================================
# setup-k3s.sh — Deploy CSOC portal + Keycloak on k3s
#
# Usage:
#   ./scripts/setup-k3s.sh                    # k3s + deploy (MOCK_AUTH)
#   ./scripts/setup-k3s.sh --keycloak         # k3s + Keycloak operator + deploy
#   ./scripts/setup-k3s.sh --teardown         # tear everything down
#   ./scripts/setup-k3s.sh --status           # show status
#   ./scripts/setup-k3s.sh --cluster-only     # only verify k3s, don't deploy
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
RELEASE_NAME="${RELEASE_NAME:-csoc}"
NAMESPACE="${NAMESPACE:-csoc}"
HELM_CHART="${CHART_PATH:-./helm/csoc}"
VALUES_FILE="./helm/csoc/values-test.yaml"
HOSTNAME="csoc.aws"
GEN3_HOSTNAME="gen3.aws"
KEYCLOAK_HOSTNAME="keycloak.aws"
KEYCLOAK_OPERATOR_DIR="./helm/keycloak-operator"
KEYCLOAK_CRD_FILE="./helm/keycloak-bootstrap-operator/keycloak.yaml"
KEYCLOAK_NS="${NAMESPACE}"
CNPG_VERSION="1.29.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Quay image tags
API_IMAGE_TAG="${API_IMAGE_TAG:-feat_bootstrap-onboarding-impl}"
FRONTEND_IMAGE_TAG="${FRONTEND_IMAGE_TAG:-feat_bootstrap-onboarding-impl}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()    { echo -e "${BLUE}[setup]${NC} $*"; }
ok()     { echo -e "${GREEN}✓${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠${NC} $*"; }
die()    { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ── Pre-flight checks ────────────────────────────────────────────────────────
check_prereqs() {
  log "Checking prerequisites..."

  local missing=()
  for cmd in kubectl helm git; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing tools: ${missing[*]}. Install them first."
  fi

  if kubectl get nodes 2>/dev/null | grep -q "Ready"; then
    ok "k3s cluster is running"
  else
    die "k3s cluster not found. Install k3s first."
  fi
}

# ── CloudNativePG operator ───────────────────────────────────────────────────
install_cnpg() {
  if kubectl get namespace cnpg-system >/dev/null 2>&1 && \
     kubectl get pods -n cnpg-system -l app.kubernetes.io/name=cloudnative-pg 2>/dev/null | grep -q "Running"; then
    warn "CloudNativePG operator already installed"
    return
  fi

  log "Installing CloudNativePG operator v${CNPG_VERSION}..."
  kubectl apply --server-side -f \
    "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.29/releases/cnpg-${CNPG_VERSION}.yaml"

  log "Waiting for CloudNativePG controller..."
  kubectl rollout status deployment \
    -n cnpg-system cnpg-controller-manager --timeout=120s

  ok "CloudNativePG operator ready"
}

# ── Keycloak via Operator ────────────────────────────────────────────────────
start_keycloak() {
  if [[ "${INSTALL_KEYCLOAK:-0}" != "1" ]]; then
    log "Keycloak not requested (--keycloak to enable), using MOCK_AUTH mode"
    return
  fi

  if kubectl get keycloak keycloak -n "$KEYCLOAK_NS" >/dev/null 2>&1 && \
     kubectl get pods -n "$KEYCLOAK_NS" -l app=keycloak 2>/dev/null | grep -q "Running"; then
    warn "Keycloak already running in cluster"
    return
  fi

  log "Installing Keycloak via Operator..."

  # Step 1: CloudNativePG
  install_cnpg

  # Step 2: Keycloak operator
  if [[ -f "$KEYCLOAK_OPERATOR_DIR/install.sh" ]]; then
    log "Running Keycloak operator install script..."
    NAMESPACE="$KEYCLOAK_NS" bash "$KEYCLOAK_OPERATOR_DIR/install.sh"
  else
    local KC_VERSION="26.6.1"
    kubectl create namespace "$KEYCLOAK_NS" --dry-run=client -o yaml | kubectl apply -f -
    kubectl apply -f "https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${KC_VERSION}/kubernetes/keycloaks.k8s.keycloak.org-v1.yml"
    kubectl apply -f "https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${KC_VERSION}/kubernetes/keycloakrealmimports.k8s.keycloak.org-v1.yml"
    kubectl -n "$KEYCLOAK_NS" apply -f "https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${KC_VERSION}/kubernetes/kubernetes.yml"
    kubectl patch clusterrolebinding keycloak-operator-clusterrole-binding \
      --type='json' \
      -p='[{"op": "replace", "path": "/subjects/0/namespace", "value":"'"$KEYCLOAK_NS"'"}]' || true
    kubectl rollout restart deployment/keycloak-operator -n "$KEYCLOAK_NS" 2>/dev/null || true
  fi

  log "Waiting for Keycloak operator..."
  kubectl rollout status deployment/keycloak-operator -n "$KEYCLOAK_NS" --timeout=120s

  # Step 3: Apply Keycloak resources — patch hostnames for AWS
  if [[ -f "$KEYCLOAK_CRD_FILE" ]]; then
    log "Applying Keycloak resources (PostgreSQL cluster + server + realm)..."

    local tmp
    tmp=$(mktemp)
    cp "$KEYCLOAK_CRD_FILE" "$tmp"

    # Patch namespace if not default
    if [[ "$KEYCLOAK_NS" != "csoc" ]]; then
      sed -i "s/namespace: csoc/namespace: ${KEYCLOAK_NS}/g" "$tmp"
    fi

    # Patch hostnames for AWS
    sed -i "s/hostname: keycloak.local/hostname: ${KEYCLOAK_HOSTNAME}/g" "$tmp"
    sed -i "s/host: keycloak.local/host: ${KEYCLOAK_HOSTNAME}/g" "$tmp"

    # Patch redirect URIs for AWS
    sed -i "s|http://localhost:3000|http://${HOSTNAME}|g" "$tmp"
    sed -i "s|http://csoc.local|http://${HOSTNAME}|g" "$tmp"

    kubectl apply -f "$tmp"
    rm -f "$tmp"
  else
    die "Keycloak resource file not found: $KEYCLOAK_CRD_FILE"
  fi

  # Step 4: Wait for PostgreSQL
  log "Waiting for PostgreSQL cluster (keycloak-db)..."
  kubectl wait --for=condition=Ready cluster/keycloak-db -n "$KEYCLOAK_NS" --timeout=300s

  # Step 5: Wait for Keycloak
  log "Waiting for Keycloak server pod..."
  kubectl wait --for=condition=ready pod \
    -l app=keycloak -n "$KEYCLOAK_NS" \
    --timeout=300s

  ok "Keycloak is ready"
}

# ── Helm deploy ──────────────────────────────────────────────────────────────
deploy_csoc() {
  cd "$PROJECT_ROOT"

  if [[ ! -f "$VALUES_FILE" ]]; then
    die "Values file not found: $VALUES_FILE"
  fi

  log "Deploying CSOC portal via Helm..."

  local helm_args=(
    --namespace "$NAMESPACE"
    -f "$VALUES_FILE"
    --set "image.api.tag=${API_IMAGE_TAG}"
    --set "image.frontend.tag=${FRONTEND_IMAGE_TAG}"
    --set "frontend.env.NEXTAUTH_URL=http://${HOSTNAME}"
    --set "ingress.className=traefik"
  )

  if [[ "${INSTALL_KEYCLOAK:-0}" == "1" ]]; then
    log "Configuring CSOC portal to use Keycloak..."
    helm_args+=(
      --set "api.env.MOCK_AUTH=false"
      --set "api.env.KEYCLOAK_URL=http://${KEYCLOAK_HOSTNAME}"
      --set "api.env.KEYCLOAK_REALM=csoc-realm"
      --set "frontend.env.MOCK_AUTH=false"
      --set "frontend.env.ENABLE_MOCK_AUTH=false"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_URL=http://${KEYCLOAK_HOSTNAME}"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_REALM=csoc-realm"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=csoc-client"
    )
  fi

  if helm status "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Upgrading existing release..."
  else
    log "Installing fresh release..."
  fi
  helm upgrade --install "$RELEASE_NAME" "$HELM_CHART" "${helm_args[@]}"

  ok "Helm release '$RELEASE_NAME' deployed to namespace '$NAMESPACE'"
}

# ── Wait for pods ────────────────────────────────────────────────────────────
wait_for_pods() {
  log "Waiting for CSOC pods to become ready..."
  kubectl wait --for=condition=ready pod \
    -l "app.kubernetes.io/instance=$RELEASE_NAME" \
    -n "$NAMESPACE" --timeout=300s
  ok "All CSOC pods are ready"

  echo ""
  log "Pod status:"
  kubectl get pods -n "$NAMESPACE" -o wide
}

# ── Teardown ─────────────────────────────────────────────────────────────────
teardown() {
  cd "$PROJECT_ROOT"
  log "Tearing down..."

  if helm status "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Uninstalling Helm release '$RELEASE_NAME'..."
    helm uninstall "$RELEASE_NAME" -n "$NAMESPACE"
    ok "Helm release uninstalled"
  fi

  if [[ "${INSTALL_KEYCLOAK:-0}" == "1" ]]; then
    log "Removing Keycloak resources..."
    kubectl delete -f "$KEYCLOAK_CRD_FILE" --ignore-not-found=true 2>/dev/null || true
    kubectl delete cluster keycloak-db -n "$KEYCLOAK_NS" --ignore-not-found=true 2>/dev/null || true
  fi

  ok "Teardown complete (k3s cluster still running — use your cloud provider to destroy the VM)"
}

# ── Status ───────────────────────────────────────────────────────────────────
show_status() {
  echo ""
  echo "============================================"
  echo "  CSOC Portal — k3s Workshop Environment"
  echo "============================================"
  echo ""

  echo "  Namespace: $NAMESPACE"
  echo "  Release:   $RELEASE_NAME"
  echo ""

  echo "  Nodes:"
  kubectl get nodes -o wide 2>/dev/null | sed 's/^/    /'
  echo ""

  if kubectl get svc "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
    echo "  Pods:"
    kubectl get pods -n "$NAMESPACE" -o wide 2>/dev/null | sed 's/^/    /'
  else
    echo "  Helm release NOT installed yet"
  fi

  echo ""
  echo "  Access:"
  echo "    Frontend:  http://${HOSTNAME}"
  echo "    API:       http://${HOSTNAME}/api/ping"
  echo "    Gen3:      http://${GEN3_HOSTNAME}"
  echo ""

  if kubectl get keycloak keycloak -n "$KEYCLOAK_NS" >/dev/null 2>&1; then
    echo "  Keycloak:   http://${KEYCLOAK_HOSTNAME}  (admin/admin)"
    echo "  Realm:      csoc-realm"
    echo "  Client:     csoc-client"
    echo "  Users:      admin/admin (superadmin), devuser/dev (csoc-role)"
  else
    echo "  Keycloak:   NOT INSTALLED (use --keycloak)"
  fi
  echo ""
}

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --keycloak          Install Keycloak via operator (default: off)
  --teardown          Remove Helm releases and Keycloak resources
  --status            Show current status
  --cluster-only      Only verify k3s, skip deploy
  --api-tag TAG       API image tag (default: $API_IMAGE_TAG)
  --frontend-tag TAG  Frontend image tag (default: $FRONTEND_IMAGE_TAG)
  --namespace NS      Kubernetes namespace (default: $NAMESPACE)
  --release NAME      Helm release name (default: $RELEASE_NAME)
  --help              Show this help

Examples:
  $(basename "$0") --keycloak
  $(basename "$0") --status
  $(basename "$0") --teardown
EOF
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  cd "$PROJECT_ROOT"

  case "${1:-}" in
    --teardown|-t) teardown; exit 0 ;;
    --status|-s)   show_status; exit 0 ;;
    --help|-h)     usage; exit 0 ;;
  esac

  CLUSTER_ONLY=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keycloak)      INSTALL_KEYCLOAK=1; shift ;;
      --cluster-only)  CLUSTER_ONLY=1; shift ;;
      --api-tag)       API_IMAGE_TAG="$2"; shift 2 ;;
      --frontend-tag)  FRONTEND_IMAGE_TAG="$2"; shift 2 ;;
      --namespace)     NAMESPACE="$2"; shift 2 ;;
      --release)       RELEASE_NAME="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║   CSOC Portal — k3s Workshop Setup       ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  check_prereqs
  start_keycloak

  if [[ "$CLUSTER_ONLY" == "0" ]]; then
    deploy_csoc
    wait_for_pods
  fi

  show_status

  ok "Setup complete!"
}

main "$@"
