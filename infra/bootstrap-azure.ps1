[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$GitHubOwner,
  [string]$Repository = "MonoBank",
  [string]$SubscriptionId,
  [string]$Location = "westus2"
)

$ErrorActionPreference = "Stop"
foreach ($command in @("az", "gh")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Install '$command' and sign in before running this script."
  }
}

if (-not $SubscriptionId) {
  $SubscriptionId = az account show --query id -o tsv
}
az account set --subscription $SubscriptionId
$TenantId = az account show --query tenantId -o tsv
$Scope = "/subscriptions/$SubscriptionId"
$DisplayName = "monobank-github-$GitHubOwner"

Write-Host "Creating or reusing Microsoft Entra application $DisplayName..."
$ClientId = az ad app list --display-name $DisplayName --query "[0].appId" -o tsv
if (-not $ClientId) {
  $ClientId = az ad app create --display-name $DisplayName --query appId -o tsv
}
$ServicePrincipalObjectId = az ad sp list --filter "appId eq '$ClientId'" --query "[0].id" -o tsv
if (-not $ServicePrincipalObjectId) {
  $ServicePrincipalObjectId = az ad sp create --id $ClientId --query id -o tsv
  Start-Sleep -Seconds 10
}

$ExistingRole = az role assignment list --assignee-object-id $ServicePrincipalObjectId --scope $Scope --role Contributor --query "[0].id" -o tsv
if (-not $ExistingRole) {
  az role assignment create --assignee-object-id $ServicePrincipalObjectId --assignee-principal-type ServicePrincipal --role Contributor --scope $Scope | Out-Null
}

$CredentialName = "github-production"
$Subject = "repo:$GitHubOwner/$Repository`:environment:production"
$Credential = @{
  name = $CredentialName
  issuer = "https://token.actions.githubusercontent.com"
  subject = $Subject
  description = "MonoBank GitHub Actions production environment"
  audiences = @("api://AzureADTokenExchange")
} | ConvertTo-Json
$TempFile = New-TemporaryFile
$Credential | Set-Content -Path $TempFile -Encoding utf8
try {
  $AppObjectId = az ad app show --id $ClientId --query id -o tsv
  $ExistingCredential = az ad app federated-credential list --id $AppObjectId --query "[?name=='$CredentialName'].name | [0]" -o tsv
  if ($ExistingCredential) {
    az ad app federated-credential delete --id $AppObjectId --federated-credential-id $CredentialName | Out-Null
  }
  az ad app federated-credential create --id $AppObjectId --parameters $TempFile | Out-Null
} finally {
  Remove-Item $TempFile -Force
}

$Repo = "$GitHubOwner/$Repository"
$ClientId | gh secret set AZURE_CLIENT_ID --repo $Repo
$TenantId | gh secret set AZURE_TENANT_ID --repo $Repo
$SubscriptionId | gh secret set AZURE_SUBSCRIPTION_ID --repo $Repo

gh api --method PUT "repos/$Repo/environments/production" | Out-Null
Write-Host "OIDC configured for $Repo. Push to main or run the Azure workflow manually."
Write-Host "Azure location: $Location"
