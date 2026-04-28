#!/bin/bash
# cloud-init user-data — bootstraps k3s + gen3-admin workshop
set -euo pipefail

GIT_REPO="${git_repo}"
GIT_BRANCH="${git_branch}"

export DEBIAN_FRONTEND=noninteractive

# ── System prep ──────────────────────────────────────────────────────────────
apt-get update -y
apt-get upgrade -y
apt-get install -y curl wget git unzip software-properties-common apt-transport-https ca-certificates

# ── AWS CLI (for SSM) ───────────────────────────────────────────────────────
curl -sfL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
cd /tmp && unzip -q awscliv2.zip && ./aws/install -i /usr/local/aws-cli -b /usr/local/bin
rm -rf /tmp/aws /tmp/awscliv2.zip

# ── k3s ──────────────────────────────────────────────────────────────────────
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --tls-san $(curl -s http://169.254.169.254/latest/meta-data/public-ipv4) \
  --disable=metrics-server \
  --write-kubeconfig-mode=644" sh -

# Wait for k3s to be ready
until kubectl get nodes | grep -q "Ready"; do sleep 5; done

# ── Helm ─────────────────────────────────────────────────────────────────────
curl -sfL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# ── Set kubeconfig for helm and other tools ─────────────────────────────────
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# ── Clone gen3-admin ─────────────────────────────────────────────────────────
cd /opt
git clone --branch "$GIT_BRANCH" --depth 1 "$GIT_REPO" gen3-admin
cd gen3-admin

# ── Run k3s setup ────────────────────────────────────────────────────────────
chmod +x scripts/setup-k3s.sh
bash scripts/setup-k3s.sh --keycloak

# ── Done ─────────────────────────────────────────────────────────────────────
echo "============================================"
echo "  Workshop VM bootstrap complete!"
echo "============================================"
