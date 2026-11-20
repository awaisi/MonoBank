#!/usr/bin/env bash
# Create or update a DNS-only (grey cloud) Cloudflare record.
# Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... \
#        infra/cloudflare-dns.sh <CNAME|TXT> <full-name> <content>
set -euo pipefail

TYPE="${1:?type}"; NAME="${2:?name}"; CONTENT="${3:?content}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ZONE_ID:?CLOUDFLARE_ZONE_ID is required}"
API="https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records"

cf() {
  local response
  response="$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" "$@")"
  if [[ "$(jq -r '.success' <<<"$response")" != "true" ]]; then
    echo "Cloudflare API error: $(jq -c '.errors' <<<"$response")" >&2
    return 1
  fi
  printf '%s' "$response"
}

if [[ "$TYPE" == "CNAME" ]]; then
  # Azure's managed certificate needs the CNAME to resolve to the app directly.
  BODY="$(jq -n --arg t "$TYPE" --arg n "$NAME" --arg c "$CONTENT" \
    '{type:$t, name:$n, content:$c, ttl:1, proxied:false}')"
else
  BODY="$(jq -n --arg t "$TYPE" --arg n "$NAME" --arg c "$CONTENT" \
    '{type:$t, name:$n, content:$c, ttl:1}')"
fi

EXISTING_ID="$(cf -G "$API" --data-urlencode "type=$TYPE" --data-urlencode "name=$NAME" \
  | jq -r '.result[0].id // empty')"
if [[ -n "$EXISTING_ID" ]]; then
  cf -X PUT "$API/$EXISTING_ID" --data "$BODY" >/dev/null
  echo "Updated $TYPE $NAME -> $CONTENT"
else
  cf -X POST "$API" --data "$BODY" >/dev/null
  echo "Created $TYPE $NAME -> $CONTENT"
fi
