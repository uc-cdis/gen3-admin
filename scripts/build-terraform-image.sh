#!/bin/bash
# =============================================================================
# build-terraform-image.sh - Build the local Terraform runner image
#
# The bootstrap wizard runs Terraform inside this image. It is built locally
# and never pushed: the API defaults to the tag gen3-terraform:latest, and
# Docker resolves local images before reaching for a registry.
#
# Usage:
#   ./scripts/build-terraform-image.sh [--tag TAG] [--no-cache]
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_TAG="${IMAGE_TAG:-gen3-terraform:latest}"
BUILD_ARGS=()

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log() { echo -e "${BLUE}[build]${NC} $*"; }
ok()  { echo -e "${GREEN}OK${NC} $*"; }
die() { echo -e "${RED}ERR${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)      IMAGE_TAG="$2"; shift 2 ;;
    --no-cache) BUILD_ARGS+=("--no-cache"); shift ;;
    -h|--help)  sed -n '2,12p' "$0"; exit 0 ;;
    *)          die "Unknown option: $1" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon - is Docker running?"

log "Building $IMAGE_TAG from Dockerfile.terraform"
docker build \
  "${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}" \
  -f "$PROJECT_ROOT/Dockerfile.terraform" \
  -t "$IMAGE_TAG" \
  "$PROJECT_ROOT"

# A broken tool here surfaces as a confusing mid-apply failure later, so check
# each one the runner depends on before declaring success.
log "Verifying bundled tools"
docker run --rm "$IMAGE_TAG" '
  set -e
  terraform version >/dev/null
  kubectl version --client >/dev/null 2>&1
  helm version --short >/dev/null
  aws --version >/dev/null 2>&1
  git --version >/dev/null
' || die "image built but one of terraform/kubectl/helm/aws/git is not working"

ok "$IMAGE_TAG is ready (not pushed - local only)"
echo ""
echo "The bootstrap wizard will pick this up automatically."
echo "To use a different tag, set docker_image in the Terraform executor."
