#!/bin/bash
# =============================================================================
# test-e2e-bootstrap.sh - End-to-end check of the cloud bootstrap path
#
# Drives the same API calls the /bootstrap wizard makes, against a running API
# (start one with: ./scripts/dev.sh --bootstrap cloud). It goes as far as
# `terraform plan` of the real CSOC module and never applies, so nothing is
# created in AWS and no state is written to the bucket.
#
# Usage:
#   ./scripts/test-e2e-bootstrap.sh --bucket <state-bucket> [options]
#
# Options:
#   --api <url>        API base URL (default: http://localhost:8002)
#   --bucket <name>    S3 bucket for Terraform state (required)
#   --region <region>  AWS region to plan in (default: us-east-1)
#   --profile <name>   AWS profile to run as (default: the server's default)
#   --domain <name>    Also check the Route53 lookup for this domain
#   --skip-plan        Stop after init (plan of the real module takes minutes)
#   --keep             Keep the work dir and containers for inspection
# =============================================================================

set -uo pipefail

API="http://localhost:8002"
BUCKET=""
REGION="us-east-1"
PROFILE=""
DOMAIN=""
SKIP_PLAN=false
KEEP=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
PASSED=0; FAILED=0
pass() { echo -e "  ${GREEN}✓${NC} $*"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗${NC} $*"; FAILED=$((FAILED + 1)); }
info() { echo -e "${BLUE}==>${NC} $*"; }
note() { echo -e "  ${YELLOW}·${NC} $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api)       API="$2"; shift 2 ;;
    --bucket)    BUCKET="$2"; shift 2 ;;
    --region)    REGION="$2"; shift 2 ;;
    --profile)   PROFILE="$2"; shift 2 ;;
    --domain)    DOMAIN="$2"; shift 2 ;;
    --skip-plan) SKIP_PLAN=true; shift ;;
    --keep)      KEEP=true; shift ;;
    -h|--help)   sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$BUCKET" ]] || { echo "--bucket is required" >&2; exit 1; }
for cmd in curl jq aws; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "missing required tool: $cmd" >&2; exit 1; }
done

RUN_ID="e2e-$(date +%Y%m%d%H%M%S)"
STATE_KEY="e2e/${RUN_ID}/terraform.tfstate"
WORK_ROOT="${TERRAFORM_WORK_ROOT:-/tmp/gen3-terraform}"
TMP="$(mktemp -d)"
EXEC_IDS=()

cleanup() {
  rm -rf "$TMP"
  [[ "$KEEP" == "true" ]] && { note "kept $WORK_ROOT/$RUN_ID and its containers (--keep)"; return; }
  for id in "${EXEC_IDS[@]:-}"; do
    [[ -n "$id" ]] || continue
    docker ps -aq --filter "label=terraform.io/execution-id=$id" | while read -r c; do docker rm -f "$c"; done >/dev/null 2>&1
  done
  rm -rf "${WORK_ROOT:?}/$RUN_ID" "${WORK_ROOT:?}/$RUN_ID-vars"
}
trap cleanup EXIT

# target builds the {profile, region} part every AWS lookup sends.
target() {
  jq -n --arg r "${1:-$REGION}" --arg p "$PROFILE" '{region: $r} + (if $p == "" then {} else {profile: $p} end)'
}

# api METHOD PATH [BODY] -> writes body to $TMP/body, prints status code.
api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -s -o "$TMP/body" -w '%{http_code}' -m 60 -X "$method" "$API$path" \
      -H 'Content-Type: application/json' -d "$body"
  else
    curl -s -o "$TMP/body" -w '%{http_code}' -m 60 -X "$method" "$API$path"
  fi
}

# execute OPERATION -> starts a run, prints the execution id.
execute() {
  local op="$1" started code
  local body
  body="$(jq -n --arg op "$op" --arg wd "$RUN_ID" --arg b "$BUCKET" --arg r "$REGION" \
    --arg k "$STATE_KEY" --arg p "$PROFILE" --arg tfvars "$(cat "$TMP/tfvars")" \
    '{operation: $op, work_dir: $wd, runtime: "docker", module: "csoc",
      state_bucket: $b, state_region: $r, state_key: $k, aws_region: $r,
      tfvars: $tfvars, tfvars_file_name: "terraform.tfvars"}
     + (if $p == "" then {} else {aws_profile: $p} end)')"
  started=$(date +%s)
  code="$(api POST /api/terraform/execute "$body")"
  local elapsed=$(( $(date +%s) - started ))
  if [[ "$code" != "202" ]]; then
    fail "$op: execute returned HTTP $code: $(jq -r '.error // .' "$TMP/body" 2>/dev/null | head -3)"
    return 1
  fi
  # The request used to block until the whole run finished.
  if (( elapsed <= 15 )); then pass "$op: accepted in ${elapsed}s (202, not blocked on the run)"
  else fail "$op: execute took ${elapsed}s; it should return as soon as the container starts"; fi
  local id; id="$(jq -r .id "$TMP/body")"
  EXEC_IDS+=("$id")
  echo "$id" > "$TMP/last_id"
}

# stream ID OP -> follows the log stream to the end, checks the exit status.
stream() {
  local id="$1" op="$2"
  local log="$TMP/$op.log"
  curl -s -N -m 1800 "$API/api/terraform/executions/$id/stream" > "$log"
  local done_line code
  done_line="$(grep -A1 '^event:done' "$log" | sed -n 's/^data://p' | tail -1)"
  if [[ -z "$done_line" ]]; then
    fail "$op: stream ended without a done event"
    grep -A1 '^event:failed' "$log" | sed -n 's/^data:/    /p' | tail -3
    return 1
  fi
  code="$(echo "$done_line" | jq -r .exit_code)"
  local lines; lines="$(grep -c '^event:message' "$log")"
  if [[ "$code" == "0" ]]; then
    pass "$op: exit code 0 ($lines log lines streamed)"
  else
    fail "$op: exit code $code. Last log lines:"
    sed -n 's/^data://p' "$log" | grep -v '^\s*$' | tail -15 | sed 's/^/      /'
    return 1
  fi
}

echo
echo "CSOC bootstrap E2E   run $RUN_ID"
echo "  api $API   bucket $BUCKET   region $REGION${PROFILE:+   profile $PROFILE}"
echo

# ── 1. API and runner ────────────────────────────────────────────────────────
info "API and runner image"
if [[ "$(api GET /ping)" == "200" ]]; then pass "API is up"
else fail "API not reachable at $API - start it with ./scripts/dev.sh --bootstrap cloud"; exit 1; fi
api GET "/api/terraform/runner-image" >/dev/null
if [[ "$(jq -r .present "$TMP/body")" == "true" ]]; then pass "runner image $(jq -r .image "$TMP/body") present"
else fail "runner image missing - run $(jq -r .build_command "$TMP/body")"; exit 1; fi

# ── 2. AWS lookups ───────────────────────────────────────────────────────────
info "AWS lookups (as the identity Terraform will use)"
if [[ "$(api POST /api/aws/identity "$(target)")" == "200" ]]; then
  ACCOUNT="$(jq -r .Account "$TMP/body")"
  pass "identity: $(jq -r .Arn "$TMP/body")"
else
  fail "identity check failed: $(jq -r .error "$TMP/body")"; exit 1
fi

bogus='{"region":"us-east-1","credentials":{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}}'
code="$(api POST /api/aws/identity "$bogus")"
[[ "$code" == "401" ]] && pass "invalid keys rejected (401), not replaced by server credentials" \
  || fail "invalid keys returned HTTP $code, want 401"

if [[ "$(api POST /api/aws/azs "$(target)")" == "200" ]]; then
  AZS=()
  while IFS= read -r z; do AZS+=("$z"); done < <(jq -r '.zones[]' "$TMP/body")
  (( ${#AZS[@]} >= 3 )) && pass "$REGION has ${#AZS[@]} zones: ${AZS[*]:0:3} ..." \
    || { fail "$REGION has only ${#AZS[@]} zones; the CSOC module needs 3"; exit 1; }
else
  fail "zone lookup failed: $(jq -r .error "$TMP/body")"; exit 1
fi

if [[ -n "$DOMAIN" ]]; then
  body="$(target | jq --arg d "$DOMAIN" '. + {domain: $d}')"
  if [[ "$(api POST /api/aws/route53/zone "$body")" == "200" ]]; then
    if [[ "$(jq -r .found "$TMP/body")" == "true" ]]; then
      pass "$DOMAIN served by zone $(jq -r .zone_name "$TMP/body") ($(jq -r .hosted_zone_id "$TMP/body"))"
    else
      note "$DOMAIN: no public hosted zone in account $ACCOUNT (the wizard will block on this)"
    fi
  else
    fail "Route53 lookup failed: $(jq -r .error "$TMP/body")"
  fi
fi

# ── 3. Input validation ──────────────────────────────────────────────────────
info "Hostile input is rejected before anything runs"
reject() {
  local label="$1" patch="$2"
  local body
  body="$(jq -n --arg wd "$RUN_ID" '{operation:"init", work_dir:$wd, runtime:"docker", module:"csoc"}' | jq "$patch")"
  local code; code="$(api POST /api/terraform/execute "$body")"
  [[ "$code" == "400" ]] && pass "$label -> 400" || fail "$label -> HTTP $code, want 400"
}
reject "bucket with shell syntax"   '.state_bucket = "x;id"'
reject "state key traversal"        '.state_key = "../../etc/terraform.tfstate"'
reject "client-chosen module URL"   '.module = "git::https://evil.example/tf"'
reject "operation with flags"       '.operation = "init -from-module=/etc"'
reject "image read as a docker flag" '.docker_image = "--privileged"'

# ── 4. Terraform against the real module ─────────────────────────────────────
info "Terraform: examples/csoc against s3://$BUCKET/$STATE_KEY"
{
  echo "vpc_name = \"$RUN_ID\""
  echo "aws_region = \"$REGION\""
  echo "availability_zones = [\"${AZS[0]}\", \"${AZS[1]}\", \"${AZS[2]}\"]"
  echo "hostname = \"$RUN_ID.example.org\""
  echo "revproxy_arn = \"\""
  echo "user_yaml_bucket_name = \"$RUN_ID-user-yaml\""
  echo "kubernetes_namespace = \"csoc\""
  echo "es_linked_role = false"
  echo "create_gitops_infra = true"
  echo "deploy_cognito = false"
  echo "default_tags = { \"ManagedBy\" = \"gen3-csoc-e2e\" }"
} > "$TMP/tfvars"

if execute init; then
  id="$(cat "$TMP/last_id")"
  if stream "$id" init; then
    grep -q 'Fetching module' "$TMP/init.log" && pass "init fetched the module into an empty work dir" \
      || fail "init did not fetch the module"
    grep -q 'Successfully configured the backend "s3"' "$TMP/init.log" \
      && pass "S3 backend configured (the module declares none; the runner's override did)" \
      || fail "S3 backend was not configured - state would stay on local disk"
    grep -q 'arn:aws' "$TMP/init.log" && pass "log names the AWS identity in use" || note "no identity line in the log"
  fi

  api GET "/api/terraform/executions?work_dir=$RUN_ID" >/dev/null
  n="$(jq 'length' "$TMP/body")"
  [[ "$n" -ge 1 ]] && pass "history scoped to this environment: $n run(s)" || fail "history filter returned no runs"
fi

# Returning to the wizard for an existing environment re-runs init. That used
# to fail because -from-module refuses a populated directory.
if execute init; then
  id="$(cat "$TMP/last_id")"
  mv "$TMP/init.log" "$TMP/init-1.log" 2>/dev/null
  if stream "$id" init; then
    grep -q 'Fetching module' "$TMP/init.log" && fail "second init fetched the module again" \
      || pass "second init reused the populated work dir"
  fi
fi

if [[ "$SKIP_PLAN" == "false" ]]; then
  note "planning the full CSOC stack; this reads AWS and takes a few minutes, and creates nothing"
  if execute plan; then
    id="$(cat "$TMP/last_id")"
    if stream "$id" plan; then
      # Output keeps its ANSI colours, which the UI renders; strip them here.
      summary="$(sed -n 's/^data://p' "$TMP/plan.log" | sed $'s/\x1b\\[[0-9;]*m//g' | grep -E '^Plan:' | tail -1)"
      [[ -n "$summary" ]] && pass "$summary" || note "no Plan: summary line found"
    fi
  fi
fi

# init and plan must not write state; only apply does.
if aws s3api head-object --bucket "$BUCKET" --key "$STATE_KEY" ${PROFILE:+--profile "$PROFILE"} >/dev/null 2>&1; then
  fail "state object exists at s3://$BUCKET/$STATE_KEY - something wrote state"
else
  pass "no state written to s3://$BUCKET/$STATE_KEY"
fi

echo
if (( FAILED == 0 )); then
  echo -e "${GREEN}All $PASSED checks passed${NC}"
else
  echo -e "${RED}$FAILED failed${NC}, $PASSED passed"
fi
exit $(( FAILED > 0 ))
