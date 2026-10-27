#!/usr/bin/env bash
# =============================================================================
# install-csoc.sh - Bootstrap GitOps onto the EKS cluster the wizard created
#
# Runs inside the gen3-terraform runner image, started by the API as the
# "install-csoc" operation. Everything CSOC runs is deployed by ArgoCD from
# the GitOps repo; this script only puts in place what ArgoCD needs before it
# can do that:
#
#   1. The CSOC's secrets in Secrets Manager, generated if absent
#   2. External Secrets Operator and ArgoCD, with the same values the repo
#      has, so ArgoCD takes them over unchanged
#   3. The ClusterSecretStore and ArgoCD's repo login (from Secrets Manager)
#   4. The root Application, which syncs the rest once the PR is merged
#   5. The first admin password, as a Secret the realm import reads; the
#      finish-csoc run deletes it once the realm exists
#
# It also finds the cluster's egress IP, which the API adds to the allowlist:
# CSOC's pods reach Keycloak through its public, allowlisted hostname.
#
# With INSTALL_MODE=direct (no GitOps repo) there is no ArgoCD: steps 2-4
# become installing the controllers, manifests and CSOC chart with Helm and
# kubectl (see direct.sh). finish-csoc applies them again with the egress IP.
#
# Every input is an environment variable the API has already validated. The
# manifests in BOOTSTRAP_DIR were rendered by the API, byte-for-byte as they
# are in the repo. The one secret (the admin password) arrives in a file the
# API deletes afterwards.
#
# Required env: CLUSTER_NAME AWS_REGION ENVIRONMENT SECRET_PREFIX
#   BOOTSTRAP_DIR RESULT_FILE SECRETS_FILE ARGOCD_CHART_VERSION
#   ESO_CHART_VERSION
# Direct mode also: INSTALL_MODE=direct LBC_CHART_VERSION CNPG_CHART_VERSION
# =============================================================================
set -euo pipefail

NS="csoc"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export KUBECONFIG="$WORK/kubeconfig"

step() { echo; echo "=== $* ==="; }
die()  { echo "ERROR: $*" >&2; exit 1; }

MODE="${INSTALL_MODE:-gitops}"
for v in CLUSTER_NAME AWS_REGION ENVIRONMENT SECRET_PREFIX BOOTSTRAP_DIR RESULT_FILE \
         SECRETS_FILE ESO_CHART_VERSION; do
  [[ -n "${!v:-}" ]] || die "$v is not set"
done
case "$MODE" in
  gitops)
    [[ -n "${ARGOCD_CHART_VERSION:-}" ]] || die "ARGOCD_CHART_VERSION is not set"
    for f in argocd-values.yaml external-secrets-values.yaml secret-store.yaml repo-creds.yaml root.yaml; do
      [[ -s "$BOOTSTRAP_DIR/$f" ]] || die "bootstrap file $f is missing"
    done ;;
  direct)
    for v in LBC_CHART_VERSION CNPG_CHART_VERSION; do
      [[ -n "${!v:-}" ]] || die "$v is not set"
    done
    # shellcheck source=direct.sh
    . "$(dirname "$0")/direct.sh"
    direct_check_files ;;
  *) die "INSTALL_MODE must be gitops or direct, got $MODE" ;;
esac

# shellcheck disable=SC1090
. "$SECRETS_FILE"
[[ -n "${CSOC_ADMIN_PASSWORD:-}" ]] || die "no initial admin password was provided"

rand() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

# Create a Secrets Manager secret only if it does not exist yet, so a re-run
# keeps existing sessions, the Keycloak admin login and the client secret.
# The value goes through a 0600 file, never argv.
ensure_sm_secret() {
  local name="$SECRET_PREFIX$1" body="$2"
  if aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$name" >/dev/null 2>&1; then
    echo "$name exists, keeping it"
    return
  fi
  (umask 077; printf '%s' "$body" >"$WORK/secret.json")
  aws secretsmanager create-secret --region "$AWS_REGION" --name "$name" \
    --description "CSOC $ENVIRONMENT; synced into the cluster by External Secrets" \
    --secret-string "file://$WORK/secret.json" \
    --tags "Key=gen3-csoc,Value=$ENVIRONMENT" --output text --query Name >/dev/null
  rm -f "$WORK/secret.json"
  echo "$name created"
}

step "Connecting to cluster $CLUSTER_NAME"
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION" --kubeconfig "$KUBECONFIG" >/dev/null
for _ in $(seq 1 60); do
  ready="$(kubectl get nodes --no-headers 2>/dev/null | grep -c ' Ready' || true)"
  [[ "$ready" -gt 0 ]] && break
  echo "waiting for worker nodes..."
  sleep 10
done
kubectl get nodes

step "Secrets Manager ($SECRET_PREFIX)"
if [[ "$MODE" == gitops ]]; then
  aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "${SECRET_PREFIX}github-app" >/dev/null 2>&1 \
    || die "${SECRET_PREFIX}github-app is missing; connect the GitOps repo in the wizard first"
fi
# Random values are alphanumeric, so they are safe inside JSON strings.
ensure_sm_secret keycloak-admin "{\"username\":\"admin\",\"password\":\"$(rand 32)\"}"
ensure_sm_secret keycloak-client "{\"client-secret\":\"$(rand 40)\"}"
ensure_sm_secret nextauth "{\"NEXTAUTH_SECRET\":\"$(rand 44)\",\"NEXTAUTH_JWT_SECRET\":\"$(rand 44)\"}"

if [[ "$MODE" == gitops ]]; then
step "External Secrets Operator $ESO_CHART_VERSION"
helm repo add external-secrets https://charts.external-secrets.io >/dev/null
helm repo add argo https://argoproj.github.io/argo-helm >/dev/null
helm repo update >/dev/null
helm upgrade --install external-secrets external-secrets/external-secrets \
  --version "$ESO_CHART_VERSION" --namespace external-secrets --create-namespace \
  -f "$BOOTSTRAP_DIR/external-secrets-values.yaml" --wait --timeout 10m

step "ArgoCD $ARGOCD_CHART_VERSION"
helm upgrade --install argocd argo/argo-cd \
  --version "$ARGOCD_CHART_VERSION" --namespace argocd --create-namespace \
  -f "$BOOTSTRAP_DIR/argocd-values.yaml" --wait --timeout 10m

step "Repo access"
kubectl apply -f "$BOOTSTRAP_DIR/secret-store.yaml"
kubectl apply -f "$BOOTSTRAP_DIR/repo-creds.yaml"
if ! kubectl -n argocd wait externalsecret/gitops-repo-creds --for=condition=Ready --timeout=5m; then
  kubectl -n argocd describe externalsecret/gitops-repo-creds | tail -20
  die "External Secrets could not read ${SECRET_PREFIX}github-app; check the external-secrets IRSA role"
fi
fi

step "Egress IP"
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
# The egress IP is what the ALB sees when CSOC's own pods call Keycloak.
# On a new cluster the probe pod can wait for Karpenter to start a node, and
# the private subnets for the squid lambda to give them a route; so it gets
# a few tries, each allowed five minutes to start.
egress=""
# Started, waited for and then read: attaching to it (run -i) can miss the
# output of a pod that is done in under a second.
for attempt in 1 2 3; do
  kubectl -n "$NS" delete pod egress-probe --ignore-not-found --wait >/dev/null 2>&1 || true
  kubectl -n "$NS" run egress-probe --restart=Never \
    --image=public.ecr.aws/docker/library/busybox:1.37 -- \
    wget -qO- -T 10 https://checkip.amazonaws.com >/dev/null
  # Done either way, then read: a failed wget says why in its log.
  kubectl -n "$NS" wait pod/egress-probe --for=jsonpath='{.status.phase}'=Succeeded --timeout=5m >/dev/null 2>&1 \
    || kubectl -n "$NS" wait pod/egress-probe --for=jsonpath='{.status.phase}'=Failed --timeout=5s >/dev/null 2>&1 || true
  out="$(kubectl -n "$NS" logs egress-probe 2>&1 | head -c 300)"
  # The log also has wget's own notes (busybox: "TLS certificate
  # validation not implemented"): take the address out of it.
  egress="$(printf '%s\n' "$out" | grep -oE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' | tail -1 || true)"
  if [[ ! "$egress" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "attempt $attempt: $(kubectl -n "$NS" get pod egress-probe -o jsonpath='{.status.phase}' 2>/dev/null): ${out:-no output}"
  fi
  kubectl -n "$NS" delete pod egress-probe --ignore-not-found --wait=false >/dev/null 2>&1 || true
  [[ "$egress" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
  egress=""
done
if [[ -n "$egress" ]]; then
  echo "cluster egress IP: $egress"
else
  egress=""
  echo "WARNING: could not detect the cluster's egress IP. Login will fail until"
  echo "         it is added to the allowlist."
fi
printf '{"egress_ip":"%s"}\n' "$egress" >"$RESULT_FILE"

step "First admin password"
if kubectl -n "$NS" get keycloakrealmimport csoc-realm >/dev/null 2>&1; then
  echo "csoc-realm already exists; its admin password is managed in Keycloak"
else
  (umask 077; printf '%s' "$CSOC_ADMIN_PASSWORD" >"$WORK/password")
  kubectl -n "$NS" create secret generic csoc-admin-bootstrap \
    --from-file=password="$WORK/password" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  rm -f "$WORK/password"
  echo "secret/csoc-admin-bootstrap written; finish-csoc removes it after the realm import"
fi

if [[ "$MODE" == direct ]]; then
  direct_helm_repos
  direct_controllers
  direct_manifests
  direct_csoc_chart
  echo
  echo "=== CSOC is applied ==="
  echo "Next: run finish-csoc. It adds the egress IP to the allowlist, waits for"
  echo "Keycloak and the portal, and creates the DNS records."
  exit 0
fi

step "Root Application"
kubectl apply -f "$BOOTSTRAP_DIR/root.yaml"

echo
echo "=== ArgoCD is ready ==="
echo "Next: merge the CSOC configuration pull request. ArgoCD deploys"
echo "everything else from the repo, then run finish-csoc."
