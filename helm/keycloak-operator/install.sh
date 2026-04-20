#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_VERSION="26.6.1"
NAMESPACE="keycloak"

echo "▶ Installing Keycloak Operator ${KEYCLOAK_VERSION}"
echo "▶ Namespace: ${NAMESPACE}"

echo "▶ Creating namespace (if needed)..."
kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -

echo "▶ Installing CRDs..."
kubectl apply -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${KEYCLOAK_VERSION}/kubernetes/keycloaks.k8s.keycloak.org-v1.yml
kubectl apply -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${KEYCLOAK_VERSION}/kubernetes/keycloakrealmimports.k8s.keycloak.org-v1.yml

echo "▶ Installing Keycloak Operator..."
kubectl -n ${NAMESPACE} apply -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${KEYCLOAK_VERSION}/kubernetes/kubernetes.yml

echo "▶ Ensuring ClusterRoleBinding namespace is correct..."
kubectl patch clusterrolebinding keycloak-operator-clusterrole-binding \
  --type='json' \
  -p='[{"op": "replace", "path": "/subjects/0/namespace", "value":"'"${NAMESPACE}"'"}]' \
  || true

echo "▶ Restarting operator to ensure RBAC is applied..."
kubectl rollout restart deployment/keycloak-operator -n ${NAMESPACE}

echo "▶ Waiting for operator to be ready..."
kubectl rollout status deployment/keycloak-operator -n ${NAMESPACE}

echo "▶ Verifying installation..."
kubectl get pods -n ${NAMESPACE}
kubectl get crds | grep keycloak

echo "✅ Keycloak Operator installed successfully"
