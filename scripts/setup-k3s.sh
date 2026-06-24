#!/bin/bash
# =============================================================================
# setup-k3s.sh — Deploy CSOC portal + Keycloak on k3s
#
# Usage:
#   ./scripts/setup-k3s.sh                    # k3s + Keycloak operator + deploy
#   ./scripts/setup-k3s.sh --mock-auth        # k3s + deploy with MOCK_AUTH
#   ./scripts/setup-k3s.sh --teardown         # tear everything down
#   ./scripts/setup-k3s.sh --status           # show status
#   ./scripts/setup-k3s.sh --cluster-only     # only verify k3s, don't deploy
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
RELEASE_NAME="${RELEASE_NAME:-csoc}"
NAMESPACE="${NAMESPACE:-csoc}"
INSTALL_KEYCLOAK="${INSTALL_KEYCLOAK:-1}"
HELM_CHART="${CHART_PATH:-./helm/csoc}"
HOSTNAME="csoc.cloud"
GEN3_HOSTNAME="gen3.cloud"
KEYCLOAK_HOSTNAME="keycloak.cloud"
KEYCLOAK_SCHEME="${KEYCLOAK_SCHEME:-http}"
KEYCLOAK_OPERATOR_DIR="./helm/keycloak-operator"
KEYCLOAK_CRD_FILE="./helm/keycloak-bootstrap-operator/keycloak.yaml"
KEYCLOAK_NS="${NAMESPACE}"
CNPG_VERSION="1.29.0"

# Resolve project root: works when run as a file, empty when piped
if [[ -n "${BASH_SOURCE[0]:-}" ]] && [[ -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  SCRIPT_DIR=""
  PROJECT_ROOT=""
fi

VALUES_FILE="./helm/csoc/values-k3s-cloud.yaml"
TRAEFIK_HTTPS_REDIRECT_MIDDLEWARE="${TRAEFIK_HTTPS_REDIRECT_MIDDLEWARE:-csoc-https-redirect}"
TRAEFIK_HTTPS_REDIRECT_ENABLED=0
IP_ALLOWLIST_MIDDLEWARE="${IP_ALLOWLIST_MIDDLEWARE:-csoc-ip-allowlist}"
IP_ALLOWLIST_RANGES="${IP_ALLOWLIST_RANGES:-}"
IP_ALLOWLIST_ENABLED=0

# Quay image tags
API_IMAGE_TAG="${API_IMAGE_TAG:-feat_bootstrap-onboarding-impl}"
FRONTEND_IMAGE_TAG="${FRONTEND_IMAGE_TAG:-feat_bootstrap-onboarding-impl}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()    { echo -e "${BLUE}[setup]${NC} $*"; }
ok()     { echo -e "${GREEN}✓${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠${NC} $*"; }
die()    { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ── Pipe detection / confirmation ────────────────────────────────────────────
is_piped() { [[ ! -t 0 ]]; }

can_prompt() { [[ -r /dev/tty && -w /dev/tty ]]; }

tty_read() {
  local prompt="$1"
  local answer
  printf "%s" "$prompt" > /dev/tty
  IFS= read -r answer < /dev/tty
  printf "%s" "$answer"
}

confirm_install() {
  local missing=("$@")
  if [[ ${#missing[@]} -eq 0 ]]; then
    return 0
  fi

  warn "Missing tools: ${missing[*]}"
  echo ""
  echo "This script will install the following tools:"
  for cmd in "${missing[@]}"; do
    case "$cmd" in
      kubectl) echo "  - kubectl (Kubernetes CLI)" ;;
      helm)    echo "  - helm (Kubernetes package manager)" ;;
      git)     echo "  - git (version control)" ;;
      k3s)     echo "  - k3s (lightweight Kubernetes)" ;;
      *)       echo "  - $cmd" ;;
    esac
  done
  echo ""

  if is_piped; then
    echo "Running in pipe mode — auto-proceeding in 5 seconds..."
    echo "Press Ctrl+C to cancel."
    for i in 5 4 3 2 1; do
      echo -ne "\r  Starting in ${i}s... "
      sleep 1
    done
    echo -ne "\r                           \r"
  else
    read -rp "Proceed with installation? [y/N] " ans
    if [[ ! "$ans" =~ ^[Yy]$ ]]; then
      die "Installation cancelled. Install the missing tools manually and rerun this script."
    fi
  fi
}

# ── Pre-flight checks / tool installation ───────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

run_sudo() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

linux_pkg_manager() {
  if have apt-get; then echo "apt"; return; fi
  if have dnf; then echo "dnf"; return; fi
  if have yum; then echo "yum"; return; fi
  if have pacman; then echo "pacman"; return; fi
  if have zypper; then echo "zypper"; return; fi
  if have apk; then echo "apk"; return; fi
  echo ""
}

# ── Repo helper ──────────────────────────────────────────────────────────────
REPO_URL="https://github.com/uc-cdis/gen3-admin.git"
REPO_BRANCH="${REPO_BRANCH:-master}"

ensure_repo() {
  # Already in a valid project root?
  if [[ -n "$PROJECT_ROOT" && -d "$PROJECT_ROOT/helm" ]]; then
    cd "$PROJECT_ROOT"
    return 0
  fi

  # If running from an unpacked checkout, use it.
  if [[ -d "./helm" ]]; then
    PROJECT_ROOT="$(pwd)"
    cd "$PROJECT_ROOT"
    return 0
  fi

  # If pipe mode already cloned the repo earlier, reuse it.
  if [[ -d "./gen3-admin/helm" ]]; then
    PROJECT_ROOT="$(pwd)/gen3-admin"
    cd "$PROJECT_ROOT"
    git fetch origin "$REPO_BRANCH"
    git checkout -B "$REPO_BRANCH" FETCH_HEAD
    return 0
  fi

  if [[ -e "./gen3-admin" ]]; then
    die "Found ./gen3-admin, but it does not look like a gen3-admin checkout. Move it aside or run from a different directory."
  fi

  # In pipe mode, clone into Git's default destination: ./gen3-admin
  git clone --branch "$REPO_BRANCH" "$REPO_URL"
  PROJECT_ROOT="$(pwd)/gen3-admin"
  cd "$PROJECT_ROOT"
  ok "Cloned branch $REPO_BRANCH"
}

ensure_values_file() {
  if [[ -f "$VALUES_FILE" ]]; then
    return 0
  fi

  die "Values file not found in checked-out repo: $VALUES_FILE"
}

ensure_traefik_https_redirect_middleware() {
  TRAEFIK_HTTPS_REDIRECT_ENABLED=0

  if ! kubectl api-resources 2>/dev/null | grep -q "middlewares.*traefik.io"; then
    warn "Traefik Middleware CRD not found; skipping HTTPS redirect middleware setup"
    return 0
  fi

  if kubectl get middlewares.traefik.io "$TRAEFIK_HTTPS_REDIRECT_MIDDLEWARE" -n "$NAMESPACE" >/dev/null 2>&1; then
    TRAEFIK_HTTPS_REDIRECT_ENABLED=1
    return 0
  fi

  local tmp
  tmp=$(mktemp)
  cat > "$tmp" <<EOF
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: ${TRAEFIK_HTTPS_REDIRECT_MIDDLEWARE}
  namespace: ${NAMESPACE}
spec:
  redirectScheme:
    scheme: https
    permanent: true
EOF

  kubectl apply -f "$tmp"
  rm -f "$tmp"
  TRAEFIK_HTTPS_REDIRECT_ENABLED=1
  ok "Created Traefik HTTPS redirect middleware: ${NAMESPACE}/${TRAEFIK_HTTPS_REDIRECT_MIDDLEWARE}"
}

ensure_ip_allowlist() {
  IP_ALLOWLIST_ENABLED=0

  if ! kubectl api-resources 2>/dev/null | grep -q "middlewares.*traefik.io"; then
    warn "Traefik Middleware CRD not found; skipping ingress IP allowlist setup"
    return 0
  fi

  if kubectl get middlewares.traefik.io "$IP_ALLOWLIST_MIDDLEWARE" -n "$NAMESPACE" >/dev/null 2>&1; then
    IP_ALLOWLIST_ENABLED=1
    return 0
  fi

  local ranges
  if [[ -n "$IP_ALLOWLIST_RANGES" ]]; then
    ranges="$IP_ALLOWLIST_RANGES"
  else
    if ! can_prompt; then
      warn "No interactive terminal available; skipping optional ingress IP allowlist setup"
      return 0
    fi

    local detected_ip
    detected_ip=$(curl -s --max-time 5 https://icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)

    echo "" > /dev/tty
    echo "Restrict ${HOSTNAME} and ${KEYCLOAK_HOSTNAME} by source IP?" > /dev/tty
    local enable
    enable=$(tty_read "Create Traefik IP allowlist? [y/N] ")
    if [[ ! "$enable" =~ ^[Yy]$ ]]; then
      return 0
    fi

    local current_range
    if [[ -n "$detected_ip" ]]; then
      current_range=$(tty_read "Current public IP/CIDR [${detected_ip}/32]: ")
      current_range="${current_range:-${detected_ip}/32}"
    else
      current_range=$(tty_read "Current public IP/CIDR: ")
    fi
    [[ -n "${current_range// /}" ]] || die "Current IP/CIDR is required"

    local extra_ranges
    extra_ranges=$(tty_read "Additional allowed IPs/CIDRs, comma separated [optional]: ")
    if [[ -n "${extra_ranges// /}" ]]; then
      ranges="${current_range},${extra_ranges}"
    else
      ranges="$current_range"
    fi
  fi

  ranges="${ranges//,/ }"
  [[ -n "${ranges// /}" ]] || die "No IP ranges provided for allowlist"

  local tmp
  tmp=$(mktemp)
  {
    echo "apiVersion: traefik.io/v1alpha1"
    echo "kind: Middleware"
    echo "metadata:"
    echo "  name: ${IP_ALLOWLIST_MIDDLEWARE}"
    echo "  namespace: ${NAMESPACE}"
    echo "spec:"
    echo "  ipAllowList:"
    echo "    sourceRange:"
    for range in $ranges; do
      echo "      - ${range}"
    done
  } > "$tmp"

  kubectl apply -f "$tmp"
  rm -f "$tmp"
  IP_ALLOWLIST_ENABLED=1
  ok "Created Traefik IP allowlist middleware: ${NAMESPACE}/${IP_ALLOWLIST_MIDDLEWARE}"
}

traefik_middlewares_annotation() {
  local include_redirect="${1:-1}"
  local middlewares=()
  if [[ "$include_redirect" == "1" && "$TRAEFIK_HTTPS_REDIRECT_ENABLED" == "1" ]]; then
    middlewares+=("${NAMESPACE}-${TRAEFIK_HTTPS_REDIRECT_MIDDLEWARE}@kubernetescrd")
  fi
  if [[ "$IP_ALLOWLIST_ENABLED" == "1" ]]; then
    middlewares+=("${NAMESPACE}-${IP_ALLOWLIST_MIDDLEWARE}@kubernetescrd")
  fi

  if [[ ${#middlewares[@]} -eq 0 ]]; then
    printf '%s' ""
    return 0
  fi

  local joined
  joined=$(IFS=,; echo "${middlewares[*]}")
  printf '%s' "$joined"
}

annotate_traefik_middlewares() {
  local ingress_name="$1"
  local include_redirect="${2:-1}"

  if kubectl get ingress "$ingress_name" -n "$NAMESPACE" >/dev/null 2>&1; then
    local middleware_annotation
    middleware_annotation=$(traefik_middlewares_annotation "$include_redirect")
    if [[ -z "$middleware_annotation" ]]; then
      return 0
    fi
    kubectl annotate ingress "$ingress_name" -n "$NAMESPACE" \
      "traefik.ingress.kubernetes.io/router.middlewares=${middleware_annotation}" \
      --overwrite
    ok "Applied Traefik middlewares to ingress: $ingress_name"
  fi
}

ensure_traefik_hostnetwork_accesslog() {
  local waited=0
  until kubectl -n kube-system get deploy traefik >/dev/null 2>&1; do
    if [[ $waited -ge 60 ]]; then
      warn "Traefik deployment not found in kube-system; skipping hostNetwork/accesslog patch"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done

  local patch='['
  local needs_patch=0

  if ! kubectl -n kube-system get deploy traefik -o jsonpath='{.spec.template.spec.hostNetwork}' 2>/dev/null | grep -qx "true"; then
    patch+='{"op":"add","path":"/spec/template/spec/hostNetwork","value":true},'
    needs_patch=1
  fi

  if ! kubectl -n kube-system get deploy traefik -o jsonpath='{.spec.template.spec.dnsPolicy}' 2>/dev/null | grep -qx "ClusterFirstWithHostNet"; then
    patch+='{"op":"add","path":"/spec/template/spec/dnsPolicy","value":"ClusterFirstWithHostNet"},'
    needs_patch=1
  fi

  local args
  args=$(kubectl -n kube-system get deploy traefik -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null || true)
  if ! grep -Fqx -- '--accesslog=true' <<<"$args"; then
    patch+='{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--accesslog=true"},'
    needs_patch=1
  fi
  if ! grep -Fqx -- '--accesslog.format=json' <<<"$args"; then
    patch+='{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--accesslog.format=json"},'
    needs_patch=1
  fi
  if ! grep -Fqx -- '--accesslog.fields.defaultmode=keep' <<<"$args"; then
    patch+='{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--accesslog.fields.defaultmode=keep"},'
    needs_patch=1
  fi
  if ! grep -Fqx -- '--accesslog.fields.headers.defaultmode=keep' <<<"$args"; then
    patch+='{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--accesslog.fields.headers.defaultmode=keep"},'
    needs_patch=1
  fi

  if [[ "$needs_patch" != "1" ]]; then
    ok "Traefik already configured for hostNetwork/accesslog"
    return 0
  fi

  patch="${patch%,}]"
  kubectl -n kube-system patch deploy traefik --type='json' -p="$patch"
  ok "Patched Traefik for hostNetwork/accesslog"
}

install_homebrew() {
  if have brew; then
    return
  fi

  log "Homebrew not found; installing Homebrew..."
  if ! have curl; then
    die "curl is required to install Homebrew. Install curl first, then rerun this script."
  fi

  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  have brew || die "Homebrew installed, but 'brew' is not on PATH. Open a new terminal or add brew shellenv to your shell profile."
}

install_kubectl_linux() {
  log "Installing kubectl using official binary download..."

  local arch
  case "$(uname -m)" in
    x86_64|amd64)  arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "Unsupported architecture: $(uname -m)" ;;
  esac

  local kube_version
  kube_version="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  curl -fsSL -o "$tmp/kubectl" "https://dl.k8s.io/release/${kube_version}/bin/linux/${arch}/kubectl"
  run_sudo install -o root -g root -m 0755 "$tmp/kubectl" /usr/local/bin/kubectl
}

install_helm_linux() {
  log "Installing Helm using official install script..."

  if ! have curl; then
    die "curl is required to install Helm. Install curl first, then rerun this script."
  fi

  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | run_sudo bash
}

install_git_linux() {
  log "Installing git..."

  local pm
  pm="$(linux_pkg_manager)"

  case "$pm" in
    apt)    run_sudo apt-get update && run_sudo apt-get install -y git ;;
    dnf)    run_sudo dnf install -y git ;;
    yum)    run_sudo yum install -y git ;;
    pacman) run_sudo pacman -S --needed --noconfirm git ;;
    zypper) run_sudo zypper --non-interactive install git ;;
    apk)    run_sudo apk add --no-cache git ;;
    *)      die "Cannot install git: no supported package manager found." ;;
  esac
}

install_k3s_linux() {
  log "Installing k3s using official install script..."

  if ! have curl; then
    die "curl is required to install k3s. Install curl first, then rerun this script."
  fi

  # Run in a subshell with `set +u` so SHELLOPTS doesn't export `nounset`
  # into the k3s installer, which uses uninitialized vars internally.
  ( set +u; curl -sfL https://get.k3s.io | run_sudo sh - )
}

install_k9s() {
  log "Installing k9s via webinstall.dev..."
  ( set +u; curl -sS https://webinstall.dev/k9s | bash )
  # shellcheck source=/dev/null
  [[ -f "${HOME}/.config/envman/PATH.env" ]] && source "${HOME}/.config/envman/PATH.env"
}

install_prereqs_macos() {
  install_homebrew

  local formulas=()
  have kubectl || formulas+=("kubernetes-cli")
  have helm    || formulas+=("helm")
  have git     || formulas+=("git")

  if [[ ${#formulas[@]} -gt 0 ]]; then
    log "Installing missing macOS tools with Homebrew: ${formulas[*]}"
    brew install "${formulas[@]}"
  fi

  have k9s || install_k9s
}

install_prereqs_linux() {
  have kubectl || install_kubectl_linux
  have helm    || install_helm_linux
  have git     || install_git_linux
  have k3s     || install_k3s_linux
  have k9s     || install_k9s
}

install_missing_prereqs() {
  case "$(uname -s)" in
    Darwin)
      install_prereqs_macos
      ;;
    Linux)
      install_prereqs_linux
      ;;
    *)
      die "Unsupported OS: $(uname -s). This setup script supports macOS and Linux."
      ;;
  esac
}

check_prereqs() {
  log "Checking prerequisites..."

  local missing=()
  for cmd in kubectl helm git k3s; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    confirm_install "${missing[@]}"
    install_missing_prereqs
  fi

  missing=()
  for cmd in kubectl helm git k3s; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing tools after attempted installation: ${missing[*]}"
  fi

  ok "Required tools are installed"

  # Ensure kubeconfig is set up
  setup_kubeconfig

  # Ensure k3s server is running
  if ! kubectl get nodes 2>/dev/null | grep -q "Ready"; then
    if have k3s; then
      log "k3s cluster not responding — checking service..."
      if have systemctl; then
        if ! systemctl is-active --quiet k3s; then
          log "Starting k3s service..."
          run_sudo systemctl start k3s
          run_sudo systemctl enable k3s 2>/dev/null || true
        fi
      else
        run_sudo service k3s start 2>/dev/null || true
      fi

      # Wait for k3s to be ready (up to 120s)
      local waited=0
      while [[ $waited -lt 120 ]]; do
        if kubectl get nodes 2>/dev/null | grep -q "Ready"; then
          break
        fi
        sleep 5
        waited=$((waited + 5))
        if (( waited % 15 == 0 )); then
          log "  Waiting for k3s... (${waited}s)"
        fi
      done

      if ! kubectl get nodes 2>/dev/null | grep -q "Ready"; then
        die "k3s failed to start within 120 seconds."
      fi
    else
      die "k3s not found. Install k3s first."
    fi
  fi

  ok "k3s cluster is running"
  ensure_traefik_hostnetwork_accesslog
}

setup_kubeconfig() {
  local k3s_yaml="/etc/rancher/k3s/k3s.yaml"

  # Create .kube dir if it doesn't exist
  mkdir -p "$HOME/.kube"

  # If kubeconfig already readable, nothing to do
  if kubectl cluster-info >/dev/null 2>&1; then
    return 0
  fi

  # If k3s yaml doesn't exist, nothing to copy
  if [[ ! -f "$k3s_yaml" ]]; then
    warn "k3s kubeconfig not found at $k3s_yaml"
    return 0
  fi

  # Don't overwrite existing kubeconfig with different contents
  if [[ -f "$HOME/.kube/config" ]]; then
    warn "Existing kubeconfig found at $HOME/.kube/config — not overwriting"
    return 0
  fi

  log "Copying k3s kubeconfig..."
  run_sudo cp "$k3s_yaml" "$HOME/.kube/config"
  run_sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
  chmod 600 "$HOME/.kube/config"

  ok "Kubeconfig copied to $HOME/.kube/config"
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
    log "Keycloak disabled (--mock-auth), using MOCK_AUTH mode"
    return
  fi

  local keycloak_running=0
  if kubectl get keycloak keycloak -n "$KEYCLOAK_NS" >/dev/null 2>&1 && \
     kubectl get pods -n "$KEYCLOAK_NS" -l app=keycloak 2>/dev/null | grep -q "Running"; then
    warn "Keycloak already running in cluster"
    keycloak_running=1
  fi

  if [[ "$keycloak_running" == "0" ]]; then
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
  fi

  # Step 3: Apply Keycloak resources — patch hostnames for k3s
  if [[ -f "$KEYCLOAK_CRD_FILE" ]]; then
    log "Applying Keycloak resources (PostgreSQL cluster + server + realm)..."

    local tmp
    tmp=$(mktemp)
    cp "$KEYCLOAK_CRD_FILE" "$tmp"

    # Patch namespace if not default
    if [[ "$KEYCLOAK_NS" != "csoc" ]]; then
      sed -i "s/namespace: csoc/namespace: ${KEYCLOAK_NS}/g" "$tmp"
    fi

    # Patch hostnames for k3s
    sed -i "s/hostname: keycloak.local/hostname: ${KEYCLOAK_HOSTNAME}/g" "$tmp"
    sed -i "s/hostname: keycloak.aws/hostname: ${KEYCLOAK_HOSTNAME}/g" "$tmp"
    sed -i "s/host: keycloak.local/host: ${KEYCLOAK_HOSTNAME}/g" "$tmp"
    sed -i "s/host: keycloak.aws/host: ${KEYCLOAK_HOSTNAME}/g" "$tmp"
    sed -i "s|- keycloak.local|- ${KEYCLOAK_HOSTNAME}|g" "$tmp"

    # Patch ingress class for k3s (traefik instead of nginx)
    sed -i "s/ingressClassName: nginx/ingressClassName: traefik/g" "$tmp"
    sed -i '/nginx.ingress.kubernetes.io\/ssl-redirect/d' "$tmp"
    sed -i '/nginx.ingress.kubernetes.io\/proxy-buffer-size/d' "$tmp"
    sed -i '/^  tls:$/,/^  rules:$/d' "$tmp"
    sed -i "/^  annotations:/a\\    traefik.ingress.kubernetes.io/router.entrypoints: web,websecure" "$tmp"
    sed -i "/^  annotations:/a\\    traefik.ingress.kubernetes.io/router.middlewares: ${NAMESPACE}-${TRAEFIK_HTTPS_REDIRECT_MIDDLEWARE}@kubernetescrd" "$tmp"
    sed -i "/^  annotations:/a\\    traefik.ingress.kubernetes.io/router.tls: \"true\"" "$tmp"

    # Patch redirect URIs for k3s
    sed -i "s|http://localhost:3000|https://${HOSTNAME}|g" "$tmp"
    sed -i "s|http://csoc.local|https://${HOSTNAME}|g" "$tmp"
    sed -i "s|http://csoc.aws|https://${HOSTNAME}|g" "$tmp"

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

  ensure_values_file

  # Create namespace if needed
  if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    kubectl create namespace "$NAMESPACE"
    ok "Created namespace: $NAMESPACE"
  fi

  ensure_traefik_https_redirect_middleware
  ensure_ip_allowlist

  log "Deploying CSOC portal via Helm..."
  log "  Chart:    $HELM_CHART"
  log "  Values:   $VALUES_FILE"
  log "  API tag:  $API_IMAGE_TAG"
  log "  FE tag:   $FRONTEND_IMAGE_TAG"

  local helm_args=(
    --namespace "$NAMESPACE"
    -f "$VALUES_FILE"
    --set "image.api.tag=${API_IMAGE_TAG}"
    --set "image.frontend.tag=${FRONTEND_IMAGE_TAG}"
    --set "frontend.env.NEXTAUTH_URL=http://${HOSTNAME}"
  )

  if [[ "${INSTALL_KEYCLOAK:-0}" == "1" ]]; then
    log "Configuring CSOC portal to use Keycloak (http://${KEYCLOAK_HOSTNAME})..."

    # Create a keycloak-http service on port 80 so pods can reach keycloak.cloud:80
    log "Creating keycloak-http service (port 80 -> keycloak pod:8080)..."
    kubectl apply -n "$NAMESPACE" -f - <<EOF >/dev/null 2>&1 || true
apiVersion: v1
kind: Service
metadata:
  name: keycloak-http
  labels:
    app: keycloak
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: 8080
  selector:
    app: keycloak
    app.kubernetes.io/instance: keycloak
    app.kubernetes.io/managed-by: keycloak-operator
EOF

    # Wait for the service to get a ClusterIP
    local keycloak_ip
    keycloak_ip=""
    local waited=0
    while [[ $waited -lt 30 && -z "$keycloak_ip" ]]; do
      keycloak_ip=$(kubectl get svc keycloak-http -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)
      sleep 2
      waited=$((waited + 2))
    done
    if [[ -z "$keycloak_ip" ]]; then
      die "Failed to create keycloak-http service in namespace '$NAMESPACE'"
    fi
    ok "keycloak-http service ready at $keycloak_ip"

    helm_args+=(
      --set "api.env.MOCK_AUTH=false"
      --set "api.env.KEYCLOAK_URL=${KEYCLOAK_SCHEME}://${KEYCLOAK_HOSTNAME}"
      --set "api.env.KEYCLOAK_REALM=csoc-realm"
      --set "frontend.env.MOCK_AUTH=false"
      --set "frontend.env.ENABLE_MOCK_AUTH=false"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_URL=${KEYCLOAK_SCHEME}://${KEYCLOAK_HOSTNAME}"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_REALM=csoc-realm"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=csoc-client"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_ISSUER=${KEYCLOAK_SCHEME}://${KEYCLOAK_HOSTNAME}/realms/csoc-realm"
      # HostAlias so pods can resolve keycloak.cloud -> Keycloak service
      --set "frontend.hostAliases[0].ip=${keycloak_ip}"
      --set "frontend.hostAliases[0].hostnames[0]=${KEYCLOAK_HOSTNAME}"
    )
  fi

  if helm status "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Upgrading existing release..."
  else
    log "Installing fresh release..."
  fi
  helm upgrade --install "$RELEASE_NAME" "$HELM_CHART" "${helm_args[@]}"
  annotate_traefik_middlewares "$RELEASE_NAME" 0   # no HTTPS redirect on csoc ingress
  annotate_traefik_middlewares "keycloak-ingress" 1

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

  # Get the external IP
  local external_ip
  external_ip=$(curl -s --max-time 5 https://icanhazip.com 2>/dev/null || true)

  echo ""
  echo "  Access:"
  echo "    Frontend:  http://${HOSTNAME}"
  echo "    API:       http://${HOSTNAME}/api/ping"
  echo "    Gen3:      http://${GEN3_HOSTNAME}"
  echo ""

  if [[ -n "$external_ip" ]]; then
    echo "  DNS / /etc/hosts setup:"
    echo "    Add the following line to /etc/hosts:"
    echo ""
    echo "      ${external_ip}  ${HOSTNAME} ${GEN3_HOSTNAME} ${KEYCLOAK_HOSTNAME}"
    echo ""
  fi

  if kubectl get keycloak keycloak -n "$KEYCLOAK_NS" >/dev/null 2>&1; then
    echo "  Keycloak:   http://${KEYCLOAK_HOSTNAME}  (admin/admin)"
    echo "  Realm:      csoc-realm"
    echo "  Client:     csoc-client"
    echo "  Users:      admin/admin (superadmin), devuser/dev (csoc-role)"
  else
    echo "  Keycloak:   NOT INSTALLED (use --mock-auth to skip)"
  fi
  echo ""
}

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --keycloak          Install Keycloak via operator (default: on)
  --mock-auth         Skip Keycloak and deploy with MOCK_AUTH
  --teardown          Remove Helm releases and Keycloak resources
  --status            Show current status
  --cluster-only      Only verify k3s, skip deploy
  --api-tag TAG       API image tag (default: $API_IMAGE_TAG)
  --frontend-tag TAG  Frontend image tag (default: $FRONTEND_IMAGE_TAG)
  --namespace NS      Kubernetes namespace (default: $NAMESPACE)
  --release NAME      Helm release name (default: $RELEASE_NAME)
  --help              Show this help

Examples:
  $(basename "$0")
  $(basename "$0") --mock-auth
  $(basename "$0") --status
  $(basename "$0") --teardown
EOF
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  ACTION=""
  case "${1:-}" in
    --teardown|-t) ACTION="teardown" ;;
    --status|-s)   ACTION="status" ;;
    --help|-h)     usage; exit 0 ;;
  esac

  CLUSTER_ONLY=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keycloak)      INSTALL_KEYCLOAK=1; shift ;;
      --mock-auth)     INSTALL_KEYCLOAK=0; shift ;;
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

  KEYCLOAK_NS="$NAMESPACE"

  check_prereqs
  ensure_repo

  if [[ "$ACTION" == "teardown" ]]; then
    teardown
    exit 0
  fi
  if [[ "$ACTION" == "status" ]]; then
    show_status
    exit 0
  fi

  start_keycloak

  if [[ "$CLUSTER_ONLY" == "0" ]]; then
    deploy_csoc
    wait_for_pods
  fi

  show_status

  ok "Setup complete!"
}

main "$@"
