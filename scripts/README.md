# Scripts

Quick-start helpers for spinning up a local CSOC / Gen3 environment.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Minikube](https://minikube.sigs.k8s.io/docs/start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl/)
- [Helm](https://helm.sh/docs/intro/install/)

## setup-minikube.sh

Spins up a Minikube cluster, configures `/etc/hosts`, and deploys the CSOC portal (and optionally Keycloak) via Helm.

### Quick start

```bash
# Clone & enter the repo
git clone <repo-url> gen3-admin
cd gen3-admin

# Full setup — minikube + CSOC portal (uses MOCK_AUTH by default)
chmod +x scripts/setup-minikube.sh
./scripts/setup-minikube.sh
```

### With Keycloak (real auth)

```bash
./scripts/setup-minikube.sh --keycloak
```

This installs:
- **CloudNativePG** operator for Postgres
- **Keycloak** operator + server (`keycloak.local`)
- **CSOC portal** configured to use Keycloak as its OIDC provider

Keycloak credentials: `admin / admin` (superadmin), `devuser / dev` (csoc-role).

### Common options

| Flag | Description |
|---|---|
| *(none)* | Full setup: minikube + hosts + deploy |
| `--cluster-only` | Start minikube only, skip Helm deploy |
| `--teardown` | Stop everything, clean up hosts entries |
| `--status` | Show current cluster/pod/service status |
| `--keycloak` | Install Keycloak operator (default: MOCK_AUTH) |
| `--api-tag TAG` | Override API Docker image tag |
| `--frontend-tag TAG` | Override Frontend Docker image tag |
| `--namespace NS` | Kubernetes namespace (default: `csoc`) |
| `--release NAME` | Helm release name (default: `csoc`) |

### Examples

```bash
# Just get a running cluster
./scripts/setup-minikube.sh --cluster-only

# Use a specific image tag
./scripts/setup-minikube.sh --api-tag main --frontend-tag main

# Tear it all down
./scripts/setup-minikube.sh --teardown

# Check what's running
./scripts/setup-minikube.sh --status
```

### After setup

| URL | What |
|---|---|
| `http://csoc.local` | CSOC portal (ingress) |
| `http://localhost:3000` | Frontend (port-forward) |
| `http://localhost:8002/ping` | API health check |
| `http://keycloak.local` | Keycloak console (if `--keycloak`) |

> **Note:** The script will try to add entries to `/etc/hosts`. If sudo is unavailable or denied, it prints the entries you need to add manually.

## Other scripts

| Script | Purpose |
|---|---|
| `setup-k3s.sh` | Alternative to Minikube — uses k3s instead |
| `deploy-csoc.sh` | Deploy CSOC to an *already running* cluster |
| `workshop-vm.sh` | Provision a workshop VM environment |
| `test-e2e.sh` | End-to-end test runner |
| `setup-docker-desktop.ps1` | Windows PowerShell script for Docker Desktop users |
| `setup-minikube.ps1` | Windows PowerShell script for Minikube on Windows |
