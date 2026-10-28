#!/usr/bin/env bash
# =============================================================================
# finish-csoc.sh - Finish a CSOC install once its GitOps PR is merged
#
# Runs inside the gen3-terraform runner image as the "finish-csoc" operation,
# after install-csoc and after the configuration PR has been merged. It:
#
#   1. Has ArgoCD pick up the merge, and waits for every Application to be
#      synced and healthy
#   2. Waits for the realm import, then deletes the first admin password
#   3. Waits for the ALB and points both hostnames at it in Route53
#
# It changes nothing that the repo describes; ArgoCD owns all of that.
#
# With INSTALL_MODE=direct there is no ArgoCD or PR. Step 1 instead applies
# the CSOC's Keycloak and portal again from BOOTSTRAP_DIR, rendered now with
# the egress IP install-csoc found, and waits for them.
#
# Required env: CLUSTER_NAME AWS_REGION ENVIRONMENT CSOC_HOSTNAME
#   KEYCLOAK_HOSTNAME
# Optional env: HOSTED_ZONE_ID
# Direct mode also: INSTALL_MODE=direct BOOTSTRAP_DIR
# =============================================================================
set -euo pipefail

NS="csoc"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export KUBECONFIG="$WORK/kubeconfig"

step() { echo; echo "=== $* ==="; }
die()  { echo "ERROR: $*" >&2; exit 1; }

for v in CLUSTER_NAME AWS_REGION ENVIRONMENT CSOC_HOSTNAME KEYCLOAK_HOSTNAME; do
  [[ -n "${!v:-}" ]] || die "$v is not set"
done

step "Connecting to cluster $CLUSTER_NAME"
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION" --kubeconfig "$KUBECONFIG" >/dev/null

MODE="${INSTALL_MODE:-gitops}"
if [[ "$MODE" == direct ]]; then
  [[ -n "${BOOTSTRAP_DIR:-}" ]] || die "BOOTSTRAP_DIR is not set"
  for f in manifests/keycloak.yaml values/csoc.yaml; do
    [[ -s "$BOOTSTRAP_DIR/$f" ]] || die "bootstrap file $f is missing"
  done
  # shellcheck source=direct.sh
  . "$(dirname "$0")/direct.sh"
  step "Allowlist"
  # Only these two carry the allowlist; the rest is unchanged since install.
  kubectl -n "$NS" apply -f "$BOOTSTRAP_DIR/manifests/keycloak.yaml"
  kubectl -n "$NS" wait keycloak/keycloak --for=condition=Ready --timeout=15m
  direct_csoc_chart --wait
else
step "ArgoCD"
# Don't wait for the next poll to notice the merge.
kubectl -n argocd annotate application csoc-root argocd.argoproj.io/refresh=hard --overwrite >/dev/null
apps() {
  kubectl -n argocd get applications -o \
    jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.sync.status}{" "}{.status.health.status}{"\n"}{end}'
}
# The root app and the seven it syncs.
want=8
ok=""
for i in $(seq 1 90); do
  list="$(apps 2>/dev/null || true)"
  total="$(grep -c . <<<"$list" || true)"
  good="$(grep -c ' Synced Healthy$' <<<"$list" || true)"
  if [[ "$total" -ge "$want" && "$good" -eq "$total" ]]; then
    ok=1
    break
  fi
  if (( i % 6 == 1 )); then
    echo "$good of $total Applications synced and healthy:"
    while read -r line; do echo "  $line"; done <<<"$list"
  fi
  sleep 20
done
apps | sed 's/^/  /'
if [[ -z "$ok" ]]; then
  echo
  echo "Applications that are not synced and healthy:"
  apps | grep -v ' Synced Healthy$' | while read -r name _; do
    kubectl -n argocd get application "$name" \
      -o jsonpath='{.metadata.name}{": "}{.status.conditions[*].message}{.status.operationState.message}{"\n"}' || true
  done
  die "ArgoCD did not finish syncing within 30 minutes; re-run finish-csoc once it has"
fi
fi

step "Keycloak realm"
if kubectl -n "$NS" get secret csoc-admin-bootstrap >/dev/null 2>&1; then
  kubectl -n "$NS" wait --for=condition=Done keycloakrealmimport/csoc-realm --timeout=15m
  kubectl -n "$NS" delete secret csoc-admin-bootstrap
  echo "first admin password removed from the cluster"
else
  echo "no bootstrap password to remove"
fi

step "Load balancer"
alb=""
for _ in $(seq 1 60); do
  alb="$(kubectl -n "$NS" get ingress csoc -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  [[ -n "$alb" ]] && break
  echo "waiting for the ALB..."
  sleep 10
done
[[ -n "$alb" ]] || die "the ALB was not provisioned; see: kubectl -n kube-system logs deploy/aws-load-balancer-controller"
echo "ALB: $alb"
# The wizard shows it beside the hostnames when DNS is not in Route 53.
[[ -n "${RESULT_FILE:-}" ]] && printf '{"load_balancer":"%s"}\n' "$alb" >"$RESULT_FILE"

if [[ -n "${HOSTED_ZONE_ID:-}" ]]; then
  step "DNS"
  changes=""
  for host in "$CSOC_HOSTNAME" "$KEYCLOAK_HOSTNAME"; do
    changes="$changes${changes:+,}{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$host\",\"Type\":\"CNAME\",\"TTL\":60,\"ResourceRecords\":[{\"Value\":\"$alb\"}]}}"
  done
  aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "{\"Comment\":\"CSOC $ENVIRONMENT\",\"Changes\":[$changes]}" --output text --query ChangeInfo.Status
else
  echo
  echo "No hosted zone given. Point these at $alb:"
  echo "  $CSOC_HOSTNAME"
  echo "  $KEYCLOAK_HOSTNAME"
fi

echo
echo "=== CSOC is installed ==="
echo "Portal:   https://$CSOC_HOSTNAME  (user: admin)"
echo "Keycloak: https://$KEYCLOAK_HOSTNAME"
if [[ "$MODE" == gitops ]]; then
  echo "Changes to CSOC are now pull requests to the GitOps repo."
fi
