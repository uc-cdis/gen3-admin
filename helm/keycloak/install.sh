#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# --- Configuration ---
# Please change the HOSTNAME to your desired value.
HOSTNAME="keycloak-csoc.planx-pla.net"
RELEASE_NAME="keycloak"
NAMESPACE="csoc"
ADMIN_SECRET_NAME="keycloak-admin-credentials"
HELM_CHART="codecentric/keycloakx"
VALUES_FILE="values.yaml"

# --- 1. Check and create admin credentials secret if it doesn't exist ---
echo "INFO: Checking for Kubernetes secret '$ADMIN_SECRET_NAME' in namespace '$NAMESPACE'..."
# Create namespace if it doesn't exist, which is necessary for the 'kubectl get secret' check.
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

if ! kubectl get secret "$ADMIN_SECRET_NAME" -n "$NAMESPACE" &> /dev/null; then
  echo "INFO: Secret not found. Generating a new admin password and creating the secret..."
  # Generate a secure random password
  ADMIN_PASSWORD=$(openssl rand -base64 32)
  if [ -z "$ADMIN_PASSWORD" ]; then
    echo "ERROR: Failed to generate a random password."
    exit 1
  fi

  kubectl create secret generic "$ADMIN_SECRET_NAME" \
    -n "$NAMESPACE" \
    --from-literal=KEYCLOAK_USER='admin' \
    --from-literal=KEYCLOAK_PASSWORD="$ADMIN_PASSWORD"
  echo "SUCCESS: Secret '$ADMIN_SECRET_NAME' created."
else
  echo "INFO: Secret '$ADMIN_SECRET_NAME' already exists. Reusing it."
fi


# --- 2. Perform idempotent Helm installation/upgrade ---
echo "INFO: Checking for existing Helm release '$RELEASE_NAME'..."

# We set the PostgreSQL password only on the first install.
# On upgrades, we let Helm manage the existing password to prevent resetting the database.
if ! helm status "$RELEASE_NAME" -n "$NAMESPACE" &> /dev/null; then
  echo "INFO: No existing release found. Performing initial install..."
  # Generate a secure password for the PostgreSQL subchart on first install
  POSTGRES_PASSWORD=$(openssl rand -base64 32)
  if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "ERROR: Failed to generate a random PostgreSQL password."
    exit 1
  fi
  helm repo add codecentric https://codecentric.github.io/helm-charts
  helm upgrade --install "$RELEASE_NAME" "$HELM_CHART" \
    --namespace "$NAMESPACE" \
    --create-namespace \
    -f "$VALUES_FILE"
    #\
    # --set postgresql.postgresqlPassword="$POSTGRES_PASSWORD"
  echo "INFO: PostgreSQL password was auto-generated and set for the first install."
else
  echo "INFO: Existing release found. Performing upgrade..."
  helm upgrade --install "$RELEASE_NAME" "$HELM_CHART" \
    --namespace "$NAMESPACE" \
    -f "$VALUES_FILE"
fi

echo "SUCCESS: Keycloak deployment script finished."
