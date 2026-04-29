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
log_info "Checking prerequisites..."

if ! command -v kubectl &> /dev/null; then
    log_error "kubectl not found. Please install kubectl: https://kubernetes.io/docs/tasks/tools/"
    exit 1
fi

if ! command -v helm &> /dev/null; then
    log_error "helm not found. Please install helm: https://helm.sh/docs/intro/install/"
    exit 1
fi

# Verify cluster connectivity
if ! kubectl cluster-info &> /dev/null; then
    log_error "Cannot connect to Kubernetes cluster. Please configure kubectl access."
    exit 1
fi

log_success "Prerequisites verified"

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
