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

echo "Creating or reusing Microsoft Entra application $DISPLAY_NAME..."
CLIENT_ID="$(az ad app list --display-name "$DISPLAY_NAME" --query "[0].appId" -o tsv)"
if [[ -z "$CLIENT_ID" ]]; then
  CLIENT_ID="$(az ad app create --display-name "$DISPLAY_NAME" --query appId -o tsv)"
fi
APP_OBJECT_ID="$(az ad app show --id "$CLIENT_ID" --query id -o tsv)"

SP_OBJECT_ID="$(az ad sp list --filter "appId eq '$CLIENT_ID'" --query "[0].id" -o tsv)"
if [[ -z "$SP_OBJECT_ID" ]]; then
  SP_OBJECT_ID="$(az ad sp create --id "$CLIENT_ID" --query id -o tsv)"
fi

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
if [[ -n "$(az ad app federated-credential list --id "$APP_OBJECT_ID" \
    --query "[?name=='$CREDENTIAL_NAME'].name | [0]" -o tsv)" ]]; then
  az ad app federated-credential delete --id "$APP_OBJECT_ID" \
    --federated-credential-id "$CREDENTIAL_NAME" --output none
fi
az ad app federated-credential create --id "$APP_OBJECT_ID" \
  --parameters "@$CREDENTIAL_FILE" --output none

echo "Writing repository secrets and environment..."
gh api --method PUT "repos/$REPO/environments/$ENVIRONMENT" --silent
gh secret set AZURE_CLIENT_ID       --repo "$REPO" --body "$CLIENT_ID"
gh secret set AZURE_TENANT_ID       --repo "$REPO" --body "$TENANT_ID"
gh secret set AZURE_SUBSCRIPTION_ID --repo "$REPO" --body "$SUBSCRIPTION_ID"

echo "OIDC deployment identity ready: client $CLIENT_ID, subscription $SUBSCRIPTION_ID."
