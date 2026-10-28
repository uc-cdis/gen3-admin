#!/usr/bin/env bash
# =============================================================================
# uninstall-csoc.sh - Remove what was installed on and around a CSOC's cluster
#
# Runs inside the gen3-terraform runner image as the "uninstall-csoc"
# operation, before a terraform destroy. The install put things in AWS that
# Terraform does not know about, and that a destroy either trips over (it
# cannot delete subnets an ALB or a Karpenter node still uses) or leaves
# behind. In order, while the controllers that clean up after them still run:
#
#   1. ArgoCD, if there is one, so it does not put back what follows
#   2. Ingresses and LoadBalancer Services: the load balancer controller
#      deletes their ALBs/NLBs and security groups
#   3. The CSOC portal, Keycloak and its database
#   4. Every namespace but the cluster's own (kube-system, karpenter, the
#      built-ins), however what is in them was installed: Helm, ArgoCD, the
#      CSOC portal, kubectl. Their pods go, which frees their PVCs
#   5. Every PVC: the EBS CSI driver deletes the volumes
#   6. Karpenter's nodes: the NodePool's limit goes to zero (Terraform owns
#      the NodePool itself) and its NodeClaims are deleted
#   7. The portal and Keycloak DNS records finish-csoc created
#   8. The CSOC's secrets in Secrets Manager, without the recovery window, so
#      a new install of the same name can create them again straight away
#
# Everything here removes what is in the cluster, Gen3 commons included.
#
# With FORCE=1 nothing graceful is waited for: stuck finalizers are dropped
# after seconds, Karpenter's instances are terminated rather than drained,
# and the cluster's EBS volumes (by the IDs its PVs had) are deleted
# directly. Load balancers are still waited for, briefly: one left behind
# would make the destroy fail at the subnets anyway.
#
# Required env: CLUSTER_NAME AWS_REGION ENVIRONMENT CSOC_HOSTNAME
#   KEYCLOAK_HOSTNAME SECRET_PREFIX
# Optional env: HOSTED_ZONE_ID FORCE
# =============================================================================
set -euo pipefail

NS="csoc"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export KUBECONFIG="$WORK/kubeconfig"

step() { echo; echo "=== $* ==="; }
die()  { echo "ERROR: $*" >&2; exit 1; }

for v in CLUSTER_NAME AWS_REGION ENVIRONMENT CSOC_HOSTNAME KEYCLOAK_HOSTNAME SECRET_PREFIX; do
  [[ -n "${!v:-}" ]] || die "$v is not set"
done

# wait_for SECONDS WHAT COMMAND...: runs COMMAND every 10s until it succeeds.
wait_for() {
  local secs="$1" what="$2" end
  shift 2
  end=$((SECONDS + secs))
  until "$@"; do
    (( SECONDS < end )) || die "timed out after ${secs}s waiting for $what"
    sleep 10
  done
}

# wait_for_quietly SECONDS COMMAND...: like wait_for, but returns false
# instead of failing the run.
wait_for_quietly() {
  local end=$((SECONDS + $1))
  shift
  until "$@"; do
    (( SECONDS < end )) || return 1
    sleep 10
  done
}

# none COMMAND...: true when COMMAND prints nothing.
none() { [[ -z "$("$@" 2>/dev/null)" ]]; }

load_balancer_services() {
  kubectl get svc -A -o jsonpath='{range .items[?(@.spec.type=="LoadBalancer")]}{.metadata.namespace}/{.metadata.name}{"\n"}{end}'
}

FORCE="${FORCE:-}"
# How long anything gets before its finalizers are dropped.
GRACE=300
[[ "$FORCE" == 1 ]] && GRACE=30

step "Connecting to cluster $CLUSTER_NAME"
# A destroy that failed part-way may already have removed the cluster; what
# is outside it (DNS, secrets) still gets cleaned up.
if ! aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" --query cluster.status --output text >/dev/null 2>&1; then
  echo "cluster $CLUSTER_NAME is gone; only DNS and secrets are left to clean up"
  CLUSTER_GONE=1
else
  CLUSTER_GONE=""
  aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION" --kubeconfig "$KUBECONFIG" >/dev/null
fi
[[ "$FORCE" == 1 ]] && echo "FORCE: not waiting for anything graceful"

step "Squid route lambda"
# First, for two reasons. Left running, it writes cloud-proxy.internal.io
# back after the step below deletes it, and the destroy then cannot delete
# the private zone. And its VPC network interface takes AWS about 20 minutes
# to release once the lambda leaves the VPC, holding a subnet and the node
# security group: taking it out now overlaps that wait with everything
# else, instead of the destroy waiting on it at the end. The default route
# it last set stays, so the nodes keep their egress meanwhile.
lambda="${CLUSTER_NAME}-gw-checks-lambda"
if aws lambda get-function --function-name "$lambda" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws lambda put-function-concurrency --function-name "$lambda" --region "$AWS_REGION" \
    --reserved-concurrent-executions 0 >/dev/null
  echo "$lambda: stopped"
  aws lambda update-function-configuration --function-name "$lambda" --region "$AWS_REGION" \
    --vpc-config SubnetIds=[],SecurityGroupIds=[] >/dev/null
  echo "$lambda: out of the VPC; AWS now releases its network interface"
else
  echo "no $lambda"
fi

if [[ -z "$CLUSTER_GONE" ]]; then
# The EBS volumes behind this cluster's PVs, noted now: a forced uninstall
# deletes exactly these once nothing is attached to them.
volumes="$(kubectl get pv -o jsonpath='{range .items[*]}{.spec.csi.volumeHandle}{"\n"}{end}' 2>/dev/null | grep '^vol-' || true)"

step "ArgoCD"
if kubectl get namespace argocd >/dev/null 2>&1; then
  # Without their finalizers, Applications go with ArgoCD instead of waiting
  # on a controller that is gone; the steps below remove what they deployed.
  for app in $(kubectl -n argocd get applications -o name 2>/dev/null); do
    kubectl -n argocd patch "$app" --type json \
      -p '[{"op":"remove","path":"/metadata/finalizers"}]' >/dev/null 2>&1 || true
  done
  helm uninstall argocd -n argocd --wait 2>/dev/null || true
  kubectl delete namespace argocd --timeout=5m
else
  echo "not installed"
fi

step "Load balancers"
kubectl delete ingress --all -A --wait=false
for svc in $(load_balancer_services); do
  kubectl delete svc -n "${svc%%/*}" "${svc#*/}" --wait=false
done
# Each one's finalizer holds it until the controller has deleted the AWS side.
wait_for 600 "the ingresses' load balancers to be deleted" none kubectl get ingress -A -o name
wait_for 600 "the services' load balancers to be deleted" none load_balancer_services

step "CSOC portal and Keycloak"
helm uninstall csoc -n "$NS" --wait 2>/dev/null || echo "csoc chart not installed"
# While their operators still run, so the finalizers are seen to.
kubectl delete keycloakrealmimports,keycloaks --all -A --timeout=5m 2>/dev/null || true
kubectl delete clusters.postgresql.cnpg.io --all -A --timeout=5m 2>/dev/null || true
kubectl delete externalsecrets.external-secrets.io --all -A --timeout=5m 2>/dev/null || true

step "Namespaces"
# What the cluster itself needs to finish this: the EBS CSI driver and load
# balancer controller (kube-system) and Karpenter.
# external-dns stays until the cluster goes: it removes the commons' records
# once their ingresses are deleted above.
keep=" kube-system kube-public kube-node-lease default karpenter external-dns "
for ns in $(kubectl get namespaces -o jsonpath='{.items[*].metadata.name}'); do
  [[ "$keep" == *" $ns "* ]] && continue
  kubectl delete namespace "$ns" --wait=false
done
# A controller's webhooks are cluster-wide and outlive its namespace; once
# its service is gone, every delete they validate fails, and the namespaces
# holding those objects never finish. Remove the ones served from here.
for kind in validatingwebhookconfigurations mutatingwebhookconfigurations; do
  for wh in $(kubectl get "$kind" -o json | jq -r --arg keep "$keep" \
      '.items[] | select(any(.webhooks[]?; .clientConfig.service.namespace as $ns
        | $ns != null and ($keep | contains(" " + $ns + " ") | not))) | .metadata.name'); do
    kubectl delete "$kind" "$wh"
  done
done
gone() {
  local ns
  for ns in $(kubectl get namespaces -o jsonpath='{.items[*].metadata.name}'); do
    [[ "$keep" == *" $ns "* ]] || return 1
  done
}
# Anything still held by the finalizer of a controller that has gone with
# its namespace would hold its namespace forever: after a grace period, let
# it go. What it guarded (an AWS resource, say) is cleaned up below or by
# the destroy.
if ! wait_for_quietly "$GRACE" gone; then
  # Only objects that still carry finalizers (events and most others have
  # none), listed in one call per namespace, and only while the namespace is
  # still there: patching every object one by one took many minutes on a
  # Gen3 namespace, long after it was gone.
  types="$(kubectl api-resources --verbs=list,patch --namespaced -o name | grep -vE '^(events|events\.events\.k8s\.io)$' | paste -sd, -)"
  for ns in $(kubectl get namespaces -o jsonpath='{.items[?(@.status.phase=="Terminating")].metadata.name}'); do
    kubectl get -n "$ns" "$types" -o json 2>/dev/null \
      | jq -r '.items[] | select((.metadata.finalizers // []) | length > 0) | "\(.kind)/\(.metadata.name)"' \
      | while read -r obj; do
          kubectl get namespace "$ns" >/dev/null 2>&1 || break
          echo "removing the finalizers of $ns/$obj"
          kubectl patch -n "$ns" "$obj" --type merge -p '{"metadata":{"finalizers":null}}' >/dev/null 2>&1 || true
        done
  done
fi
wait_for 600 "the namespaces to be deleted" gone

step "Volumes"
kubectl delete pvc --all -A --wait=false
if [[ "$FORCE" != 1 ]]; then
  wait_for 600 "the EBS volumes to be deleted" none kubectl get pv -o name
else
  echo "not waiting; the volumes are deleted after the nodes"
fi

step "Karpenter nodes"
if kubectl get crd nodepools.karpenter.sh >/dev/null 2>&1; then
  for np in $(kubectl get nodepools -o name); do
    kubectl patch "$np" --type merge -p '{"spec":{"limits":{"cpu":"0"}}}' >/dev/null
  done
  kubectl delete nodeclaims --all --wait=false
  if [[ "$FORCE" == 1 ]]; then
    # Only this cluster's Karpenter nodes: both tags must match.
    ids="$(aws ec2 describe-instances --region "$AWS_REGION" \
      --filters Name=tag-key,Values=karpenter.sh/nodepool "Name=tag:eks:eks-cluster-name,Values=$CLUSTER_NAME" \
        Name=instance-state-name,Values=pending,running,stopping,stopped \
      --query 'Reservations[].Instances[].InstanceId' --output text)"
    if [[ -n "$ids" ]]; then
      echo "terminating $ids"
      # shellcheck disable=SC2086 # one argument per instance ID
      aws ec2 terminate-instances --region "$AWS_REGION" --instance-ids $ids --output text --query 'TerminatingInstances[].InstanceId'
    fi
    if ! wait_for_quietly 300 none kubectl get nodeclaims -o name; then
      for nc in $(kubectl get nodeclaims -o name); do
        kubectl patch "$nc" --type merge -p '{"metadata":{"finalizers":null}}' >/dev/null || true
      done
    fi
  else
    wait_for 900 "Karpenter's instances to terminate" none kubectl get nodeclaims -o name
  fi
else
  echo "Karpenter not installed"
fi

if [[ "$FORCE" == 1 && -n "$volumes" ]]; then
  step "EBS volumes"
  for vol in $volumes; do
    state="$(aws ec2 describe-volumes --region "$AWS_REGION" --volume-ids "$vol" \
      --query 'Volumes[0].State' --output text 2>/dev/null || echo gone)"
    case "$state" in
      gone|deleting|deleted|None) echo "$vol: already gone" ;;
      *)
        # Detaching finishes shortly after the instance is gone.
        wait_for_quietly 120 aws ec2 wait volume-available --region "$AWS_REGION" --volume-ids "$vol" || true
        aws ec2 delete-volume --region "$AWS_REGION" --volume-id "$vol" && echo "$vol: deleted" ;;
    esac
  done
fi

fi # cluster steps

step "DNS"
if [[ -n "${HOSTED_ZONE_ID:-}" ]]; then
  for host in "$CSOC_HOSTNAME" "$KEYCLOAK_HOSTNAME"; do
    rec="$(aws route53 list-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
      --query "ResourceRecordSets[?Name=='${host}.' && Type=='CNAME'] | [0]" --output json)"
    if [[ "$rec" == null ]]; then
      echo "$host: no record"
      continue
    fi
    aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
      --change-batch "{\"Comment\":\"CSOC $ENVIRONMENT uninstall\",\"Changes\":[{\"Action\":\"DELETE\",\"ResourceRecordSet\":$rec}]}" \
      --query ChangeInfo.Status --output text
    echo "$host: deleted"
  done
else
  echo "No hosted zone given; remove the records for $CSOC_HOSTNAME and $KEYCLOAK_HOSTNAME yourself."
fi

step "Squid's DNS record"
# The squid gw_checks lambda names the active proxy cloud-proxy.internal.io
# in the VPC's private zone. Terraform did not create that record, and
# cannot delete the zone while it is there.
vpc="$(aws ec2 describe-vpcs --region "$AWS_REGION" --filters "Name=tag:Name,Values=$CLUSTER_NAME" --query 'Vpcs[0].VpcId' --output text 2>/dev/null || true)"
pzone=""
if [[ -n "$vpc" && "$vpc" != None ]]; then
  pzone="$(aws route53 list-hosted-zones-by-vpc --vpc-id "$vpc" --vpc-region "$AWS_REGION" \
    --query "HostedZoneSummaries[?Name=='internal.io.'].HostedZoneId | [0]" --output text 2>/dev/null || true)"
fi
if [[ -n "$pzone" && "$pzone" != None ]]; then
  rec="$(aws route53 list-resource-record-sets --hosted-zone-id "$pzone" \
    --query "ResourceRecordSets[?Name=='cloud-proxy.internal.io.'] | [0]" --output json)"
  if [[ "$rec" != null ]]; then
    aws route53 change-resource-record-sets --hosted-zone-id "$pzone" \
      --change-batch "{\"Changes\":[{\"Action\":\"DELETE\",\"ResourceRecordSet\":$rec}]}" --query ChangeInfo.Status --output text
    echo "cloud-proxy.internal.io: deleted"
  else
    echo "no record"
  fi
else
  echo "no internal.io zone for this VPC"
fi

step "Secrets Manager ($SECRET_PREFIX)"
found=0
for arn in $(aws secretsmanager list-secrets --region "$AWS_REGION" \
    --filters Key=name,Values="$SECRET_PREFIX" --query 'SecretList[].ARN' --output text); do
  aws secretsmanager delete-secret --region "$AWS_REGION" --secret-id "$arn" \
    --force-delete-without-recovery --query Name --output text
  found=1
done
(( found )) || echo "none"

step "CSOC is uninstalled"
echo "The cluster and its network are still there; Destroy removes them."
