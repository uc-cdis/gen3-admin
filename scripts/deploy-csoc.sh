#!/bin/bash
# Deploy CSOC Stack to Kubernetes Cluster
# This script deploys the Gen3-Admin CSOC application to a Kubernetes cluster
# using Helm charts with environment-specific values

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
NAMESPACE="${NAMESPACE:-csoc}"
RELEASE_NAME="${RELEASE_NAME:-csoc}"
CHART_PATH="${CHART_PATH:-helm/csoc}"
ENVIRONMENT="${ENVIRONMENT:-test}"
VALUES_FILE="${VALUES_FILE:-helm/csoc/values-${ENVIRONMENT}.yaml}"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ── Pipe detection / confirmation ────────────────────────────────────────────
is_piped() { [[ ! -t 0 ]]; }

confirm_install() {
    local missing=("$@")
    if [[ ${#missing[@]} -eq 0 ]]; then
        return 0
    fi

    log_warning "Missing tools: ${missing[*]}"
    echo ""
    echo "This script will install the following tools:"
    for cmd in "${missing[@]}"; do
        case "$cmd" in
            kubectl) echo "  - kubectl (Kubernetes CLI)" ;;
            helm)    echo "  - helm (Kubernetes package manager)" ;;
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
            log_error "Installation cancelled. Install the missing tools manually and rerun this script."
            exit 1
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

install_homebrew() {
    if have brew; then
        return
    fi

    log_info "Homebrew not found; installing Homebrew..."
    if ! have curl; then
        log_error "curl is required to install Homebrew. Install curl first, then rerun this script."
        exit 1
    fi

    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    if [[ -x /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi

    have brew || { log_error "Homebrew installed, but 'brew' is not on PATH."; exit 1; }
}

install_kubectl_linux() {
    log_info "Installing kubectl using official binary download..."

    local arch
    case "$(uname -m)" in
        x86_64|amd64)  arch="amd64" ;;
        aarch64|arm64) arch="arm64" ;;
        *) log_error "Unsupported architecture: $(uname -m)"; exit 1 ;;
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
    log_info "Installing Helm using official install script..."

    if ! have curl; then
        log_error "curl is required to install Helm. Install curl first, then rerun this script."
        exit 1
    fi

    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | run_sudo sh
}

install_prereqs_macos() {
    install_homebrew

    local formulas=()
    have kubectl || formulas+=("kubernetes-cli")
    have helm    || formulas+=("helm")

    if [[ ${#formulas[@]} -gt 0 ]]; then
        log_info "Installing missing macOS tools with Homebrew: ${formulas[*]}"
        brew install "${formulas[@]}"
    fi
}

install_prereqs_linux() {
    have kubectl || install_kubectl_linux
    have helm    || install_helm_linux
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
            log_error "Unsupported OS: $(uname -s). This script supports macOS and Linux."
            exit 1
            ;;
    esac
}

check_prereqs() {
    log_info "Checking prerequisites..."

    local missing=()
    for cmd in kubectl helm; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        confirm_install "${missing[@]}"
        install_missing_prereqs
    fi

    missing=()
    for cmd in kubectl helm; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing tools after attempted installation: ${missing[*]}"
        exit 1
    fi

    # Verify cluster connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster. Please configure kubectl access."
        exit 1
    fi

    log_success "Prerequisites verified"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -r|--release)
            RELEASE_NAME="$2"
            shift 2
            ;;
        -e|--environment)
            ENVIRONMENT="$2"
            VALUES_FILE="helm/csoc/values-${ENVIRONMENT}.yaml"
            shift 2
            ;;
        -f|--values-file)
            VALUES_FILE="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: deploy-csoc.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -n, --namespace NAMESPACE        Kubernetes namespace (default: csoc)"
            echo "  -r, --release RELEASE_NAME       Helm release name (default: csoc)"
            echo "  -e, --environment ENVIRONMENT    Environment (test/prod) - determines values file"
            echo "  -f, --values-file FILE           Custom values file path"
            echo "  -h, --help                       Show this help message"
            echo ""
            echo "Examples:"
            echo "  # Deploy to test namespace with test values"
            echo "  ./scripts/deploy-csoc.sh -e test"
            echo ""
            echo "  # Deploy to production with custom values"
            echo "  ./scripts/deploy-csoc.sh -n prod -e prod -f helm/csoc/values-prod-custom.yaml"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}CSOC Deployment${NC}"
echo -e "${BLUE}=====================================${NC}"
echo "Release Name: $RELEASE_NAME"
echo "Namespace: $NAMESPACE"
echo "Chart: $CHART_PATH"
echo "Values File: $VALUES_FILE"
echo ""

# Verify prerequisites
check_prereqs

# Check if namespace exists
log_info "Checking namespace: $NAMESPACE"
if kubectl get namespace "$NAMESPACE" &> /dev/null; then
    log_success "Namespace $NAMESPACE exists"
else
    log_info "Creating namespace: $NAMESPACE"
    kubectl create namespace "$NAMESPACE"
    log_success "Namespace created"
fi

# Verify values file exists
if [ ! -f "$VALUES_FILE" ]; then
    log_error "Values file not found: $VALUES_FILE"
    log_info "Available values files:"
    find helm/csoc -name "values*.yaml" -type f | sed 's/^/  /'
    exit 1
fi

log_success "Values file found: $VALUES_FILE"

# Deploy using helm upgrade --install for idempotency
log_info "Deploying release..."
helm upgrade --install "$RELEASE_NAME" "$CHART_PATH" \
    -n "$NAMESPACE" \
    -f "$VALUES_FILE"
log_success "Release deployed successfully"

echo ""
log_success "Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. Wait for pods to be ready:"
echo "     kubectl rollout status deployment/$RELEASE_NAME -n $NAMESPACE --timeout=5m"
echo ""
echo "  2. Check pod status:"
echo "     kubectl get pods -n $NAMESPACE -o wide"
echo ""
echo "  3. Run E2E tests:"
echo "     bash scripts/test-e2e.sh -n $NAMESPACE"
echo ""
echo "  4. Access services via port-forward:"
echo "     kubectl port-forward -n $NAMESPACE svc/$RELEASE_NAME 3000:80 &"
echo "     kubectl port-forward -n $NAMESPACE svc/$RELEASE_NAME 8002:8002 &"
echo ""
echo "  5. View deployment details:"
echo "     helm status $RELEASE_NAME -n $NAMESPACE"
echo "     helm values $RELEASE_NAME -n $NAMESPACE"
