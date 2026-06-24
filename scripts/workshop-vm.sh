#!/bin/bash
# =============================================================================
# workshop-vm.sh - Provision / destroy workshop VM on AWS
#
# Usage:
#   ./scripts/workshop-vm.sh --create [--name NAME] [--branch BRANCH] [--region REGION]
#   ./scripts/workshop-vm.sh --destroy [--name NAME] [--region REGION]
#   ./scripts/workshop-vm.sh --status  [--name NAME] [--region REGION]
#   ./scripts/workshop-vm.sh --logs   [--name NAME] [--region REGION]
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="$PROJECT_ROOT/terraform/workshop"

# Defaults
WORKSHOP_NAME="${WORKSHOP_NAME:-gen3-workshop}"
AWS_REGION="${AWS_REGION:-us-east-1}"
GIT_BRANCH="${GIT_BRANCH:-feat/bootstrap-onboarding-impl}"
INSTANCE_TYPE="${INSTANCE_TYPE:-m6i.2xlarge}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()    { echo -e "${BLUE}[workshop]${NC} $*"; }
ok()     { echo -e "${GREEN}OK${NC} $*"; }
warn()   { echo -e "${YELLOW}WARN${NC} $*"; }
die()    { echo -e "${RED}ERR${NC} $*" >&2; exit 1; }

# -- Pipe detection / confirmation --------------------------------------------
is_piped() { [[ ! -t 0 ]]; }

confirm_install() {
  local missing=("$@")
  local sm_missing="${1:-}"
  if [[ ${#missing[@]} -eq 0 ]]; then
    return 0
  fi

  warn "Missing tools detected"
  echo ""
  echo "This script will install the following tools:"
  for cmd in "${missing[@]}"; do
    case "$cmd" in
      aws)   echo "  - aws (AWS CLI)" ;;
      curl)  echo "  - curl (HTTP client)" ;;
      unzip) echo "  - unzip (archive extractor)" ;;
      jq)    echo "  - jq (JSON processor)" ;;
      *)     echo "  - $cmd" ;;
    esac
  done
  if [[ "$sm_missing" == "1" ]]; then
    echo "  - session-manager-plugin (AWS Session Manager)"
  fi
  echo ""

  if is_piped; then
    echo "Running in pipe mode — auto-proceeding in 5 seconds..."
    echo "Press Ctrl+C to cancel."
    for i in 5 4 3 2 1; do
      echo -ne "\r  Starting in ${i}s... "
      sleep 1
    done
    echo -ne "\r                           \r"
  else
    read -rp "Proceed with installation? [y/N] " ans
    if [[ ! "$ans" =~ ^[Yy]$ ]]; then
      die "Installation cancelled. Install the missing tools manually and rerun this script."
    fi
  fi
}

# -- Pre-flight checks / tool installation ------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

run_sudo() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

linux_pkg_manager() {
  if have apt-get; then echo "apt"; return; fi
  if have dnf; then echo "dnf"; return; fi
  if have yum; then echo "yum"; return; fi
  if have pacman; then echo "pacman"; return; fi
  if have zypper; then echo "zypper"; return; fi
  if have apk; then echo "apk"; return; fi
  echo ""
}

install_homebrew() {
  if have brew; then
    return
  fi

  log "Homebrew not found; installing Homebrew..."
  if ! have curl; then
    die "curl is required to install Homebrew. Install curl first, then rerun this script."
  fi

  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  have brew || die "Homebrew installed, but 'brew' is not on PATH. Open a new terminal or add brew shellenv to your shell profile."
}

install_curl_linux() {
  log "Installing curl..."

  local pm
  pm="$(linux_pkg_manager)"

  case "$pm" in
    apt)    run_sudo apt-get update && run_sudo apt-get install -y curl ;;
    dnf)    run_sudo dnf install -y curl ;;
    yum)    run_sudo yum install -y curl ;;
    pacman) run_sudo pacman -S --needed --noconfirm curl ;;
    zypper) run_sudo zypper --non-interactive install curl ;;
    apk)    run_sudo apk add --no-cache curl ;;
    *)      die "Cannot install curl: no supported package manager found." ;;
  esac
}

install_unzip_linux() {
  log "Installing unzip..."

  local pm
  pm="$(linux_pkg_manager)"

  case "$pm" in
    apt)    run_sudo apt-get update && run_sudo apt-get install -y unzip ;;
    dnf)    run_sudo dnf install -y unzip ;;
    yum)    run_sudo yum install -y unzip ;;
    pacman) run_sudo pacman -S --needed --noconfirm unzip ;;
    zypper) run_sudo zypper --non-interactive install unzip ;;
    apk)    run_sudo apk add --no-cache unzip ;;
    *)      die "Cannot install unzip: no supported package manager found." ;;
  esac
}

install_jq_linux() {
  log "Installing jq using official binary download..."

  local arch
  case "$(uname -m)" in
    x86_64|amd64)  arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "Unsupported architecture: $(uname -m)" ;;
  esac

  local jq_url="https://github.com/jqlang/jq/releases/latest/download/jq-linux-${arch}"
  run_sudo curl -fsSL -o /usr/local/bin/jq "$jq_url"
  run_sudo chmod +x /usr/local/bin/jq
}

install_aws_cli_linux() {
  log "Installing AWS CLI using official bundled installer..."

  local arch
  case "$(uname -m)" in
    x86_64|amd64)  arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *) die "Unsupported architecture: $(uname -m)" ;;
  esac

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  curl -fsSL -o "$tmp/awscliv2.zip" "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip"
  unzip -qo "$tmp/awscliv2.zip" -d "$tmp"
  run_sudo "$tmp/aws/install" --update 2>/dev/null || run_sudo "$tmp/aws/install"
}

install_session_manager_plugin_linux() {
  log "Installing AWS Session Manager Plugin..."

  local arch
  case "$(uname -m)" in
    x86_64|amd64)  arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "Unsupported architecture: $(uname -m)" ;;
  esac

  local pm
  pm="$(linux_pkg_manager)"

  case "$pm" in
    apt)
      local tmp
      tmp="$(mktemp -d)"
      curl -fsSL -o "$tmp/session-manager-plugin.rpm" \
        "https://session-manager-downloads.s3.amazonaws.com/plugin/latest/linux_${arch}/session-manager-plugin.rpm"
      run_sudo dpkg -i "$tmp/session-manager-plugin.rpm" 2>/dev/null || \
        run_sudo apt-get install -y "$tmp/session-manager-plugin.rpm"
      ;;
    dnf|yum)
      local tmp
      tmp="$(mktemp -d)"
      curl -fsSL -o "$tmp/session-manager-plugin.rpm" \
        "https://session-manager-downloads.s3.amazonaws.com/plugin/latest/linux_${arch}/session-manager-plugin.rpm"
      run_sudo "$pm" install -y "$tmp/session-manager-plugin.rpm"
      ;;
    *)
      die "Automatic Session Manager Plugin install is not supported for $(uname -s). Install manually: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
      ;;
  esac
}

install_prereqs_macos() {
  install_homebrew

  local formulas=()
  have aws    || formulas+=("awscli")
  have curl   || formulas+=("curl")
  have unzip  || formulas+=("unzip")
  have jq     || formulas+=("jq")

  if [[ ${#formulas[@]} -gt 0 ]]; then
    log "Installing missing macOS tools with Homebrew: ${formulas[*]}"
    brew install "${formulas[@]}"
  fi

  if ! session-manager-plugin --version >/dev/null 2>&1; then
    log "Installing AWS Session Manager Plugin..."
    brew install --cask session-manager-plugin
  fi
}

install_prereqs_linux() {
  have curl    || install_curl_linux
  have unzip   || install_unzip_linux
  have jq      || install_jq_linux
  have aws     || install_aws_cli_linux
  ! session-manager-plugin --version >/dev/null 2>&1 && install_session_manager_plugin_linux
}

install_missing_prereqs() {
  case "$(uname -s)" in
    Darwin)
      install_prereqs_macos
      ;;
    Linux)
      install_prereqs_linux
      ;;
    *)
      die "Unsupported OS: $(uname -s). This script supports macOS and Linux."
      ;;
  esac
}

# -- Prereq checks -----------------------------------------------------------
check_prereqs() {
  local missing=()
  for cmd in aws curl unzip jq; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done

  local sm_missing=0
  ! session-manager-plugin --version >/dev/null 2>&1 && sm_missing=1

  if [[ ${#missing[@]} -gt 0 || $sm_missing -eq 1 ]]; then
    confirm_install "${missing[@]}" "$sm_missing"
    install_missing_prereqs
  fi

  missing=()
  for cmd in aws curl unzip jq; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing tools after attempted installation: ${missing[*]}"
  fi

  if ! session-manager-plugin --version >/dev/null 2>&1; then
    die "AWS Session Manager Plugin not found after attempted installation."
  fi

  if ! aws configure get region >/dev/null 2>&1 && [[ -z "${AWS_REGION:-}" ]]; then
    die "AWS CLI not configured with a region. Run: aws configure"
  fi

  ok "Prerequisites met"
}

# -- Ensure terraform --------------------------------------------------------
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
  ok "Terraform $(terraform version -raw) installed"
}

# -- SSM helpers -------------------------------------------------------------
ssm_run() {
  # Runs a command on the VM via SSM, prints labelled output
  local instance_id="$1"
  local cmd="$2"
  local label="${3:-output}"

  local json_input
  json_input=$(jq -n \
    --arg iid "$instance_id" \
    --arg cmd "$cmd" \
    '{InstanceIds: [$iid], DocumentName: "AWS-RunShellScript", Parameters: {commands: [$cmd]}, TimeoutSeconds: 60}')

  local cmd_id
  cmd_id=$(aws ssm send-command \
    --region "$AWS_REGION" \
    --cli-input-json "$json_input" \
    --output text \
    --query "Command.CommandId" 2>&1) || {
    local rc=$?
    warn "SSM send-command failed (exit $rc): $cmd_id"
    echo "  Possible causes:"
    echo "    - Instance still booting (retry in a minute)"
    echo "    - Wrong region (current: $AWS_REGION)"
    echo "    - AWS credentials issue (check: aws sts get-caller-identity)"
    return 1
  }

  # Wait for command to complete
  local waited=0
  while [[ $waited -lt 60 ]]; do
    local status
    status=$(aws ssm list-command-invocations \
      --region "$AWS_REGION" \
      --command-id "$cmd_id" \
      --instance-id "$instance_id" \
      --details \
      --query "CommandInvocations[0].Status" \
      --output text 2>/dev/null || echo "Pending")
    [[ "$status" == "Success" || "$status" == "Failed" ]] && break
    sleep 3
    waited=$((waited + 3))
  done

  local output
  output=$(aws ssm list-command-invocations \
    --region "$AWS_REGION" \
    --command-id "$cmd_id" \
    --instance-id "$instance_id" \
    --details \
    --query "CommandInvocations[0].CommandPlugins[0].Output" \
    --output text 2>/dev/null || echo "No output")

  echo "  [$label]"
  echo "$output" | head -50 | sed 's/^/    /'
  echo ""
}

ssm_run_quiet() {
  # Runs a command via SSM, returns raw stdout (empty string on any failure)
  local instance_id="$1"
  local cmd="$2"

  local json_input
  json_input=$(jq -n \
    --arg iid "$instance_id" \
    --arg cmd "$cmd" \
    '{InstanceIds: [$iid], DocumentName: "AWS-RunShellScript", Parameters: {commands: [$cmd]}, TimeoutSeconds: 30}')

  local cmd_id
  cmd_id=$(aws ssm send-command \
    --region "$AWS_REGION" \
    --cli-input-json "$json_input" \
    --output text \
    --query "Command.CommandId" 2>/dev/null) || return 1

  local waited=0
  while [[ $waited -lt 30 ]]; do
    local status
    status=$(aws ssm list-command-invocations \
      --region "$AWS_REGION" \
      --command-id "$cmd_id" \
      --instance-id "$instance_id" \
      --details \
      --query "CommandInvocations[0].Status" \
      --output text 2>/dev/null || echo "Pending")
    [[ "$status" == "Success" || "$status" == "Failed" ]] && break
    sleep 2
    waited=$((waited + 2))
  done

  aws ssm list-command-invocations \
    --region "$AWS_REGION" \
    --command-id "$cmd_id" \
    --instance-id "$instance_id" \
    --details \
    --query "CommandInvocations[0].CommandPlugins[0].Output" \
    --output text 2>/dev/null || echo ""
}

# -- /etc/hosts --------------------------------------------------------------
setup_hosts() {
  local ip="$1"
  log "Updating /etc/hosts..."
  for host in csoc.aws keycloak.aws gen3.aws; do
    if grep -qw "$host" /etc/hosts 2>/dev/null; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sudo sed -i '' "/[[:space:]]$host$/d" /etc/hosts
      else
        sudo sed -i "/[[:space:]]$host$/d" /etc/hosts
      fi
    fi
    echo "$ip  $host" | sudo tee -a /etc/hosts > /dev/null
  done
  ok "Added csoc.aws / keycloak.aws / gen3.aws -> $ip to /etc/hosts"
}

cleanup_hosts() {
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

# -- Wait for bootstrap ------------------------------------------------------
wait_for_bootstrap() {
  local instance_id="$1"
  local public_ip="$2"

  log "Waiting for workshop to come up (this takes ~5-10 minutes)..."
  log "  Streaming cloud-init logs via SSM..."
  echo ""

  local max_wait=900
  local waited=0
  local last_snapshot=""

  while [[ $waited -lt $max_wait ]]; do
    # Check if portal is up
    if curl -sf --max-time 5 "http://csoc.aws" >/dev/null 2>&1; then
      echo ""
      ok "Portal is up!"
      return
    fi

    # Wait 30s for SSM agent before trying to stream logs
    if [[ $waited -ge 30 ]]; then
      local log_output=""
      log_output=$(ssm_run_quiet "$instance_id" "tail -n 8 /var/log/cloud-init-output.log 2>/dev/null") || true
      if [[ -n "$log_output" && "$log_output" != "$last_snapshot" ]]; then
        echo "$log_output" | sed 's/^/  > /'
        last_snapshot="$log_output"
      fi
    else
      echo "  > waiting for SSM agent ($waited / 30 s)"
    fi

    sleep 10
    waited=$((waited + 10))
  done

  echo ""
  warn "Timed out waiting for portal."
  warn "Check logs:  $0 --logs --name $WORKSHOP_NAME"
  warn "Connect SSM: aws ssm start-session --target $instance_id --region $AWS_REGION"
}

# -- Create ------------------------------------------------------------------
do_create() {
  check_prereqs

  log "Provisioning workshop VM..."
  log "  Name:     $WORKSHOP_NAME"
  log "  Region:   $AWS_REGION"
  log "  Instance: $INSTANCE_TYPE"
  log "  Branch:   $GIT_BRANCH"
  echo ""

  cd "$TF_DIR"
  ensure_terraform

  if [[ ! -d ".terraform" ]]; then
    log "Running terraform init..."
    terraform init
  fi

  log "Running terraform apply..."
  terraform apply \
    -auto-approve \
    -var "workshop_name=$WORKSHOP_NAME" \
    -var "aws_region=$AWS_REGION" \
    -var "git_branch=$GIT_BRANCH" \
    -var "instance_type=$INSTANCE_TYPE"

  local public_ip instance_id
  public_ip=$(terraform output -raw public_ip)
  instance_id=$(terraform output -raw instance_id)

  setup_hosts "$public_ip"
  wait_for_bootstrap "$instance_id" "$public_ip"

  echo ""
  echo "  Workshop VM Ready!"
  echo "  =================="
  echo ""
  echo "  Public IP:   $public_ip"
  echo "  Instance ID: $instance_id"
  echo ""
  echo "  Access:"
  echo "    Frontend:  http://csoc.aws"
  echo "    Keycloak:  http://keycloak.aws  (admin/admin)"
  echo ""
  echo "  Connect:"
  echo "    SSM:       aws ssm start-session --target $instance_id --region $AWS_REGION"
  echo ""
  echo "  Debug:"
  echo "    Logs:      $0 --logs --name $WORKSHOP_NAME"
  echo ""
  echo "  Cleanup:"
  echo "    $0 --destroy --name $WORKSHOP_NAME"
  echo ""
}

# -- Destroy -----------------------------------------------------------------
do_destroy() {
  cd "$TF_DIR"
  ensure_terraform

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

  [[ -n "$public_ip" ]] && cleanup_hosts
  ok "Workshop VM destroyed"
}

# -- Status ------------------------------------------------------------------
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
  echo "  SSM:         aws ssm start-session --target $instance_id --region $AWS_REGION"
  echo ""

  if [[ "$instance_id" != "N/A" ]]; then
    log "Checking cloud-init status..."
    ssm_run "$instance_id" "cloud-init status 2>/dev/null || echo still-running" "cloud-init"

    log "Checking pods..."
    ssm_run "$instance_id" "sudo kubectl get pods -A -o wide" "pods"
  fi
  echo ""
}

# -- Logs --------------------------------------------------------------------
do_logs() {
  cd "$TF_DIR"
  ensure_terraform

  if [[ ! -f "terraform.tfstate" ]]; then
    echo "No workshop VM found."
    exit 0
  fi

  local instance_id
  instance_id=$(terraform output -raw instance_id 2>/dev/null || echo "N/A")
  [[ "$instance_id" == "N/A" ]] && die "No instance found"

  log "Fetching cloud-init logs (via SSM)..."
  echo ""

  ssm_run "$instance_id" "tail -n 80 /var/log/cloud-init-output.log 2>/dev/null || cat /var/log/cloud-init.log 2>/dev/null || echo No-logs-yet" "cloud-init-output.log"
}

# -- Usage -------------------------------------------------------------------
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
  $(basename "$0") --logs
EOF
}

# -- Main --------------------------------------------------------------------
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

[[ -z "$ACTION" ]] && { usage; exit 1; }

case "$ACTION" in
  create)  do_create ;;
  destroy) do_destroy ;;
  status)  do_status ;;
  logs)    do_logs ;;
esac
