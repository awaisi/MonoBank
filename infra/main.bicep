targetScope = 'subscription'

@description('Short environment name used in resource names.')
param environmentName string = 'prod'

@description('Azure region for the resource group and web app.')
param location string = 'westus2'

@description('Globally unique web app base name. A deterministic suffix is added.')
param baseName string = 'monobank'

@allowed([
  'F1'
  'B1'
  'S1'
  'P0v3'
])
@description('Linux App Service Plan SKU. B1 is the economical always-on default; F1 is free (no Always On, 60 CPU-minutes/day).')
param skuName string = 'B1'

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

module appService 'appservice.bicep' = {
  name: 'monobank-appservice'
  scope: resourceGroup
  params: {
    location: location
    webAppName: toLower('${baseName}-${environmentName}-${suffix}')
    planName: 'asp-${baseName}-${environmentName}'
    skuName: skuName
  }
}

output resourceGroupName string = resourceGroup.name
output webAppName string = appService.outputs.webAppName
output webAppUrl string = appService.outputs.webAppUrl
