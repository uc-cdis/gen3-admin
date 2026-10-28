# shellcheck shell=bash
# =============================================================================
# direct.sh - Apply a CSOC's rendered configuration without ArgoCD
#
# Sourced by install-csoc.sh and finish-csoc.sh when INSTALL_MODE=direct, for
# a CSOC with no GitOps repo. BOOTSTRAP_DIR holds the same files the repo
# would, at the same paths (values/, manifests/, keycloak-operator/), and each
# Helm release has the name and namespace its ArgoCD Application would give
# it, so the CSOC can be moved to GitOps later without reinstalling.
#
# Required env: NS BOOTSTRAP_DIR AWS_REGION ESO_CHART_VERSION
#   LBC_CHART_VERSION CNPG_CHART_VERSION
# =============================================================================

CSOC_CHART_DIR="/gen3-admin/helm/csoc"

# A release left mid-operation (a run stopped during an upgrade, say) makes
# every later upgrade fail with "another operation is in progress". Put it
# back: roll an interrupted upgrade or rollback back to its last revision,
# and remove an install that never finished.
helm_unstick() {
  local release="$1" ns="$2" status
  status="$(helm status "$release" -n "$ns" -o json 2>/dev/null | jq -r '.info.status // empty')" || true
  case "$status" in
    pending-install)
      echo "Release $release was left mid-install; removing it to start over"
      helm uninstall "$release" -n "$ns" --wait ;;
    pending-upgrade|pending-rollback)
      echo "Release $release was left mid-operation ($status); rolling back to its last revision"
      helm rollback "$release" -n "$ns" ;;
  esac
}

direct_check_files() {
  local f
  for f in values/external-secrets.yaml values/aws-load-balancer-controller.yaml \
           values/cloudnative-pg.yaml values/csoc.yaml keycloak-operator/kustomization.yaml \
           manifests/storage-class.yaml manifests/secret-store.yaml manifests/external-secrets.yaml \
           manifests/keycloak.yaml manifests/realm.yaml; do
    [[ -s "$BOOTSTRAP_DIR/$f" ]] || die "bootstrap file $f is missing"
  done
  [[ -f "$CSOC_CHART_DIR/Chart.yaml" ]] || die "the CSOC chart is not mounted at $CSOC_CHART_DIR"
}

direct_helm_repos() {
  helm repo add external-secrets https://charts.external-secrets.io >/dev/null
  helm repo add eks https://aws.github.io/eks-charts >/dev/null
  helm repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null
  helm repo add external-dns https://kubernetes-sigs.github.io/external-dns/ >/dev/null
  helm repo add aws-ebs-csi-driver https://kubernetes-sigs.github.io/aws-ebs-csi-driver >/dev/null
  helm repo update >/dev/null
}

# The operators and controllers the CSOC's manifests need, in the order
# ArgoCD's sync waves would apply them.
direct_controllers() {
  local d="$BOOTSTRAP_DIR"
  step "External Secrets Operator $ESO_CHART_VERSION"
  helm_unstick external-secrets external-secrets
  helm upgrade --install external-secrets external-secrets/external-secrets \
    --version "$ESO_CHART_VERSION" --namespace external-secrets --create-namespace \
    -f "$d/values/external-secrets.yaml" --wait --timeout 10m

  step "AWS Load Balancer Controller $LBC_CHART_VERSION"
  helm_unstick aws-load-balancer-controller kube-system
  helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
    --version "$LBC_CHART_VERSION" --namespace kube-system \
    -f "$d/values/aws-load-balancer-controller.yaml" --wait --timeout 10m

  # Points each commons' hostname at its load balancer, so a deploy from the
  # CSOC needs no DNS by hand. Only in the CSOC's zone, only records it owns
  # (TXT records name this cluster), and never the CSOC's own two names,
  # which finish-csoc writes.
  if [[ -n "${EXTERNAL_DNS_ROLE_ARN:-}" && -n "${HOSTED_ZONE_ID:-}" ]]; then
    step "external-dns ${EXTERNAL_DNS_CHART_VERSION:-}"
    helm_unstick external-dns external-dns
    helm upgrade --install external-dns external-dns/external-dns \
      --version "${EXTERNAL_DNS_CHART_VERSION}" --namespace external-dns --create-namespace \
      --set provider.name=aws --set policy=sync --set "txtOwnerId=${CLUSTER_NAME}" \
      --set "sources={ingress}" --set "env[0].name=AWS_DEFAULT_REGION" --set "env[0].value=${AWS_REGION}" \
      --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=${EXTERNAL_DNS_ROLE_ARN}" \
      --set "extraArgs={--zone-id-filter=${HOSTED_ZONE_ID},--exclude-domains=${CSOC_HOSTNAME},--exclude-domains=${KEYCLOAK_HOSTNAME}}" \
      --wait --timeout 10m
  else
    echo "external-dns: skipped (no zone or role; point commons' hostnames at their load balancers yourself)"
  fi

  # Volumes, for Keycloak's Postgres and the commons. Rendered only for
  # environments whose apply made the driver's role rather than the add-on.
  if [[ -f "$d/values/ebs-csi-driver.yaml" ]]; then
    step "EBS CSI driver $EBS_CSI_CHART_VERSION"
    helm_unstick ebs-csi-driver kube-system
    helm upgrade --install ebs-csi-driver aws-ebs-csi-driver/aws-ebs-csi-driver \
      --version "$EBS_CSI_CHART_VERSION" --namespace kube-system \
      -f "$d/values/ebs-csi-driver.yaml" --wait --timeout 10m
  fi

  step "CloudNativePG $CNPG_CHART_VERSION"
  helm_unstick cloudnative-pg cnpg-system
  helm upgrade --install cloudnative-pg cnpg/cloudnative-pg \
    --version "$CNPG_CHART_VERSION" --namespace cnpg-system --create-namespace \
    -f "$d/values/cloudnative-pg.yaml" --wait --timeout 10m

  step "Keycloak operator"
  kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl kustomize "$d/keycloak-operator" | kubectl apply --server-side --force-conflicts -f - >/dev/null
  kubectl -n "$NS" rollout status deploy/keycloak-operator --timeout=5m
}

# The CSOC's own manifests: storage, its secrets, Keycloak and the realm.
direct_manifests() {
  local d="$BOOTSTRAP_DIR/manifests"
  step "CSOC manifests"
  kubectl apply -f "$d/storage-class.yaml"
  kubectl apply -f "$d/secret-store.yaml"
  kubectl -n "$NS" apply -f "$d/external-secrets.yaml"
  local es
  for es in keycloak-admin-credentials csoc-keycloak-client csoc-nextauth; do
    if ! kubectl -n "$NS" wait "externalsecret/$es" --for=condition=Ready --timeout=5m; then
      kubectl -n "$NS" describe "externalsecret/$es" | tail -20
      die "External Secrets could not read $es; check the external-secrets IRSA role"
    fi
  done
  # The LB controller's webhook must answer before an Ingress can be created;
  # it can lag its rollout by a few seconds.
  local i
  for i in $(seq 1 12); do
    kubectl -n "$NS" apply -f "$d/keycloak.yaml" && break
    [[ "$i" -eq 12 ]] && die "could not apply manifests/keycloak.yaml"
    echo "retrying in 10s..."
    sleep 10
  done
  kubectl -n "$NS" apply -f "$d/realm.yaml"
}

# The portal's login goes through Keycloak's public hostname, which has no
# DNS record until finish-csoc, so only finish waits for it to be ready.
direct_csoc_chart() {
  step "CSOC portal"
  local wait=()
  [[ "${1:-}" == "--wait" ]] && wait=(--wait --timeout 15m)
  helm_unstick csoc "$NS"
  helm upgrade --install csoc "$CSOC_CHART_DIR" --namespace "$NS" --create-namespace \
    -f "$BOOTSTRAP_DIR/values/csoc.yaml" "${wait[@]}"
}
