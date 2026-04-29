# Gen3-Admin E2E Testing Guide

This guide covers setting up and testing the Gen3-Admin CSOC deployment on Minikube for local development and demonstration purposes.

## Quick Start

### 1. Initial Setup (One-time)

```bash
# Set up Minikube cluster with required addons and namespace
bash scripts/setup-minikube.sh

# Output will show:
# - Minikube cluster name: gen3-admin-test
# - Minikube IP address (e.g., 192.168.58.2)
# - Instructions for adding to /etc/hosts
```

### 2. Add to /etc/hosts (Optional but recommended)

```bash
# Add this line to /etc/hosts for easy access
echo "192.168.58.2  csoc.local" | sudo tee -a /etc/hosts

# Or manually edit /etc/hosts and add:
# 192.168.58.2 csoc.local
```

### 3. Build Local Images (ARM64)

```bash
# Build API container
docker build -f Dockerfile.api -t csoc-api:arm64-local .

# Build Frontend container
docker build -f Dockerfile.frontend -t csoc-frontend:arm64-local .

# Load images into Minikube
minikube image load csoc-api:arm64-local -p gen3-admin-test
minikube image load csoc-frontend:arm64-local -p gen3-admin-test
```

### 4. Deploy CSOC Stack

```bash
# Deploy using the test environment configuration
bash scripts/deploy-csoc.sh -e test

# This will:
# - Create csoc namespace if needed
# - Deploy API and Frontend containers
# - Configure ingress with nginx
# - Apply test-optimized resource limits
# - Enable mock authentication
```

### 5. Verify Deployment

```bash
# Check pod status
kubectl get pods -n csoc -o wide

# Expected output: Both API and Frontend containers should be READY 2/2 and Running
```

## Accessing the Application

### Option 1: Ingress (Recommended)

After adding to /etc/hosts:
```
http://csoc.local
```

Or using Minikube IP directly:
```
http://192.168.58.2
```

### Option 2: Port Forwarding

```bash
# Terminal 1: Forward frontend
kubectl port-forward -n csoc svc/csoc 3000:80 &

# Terminal 2: Forward API
kubectl port-forward -n csoc svc/csoc 8002:8002 &

# Access at:
# Frontend: http://localhost:3000
# API: http://localhost:8002
```

## Running E2E Tests

```bash
# Run comprehensive E2E test suite
bash scripts/test-e2e.sh -n csoc

# This validates:
# - Namespace exists
# - Deployment is running
# - Pods are ready
# - Services have endpoints
# - Persistent volumes are bound
# - Environment variables are configured
# - No errors in logs
```

## Viewing Logs and Debugging

```bash
# View API container logs
kubectl logs -n csoc -l app.kubernetes.io/name=csoc -c api -f

# View Frontend container logs
kubectl logs -n csoc -l app.kubernetes.io/name=csoc -c frontend -f

# View both containers
kubectl logs -n csoc -l app.kubernetes.io/name=csoc -f

# Describe pod for detailed information
kubectl describe pod -n csoc -l app.kubernetes.io/name=csoc

# Get pod events
kubectl get events -n csoc --sort-by='.lastTimestamp'
```

## Minikube Dashboard

```bash
# Open Minikube dashboard UI
minikube dashboard -p gen3-admin-test

# This provides visual monitoring of:
# - Pod status and resource usage
# - Deployments and replicas
# - Services and ingress
# - Persistent volumes
# - Logs
```

## Deployment Commands Reference

### Deploy/Update Stack
```bash
# Using deployment script
bash scripts/deploy-csoc.sh -e test

# Or use helm directly
helm upgrade --install csoc helm/csoc -n csoc -f helm/csoc/values-test.yaml
```

### View Deployment Status
```bash
# Check release status
helm status csoc -n csoc

# View current values
helm values csoc -n csoc

# Show deployment history
helm history csoc -n csoc
```

### Rollback to Previous Release
```bash
helm rollback csoc -n csoc
```

### Uninstall Release
```bash
helm uninstall csoc -n csoc
```

## Cleanup

### Remove CSOC Stack
```bash
# Uninstall Helm release
helm uninstall csoc -n csoc

# Delete namespace (optional)
kubectl delete namespace csoc
```

### Clean Up Minikube

```bash
# Stop cluster (keeps data)
minikube stop -p gen3-admin-test

# Delete cluster (removes all data)
minikube delete -p gen3-admin-test
```

### Remove /etc/hosts Entry

```bash
# Remove the csoc.local entry from /etc/hosts
# Edit the file and remove the line: 192.168.58.2 csoc.local
```

## Configuration Files

### Test Environment Values
**File:** `helm/csoc/values-test.yaml`

Key settings for testing:
- `pullPolicy: Never` - Uses locally built images
- `MOCK_AUTH: "true"` - Enables mock authentication
- `ENABLE_MOCK_AUTH: "true"` - Frontend mock auth
- Reduced resource requests/limits
- Nginx ingress configuration
- NodePort services for gRPC

### Deployment Script
**File:** `scripts/deploy-csoc.sh`

Options:
```bash
-n, --namespace NAMESPACE     Kubernetes namespace (default: csoc)
-r, --release RELEASE_NAME    Helm release name (default: csoc)
-e, --environment ENVIRONMENT Environment (test/prod)
-f, --values-file FILE        Custom values file path
```

### E2E Test Script
**File:** `scripts/test-e2e.sh`

Options:
```bash
-n, --namespace NAMESPACE  Kubernetes namespace (default: csoc)
-t, --timeout TIMEOUT      Timeout in seconds (default: 300)
```

## Troubleshooting

### Pods not starting - ImagePullBackOff

**Problem:** Pods fail to pull images

**Solution:**
1. Verify local images are built: `docker images | grep csoc`
2. Load images into Minikube: `minikube image load csoc-api:arm64-local -p gen3-admin-test`
3. Verify values file has `pullPolicy: Never`: `helm values csoc -n csoc | grep -A5 image`

### Ingress not getting IP address

**Problem:** Ingress shows `<pending>` for ADDRESS

**Solution:**
1. Verify ingress addon is enabled: `minikube addons list -p gen3-admin-test | grep ingress`
2. Enable if needed: `minikube addons enable ingress -p gen3-admin-test`
3. Check ingress controller: `kubectl get pods -n ingress-nginx`

### Cannot access application at hostname

**Problem:** Can't reach csoc.local

**Solution:**
1. Verify /etc/hosts entry: `grep csoc.local /etc/hosts`
2. Verify Minikube IP: `minikube ip -p gen3-admin-test`
3. Try Minikube IP directly: `http://192.168.58.2`
4. Check ingress: `kubectl get ingress -n csoc`
5. Check pods are running: `kubectl get pods -n csoc -o wide`

### Frontend shows authentication errors

**Problem:** Frontend authentication fails despite MOCK_AUTH

**Solution:**
1. Verify environment variables:
   ```bash
   kubectl get deployment -n csoc csoc -o yaml | grep -A20 frontend
   ```
2. Check frontend logs for auth issues:
   ```bash
   kubectl logs -n csoc -l app.kubernetes.io/name=csoc -c frontend | grep -i auth
   ```
3. Ensure both `MOCK_AUTH` and `ENABLE_MOCK_AUTH` are set to "true"

### API not responding

**Problem:** API endpoints return errors or timeouts

**Solution:**
1. Check API pod logs:
   ```bash
   kubectl logs -n csoc -l app.kubernetes.io/name=csoc -c api
   ```
2. Verify API port is exposed:
   ```bash
   kubectl get svc -n csoc csoc -o yaml | grep -A10 "- name: api"
   ```
3. Test API directly:
   ```bash
   kubectl port-forward -n csoc svc/csoc 8002:8002
   curl http://localhost:8002/ping
   ```

## Next Steps

After testing locally:

1. **Build ARM64 images in CI/CD**
   - GitHub workflow updated to build `linux/amd64,linux/arm64`
   - Images pushed to Quay.io registry

2. **Deploy to Production**
   - Use `helm/csoc/values-prod.yaml` for production settings
   - Configure external domain and TLS certificates
   - Set up Keycloak integration
   - Enable monitoring with Grafana stack

3. **Multi-cluster Management**
   - Deploy agents to other Kubernetes clusters
   - Configure central CSOC server for cluster discovery
   - Set up GitOps with ArgoCD

## Support

For issues or questions:
- Check logs: `kubectl logs -n csoc -l app.kubernetes.io/name=csoc`
- Review events: `kubectl get events -n csoc`
- Describe resources: `kubectl describe pod -n csoc <pod-name>`
