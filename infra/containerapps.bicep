param location string
param registryName string
param storageAccountName string
param environmentName string
param logAnalyticsName string
param appName string
param deployApp bool
param containerImage string
param customDomain string
param customDomainCertificateId string
@secure()
param adminToken string = ''

// The admin usage page is enabled only when a token is supplied; it is stored as a Container Apps secret.
var adminSecrets = empty(adminToken) ? [] : [
  {
    name: 'admin-token'
    value: adminToken
  }
]
var adminEnv = empty(adminToken) ? [] : [
  {
    name: 'ADMIN_TOKEN'
    secretRef: 'admin-token'
  }
]

// A custom domain is first attached unbound (so Azure can issue a managed
// certificate for it), then bound with SNI once the certificate exists.
var customDomains = empty(customDomain) ? [] : [
  empty(customDomainCertificateId) ? {
    name: customDomain
    bindingType: 'Disabled'
  } : {
    name: customDomain
    bindingType: 'SniEnabled'
    certificateId: customDomainCertificateId
  }
]

var tags = {
  application: 'MonoBank'
}
var gamesShareName = 'games'
var gamesStorageName = 'games'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: 1
    }
  }
}

// Basic tier. The admin user lets the container app pull images without a
// role assignment, which the Contributor-only deployment identity cannot create.
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
    publicNetworkAccess: 'Enabled'
  }
}

// Durable game storage: one JSON file per game on an Azure Files share,
// mounted into the container at /data. The environment authenticates with
// the account key (the Contributor-only deploy identity cannot assign roles).
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    shareDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource gamesShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: gamesShareName
  properties: {
    shareQuota: 5
    accessTier: 'TransactionOptimized'
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource environmentStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: environment
  name: gamesStorageName
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: gamesShare.name
      accessMode: 'ReadWrite'
    }
  }
}

// Games are cached in process memory with write-through to /data, so run
// exactly one always-on replica.
resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: appName
  location: location
  tags: tags
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        customDomains: customDomains
      }
      secrets: concat([
        {
          name: 'registry-password'
          value: registry.listCredentials().passwords[0].value
        }
      ], adminSecrets)
      registries: [
        {
          server: registry.properties.loginServer
          username: registry.listCredentials().username
          passwordSecretRef: 'registry-password'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'monobank'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: concat([
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'DATA_DIR', value: '/data' }
            { name: 'TRUST_PROXY', value: '1' }
          ], adminEnv)
          volumeMounts: [
            {
              volumeName: 'games'
              mountPath: '/data'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 3000 }
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 3000 }
              periodSeconds: 10
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'games'
          storageType: 'AzureFile'
          storageName: environmentStorage.name
          // The image runs as the unprivileged `node` user (uid/gid 1000).
          mountOptions: 'uid=1000,gid=1000,dir_mode=0700,file_mode=0600'
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output registryName string = registry.name
output storageAccountName string = storage.name
output registryLoginServer string = registry.properties.loginServer
output appName string = appName
output environmentName string = environment.name
output environmentDefaultDomain string = environment.properties.defaultDomain
output customDomainVerificationId string = environment.properties.customDomainConfiguration.customDomainVerificationId
output appUrl string = deployApp ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
