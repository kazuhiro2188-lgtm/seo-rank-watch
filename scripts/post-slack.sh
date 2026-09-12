#!/usr/bin/env bash
# 標準入力の本文を Slack へ投稿する。Webhook URL はログに出さない。
set -euo pipefail
: "${SLACK_WEBHOOK_URL:?SLACK_WEBHOOK_URL が未設定です}"
resp="$(mktemp)"; trap 'rm -f "$resp"' EXIT
body="$(cat)"
payload="$(TEXT="$body" node -e 'process.stdout.write(JSON.stringify({text: process.env.TEXT}))')"
code="$(printf '%s' "$payload" | curl -sS -o "$resp" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data @- "$SLACK_WEBHOOK_URL")"
if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then echo "Slack投稿に失敗: HTTP $code / $(cat "$resp")" >&2; exit 1; fi
echo "Slack投稿に成功: HTTP $code"
