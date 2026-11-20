targetScope = 'subscription'

@description('Short environment name used in resource names.')
param environmentName string = 'prod'

@description('Azure region for all resources.')
param location string = 'westus2'

@description('Base name used in resource names. A deterministic suffix is added where global uniqueness is required.')
param baseName string = 'monobank'

@description('Deploy the container app itself. Set false to create only the shared infrastructure (registry, environment) before the first image exists.')
param deployApp bool = false

@description('Full container image reference, e.g. myregistry.azurecr.io/monobank:sha. Required when deployApp is true.')
param containerImage string = ''

@description('Optional custom hostname, e.g. monobank.example.com. Its CNAME and asuid TXT records must already exist.')
param customDomain string = ''

@description('Resource ID of the managed certificate for customDomain. Leave empty to attach the hostname unbound so a certificate can be issued.')
param customDomainCertificateId string = ''

var suffix = uniqueString(subscription().id, environmentName, baseName)
var resourceGroupName = 'rg-${baseName}-${environmentName}'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    application: 'MonoBank'
    environment: environmentName
    managedBy: 'Bicep'
  }
}

module containerApps 'containerapps.bicep' = {
  name: 'monobank-containerapps'
  scope: resourceGroup
  params: {
    location: location
    registryName: toLower('${baseName}${suffix}')
    environmentName: 'cae-${baseName}-${environmentName}'
    logAnalyticsName: 'log-${baseName}-${environmentName}'
    appName: '${baseName}-${environmentName}'
    deployApp: deployApp
    containerImage: containerImage
    customDomain: customDomain
    customDomainCertificateId: customDomainCertificateId
  }
}

output resourceGroupName string = resourceGroup.name
output registryName string = containerApps.outputs.registryName
output registryLoginServer string = containerApps.outputs.registryLoginServer
output appName string = containerApps.outputs.appName
output webAppUrl string = containerApps.outputs.appUrl
output environmentName string = containerApps.outputs.environmentName
output environmentDefaultDomain string = containerApps.outputs.environmentDefaultDomain
output customDomainVerificationId string = containerApps.outputs.customDomainVerificationId
