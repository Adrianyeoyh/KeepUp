#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

API_BASE_URL="${API_BASE_URL:-http://localhost:3001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
COMPANY_ID="${COMPANY_ID:-}"

if [[ -z "$ADMIN_API_KEY" && -f ".env" ]]; then
  ADMIN_API_KEY="$(grep -E '^[[:space:]]*ADMIN_API_KEY=' .env | tail -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
fi

INSIGHT_BUDGET_PER_DAY="${INSIGHT_BUDGET_PER_DAY:-3}"
CONFIDENCE_THRESHOLD="${CONFIDENCE_THRESHOLD:-0.5}"
DIGEST_CRON="${DIGEST_CRON:-0 9 * * 1-5}"
DIGEST_USER_IDS="${DIGEST_USER_IDS:-}"
DIGEST_CHANNEL_IDS="${DIGEST_CHANNEL_IDS:-}"

SLACK_STATUS="${SLACK_STATUS:-active}"
SLACK_TEAM_ID="${SLACK_TEAM_ID:-}"
SLACK_TEAM_NAME="${SLACK_TEAM_NAME:-}"
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-}"
SLACK_BOT_USER_ID="${SLACK_BOT_USER_ID:-}"
SLACK_APP_TOKEN="${SLACK_APP_TOKEN:-}"
SLACK_SCOPES="${SLACK_SCOPES:-}"

JIRA_STATUS="${JIRA_STATUS:-active}"
JIRA_BASE_URL="${JIRA_BASE_URL:-}"
JIRA_ACCESS_TOKEN="${JIRA_ACCESS_TOKEN:-}"
JIRA_CLOUD_ID="${JIRA_CLOUD_ID:-}"
JIRA_PROJECT_KEYS="${JIRA_PROJECT_KEYS:-}"
JIRA_SCOPES="${JIRA_SCOPES:-}"

GITHUB_STATUS="${GITHUB_STATUS:-active}"
GITHUB_ACCESS_TOKEN="${GITHUB_ACCESS_TOKEN:-}"
GITHUB_REPO_FULL_NAME="${GITHUB_REPO_FULL_NAME:-}"
GITHUB_REPOSITORIES="${GITHUB_REPOSITORIES:-}"
GITHUB_SCOPES="${GITHUB_SCOPES:-}"

API_HEADERS=(-H "Content-Type: application/json")
if [[ -n "$ADMIN_API_KEY" ]]; then
  API_HEADERS+=(-H "x-admin-key: $ADMIN_API_KEY")
fi

csv_to_json_array() {
  local csv="$1"
  jq -cn --arg csv "$csv" '$csv | split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length > 0))'
}

api_call() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local tmp_file
  tmp_file="$(mktemp)"

  local http_code
  if [[ -n "$data" ]]; then
    http_code="$(curl -sS -o "$tmp_file" -w "%{http_code}" -X "$method" "${API_HEADERS[@]}" -d "$data" "$API_BASE_URL$path")"
  else
    http_code="$(curl -sS -o "$tmp_file" -w "%{http_code}" -X "$method" "${API_HEADERS[@]}" "$API_BASE_URL$path")"
  fi

  local body
  body="$(cat "$tmp_file")"
  rm -f "$tmp_file"

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "❌ API call failed: $method $path -> $http_code" >&2
    echo "$body" >&2
    return 1
  fi

  echo "$body"
}

ensure_company_id() {
  if [[ -n "$COMPANY_ID" ]]; then
    return
  fi

  local companies_json
  companies_json="$(api_call GET "/admin/companies")"
  COMPANY_ID="$(echo "$companies_json" | jq -r '.companies[0].id // empty')"

  if [[ -z "$COMPANY_ID" ]]; then
    echo "❌ No company found. Create one first, then set COMPANY_ID and re-run." >&2
    exit 1
  fi
}

patch_company_settings() {
  local payload
  payload="$(jq -cn \
    --argjson insight_budget_per_day "$INSIGHT_BUDGET_PER_DAY" \
    --argjson confidence_threshold "$CONFIDENCE_THRESHOLD" \
    --arg digest_cron "$DIGEST_CRON" \
    '{
      insight_budget_per_day: $insight_budget_per_day,
      confidence_threshold: $confidence_threshold,
      digest_cron: $digest_cron
    }'
  )"

  if [[ -n "$DIGEST_USER_IDS" ]]; then
    local user_ids_json
    user_ids_json="$(csv_to_json_array "$DIGEST_USER_IDS")"
    payload="$(jq -c --argjson user_ids "$user_ids_json" '. + {digest_user_ids: $user_ids}' <<< "$payload")"
  fi

  if [[ -n "$DIGEST_CHANNEL_IDS" ]]; then
    local channel_ids_json
    channel_ids_json="$(csv_to_json_array "$DIGEST_CHANNEL_IDS")"
    payload="$(jq -c --argjson channel_ids "$channel_ids_json" '. + {digest_channel_ids: $channel_ids}' <<< "$payload")"
  fi

  local response
  response="$(api_call PATCH "/admin/companies/$COMPANY_ID/settings" "$payload")"
  echo "✅ Updated company settings"
  echo "$response" | jq '{company: {id: .company.id, slug: .company.slug, settings: .company.settings}}'
}

upsert_integration() {
  local provider="$1"
  local payload="$2"

  local response
  response="$(api_call PUT "/admin/integrations/$COMPANY_ID/$provider" "$payload")"
  echo "✅ Upserted $provider integration"
  echo "$response" | jq '.integration'
}

bootstrap_slack() {
  if [[ -z "${SLACK_TEAM_ID}${SLACK_TEAM_NAME}${SLACK_BOT_TOKEN}${SLACK_BOT_USER_ID}${SLACK_APP_TOKEN}${SLACK_SCOPES}" ]]; then
    echo "ℹ️  Skipping Slack integration (no Slack bootstrap env vars provided)"
    return
  fi

  local scopes_json
  scopes_json="$(csv_to_json_array "$SLACK_SCOPES")"

  local payload
  payload="$(jq -cn \
    --arg status "$SLACK_STATUS" \
    --arg team_id "$SLACK_TEAM_ID" \
    --arg team_name "$SLACK_TEAM_NAME" \
    --arg bot_token "$SLACK_BOT_TOKEN" \
    --arg bot_user_id "$SLACK_BOT_USER_ID" \
    --arg app_token "$SLACK_APP_TOKEN" \
    --argjson scopes "$scopes_json" \
    '{
      status: $status,
      installation_data: (
        {}
        + (if $team_id != "" then {team_id: $team_id} else {} end)
        + (if $team_name != "" then {team_name: $team_name} else {} end)
      ),
      token_data: (
        {}
        + (if $bot_token != "" then {bot_token: $bot_token} else {} end)
        + (if $bot_user_id != "" then {bot_user_id: $bot_user_id} else {} end)
        + (if $app_token != "" then {app_token: $app_token} else {} end)
      ),
      scopes: $scopes
    }'
  )"

  upsert_integration "slack" "$payload"
}

bootstrap_jira() {
  if [[ -z "${JIRA_BASE_URL}${JIRA_ACCESS_TOKEN}${JIRA_CLOUD_ID}${JIRA_PROJECT_KEYS}${JIRA_SCOPES}" ]]; then
    echo "ℹ️  Skipping Jira integration (no Jira bootstrap env vars provided)"
    return
  fi

  local project_keys_json
  project_keys_json="$(csv_to_json_array "$JIRA_PROJECT_KEYS")"
  local scopes_json
  scopes_json="$(csv_to_json_array "$JIRA_SCOPES")"

  local payload
  payload="$(jq -cn \
    --arg status "$JIRA_STATUS" \
    --arg base_url "$JIRA_BASE_URL" \
    --arg access_token "$JIRA_ACCESS_TOKEN" \
    --arg cloud_id "$JIRA_CLOUD_ID" \
    --argjson project_keys "$project_keys_json" \
    --argjson scopes "$scopes_json" \
    '{
      status: $status,
      installation_data: (
        {}
        + (if $base_url != "" then {base_url: $base_url} else {} end)
        + (if $cloud_id != "" then {cloud_id: $cloud_id} else {} end)
        + (if ($project_keys | length) > 0 then {project_keys: $project_keys} else {} end)
      ),
      token_data: (
        {}
        + (if $access_token != "" then {access_token: $access_token} else {} end)
      ),
      scopes: $scopes
    }'
  )"

  upsert_integration "jira" "$payload"
}

bootstrap_github() {
  if [[ -z "${GITHUB_ACCESS_TOKEN}${GITHUB_REPO_FULL_NAME}${GITHUB_REPOSITORIES}${GITHUB_SCOPES}" ]]; then
    echo "ℹ️  Skipping GitHub integration (no GitHub bootstrap env vars provided)"
    return
  fi

  local repositories_json
  repositories_json="$(csv_to_json_array "$GITHUB_REPOSITORIES")"
  local scopes_json
  scopes_json="$(csv_to_json_array "$GITHUB_SCOPES")"

  local payload
  payload="$(jq -cn \
    --arg status "$GITHUB_STATUS" \
    --arg access_token "$GITHUB_ACCESS_TOKEN" \
    --arg repo_full_name "$GITHUB_REPO_FULL_NAME" \
    --argjson repositories "$repositories_json" \
    --argjson scopes "$scopes_json" \
    '{
      status: $status,
      installation_data: (
        {}
        + (if $repo_full_name != "" then {repo_full_name: $repo_full_name} else {} end)
        + (if ($repositories | length) > 0 then {repositories: $repositories} else {} end)
      ),
      token_data: (
        {}
        + (if $access_token != "" then {access_token: $access_token} else {} end)
      ),
      scopes: $scopes
    }'
  )"

  upsert_integration "github" "$payload"
}

echo "🚀 FlowGuard admin bootstrap"
echo "API_BASE_URL=$API_BASE_URL"

ensure_company_id
echo "Using COMPANY_ID=$COMPANY_ID"

patch_company_settings
bootstrap_slack
bootstrap_jira
bootstrap_github

echo "✅ Bootstrap complete"
