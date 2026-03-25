#!/usr/bin/env bash
# ============================================
# FlowGuard — Dev Tunnel with Auto Webhook Update
# ============================================
# Starts a cloudflared tunnel and automatically updates
# Slack, Jira, and GitHub webhook URLs to the new tunnel URL.
#
# Usage:
#   npm run tunnel
#   # or directly:
#   bash scripts/tunnel-dev.sh
#
# Environment variables (from .env or exported):
#   Required:
#     API_PORT               — API service port (default: 3001)
#   Slack (optional — skipped if not set):
#     SLACK_APP_CONFIG_TOKEN — App Configuration Token (from api.slack.com/apps → "App Configuration Tokens")
#     SLACK_APP_ID           — Your Slack App ID
#   GitHub (optional — skipped if not set):
#     GITHUB_APP_WEBHOOK_SECRET — Webhook secret for your GitHub App
#     GITHUB_APP_PEM_PATH       — Path to your GitHub App private key .pem file
#     GITHUB_APP_ID             — Your GitHub App ID
#   Jira (optional — skipped if not set):
#     JIRA_BASE_URL          — e.g. https://your-domain.atlassian.net
#     JIRA_USER_EMAIL        — Jira user email
#     JIRA_API_TOKEN         — Jira API token (from id.atlassian.com)
#     JIRA_WEBHOOK_NAME      — Name for the FlowGuard webhook (default: FlowGuard Dev)
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if it exists
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

# ---- Config ----
API_PORT="${API_PORT:-3001}"
TUNNEL_LOG_FILE="$PROJECT_ROOT/.tunnel.log"
TUNNEL_URL_FILE="$PROJECT_ROOT/.tunnel-url"

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}ℹ️  $*${NC}"; }
log_ok()    { echo -e "${GREEN}✅ $*${NC}"; }
log_warn()  { echo -e "${YELLOW}⚠️  $*${NC}"; }
log_error() { echo -e "${RED}❌ $*${NC}" >&2; }
log_step()  { echo -e "${CYAN}→ $*${NC}"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Missing required command: $1"
    exit 1
  fi
}

require_cmd cloudflared
require_cmd curl
require_cmd grep
require_cmd sed

# ---- Cleanup on exit ----
TUNNEL_PID=""
cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    log_info "Stopping tunnel (PID $TUNNEL_PID)..."
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  rm -f "$TUNNEL_LOG_FILE"
  log_info "Tunnel stopped."
}
trap cleanup EXIT INT TERM

# ============================================
# 1) Start cloudflared tunnel
# ============================================
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   FlowGuard Dev Tunnel + Webhook Updater     ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

log_step "Starting cloudflared tunnel to localhost:$API_PORT..."

cloudflared tunnel --url "http://localhost:$API_PORT" \
  --no-autoupdate \
  > "$TUNNEL_LOG_FILE" 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel URL to appear in logs
TUNNEL_URL=""
MAX_WAIT=30
WAITED=0
while [[ -z "$TUNNEL_URL" && $WAITED -lt $MAX_WAIT ]]; do
  sleep 1
  WAITED=$((WAITED + 1))
  TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG_FILE" 2>/dev/null | head -1 || true)"
done

if [[ -z "$TUNNEL_URL" ]]; then
  log_error "Failed to get tunnel URL after ${MAX_WAIT}s. Check cloudflared logs:"
  cat "$TUNNEL_LOG_FILE" >&2
  exit 1
fi

# Save tunnel URL for other scripts
echo "$TUNNEL_URL" > "$TUNNEL_URL_FILE"

echo ""
log_ok "Tunnel active!"
echo -e "  ${GREEN}Public URL:${NC}  $TUNNEL_URL"
echo -e "  ${GREEN}Local:${NC}       http://localhost:$API_PORT"
echo ""

# ============================================
# 2) Update Slack webhook URLs
# ============================================
update_slack() {
  local slack_app_config_token="${SLACK_APP_CONFIG_TOKEN:-}"
  local slack_app_id="${SLACK_APP_ID:-}"

  if [[ -z "$slack_app_config_token" || -z "$slack_app_id" ]]; then
    log_warn "Skipping Slack — SLACK_APP_CONFIG_TOKEN or SLACK_APP_ID not set"
    return 0
  fi

  log_step "Updating Slack app webhook URLs..."

  # First, get the current app manifest
  local manifest_response
  manifest_response="$(curl -sS -X POST "https://slack.com/api/apps.manifest.export" \
    -H "Authorization: Bearer $slack_app_config_token" \
    -H "Content-Type: application/json" \
    -d "{\"app_id\": \"$slack_app_id\"}")"

  local ok
  ok="$(echo "$manifest_response" | python3 -c "import sys, json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")"

  if [[ "$ok" != "True" ]]; then
    log_error "Failed to export Slack manifest: $(echo "$manifest_response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo 'unknown')"
    return 1
  fi

  # Extract current manifest and update URLs
  local updated_manifest
  updated_manifest="$(echo "$manifest_response" | python3 -c "
import sys, json

data = json.load(sys.stdin)
manifest = data['manifest']
tunnel = '$TUNNEL_URL'

# Update Event Subscriptions request_url
if 'event_subscriptions' not in manifest:
    manifest['event_subscriptions'] = {}
manifest['event_subscriptions']['request_url'] = tunnel + '/webhooks/slack/events'

# Update Interactivity request_url
if 'interactivity' not in manifest:
    manifest['interactivity'] = {'is_enabled': True}
manifest['interactivity']['request_url'] = tunnel + '/webhooks/slack/actions'
manifest['interactivity']['is_enabled'] = True

# Update OAuth redirect URLs
if 'oauth_config' not in manifest:
    manifest['oauth_config'] = {}
if 'redirect_urls' not in manifest['oauth_config']:
    manifest['oauth_config']['redirect_urls'] = []

# Update existing redirect URL or add new one
redirect_urls = manifest['oauth_config'].get('redirect_urls', [])
new_redirect = tunnel + '/webhooks/slack/oauth/callback'
# Replace any existing flowguard/trycloudflare redirect URLs
filtered = [u for u in redirect_urls if 'trycloudflare.com' not in u and '/webhooks/slack/oauth' not in u]
filtered.append(new_redirect)
manifest['oauth_config']['redirect_urls'] = filtered

print(json.dumps(manifest))
" 2>/dev/null)"

  if [[ -z "$updated_manifest" ]]; then
    log_error "Failed to process Slack manifest"
    return 1
  fi

  # Push updated manifest
  local update_response
  update_response="$(curl -sS -X POST "https://slack.com/api/apps.manifest.update" \
    -H "Authorization: Bearer $slack_app_config_token" \
    -H "Content-Type: application/json" \
    -d "{\"app_id\": \"$slack_app_id\", \"manifest\": $updated_manifest}")"

  ok="$(echo "$update_response" | python3 -c "import sys, json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")"

  if [[ "$ok" == "True" ]]; then
    log_ok "Slack URLs updated:"
    echo "     Events:       $TUNNEL_URL/webhooks/slack/events"
    echo "     Interactivity: $TUNNEL_URL/webhooks/slack/actions"
    echo "     OAuth:         $TUNNEL_URL/webhooks/slack/oauth/callback"
  else
    local err
    err="$(echo "$update_response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo 'unknown')"
    log_error "Failed to update Slack manifest: $err"
    return 1
  fi
}

# ============================================
# 3) Update GitHub App webhook URL
# ============================================
update_github() {
  local github_app_id="${GITHUB_APP_ID:-}"
  local github_pem_path="${GITHUB_APP_PEM_PATH:-${GITHUB_PRIVATE_KEY_PATH:-}}"
  local github_webhook_secret="${GITHUB_WEBHOOK_SECRET:-}"

  if [[ -z "$github_app_id" || -z "$github_pem_path" ]]; then
    log_warn "Skipping GitHub — GITHUB_APP_ID or GITHUB_APP_PEM_PATH not set"
    return 0
  fi

  if [[ ! -f "$github_pem_path" ]]; then
    log_error "GitHub private key not found at: $github_pem_path"
    return 1
  fi

  log_step "Updating GitHub App webhook URL..."

  # Generate JWT for GitHub App auth
  local jwt
  jwt="$(python3 -c "
import jwt as pyjwt
import time, sys

app_id = '$github_app_id'
pem_path = '$github_pem_path'

with open(pem_path, 'r') as f:
    private_key = f.read()

now = int(time.time())
payload = {
    'iat': now - 60,
    'exp': now + (10 * 60),
    'iss': app_id
}

encoded = pyjwt.encode(payload, private_key, algorithm='RS256')
print(encoded)
" 2>/dev/null)" || true

  # Fallback: try using openssl + base64 if PyJWT not available
  if [[ -z "$jwt" ]]; then
    jwt="$(python3 -c "
import json, base64, time, subprocess, tempfile, os

app_id = '$github_app_id'
pem_path = '$github_pem_path'

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

now = int(time.time())
header = b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
payload = b64url(json.dumps({'iat': now - 60, 'exp': now + 600, 'iss': app_id}).encode())
signing_input = f'{header}.{payload}'

# Use openssl to sign
with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
    f.write(signing_input)
    tmp = f.name

try:
    result = subprocess.run(
        ['openssl', 'dgst', '-sha256', '-sign', pem_path, tmp],
        capture_output=True, check=True
    )
    signature = b64url(result.stdout)
    print(f'{signing_input}.{signature}')
finally:
    os.unlink(tmp)
" 2>/dev/null)" || true
  fi

  if [[ -z "$jwt" ]]; then
    log_error "Could not generate GitHub JWT (need PyJWT or openssl). Trying with GITHUB_ACCESS_TOKEN instead..."
    local github_token="${GITHUB_ACCESS_TOKEN:-}"
    if [[ -z "$github_token" ]]; then
      log_error "No GITHUB_ACCESS_TOKEN available either. Skipping GitHub."
      return 1
    fi
    # Use access token as fallback
    jwt=""
  fi

  # Build the config update payload
  local payload
  payload="{\"url\": \"$TUNNEL_URL/webhooks/github\", \"content_type\": \"json\""
  if [[ -n "$github_webhook_secret" ]]; then
    payload="$payload, \"secret\": \"$github_webhook_secret\""
  fi
  payload="$payload}"

  local auth_header
  if [[ -n "$jwt" ]]; then
    auth_header="Authorization: Bearer $jwt"
  else
    auth_header="Authorization: token ${GITHUB_ACCESS_TOKEN:-}"
  fi

  local response
  response="$(curl -sS -X PATCH "https://api.github.com/app/hook/config" \
    -H "$auth_header" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null)"

  local url_in_response
  url_in_response="$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")"

  if [[ -n "$url_in_response" ]]; then
    log_ok "GitHub webhook URL updated: $url_in_response"
  else
    local msg
    msg="$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message','unknown error'))" 2>/dev/null || echo 'unknown error')"
    log_error "Failed to update GitHub webhook: $msg"
    return 1
  fi
}

# ============================================
# 4) Update Jira webhook URL
# ============================================
update_jira() {
  local jira_base_url="${JIRA_BASE_URL:-}"
  local jira_user_email="${JIRA_USER_EMAIL:-}"
  local jira_api_token="${JIRA_API_TOKEN:-${JIRA_ACCESS_TOKEN:-}}"
  local webhook_name="${JIRA_WEBHOOK_NAME:-FlowGuard Dev}"

  if [[ -z "$jira_base_url" || -z "$jira_user_email" || -z "$jira_api_token" ]]; then
    log_warn "Skipping Jira — JIRA_BASE_URL, JIRA_USER_EMAIL, or JIRA_API_TOKEN not set"
    return 0
  fi

  log_step "Updating Jira webhook URL..."

  local auth
  auth="$(echo -n "$jira_user_email:$jira_api_token" | base64)"

  # List existing webhooks to find ours
  local webhooks_response
  webhooks_response="$(curl -sS -X GET "$jira_base_url/rest/webhooks/1.0/webhook" \
    -H "Authorization: Basic $auth" \
    -H "Content-Type: application/json" 2>/dev/null)"

  local existing_id
  existing_id="$(echo "$webhooks_response" | python3 -c "
import sys, json
try:
    webhooks = json.load(sys.stdin)
    if isinstance(webhooks, list):
        for wh in webhooks:
            if wh.get('name', '') == '$webhook_name':
                print(wh.get('self', '').split('/')[-1])
                break
except:
    pass
" 2>/dev/null || echo "")"

  local jira_webhook_url="$TUNNEL_URL/webhooks/jira"
  local jira_payload
  jira_payload="$(python3 -c "
import json
print(json.dumps({
    'name': '$webhook_name',
    'url': '$jira_webhook_url',
    'events': [
        'jira:issue_created',
        'jira:issue_updated',
        'comment_created',
        'comment_updated'
    ],
    'excludeBody': False
}))
" 2>/dev/null)"

  if [[ -n "$existing_id" ]]; then
    # Update existing webhook
    local update_response
    update_response="$(curl -sS -X PUT "$jira_base_url/rest/webhooks/1.0/webhook/$existing_id" \
      -H "Authorization: Basic $auth" \
      -H "Content-Type: application/json" \
      -d "$jira_payload" 2>/dev/null)"
    log_ok "Jira webhook updated (ID: $existing_id): $jira_webhook_url"
  else
    # Create new webhook
    local create_response
    create_response="$(curl -sS -X POST "$jira_base_url/rest/webhooks/1.0/webhook" \
      -H "Authorization: Basic $auth" \
      -H "Content-Type: application/json" \
      -d "$jira_payload" 2>/dev/null)"

    local new_name
    new_name="$(echo "$create_response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")"

    if [[ -n "$new_name" ]]; then
      log_ok "Jira webhook created: $jira_webhook_url"
    else
      log_error "Failed to create Jira webhook: $create_response"
      return 1
    fi
  fi
}

# ============================================
# 5) Run all updates
# ============================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}Updating webhook endpoints...${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

update_slack || true
echo ""
update_github || true
echo ""
update_jira || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Webhook update complete!${NC}"
echo ""
echo -e "  ${CYAN}API Base URL:${NC}  $TUNNEL_URL"
echo ""
echo -e "  ${CYAN}Webhook Endpoints:${NC}"
echo "    Slack Events:       $TUNNEL_URL/webhooks/slack/events"
echo "    Slack Actions:      $TUNNEL_URL/webhooks/slack/actions"
echo "    Slack OAuth:        $TUNNEL_URL/webhooks/slack/oauth/callback"
echo "    Jira:               $TUNNEL_URL/webhooks/jira"
echo "    GitHub:             $TUNNEL_URL/webhooks/github"
echo ""
echo "  ${CYAN}Health Check:${NC}    $TUNNEL_URL/health"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "Tunnel is running. Press Ctrl+C to stop."
echo ""

# ============================================
# 6) Keep running + tail tunnel logs
# ============================================
wait "$TUNNEL_PID"
