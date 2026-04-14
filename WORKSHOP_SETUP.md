# Gen3-Admin Workshop E2E Testing Setup - Complete

## Overview

This document summarizes the complete E2E testing environment setup for the Gen3-Admin workshop demonstration. The setup enables rapid iteration and testing of the CSOC (Cloud Security Operations Center) deployment on local infrastructure using Minikube.

## What's Been Completed ✅

### Phase 1: E2E Testing Environment (Minikube)

#### 1. Automated Minikube Setup
- **Script:** `scripts/setup-minikube.sh`
- Creates Minikube cluster with:
  - 6GB memory, 4 CPUs, 30GB disk
  - Docker runtime
  - Nginx ingress addon (enabled)
  - Metrics server addon
  - Dashboard addon
  - Automatic namespace creation (csoc)

#### 2. Local Docker Images (ARM64 Support)
- Built locally for Apple Silicon compatibility:
  - `csoc-api:arm64-local` - Go backend API
  - `csoc-frontend:arm64-local` - Next.js frontend
- Updated GitHub workflow to build multi-arch images:
  - `.github/workflows/docker-builds.yaml` now builds `linux/amd64,linux/arm64`

#### 3. Test Environment Configuration
- **File:** `helm/csoc/values-test.yaml`
- Key features:
  - Uses local images (`pullPolicy: Never`)
  - Mock authentication enabled (`MOCK_AUTH: "true"`, `ENABLE_MOCK_AUTH: "true"`)
  - Reduced resource limits for Minikube
  - NEXTAUTH_URL: `http://csoc.local`
  - Nginx ingress with proper path routing

#### 4. Helm Chart Updates
- **File:** `helm/csoc/templates/deployment.yaml`
- Fixed: Frontend container now respects `imagePullPolicy` from values (was hardcoded to `Always`)
- Enables proper local image loading on test environment

#### 5. Deployment Script
- **Script:** `scripts/deploy-csoc.sh`
- Features:
  - Idempotent `helm upgrade --install`
  - Environment-based values selection
  - Automatic namespace creation
  - Pre-flight checks and validation
  - Clear output with access instructions

#### 6. E2E Testing Suite
- **Script:** `scripts/test-e2e.sh`
- Validates 13+ test cases:
  - Namespace and deployment existence
  - Pod readiness and health
  - Container status (API and Frontend)
  - Persistent volume binding
  - Service endpoint configuration
  - Environment variable setup
  - Error checking in logs

#### 7. Comprehensive Documentation
- **File:** `docs/TESTING_GUIDE.md`
- Complete guide covering:
  - Quick start instructions
  - Local image building
  - Multiple access methods (ingress, port-forward)
  - Debugging and troubleshooting
  - Configuration reference

### Ingress Configuration

The ingress routes traffic properly:
```
Host: csoc.local
  /api/auth   → Frontend (port 3000)
  /api        → API (port 8002)
  /           → Frontend (port 3000)
```

This matches the production ingress structure from `deployments/k8s-deploy.yaml`

## Quick Start Guide

### One-time Setup

```bash
# 1. Set up Minikube cluster
bash scripts/setup-minikube.sh

# 2. Add to /etc/hosts (get IP from output above)
echo "192.168.58.2  csoc.local" | sudo tee -a /etc/hosts

# 3. Build local images
docker build -f Dockerfile.api -t csoc-api:arm64-local .
docker build -f Dockerfile.frontend -t csoc-frontend:arm64-local .

# 4. Load into Minikube
minikube image load csoc-api:arm64-local -p gen3-admin-test
minikube image load csoc-frontend:arm64-local -p gen3-admin-test
```

### Deploy and Test

```bash
# Deploy CSOC stack
bash scripts/deploy-csoc.sh -e test

# Run E2E tests
bash scripts/test-e2e.sh -n csoc

# Access application
open http://csoc.local

# View logs
kubectl logs -n csoc -l app.kubernetes.io/name=csoc -f
```

## File Changes Summary

### New Files Created
- `helm/csoc/values-test.yaml` - Test environment configuration
- `scripts/setup-minikube.sh` - Minikube cluster initialization
- `scripts/deploy-csoc.sh` - Deployment automation
- `scripts/test-e2e.sh` - E2E testing suite
- `docs/TESTING_GUIDE.md` - Comprehensive testing documentation
- `WORKSHOP_SETUP.md` - This file

### Modified Files
- `helm/csoc/values.yaml` - Updated image tags to `master`
- `helm/csoc/templates/deployment.yaml` - Fixed frontend `imagePullPolicy`
- `.github/workflows/docker-builds.yaml` - Added ARM64 build support

## Current Status

### ✅ Working
- Minikube cluster running on Apple Silicon
- Local ARM64 images built and loaded
- CSOC pods deployed and healthy
- Ingress configured with nginx
- Mock authentication enabled
- All containers running (2/2 READY)
- E2E test script ready

### 📋 Deployment Details
```
Cluster: gen3-admin-test
Minikube IP: 192.168.58.2
Namespace: csoc
Frontend: http://csoc.local (or http://192.168.58.2)
API: http://csoc.local/api
Status: 2/2 Running pods
```

## Next Steps for Workshop

1. **Verify Everything Works**
   - Add `192.168.58.2 csoc.local` to `/etc/hosts`
   - Open browser to `http://csoc.local`
   - Test mock authentication flow
   - Check API endpoints at `/api`

2. **Demo Preparation**
   - Customize frontend branding if needed
   - Prepare sample cluster configurations
   - Document any custom workflows
   - Create demo script for cluster discovery/import

3. **Production Deployment (Future)**
   - Create `helm/csoc/values-prod.yaml` for AWS/GKE
   - Set up Terraform for infrastructure provisioning
   - Configure external authentication (Keycloak)
   - Set up monitoring with Grafana stack
   - Enable ArgoCD for GitOps

4. **Multi-cluster Setup (Future)**
   - Deploy agents to target clusters
   - Configure agent certificates (mTLS)
   - Set up cross-cluster communication
   - Enable cluster discovery and management

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Minikube Cluster                 │
│                (gen3-admin-test)                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │         Nginx Ingress (192.168.58.2)         │  │
│  │         csoc.local                           │  │
│  └─────────┬──────────────────────────┬─────────┘  │
│            │                          │            │
│    ┌───────▼──────┐         ┌────────▼─────────┐   │
│    │  Frontend    │         │   API (8002)     │   │
│    │  (port 3000) │         │   (gRPC 50051)   │   │
│    │  Next.js     │         │   Go/Gin         │   │
│    └──────────────┘         └──────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │    Persistent Volume (csoc-pvc)              │  │
│  │    - Agent certificates                      │  │
│  │    - Configuration data                      │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Environment Variables

### API Container
- `MOCK_AUTH=true` - Enable mock authentication
- `PORT=8002` - HTTP server port
- Certificate volume mounted at `/go/src/api/certs`

### Frontend Container
- `NEXTAUTH_URL=http://csoc.local` - NextAuth callback URL
- `NEXTAUTH_SECRET=test-secret-change-in-production`
- `NEXTAUTH_JWT_SECRET=test-jwt-secret-change-in-production`
- `MOCK_AUTH=true` - Backend mock auth
- `ENABLE_MOCK_AUTH=true` - Frontend mock auth

## Troubleshooting

### Can't reach csoc.local
- Verify `/etc/hosts` entry: `grep csoc.local /etc/hosts`
- Check Minikube IP: `minikube ip -p gen3-admin-test`
- Verify ingress: `kubectl get ingress -n csoc`

### Pods not starting
- Check image status: `docker images | grep csoc`
- Verify images loaded: `minikube image ls -p gen3-admin-test | grep csoc`
- View pod events: `kubectl describe pod -n csoc <pod-name>`

### API/Frontend errors
- Check logs: `kubectl logs -n csoc -l app.kubernetes.io/name=csoc -f`
- Verify environment: `kubectl get deployment -n csoc csoc -o yaml | grep -A30 env`
- Test connectivity: `kubectl port-forward -n csoc svc/csoc 8002:8002`

## Useful Commands

```bash
# Minikube
minikube start -p gen3-admin-test
minikube stop -p gen3-admin-test
minikube delete -p gen3-admin-test
minikube ip -p gen3-admin-test
minikube dashboard -p gen3-admin-test

# Kubernetes
kubectl config use-context gen3-admin-test
kubectl get all -n csoc
kubectl describe pod -n csoc -l app.kubernetes.io/name=csoc

# Helm
helm status csoc -n csoc
helm values csoc -n csoc
helm history csoc -n csoc
helm rollback csoc -n csoc

# Logs
kubectl logs -n csoc -l app.kubernetes.io/name=csoc -f
kubectl logs -n csoc -l app.kubernetes.io/name=csoc -c api -f
kubectl logs -n csoc -l app.kubernetes.io/name=csoc -c frontend -f

# Port Forwarding
kubectl port-forward -n csoc svc/csoc 3000:80
kubectl port-forward -n csoc svc/csoc 8002:8002
```

## Summary

The Gen3-Admin E2E testing environment is now fully set up and ready for:
- ✅ Local development and testing
- ✅ Workshop demonstrations
- ✅ Pre-production validation
- ✅ CI/CD pipeline testing

All components are containerized, automated, and documented for easy reproduction and scaling to production infrastructure.
