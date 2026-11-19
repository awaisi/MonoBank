#!/usr/bin/env bash
# One-time bootstrap: creates the OIDC deployment identity used by
# .github/workflows/azure-deploy.yml and stores its IDs as repository secrets.
#
# Requires: az (signed in with rights to create app registrations and role
# assignments) and gh (GH_TOKEN with Secrets + Environments + Administration
# write on the repository). Safe to re-run.
#
# Usage: infra/bootstrap-azure.sh <owner/repo> [subscription-id]
set -euo pipefail

REPO="${1:?usage: bootstrap-azure.sh <owner/repo> [subscription-id]}"
SUBSCRIPTION_ID="${2:-$(az account show --query id -o tsv)}"
ENVIRONMENT="${GITHUB_DEPLOY_ENVIRONMENT:-production}"
OWNER="${REPO%%/*}"

az account set --subscription "$SUBSCRIPTION_ID"
TENANT_ID="$(az account show --query tenantId -o tsv)"
SCOPE="/subscriptions/$SUBSCRIPTION_ID"
DISPLAY_NAME="monobank-github-$OWNER"

# Microsoft Graph is eventually consistent: an object created a moment ago can
# return "does not exist" on the next call. Retry such calls for up to ~2 min.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8; do
    if "$@"; then return 0; fi
    if [[ $attempt -eq 8 ]]; then
      echo "Giving up after $attempt attempts: $*" >&2
      return 1
    fi
    echo "Waiting for Microsoft Entra replication (attempt $attempt)..." >&2
    sleep 15
  done
}

echo "Creating or reusing Microsoft Entra application $DISPLAY_NAME..."
# Values of a JMESPath list come back one per line with -o tsv; normalise tabs too.
ids() { tr '\t' '\n'; }
APP_IDS=()
mapfile -t APP_IDS < <(az ad app list --display-name "$DISPLAY_NAME" \
  --query "[0].[appId, id]" -o tsv | ids)
if [[ -z "${APP_IDS[0]:-}" ]]; then
  mapfile -t APP_IDS < <(az ad app create --display-name "$DISPLAY_NAME" \
    --query "[appId, id]" -o tsv | ids)
fi
CLIENT_ID="${APP_IDS[0]:-}"
APP_OBJECT_ID="${APP_IDS[1]:-}"
[[ -n "${CLIENT_ID:-}" && -n "${APP_OBJECT_ID:-}" ]] || { echo "Could not find or create application $DISPLAY_NAME" >&2; exit 1; }
echo "Application: client $CLIENT_ID, object $APP_OBJECT_ID"

SP_OBJECT_ID="$(az ad sp list --filter "appId eq '$CLIENT_ID'" --query "[0].id" -o tsv)"
if [[ -z "$SP_OBJECT_ID" ]]; then
  create_sp() { SP_OBJECT_ID="$(az ad sp create --id "$CLIENT_ID" --query id -o tsv)"; }
  retry create_sp
fi
echo "Service principal: $SP_OBJECT_ID"

echo "Granting Contributor on $SCOPE..."
EXISTING_ROLE="$(az role assignment list --scope "$SCOPE" --role Contributor \
  --query "[?principalId=='$SP_OBJECT_ID'].id | [0]" -o tsv)"
if [[ -z "$EXISTING_ROLE" ]]; then
  # A new service principal can take a while to replicate; retry.
  for attempt in 1 2 3 4 5 6; do
    if az role assignment create --assignee-object-id "$SP_OBJECT_ID" \
        --assignee-principal-type ServicePrincipal --role Contributor \
        --scope "$SCOPE" --output none; then
      break
    fi
    [[ $attempt -eq 6 ]] && { echo "Role assignment failed" >&2; exit 1; }
    echo "Retrying role assignment in 15s..."; sleep 15
  done
fi

echo "Configuring federated credential for repo:$REPO:environment:$ENVIRONMENT..."
CREDENTIAL_NAME="github-$ENVIRONMENT"
CREDENTIAL_FILE="$(mktemp)"
trap 'rm -f "$CREDENTIAL_FILE"' EXIT
cat > "$CREDENTIAL_FILE" <<JSON
{
  "name": "$CREDENTIAL_NAME",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:$REPO:environment:$ENVIRONMENT",
  "description": "MonoBank GitHub Actions $ENVIRONMENT environment",
  "audiences": ["api://AzureADTokenExchange"]
}
JSON
EXISTING_CREDENTIAL=""
list_credential() {
  EXISTING_CREDENTIAL="$(az ad app federated-credential list --id "$APP_OBJECT_ID" \
    --query "[?name=='$CREDENTIAL_NAME'].name | [0]" -o tsv)"
}
retry list_credential
if [[ -n "$EXISTING_CREDENTIAL" ]]; then
  az ad app federated-credential delete --id "$APP_OBJECT_ID" \
    --federated-credential-id "$CREDENTIAL_NAME" --output none
fi
retry az ad app federated-credential create --id "$APP_OBJECT_ID" \
  --parameters "@$CREDENTIAL_FILE" --output none

echo "Writing repository secrets and environment..."
gh api --method PUT "repos/$REPO/environments/$ENVIRONMENT" --silent
gh secret set AZURE_CLIENT_ID       --repo "$REPO" --body "$CLIENT_ID"
gh secret set AZURE_TENANT_ID       --repo "$REPO" --body "$TENANT_ID"
gh secret set AZURE_SUBSCRIPTION_ID --repo "$REPO" --body "$SUBSCRIPTION_ID"

echo "OIDC deployment identity ready: client $CLIENT_ID, subscription $SUBSCRIPTION_ID."
