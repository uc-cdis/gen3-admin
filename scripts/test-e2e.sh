#!/bin/bash
# E2E Testing Checklist for Gen3-Admin Deployment
# Validates core functionality of CSOC deployment on Kubernetes

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
NAMESPACE="${NAMESPACE:-csoc}"
TIMEOUT="${TIMEOUT:-300}"  # 5 minutes
DEPLOYMENT_NAME="csoc"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    ((TESTS_PASSED++))
}

log_failure() {
    echo -e "${RED}[✗]${NC} $1"
    ((TESTS_FAILED++))
}

log_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
    ((TESTS_TOTAL++))
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -t|--timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}Gen3-Admin E2E Testing${NC}"
echo -e "${BLUE}=====================================${NC}"
echo "Namespace: $NAMESPACE"
echo "Timeout: ${TIMEOUT}s"
echo ""

# Test 1: Namespace exists
log_test "Namespace $NAMESPACE exists"
if kubectl get namespace "$NAMESPACE" &> /dev/null; then
    log_success "Namespace exists"
else
    log_failure "Namespace does not exist"
    exit 1
fi

# Test 2: Deployment exists
log_test "Deployment $DEPLOYMENT_NAME exists in namespace $NAMESPACE"
if kubectl get deployment "$DEPLOYMENT_NAME" -n "$NAMESPACE" &> /dev/null; then
    log_success "Deployment exists"
else
    log_failure "Deployment does not exist"
    exit 1
fi

# Test 3: Wait for deployment to be ready
log_test "Deployment $DEPLOYMENT_NAME is ready (timeout: ${TIMEOUT}s)"
if kubectl rollout status deployment/"$DEPLOYMENT_NAME" -n "$NAMESPACE" --timeout="${TIMEOUT}s" &> /dev/null; then
    log_success "Deployment is ready"
else
    log_failure "Deployment failed to reach ready state"
    # Show pod status for debugging
    echo -e "${YELLOW}Pod Status:${NC}"
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=csoc
    exit 1
fi

# Test 4: Check pod count
log_test "At least one pod is running"
POD_COUNT=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=csoc --field-selector=status.phase=Running -o json | jq '.items | length')
if [ "$POD_COUNT" -gt 0 ]; then
    log_success "Found $POD_COUNT running pod(s)"
else
    log_failure "No running pods found"
    exit 1
fi

# Test 5: Check API container status
log_test "API container is running"
PODS=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=csoc -o jsonpath='{.items[*].metadata.name}')
API_READY=false

for pod in $PODS; do
    CONTAINER_STATUS=$(kubectl get pod "$pod" -n "$NAMESPACE" -o jsonpath='{.status.containerStatuses[?(@.name=="api")].ready}')
    if [ "$CONTAINER_STATUS" == "true" ]; then
        log_success "API container is ready in pod $pod"
        API_READY=true
        break
    fi
done

if [ "$API_READY" != "true" ]; then
    log_failure "API container is not ready"
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=csoc -o wide
fi

# Test 6: Check Frontend container status
log_test "Frontend container is running"
FRONTEND_READY=false

for pod in $PODS; do
    CONTAINER_STATUS=$(kubectl get pod "$pod" -n "$NAMESPACE" -o jsonpath='{.status.containerStatuses[?(@.name=="frontend")].ready}')
    if [ "$CONTAINER_STATUS" == "true" ]; then
        log_success "Frontend container is ready in pod $pod"
        FRONTEND_READY=true
        break
    fi
done

if [ "$FRONTEND_READY" != "true" ]; then
    log_failure "Frontend container is not ready"
fi

# Test 7: Check persistent volume
log_test "Persistent volume is bound"
PVC_NAME="csoc-pvc"
PVC_STATUS=$(kubectl get pvc "$PVC_NAME" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || echo "NotFound")

if [ "$PVC_STATUS" == "Bound" ]; then
    log_success "PVC is bound"
elif [ "$PVC_STATUS" == "NotFound" ]; then
    log_failure "PVC not found"
else
    log_failure "PVC status is $PVC_STATUS (expected: Bound)"
fi

# Test 8: Check service endpoints
log_test "Service has endpoints"
SERVICE_NAME="csoc"
ENDPOINTS=$(kubectl get endpoints "$SERVICE_NAME" -n "$NAMESPACE" -o jsonpath='{.subsets[0].addresses | length}' 2>/dev/null || echo "0")

if [ "$ENDPOINTS" -gt 0 ]; then
    log_success "Service has $ENDPOINTS endpoint(s)"
else
    log_failure "Service has no endpoints"
fi

# Test 9: API port is listening
log_test "API port 8002 is listening"
API_PORT=$(kubectl get service "$SERVICE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.ports[?(@.name=="api")].port}' 2>/dev/null || echo "unknown")

if [ "$API_PORT" == "8002" ]; then
    log_success "API port is correctly configured as 8002"
else
    log_failure "API port configuration is incorrect: $API_PORT"
fi

# Test 10: Frontend port is listening
log_test "Frontend port 80 is listening"
FRONTEND_PORT=$(kubectl get service "$SERVICE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.ports[?(@.name=="frontend")].port}' 2>/dev/null || echo "unknown")

if [ "$FRONTEND_PORT" == "80" ]; then
    log_success "Frontend port is correctly configured as 80"
else
    log_failure "Frontend port configuration is incorrect: $FRONTEND_PORT"
fi

# Test 11: Check for pod errors
log_test "No pod errors or crashes"
ERROR_COUNT=$(kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=csoc --tail=100 2>/dev/null | grep -i "error\|fatal\|panic" | wc -l || echo "0")

if [ "$ERROR_COUNT" -eq 0 ]; then
    log_success "No errors found in recent logs"
else
    log_failure "Found $ERROR_COUNT error(s) in logs"
    kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=csoc --tail=20 | grep -i "error\|fatal\|panic"
fi

# Test 12: Check certificate volume mount
log_test "Certificate volume is mounted"
if kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=csoc -o jsonpath='{.items[0].spec.volumes[*].name}' | grep -q "data-volume"; then
    log_success "Certificate volume is mounted"
else
    log_failure "Certificate volume mount not found"
fi

# Test 13: Verify environment variables
log_test "API environment variables are set"
MOCK_AUTH=$(kubectl get deployment "$DEPLOYMENT_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[?(@.name=="api")].env[?(@.name=="MOCK_AUTH")].value}')

if [ -n "$MOCK_AUTH" ]; then
    log_success "MOCK_AUTH environment variable is set"
else
    log_warning "MOCK_AUTH environment variable not found (expected for test environment)"
fi

# Summary
echo ""
echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}=====================================${NC}"
echo "Total Tests: $TESTS_TOTAL"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    log_success "All tests passed!"
    echo ""
    echo "Next steps:"
    echo "  1. Port-forward to access services:"
    echo "     kubectl port-forward -n $NAMESPACE svc/$SERVICE_NAME 3000:80 &"
    echo ""
    echo "  2. Access frontend at http://localhost:3000"
    echo ""
    echo "  3. Check logs:"
    echo "     kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=csoc -f"
    exit 0
else
    log_failure "$TESTS_FAILED test(s) failed!"
    echo ""
    echo "Debugging:"
    echo "  1. Check pod status:"
    echo "     kubectl get pods -n $NAMESPACE -l app.kubernetes.io/name=csoc -o wide"
    echo ""
    echo "  2. Check pod logs:"
    echo "     kubectl logs -n $NAMESPACE <pod-name>"
    echo ""
    echo "  3. Describe pod:"
    echo "     kubectl describe pod -n $NAMESPACE <pod-name>"
    exit 1
fi
