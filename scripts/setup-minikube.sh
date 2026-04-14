#!/bin/bash
# Setup Minikube cluster for Gen3-Admin E2E testing
# This script automates the creation and configuration of a Minikube cluster
# for testing the Gen3-Admin deployment before production rollout

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CLUSTER_NAME="${CLUSTER_NAME:-gen3-admin-test}"
MINIKUBE_MEMORY="${MINIKUBE_MEMORY:-6144}"  # 6GB
MINIKUBE_CPUS="${MINIKUBE_CPUS:-4}"
MINIKUBE_DISK="${MINIKUBE_DISK:-30g}"
NAMESPACE="${NAMESPACE:-csoc}"

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

ensure_brew() {
    if ! command -v brew &> /dev/null; then
        log_error "Homebrew not found. Please install it first: https://brew.sh"
        exit 1
    fi
}

install_tool() {
    local tool="$1"
    local name="$2"

    if ! command -v "$tool" &> /dev/null; then
        log_warning "$name not found. Installing via Homebrew..."
        brew install "$tool" || {
            log_error "Failed to install $name. Please install manually and re-run."
            exit 1
        }
        log_success "$name installed successfully"
    fi
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    ensure_brew

    install_tool minikube "Minikube"
    install_tool kubectl "kubectl"
    install_tool helm "Helm"

    log_success "All prerequisites are installed"
}

start_minikube() {
    log_info "Starting Minikube cluster: $CLUSTER_NAME"

    # Check if cluster already exists
    if minikube profile list | grep -q "$CLUSTER_NAME"; then
        log_warning "Cluster $CLUSTER_NAME already exists. Starting it..."
        minikube start -p "$CLUSTER_NAME" || log_warning "Cluster may already be running"
    else
        log_info "Creating new Minikube cluster..."
        minikube start \
            -p "$CLUSTER_NAME" \
            --memory="$MINIKUBE_MEMORY" \
            --cpus="$MINIKUBE_CPUS" \
            --disk-size="$MINIKUBE_DISK" \
            --driver=docker \
            --container-runtime=docker \
            --addons=ingress \
            --addons=registry
    fi

    # Set kubectl context to minikube
    kubectl config use-context "$CLUSTER_NAME"
    log_success "Minikube cluster is running"
}

create_namespace() {
    log_info "Creating namespace: $NAMESPACE"
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    log_success "Namespace created"
}

enable_addons() {
    log_info "Enabling useful Minikube addons..."

    addons=("ingress" "metrics-server" "dashboard")

    for addon in "${addons[@]}"; do
        log_info "Enabling addon: $addon"
        minikube addons enable "$addon" -p "$CLUSTER_NAME" || log_warning "Failed to enable $addon"
    done

    log_success "Addons enabled"
}

load_images() {
    log_info "Configuring image loading..."

    # Instructions for using local images
    log_info "To use locally built images:"
    log_info "  1. Build images: docker build -t quay.io/cdis/csoc-api:test ."
    log_info "  2. Load to Minikube: minikube image load quay.io/cdis/csoc-api:test -p $CLUSTER_NAME"
    log_info "  3. Or use: eval \$(minikube docker-env -p $CLUSTER_NAME)"
}

display_info() {
    local MINIKUBE_IP
    MINIKUBE_IP=$(minikube ip -p "$CLUSTER_NAME")

    log_info "Cluster setup complete!"
    echo ""
    log_success "Cluster Information:"
    echo "  Profile: $CLUSTER_NAME"
    echo "  API Server: $(kubectl cluster-info | grep 'Kubernetes master' | awk '{print $NF}')"
    echo "  Namespace: $NAMESPACE"
    echo "  Minikube IP: $MINIKUBE_IP"
    echo ""

    log_success "Next steps:"
    echo "  1. (Optional) Add to /etc/hosts for ingress access:"
    echo "     echo '$MINIKUBE_IP  csoc.local' | sudo tee -a /etc/hosts"
    echo ""
    echo "  2. Set kubectl context:"
    echo "     kubectl config use-context $CLUSTER_NAME"
    echo ""
    echo "  3. Deploy CSOC stack:"
    echo "     bash scripts/deploy-csoc.sh -e test"
    echo ""
    echo "  4. Run E2E tests:"
    echo "     bash scripts/test-e2e.sh -n $NAMESPACE"
    echo ""
    echo "  5. Access application:"
    echo "     - Via ingress (recommended after hosts entry): http://csoc.local"
    echo "     - Via Minikube IP: http://$MINIKUBE_IP"
    echo "     - Via port-forward:"
    echo "       kubectl port-forward -n $NAMESPACE svc/csoc 3000:80 &"
    echo "       then access at http://localhost:3000"
    echo ""
    echo "  6. View Minikube dashboard:"
    echo "     minikube dashboard -p $CLUSTER_NAME"
    echo ""
}

cleanup_on_exit() {
    log_info "Setup complete. To clean up later, run:"
    echo "  minikube delete -p $CLUSTER_NAME"
}

# Main execution
main() {
    echo -e "${BLUE}=====================================${NC}"
    echo -e "${BLUE}Gen3-Admin Minikube Setup${NC}"
    echo -e "${BLUE}=====================================${NC}"
    echo ""

    check_prerequisites
    start_minikube
    create_namespace
    enable_addons
    load_images
    display_info
    cleanup_on_exit
}

main "$@"
