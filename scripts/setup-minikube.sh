#!/bin/bash
# =============================================================================
# setup-minikube.sh — Spin up Minikube + deploy CSOC portal via Helm
#
# Usage:
#   chmod +x scripts/setup-minikube.sh
#   ./scripts/setup-minikube.sh              # full setup (minikube + deploy)
#   ./scripts/setup-minikube.sh --teardown   # tear everything down
#   ./scripts/setup-minikube.sh --skip-keycloak
#   ./scripts/setup-minikube.sh --cluster-only  # only start minikube, don't deploy
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-minikube}"
RELEASE_NAME="${RELEASE_NAME:-csoc}"
NAMESPACE="${NAMESPACE:-csoc}"
HELM_CHART="${CHART_PATH:-./helm/csoc}"
VALUES_FILE="./helm/csoc/values-test.yaml"
HOSTNAME="csoc.local"
GEN3_HOSTNAME="gen3.local"
KEYCLOAK_OPERATOR_DIR="./helm/keycloak-operator"
KEYCLOAK_CRD_FILE="./helm/keycloak-bootstrap-operator/keycloak.yaml"
KEYCLOAK_NS="${NAMESPACE}"
KEYCLOAK_HOSTNAME="keycloak.local"
CNPG_VERSION="1.29.0"

# Resolve project root: works when run as a file, empty when piped
if [[ -n "${BASH_SOURCE[0]:-}" ]] && [[ -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  SCRIPT_DIR=""
  PROJECT_ROOT=""
fi

# Quay image tags — override with env vars or CLI flags
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
      minikube) echo "  - minikube (local Kubernetes)" ;;
      kubectl)  echo "  - kubectl (Kubernetes CLI)" ;;
      helm)     echo "  - helm (Kubernetes package manager)" ;;
      docker)   echo "  - Docker (container runtime)" ;;
      *)        echo "  - $cmd" ;;
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

linux_arch_deb() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) die "Unsupported Linux architecture for minikube: $(uname -m)" ;;
  esac
}

linux_arch_rpm() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x86_64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *) die "Unsupported Linux architecture for minikube: $(uname -m)" ;;
  esac
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

  # Make brew available in this non-login shell.
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  have brew || die "Homebrew installed, but 'brew' is not on PATH. Open a new terminal or add brew shellenv to your shell profile."
}

wait_for_docker() {
  local waited=0
  local max_wait="${DOCKER_WAIT_SECONDS:-120}"

  while [[ $waited -lt $max_wait ]]; do
    if docker info >/dev/null 2>&1; then
      ok "Docker daemon is running"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done

  return 1
}

install_prereqs_macos() {
  install_homebrew

  local formulas=()
  have minikube || formulas+=("minikube")
  have kubectl  || formulas+=("kubernetes-cli")
  have helm     || formulas+=("helm")

  if [[ ${#formulas[@]} -gt 0 ]]; then
    log "Installing missing macOS tools with Homebrew: ${formulas[*]}"
    brew install "${formulas[@]}"
  fi

  if ! have docker; then
    log "Installing Docker Desktop with Homebrew cask..."
    brew install --cask docker-desktop
  fi

  if ! docker info >/dev/null 2>&1; then
    warn "Docker Desktop is installed but not running yet. Starting it now..."
    open -a Docker >/dev/null 2>&1 || true
    if ! wait_for_docker; then
      die "Docker Desktop did not become ready. Open Docker Desktop, finish any first-run setup, then rerun this script."
    fi
  fi
}

linux_pkg_update_once() {
  local pm="$1"
  if [[ "${LINUX_PKG_UPDATED:-0}" == "1" ]]; then
    return
  fi

  case "$pm" in
    apt)    run_sudo apt-get update ;;
    dnf)    run_sudo dnf makecache -y || true ;;
    yum)    run_sudo yum makecache -y || true ;;
    pacman) run_sudo pacman -Sy --noconfirm ;;
    zypper) run_sudo zypper --non-interactive refresh ;;
    apk)    run_sudo apk update ;;
  esac

  LINUX_PKG_UPDATED=1
}

install_linux_base_packages() {
  local pm="$1"
  linux_pkg_update_once "$pm"

  case "$pm" in
    apt)
      run_sudo apt-get install -y ca-certificates curl gnupg lsb-release
      ;;
    dnf)
      run_sudo dnf install -y ca-certificates curl gnupg2
      ;;
    yum)
      run_sudo yum install -y ca-certificates curl gnupg2
      ;;
    pacman)
      run_sudo pacman -S --needed --noconfirm ca-certificates curl gnupg
      ;;
    zypper)
      run_sudo zypper --non-interactive install ca-certificates curl gpg2
      ;;
    apk)
      run_sudo apk add --no-cache ca-certificates curl gnupg
      ;;
  esac
}

install_docker_linux() {
  log "Installing Docker using official convenience script..."

  if ! have curl; then
    die "curl is required to install Docker. Install curl first, then rerun this script."
  fi

  curl -fsSL https://get.docker.com | run_sudo sh

  if have systemctl; then
    run_sudo systemctl enable --now docker || true
  else
    run_sudo service docker start 2>/dev/null || true
    run_sudo rc-update add docker default 2>/dev/null || true
  fi

  if getent group docker >/dev/null 2>&1 && [[ -n "${USER:-}" ]]; then
    run_sudo usermod -aG docker "$USER" || true
  fi
}

install_kubectl_linux() {
  local pm="$1"
  local kube_minor="${KUBERNETES_MINOR:-v1.35}"
  log "Installing kubectl with Linux package manager ($pm, Kubernetes repo ${kube_minor})..."

  case "$pm" in
    apt)
      run_sudo install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://pkgs.k8s.io/core:/stable:/${kube_minor}/deb/Release.key" \
        | run_sudo gpg --dearmor --batch --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
      echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${kube_minor}/deb/ /" \
        | run_sudo tee /etc/apt/sources.list.d/kubernetes.list >/dev/null
      run_sudo apt-get update
      run_sudo apt-get install -y kubectl
      ;;
    dnf)
      cat <<EOF | run_sudo tee /etc/yum.repos.d/kubernetes.repo >/dev/null
[kubernetes]
name=Kubernetes
baseurl=https://pkgs.k8s.io/core:/stable:/${kube_minor}/rpm/
enabled=1
gpgcheck=1
gpgkey=https://pkgs.k8s.io/core:/stable:/${kube_minor}/rpm/repodata/repomd.xml.key
EOF
      run_sudo dnf install -y kubectl
      ;;
    yum)
      cat <<EOF | run_sudo tee /etc/yum.repos.d/kubernetes.repo >/dev/null
[kubernetes]
name=Kubernetes
baseurl=https://pkgs.k8s.io/core:/stable:/${kube_minor}/rpm/
enabled=1
gpgcheck=1
gpgkey=https://pkgs.k8s.io/core:/stable:/${kube_minor}/rpm/repodata/repomd.xml.key
EOF
      run_sudo yum install -y kubectl
      ;;
    pacman)
      run_sudo pacman -S --needed --noconfirm kubectl
      ;;
    zypper)
      run_sudo zypper --non-interactive install kubernetes-client
      ;;
    apk)
      run_sudo apk add --no-cache kubectl
      ;;
  esac
}

install_helm_linux() {
  log "Installing Helm using official install script..."

  if ! have curl; then
    die "curl is required to install Helm. Install curl first, then rerun this script."
  fi

  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | run_sudo sh
}

install_minikube_linux() {
  local pm="$1"
  log "Installing minikube with Linux package manager ($pm)..."

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  case "$pm" in
    apt)
      local arch
      arch="$(linux_arch_deb)"
      curl -fsSL -o "$tmp/minikube.deb" "https://storage.googleapis.com/minikube/releases/latest/minikube_latest_${arch}.deb"
      run_sudo apt-get install -y "$tmp/minikube.deb"
      ;;
    dnf)
      local arch
      arch="$(linux_arch_rpm)"
      curl -fsSL -o "$tmp/minikube.rpm" "https://storage.googleapis.com/minikube/releases/latest/minikube-latest.${arch}.rpm"
      run_sudo dnf install -y "$tmp/minikube.rpm"
      ;;
    yum)
      local arch
      arch="$(linux_arch_rpm)"
      curl -fsSL -o "$tmp/minikube.rpm" "https://storage.googleapis.com/minikube/releases/latest/minikube-latest.${arch}.rpm"
      run_sudo yum install -y "$tmp/minikube.rpm"
      ;;
    pacman)
      run_sudo pacman -S --needed --noconfirm minikube
      ;;
    zypper)
      local arch
      arch="$(linux_arch_rpm)"
      curl -fsSL -o "$tmp/minikube.rpm" "https://storage.googleapis.com/minikube/releases/latest/minikube-latest.${arch}.rpm"
      run_sudo zypper --non-interactive install "$tmp/minikube.rpm"
      ;;
    apk)
      die "Automatic minikube install is not supported for apk. Install minikube manually, then rerun this script."
      ;;
  esac
}

install_prereqs_linux() {
  local pm
  pm="$(linux_pkg_manager)"
  [[ -n "$pm" ]] || die "Unsupported Linux distro: no supported package manager found (apt, dnf, yum, pacman, zypper, apk)."

  install_linux_base_packages "$pm"

  have docker   || install_docker_linux
  have kubectl  || install_kubectl_linux "$pm"
  have helm     || install_helm_linux
  have minikube || install_minikube_linux "$pm"

  if ! docker info >/dev/null 2>&1; then
    warn "Docker is installed, but this shell cannot talk to the Docker daemon."
    warn "If your user was just added to the docker group, run 'newgrp docker' or log out/in, then rerun this script."
    die "Docker daemon is not ready for minikube's docker driver."
  fi
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
  for cmd in minikube kubectl helm docker; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    confirm_install "${missing[@]}"
    install_missing_prereqs
  fi

  missing=()
  for cmd in minikube kubectl helm docker; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing tools after attempted installation: ${missing[*]}"
  fi

  if ! docker info >/dev/null 2>&1; then
    die "Docker is installed but not running or not accessible. Start Docker, then rerun this script."
  fi

  ok "Required tools are installed"

  if minikube status -p "$MINIKUBE_PROFILE" 2>/dev/null | grep -q "Running"; then
    ok "Minikube profile '$MINIKUBE_PROFILE' is already running"
  else
    log "Will start Minikube profile '$MINIKUBE_PROFILE'"
  fi
}

# ── Minikube start ───────────────────────────────────────────────────────────
start_minikube() {
  if minikube status -p "$MINIKUBE_PROFILE" 2>/dev/null | grep -q "Running"; then
    warn "Minikube already running, skipping start"
    return
  fi

  log "Starting Minikube (profile: $MINIKUBE_PROFILE)..."
  minikube start \
    -p "$MINIKUBE_PROFILE" \
    --driver=docker \
    --cpus=4 \
    --memory=8192 \
    --disk-size=40g \
    --kubernetes-version=v1.35 \
    --container-runtime=docker

  # Enable required addons
  log "Enabling addons..."
  minikube addons enable metrics-server -p "$MINIKUBE_PROFILE" 2>/dev/null || true
  minikube addons enable ingress         -p "$MINIKUBE_PROFILE" 2>/dev/null || true

  # Wait for ingress controller pod
  log "Waiting for nginx ingress controller pod..."
  local max_wait=120
  local waited=0
  while [[ $waited -lt $max_wait ]]; do
    if kubectl get pods -n ingress-nginx 2>/dev/null | grep -q "Running"; then
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done

  # Wait for the ingress admission webhook to be ready
  # Helm will fail with "failed calling webhook" if the validating webhook
  # service isn't accepting connections yet.
  log "Waiting for nginx ingress admission webhook..."
  waited=0
  max_wait=120
  while [[ $waited -lt $max_wait ]]; do
    # Check that the webhook service is reachable
    if kubectl get endpoints ingress-nginx-controller-admission \
        -n ingress-nginx 2>/dev/null | grep -q "[0-9]"; then
      break
    fi
    sleep 3
    waited=$((waited + 3))
  done

  ok "Minikube is ready"
}

# ── /etc/hosts entry ────────────────────────────────────────────────────────
setup_hosts() {
  local ip
  ip=$(minikube ip -p "$MINIKUBE_PROFILE")

  if grep -qw "$HOSTNAME" /etc/hosts 2>/dev/null; then
    warn "/etc/hosts already has an entry for $HOSTNAME — updating IP to $ip"
    if [[ "$(uname)" == "Darwin" ]]; then
      sudo sed -i '' "/[[:space:]]$HOSTNAME$/d" /etc/hosts
    else
      sudo sed -i "/[[:space:]]$HOSTNAME$/d" /etc/hosts
    fi
  fi

  echo "$ip  $HOSTNAME" | sudo tee -a /etc/hosts > /dev/null
  ok "Added $HOSTNAME -> $ip to /etc/hosts"

  # Also add gen3.local for workshop deployments
  if ! grep -qw "$GEN3_HOSTNAME" /etc/hosts 2>/dev/null; then
    echo "$ip  $GEN3_HOSTNAME" | sudo tee -a /etc/hosts > /dev/null
    ok "Added $GEN3_HOSTNAME -> $ip to /etc/hosts"
  fi
}

# ── CloudNativePG operator ──────────────────────────────────────────────────
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

# ── Keycloak via Operator (opt-in) ──────────────────────────────────────────
start_keycloak() {
  if [[ "${INSTALL_KEYCLOAK:-0}" != "1" ]]; then
    log "Keycloak not requested (--keycloak to enable), using MOCK_AUTH mode"
    return
  fi

  # Check if keycloak pod is already running
  if kubectl get keycloak keycloak -n "$KEYCLOAK_NS" >/dev/null 2>&1 && \
     kubectl get pods -n "$KEYCLOAK_NS" -l app=keycloak 2>/dev/null | grep -q "Running"; then
    warn "Keycloak already running in cluster"
    setup_keycloak_hosts
    return
  fi

  log "Installing Keycloak via Operator..."

  # Step 1: Install CloudNativePG operator
  install_cnpg

  # Step 2: Install Keycloak operator (CRDs + deployment)
  if [[ -f "$KEYCLOAK_OPERATOR_DIR/install.sh" ]]; then
    log "Running Keycloak operator install script..."
    # The install.sh hardcodes namespace="keycloak" — override via env
    NAMESPACE="$KEYCLOAK_NS" bash "$KEYCLOAK_OPERATOR_DIR/install.sh"
  else
    # Fallback: install manually
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

  # Wait for operator to be ready
  log "Waiting for Keycloak operator..."
  kubectl rollout status deployment/keycloak-operator -n "$KEYCLOAK_NS" --timeout=120s

  # Step 3: Apply Keycloak resources (CNPG cluster + server + realm + ingress)
  if [[ -f "$KEYCLOAK_CRD_FILE" ]]; then
    log "Applying Keycloak resources (PostgreSQL cluster + server + realm)..."
    # The CRD file uses a fixed namespace — sed it to match our namespace
    if [[ "$KEYCLOAK_NS" != "csoc" ]]; then
      local tmp
      tmp=$(mktemp)
      sed "s/namespace: csoc/namespace: ${KEYCLOAK_NS}/g" "$KEYCLOAK_CRD_FILE" > "$tmp"
      kubectl apply -f "$tmp"
      rm -f "$tmp"
    else
      kubectl apply -f "$KEYCLOAK_CRD_FILE"
    fi
  else
    die "Keycloak resource file not found: $KEYCLOAK_CRD_FILE"
  fi

  # Step 4: Wait for PostgreSQL cluster to be ready
  log "Waiting for PostgreSQL cluster (keycloak-db) to be ready..."
  kubectl wait --for=condition=Ready cluster/keycloak-db -n "$KEYCLOAK_NS" --timeout=300s

  # Step 5: Wait for Keycloak server pod to be ready
  log "Waiting for Keycloak server pod..."
  kubectl wait --for=condition=ready pod \
    -l app=keycloak -n "$KEYCLOAK_NS" \
    --timeout=300s

  ok "Keycloak is ready"

  # Step 6: Add keycloak hostname to /etc/hosts
  setup_keycloak_hosts
}

# ── Keycloak /etc/hosts entry ──────────────────────────────────────────────
setup_keycloak_hosts() {
  local ip
  ip=$(minikube ip -p "$MINIKUBE_PROFILE")

  if grep -qw "$KEYCLOAK_HOSTNAME" /etc/hosts 2>/dev/null; then
    warn "/etc/hosts already has $KEYCLOAK_HOSTNAME — updating IP to $ip"
    if [[ "$(uname)" == "Darwin" ]]; then
      sudo sed -i '' "/[[:space:]]$KEYCLOAK_HOSTNAME$/d" /etc/hosts
    else
      sudo sed -i "/[[:space:]]$KEYCLOAK_HOSTNAME$/d" /etc/hosts
    fi
  fi

  echo "$ip  $KEYCLOAK_HOSTNAME" | sudo tee -a /etc/hosts > /dev/null
  ok "Added $KEYCLOAK_HOSTNAME -> $ip to /etc/hosts"
}

# ── Helm deploy ──────────────────────────────────────────────────────────────
deploy_csoc() {
  cd "$PROJECT_ROOT"

  if [[ ! -f "$VALUES_FILE" ]]; then
    die "Values file not found: $VALUES_FILE"
  fi

  log "Deploying CSOC portal via Helm..."
  log "  Chart:    $HELM_CHART"
  log "  Values:   $VALUES_FILE"
  log "  API tag:  $API_IMAGE_TAG"
  log "  FE tag:   $FRONTEND_IMAGE_TAG"

  # Create namespace if needed
  if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    kubectl create namespace "$NAMESPACE"
    ok "Created namespace: $NAMESPACE"
  fi

  # Build helm args
  local helm_args=(
    --namespace "$NAMESPACE"
    -f "$VALUES_FILE"
    --set "image.api.tag=${API_IMAGE_TAG}"
    --set "image.frontend.tag=${FRONTEND_IMAGE_TAG}"
    --set "frontend.env.NEXTAUTH_URL=http://${HOSTNAME}"
  )

  # When Keycloak is enabled, switch from MOCK_AUTH to real Keycloak auth
  if [[ "${INSTALL_KEYCLOAK:-0}" == "1" ]]; then
    log "Configuring CSOC portal to use Keycloak (http://keycloak.local)..."

    # Create a keycloak-http service on port 80 so pods can reach keycloak.local:80
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
      # API — disable mock, point to Keycloak
      --set "api.env.MOCK_AUTH=false"
      --set "api.env.KEYCLOAK_URL=http://keycloak.local"
      --set "api.env.KEYCLOAK_REALM=csoc-realm"
      # Frontend — disable mock, point to Keycloak
      --set "frontend.env.MOCK_AUTH=false"
      --set "frontend.env.ENABLE_MOCK_AUTH=false"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_URL=http://keycloak.local"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_REALM=csoc-realm"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=csoc-client"
      --set "frontend.env.NEXT_PUBLIC_KEYCLOAK_ISSUER=http://keycloak.local/realms/csoc-realm"
      # HostAlias so pods can resolve keycloak.local -> Keycloak service
      --set "frontend.hostAliases[0].ip=${keycloak_ip}"
      --set "frontend.hostAliases[0].hostnames[0]=keycloak.local"
    )
  fi

  # Upgrade or install (with retry for transient errors like webhook not ready)
  local max_retries=5
  local retry_delay=10
  local attempt=1
  while [[ $attempt -le $max_retries ]]; do
    if helm status "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
      if [[ $attempt -gt 1 ]]; then log "Upgrading existing release (attempt $attempt/$max_retries)..."; fi
      if [[ $attempt -eq 1 ]]; then log "Upgrading existing release..."; fi
      if helm upgrade "$RELEASE_NAME" "$HELM_CHART" "${helm_args[@]}"; then
        break
      fi
    else
      if [[ $attempt -gt 1 ]]; then log "Installing fresh release (attempt $attempt/$max_retries)..."; fi
      if [[ $attempt -eq 1 ]]; then log "Installing fresh release..."; fi
      if helm install "$RELEASE_NAME" "$HELM_CHART" "${helm_args[@]}"; then
        break
      fi
    fi

    if [[ $attempt -eq $max_retries ]]; then
      die "Helm install/upgrade failed after $max_retries attempts"
    fi

    warn "Helm failed (attempt $attempt/$max_retries), retrying in ${retry_delay}s..."
    sleep $retry_delay
    attempt=$((attempt + 1))
  done

  ok "Helm release '$RELEASE_NAME' deployed to namespace '$NAMESPACE'"
}

# ── Wait for pods ────────────────────────────────────────────────────────────
wait_for_pods() {
  log "Waiting for CSOC pods to become ready..."

  # Wait up to 5 minutes
  kubectl wait \
    --for=condition=ready pod \
    -l "app.kubernetes.io/instance=$RELEASE_NAME" \
    -n "$NAMESPACE" \
    --timeout=300s

  ok "All CSOC pods are ready"

  echo ""
  log "Pod status:"
  kubectl get pods -l "app.kubernetes.io/instance=$RELEASE_NAME" -n "$NAMESPACE" -o wide
  echo ""

  log "Services:"
  kubectl get svc "$RELEASE_NAME" -n "$NAMESPACE"
}

# ── Teardown ─────────────────────────────────────────────────────────────────
teardown() {
  cd "$PROJECT_ROOT"
  log "Tearing down..."

  # Uninstall helm release
  if helm status "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Uninstalling Helm release '$RELEASE_NAME'..."
    helm uninstall "$RELEASE_NAME" -n "$NAMESPACE"
    ok "Helm release uninstalled"
  fi

  # Remove /etc/hosts entry
  if grep -qw "$HOSTNAME" /etc/hosts 2>/dev/null; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sudo sed -i '' "/[[:space:]]$HOSTNAME$/d" /etc/hosts
    else
      sudo sed -i "/[[:space:]]$HOSTNAME$/d" /etc/hosts
    fi
    ok "Removed $HOSTNAME from /etc/hosts"
  fi

  if grep -qw "$GEN3_HOSTNAME" /etc/hosts 2>/dev/null; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sudo sed -i '' "/[[:space:]]$GEN3_HOSTNAME$/d" /etc/hosts
    else
      sudo sed -i "/[[:space:]]$GEN3_HOSTNAME$/d" /etc/hosts
    fi
    ok "Removed $GEN3_HOSTNAME from /etc/hosts"
  fi

  # Stop minikube
  if minikube status -p "$MINIKUBE_PROFILE" 2>/dev/null | grep -q "Running"; then
    log "Stopping Minikube..."
    minikube stop -p "$MINIKUBE_PROFILE"
    ok "Minikube stopped"
  fi

  # Optionally remove keycloak + CNPG
  if [[ "${INSTALL_KEYCLOAK:-0}" == "1" ]]; then
    if kubectl get keycloak keycloak -n "$KEYCLOAK_NS" >/dev/null 2>&1; then
      read -rp "Remove Keycloak + CloudNativePG resources? [y/N] " ans
      if [[ "$ans" =~ ^[Yy]$ ]]; then
        log "Removing Keycloak resources..."
        kubectl delete -f "$KEYCLOAK_CRD_FILE" --ignore-not-found=true 2>/dev/null || true
        kubectl delete cluster keycloak-db -n "$KEYCLOAK_NS" --ignore-not-found=true 2>/dev/null || true
        ok "Keycloak + PostgreSQL removed from namespace '$KEYCLOAK_NS'"
      fi
    fi

    read -rp "Uninstall CloudNativePG operator too? [y/N] " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      log "Removing CloudNativePG operator..."
      kubectl delete -f "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.29/releases/cnpg-${CNPG_VERSION}.yaml" \
        --ignore-not-found=true 2>/dev/null || true
      ok "CloudNativePG operator removed"
    fi

    read -rp "Remove Keycloak operator too? [y/N] " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      log "Removing Keycloak operator..."
      kubectl delete deployment/keycloak-operator -n "$KEYCLOAK_NS" --ignore-not-found=true 2>/dev/null || true
      kubectl delete crds keycloaks.k8s.keycloak.org keycloakrealmimports.k8s.keycloak.org --ignore-not-found=true 2>/dev/null || true
      ok "Keycloak operator removed"
    fi
  fi

  # Remove keycloak hosts entry
  if grep -qw "$KEYCLOAK_HOSTNAME" /etc/hosts 2>/dev/null; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sudo sed -i '' "/[[:space:]]$KEYCLOAK_HOSTNAME$/d" /etc/hosts
    else
      sudo sed -i "/[[:space:]]$KEYCLOAK_HOSTNAME$/d" /etc/hosts
    fi
    ok "Removed $KEYCLOAK_HOSTNAME from /etc/hosts"
  fi

  ok "Teardown complete"
}

# ── Status check ─────────────────────────────────────────────────────────────
show_status() {
  cd "$PROJECT_ROOT"
  echo ""
  echo "============================================"
  echo "  CSOC Portal — Local Minikube Environment"
  echo "============================================"
  echo ""

  if minikube status -p "$MINIKUBE_PROFILE" 2>/dev/null | grep -q "Running"; then
    echo "  Minikube:  $(minikube ip -p "$MINIKUBE_PROFILE")  Running"
  else
    echo "  Minikube:  NOT RUNNING"
  fi

  echo "  Profile:   $MINIKUBE_PROFILE"
  echo "  Namespace: $NAMESPACE"
  echo "  Release:   $RELEASE_NAME"
  echo "  Hostname:  http://$HOSTNAME"
  echo "  Gen3:      http://$GEN3_HOSTNAME"
  echo ""

  if kubectl get svc "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
    echo "  Services:"
    kubectl get svc "$RELEASE_NAME" -n "$NAMESPACE" 2>/dev/null | sed 's/^/    /'
    echo ""
    echo "  Pods:"
    kubectl get pods -l "app.kubernetes.io/instance=$RELEASE_NAME" -n "$NAMESPACE" 2>/dev/null | sed 's/^/    /'
  else
    echo "  Helm release NOT installed yet (run without --status to deploy)"
  fi

  echo ""
  echo "  Quick access:"
  echo "    Frontend:  http://localhost:3000"
  echo "    API:       http://localhost:8002/ping"
  echo "    Ingress:   http://$HOSTNAME"
  echo "    Gen3:      http://$GEN3_HOSTNAME"
  echo ""

  # Keycloak status
  if kubectl get keycloak keycloak -n "$KEYCLOAK_NS" >/dev/null 2>&1; then
    echo "  Keycloak:   http://$KEYCLOAK_HOSTNAME  (admin / admin)"
    echo "  Keycloak pods:"
    kubectl get pods -n "$KEYCLOAK_NS" 2>/dev/null | grep -E "keycloak|keycloak-db" | sed 's/^/    /'
    echo ""
    echo "  Realm:      csoc-realm"
    echo "  Client:     csoc-client"
    echo "  Users:      admin/admin (superadmin), devuser/dev (csoc-role)"
  else
    echo "  Keycloak:   NOT INSTALLED (use --keycloak to enable)"
  fi
  echo ""
}

# ── Usage ───────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --teardown        Tear down everything (stop services, cleanup hosts)
  --status          Show current environment status
  --cluster-only    Only start minikube, skip helm deploy
  --keycloak        Install Keycloak via operator (default: off, uses MOCK_AUTH)
  --api-tag TAG     Override API Docker image tag (default: $API_IMAGE_TAG)
  --frontend-tag TAG Override Frontend Docker image tag (default: $FRONTEND_IMAGE_TAG)
  --namespace NS     Kubernetes namespace (default: $NAMESPACE)
  --release NAME    Helm release name (default: $RELEASE_NAME)
  --help            Show this help message

Examples:
  $(basename "$0")                          # Full setup + deploy
  $(basename "$0") --keycloak              # Setup with Keycloak operator
  $(basename "$0") --cluster-only           # Only start minikube
  $(basename "$0") --api-tag latest         # Use 'latest' tag for API
  $(basename "$0") --teardown               # Tear down
  $(basename "$0") --status                 # Show status
EOF
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  cd "$PROJECT_ROOT"

  case "${1:-}" in
    --teardown|-t)
      teardown
      exit 0
      ;;
    --status|-s)
      show_status
      exit 0
      ;;
    --help|-h|help)
      usage
      exit 0
      ;;
  esac

  # Parse optional flags
  CLUSTER_ONLY=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keycloak) INSTALL_KEYCLOAK=1; shift ;;
      --cluster-only)   CLUSTER_ONLY=1; shift ;;
      --api-tag)        API_IMAGE_TAG="$2"; shift 2 ;;
      --frontend-tag)   FRONTEND_IMAGE_TAG="$2"; shift 2 ;;
      --namespace)      NAMESPACE="$2"; shift 2 ;;
      --release)        RELEASE_NAME="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║   CSOC Portal — Minikube Setup           ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  check_prereqs
  start_minikube
  setup_hosts
  start_keycloak

  if [[ "$CLUSTER_ONLY" == "0" ]]; then
    deploy_csoc
    wait_for_pods
  fi

  show_status

  if [[ "$CLUSTER_ONLY" == "0" ]]; then
    echo ""
    ok "Setup complete! Open http://$HOSTNAME in your browser"
  else
    echo ""
    ok "Minikube ready. Deploy with:  $(basename "$0") --namespace $NAMESPACE"
  fi
  echo ""
  echo "To tear down later:  $(basename "$0") --teardown"
  echo "To check status:     $(basename "$0") --status"
  echo ""
}

main "$@"
