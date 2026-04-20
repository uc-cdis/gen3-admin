#!/bin/bash
# =============================================================================
# workshop-vm.sh — Provision / destroy workshop VM on AWS
#
# Usage:
#   ./scripts/workshop-vm.sh --create [--name NAME] [--branch BRANCH] [--region REGION]
#   ./scripts/workshop-vm.sh --destroy [--name NAME] [--region REGION]
#   ./scripts/workshop-vm.sh --status  [--name NAME] [--region REGION]
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="$PROJECT_ROOT/terraform/workshop"

# Defaults
WORKSHOP_NAME="${WORKSHOP_NAME:-gen3-workshop}"
AWS_REGION="${AWS_REGION:-us-east-1}"
GIT_BRANCH="${GIT_BRANCH:-feat_bootstrap-onboarding-impl}"
INSTANCE_TYPE="${INSTANCE_TYPE:-m6i.2xlarge}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()    { echo -e "${BLUE}[workshop]${NC} $*"; }
ok()     { echo -e "${GREEN}✓${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠${NC} $*"; }
die()    { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ── Ensure terraform ───────────────────────────────────────────────────────
ensure_terraform() {
  if command -v terraform >/dev/null 2>&1; then
    return
  fi

  log "Terraform not found. Installing..."

  local arch
  case "$(uname -m)" in
    x86_64)  arch="amd64" ;;
    arm64)   arch="arm64" ;;
    aarch64) arch="arm64" ;;
    *)       die "Unsupported architecture: $(uname -m)" ;;
  esac

  local os
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)      die "Unsupported OS: $(uname -s)" ;;
  esac

  local tf_version="1.11.4"
  local tf_url="https://releases.hashicorp.com/terraform/${tf_version}/terraform_${tf_version}_${os}_${arch}.zip"
  local tf_install_dir="/usr/local/bin"

  curl -sfL "$tf_url" -o /tmp/terraform.zip
  unzip -o /tmp/terraform.zip -d /tmp/terraform

  if [[ -w "$tf_install_dir" ]]; then
    mv /tmp/terraform/terraform "$tf_install_dir/terraform"
  else
    sudo mv /tmp/terraform/terraform "$tf_install_dir/terraform"
  fi
  rm -rf /tmp/terraform /tmp/terraform.zip

  ok "Terraform $(terraform version -raw) installed to $tf_install_dir/terraform"
}

# ── Create ───────────────────────────────────────────────────────────────────
do_create() {
  log "Provisioning workshop VM..."
  log "  Name:     $WORKSHOP_NAME"
  log "  Region:   $AWS_REGION"
  log "  Instance: $INSTANCE_TYPE"
  log "  Branch:   $GIT_BRANCH"
  echo ""

  cd "$TF_DIR"

  # Ensure terraform is available
  ensure_terraform

  # Init if needed
  if [[ ! -d ".terraform" ]]; then
    log "Running terraform init..."
    terraform init
  fi

  # Apply
  log "Running terraform apply..."
  terraform apply \
    -auto-approve \
    -var "workshop_name=$WORKSHOP_NAME" \
    -var "aws_region=$AWS_REGION" \
    -var "git_branch=$GIT_BRANCH" \
    -var "instance_type=$INSTANCE_TYPE"

  # Get outputs
  local public_ip instance_id
  public_ip=$(terraform output -raw public_ip)
  instance_id=$(terraform output -raw instance_id)

  # Update /etc/hosts
  setup_hosts "$public_ip"

  # Wait for cloud-init to finish
  wait_for_bootstrap "$instance_id" "$public_ip"

  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  Workshop VM Ready!                                  ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
  echo "  Public IP:   $public_ip"
  echo "  Instance ID: $instance_id"
  echo ""
  echo "  Access:"
  echo "    Frontend:  http://csoc.aws"
  echo "    Keycloak:  http://keycloak.aws  (admin/admin)"
  echo ""
  echo "  Connect:"
  echo "    SSM:       aws ssm start-session --target $instance_id"
  echo ""
  echo "  Debug:"
  echo "    Logs:      $0 --logs --name $WORKSHOP_NAME"
  echo ""
  echo "  Cleanup:"
  echo "    $0 --destroy --name $WORKSHOP_NAME"
  echo ""
}

# ── Destroy ──────────────────────────────────────────────────────────────────
do_destroy() {
  cd "$TF_DIR"
  ensure_terraform

  # Get IP before destroying
  local public_ip=""
  if terraform output public_ip >/dev/null 2>&1; then
    public_ip=$(terraform output -raw public_ip 2>/dev/null || echo "")
  fi

  log "Destroying workshop VM..."
  terraform destroy \
    -auto-approve \
    -var "workshop_name=$WORKSHOP_NAME" \
    -var "aws_region=$AWS_REGION" \
    -var "instance_type=$INSTANCE_TYPE"

  # Clean /etc/hosts
  if [[ -n "$public_ip" ]]; then
    cleanup_hosts "$public_ip"
  fi

  ok "Workshop VM destroyed"
}

# ── Status ───────────────────────────────────────────────────────────────────
do_status() {
  cd "$TF_DIR"
  ensure_terraform

  if [[ ! -f "terraform.tfstate" ]]; then
    echo "No workshop VM found."
    exit 0
  fi

  local public_ip instance_id
  public_ip=$(terraform output -raw public_ip 2>/dev/null || echo "N/A")
  instance_id=$(terraform output -raw instance_id 2>/dev/null || echo "N/A")

  echo ""
  echo "  Workshop:    $WORKSHOP_NAME"
  echo "  Public IP:   $public_ip"
  echo "  Instance ID: $instance_id"
  echo ""
  echo "  SSM:         aws ssm start-session --target $instance_id"
  echo ""

  # Show cloud-init status via SSM
  if [[ "$instance_id" != "N/A" ]]; then
    log "Checking cloud-init status..."
    ssm_run "$instance_id" "cloud-init status 2>/dev/null || echo 'still running'" "cloud-init"

    log "Checking pods..."
    ssm_run "$instance_id" "sudo kubectl get pods -A -o wide" "pods"
  fi
  echo ""
}

# ── Logs ──────────────────────────────────────────────────────────────────────
do_logs() {
  cd "$TF_DIR"
  ensure_terraform

  if [[ ! -f "terraform.tfstate" ]]; then
    echo "No workshop VM found."
    exit 0
  fi

  local instance_id
  instance_id=$(terraform output -raw instance_id 2>/dev/null || echo "N/A")

  if [[ "$instance_id" == "N/A" ]]; then
    die "No instance found"
  fi

  log "Streaming cloud-init log (via SSM)..."
  log "  Ctrl+C to stop"
  echo ""

  # Use interactive SSM session to tail the log
  ssm_run "$instance_id" "tail -n 50 /var/log/cloud-init-output.log 2>/dev/null || cat /var/log/cloud-init.log 2>/dev/null || echo 'No logs yet'" "logs"
}

# ── SSM helper ───────────────────────────────────────────────────────────────
ssm_run() {
  local instance_id="$1"
  local cmd="$2"
  local label="${3:-output}"

  local cmd_id
  cmd_id=$(aws ssm send-command \
    --instance-ids "$instance_id" \
    --document-name "AWS-RunShellScript" \
    --parameters commands=["$cmd"] \
    --timeout-seconds 30 \
    --output text \
    --query "Command.CommandId" 2>/dev/null) || {
    warn "Could not reach VM via SSM — may still be booting"
    return 1
  }

  # Wait for command to complete
  local waited=0
  while [[ $waited -lt 30 ]]; do
    local status
    status=$(aws ssm list-command-invocations \
      --command-id "$cmd_id" \
      --instance-id "$instance_id" \
      --details \
      --query "CommandInvocations[0].Status" \
      --output text 2>/dev/null || echo "Pending")

    if [[ "$status" == "Success" || "$status" == "Failed" ]]; then
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done

  # Get output
  local output
  output=$(aws ssm list-command-invocations \
    --command-id "$cmd_id" \
    --instance-id "$instance_id" \
    --details \
    --query "CommandInvocations[0].CommandPlugins[0].Output" \
    --output text 2>/dev/null || echo "No output")

  echo "  [$label]"
  echo "$output" | head -50 | sed 's/^/    /'
  echo ""
}

# ── /etc/hosts ──────────────────────────────────────────────────────────────
setup_hosts() {
  local ip="$1"

  log "Updating /etc/hosts..."

  for host in csoc.aws keycloak.aws gen3.aws; do
    # Remove old entry
    if grep -qw "$host" /etc/hosts 2>/dev/null; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sudo sed -i '' "/[[:space:]]$host$/d" /etc/hosts
      else
        sudo sed -i "/[[:space:]]$host$/d" /etc/hosts
      fi
    fi
    # Add new entry
    echo "$ip  $host" | sudo tee -a /etc/hosts > /dev/null
  done

  ok "Added csoc.aws / keycloak.aws / gen3.aws → $ip to /etc/hosts"
}

cleanup_hosts() {
  local ip="$1"
  for host in csoc.aws keycloak.aws gen3.aws; do
    if grep -qw "$host" /etc/hosts 2>/dev/null; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sudo sed -i '' "/[[:space:]]$host$/d" /etc/hosts
      else
        sudo sed -i "/[[:space:]]$host$/d" /etc/hosts
      fi
    fi
  done
  ok "Cleaned up /etc/hosts entries"
}

# ── Wait for bootstrap ──────────────────────────────────────────────────────
wait_for_bootstrap() {
  local instance_id="$1"
  local public_ip="$2"

  log "Waiting for workshop to come up (this takes ~5-10 minutes)..."
  log "  Polling http://csoc.aws until it responds..."
  log "  To see boot progress: $0 --logs --name $WORKSHOP_NAME"

  local max_wait=900  # 15 minutes
  local waited=0

  while [[ $waited -lt $max_wait ]]; do
    # Check if portal is up
    if curl -sf --max-time 5 "http://csoc.aws" >/dev/null 2>&1; then
      ok "Portal is up!"
      return
    fi

    # Show cloud-init status every 2 minutes
    if [[ $((waited % 120)) -eq 0 && $waited -gt 0 ]]; then
      log "Checking cloud-init status..."
      ssm_run "$instance_id" "cloud-init status 2>/dev/null || echo 'still running'" "cloud-init"
    fi

    sleep 30
    waited=$((waited + 30))
    echo "  ... still booting ($((waited / 60))m / $((max_wait / 60))m)"
  done

  warn "Timed out waiting for portal. VM may still be booting."
  warn "Check logs:  $0 --logs --name $WORKSHOP_NAME"
  warn "Connect SSM: aws ssm start-session --target $instance_id"
}

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") ACTION [OPTIONS]

Actions:
  --create    Provision workshop VM (terraform apply)
  --destroy   Destroy workshop VM (terraform destroy)
  --status    Show workshop VM status + pod status
  --logs      Show cloud-init / boot logs via SSM

Options:
  --name NAME         Workshop name (default: $WORKSHOP_NAME)
  --region REGION     AWS region (default: $AWS_REGION)
  --branch BRANCH     Git branch to deploy (default: $GIT_BRANCH)
  --instance-type TYPE EC2 instance type (default: $INSTANCE_TYPE)
  --help              Show this help

Examples:
  $(basename "$0") --create
  $(basename "$0") --create --name my-workshop --branch master
  $(basename "$0") --destroy --name my-workshop
  $(basename "$0") --status
EOF
}

# ── Main ─────────────────────────────────────────────────────────────────────
ACTION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --create)   ACTION="create"; shift ;;
    --destroy)  ACTION="destroy"; shift ;;
    --status)   ACTION="status"; shift ;;
    --logs)     ACTION="logs"; shift ;;
    --name)     WORKSHOP_NAME="$2"; shift 2 ;;
    --region)   AWS_REGION="$2"; shift 2 ;;
    --branch)   GIT_BRANCH="$2"; shift 2 ;;
    --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
    --help|-h)  usage; exit 0 ;;
    *) shift ;;
  esac
done

if [[ -z "$ACTION" ]]; then
  usage
  exit 1
fi

case "$ACTION" in
  create)  do_create ;;
  destroy) do_destroy ;;
  status)  do_status ;;
  logs)    do_logs ;;
esac
