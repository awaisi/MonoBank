# MonoBank

MonoBank is a mobile-first, shared banking companion for a classic property-trading board game. It replaces paper cash with instant transfers, a complete deed desk, automatic rent calculations, trades, mortgages, buildings, and an auditable activity feed.

> MonoBank is an unofficial fan-made companion and is not affiliated with or endorsed by Hasbro.

## Highlights

- Start a shared game for 2–4 players with a unique URL.
- Move money between players and the Bank, with GO, jail, and tax shortcuts.
- Manage all 28 classic U.S. deeds, including purchase and auction prices.
- Calculate street, complete-color-set, railroad, and utility rent automatically.
- Mortgage and unmortgage deeds; buy and sell houses/hotels with even-building checks.
- Trade deeds and cash in one atomic transaction.
- Use an accessible responsive UI designed as a tableside game console.
- Keep sessions in server memory for 24 hours after the latest activity.

## Run locally

Requires Node.js 22 or newer. There are no runtime dependencies.

```powershell
cd C:\Code\MonoBank
node server.mjs
```

Open <http://localhost:3000>.

For development and validation:

```bash
npm test
npm run check
npm run dev
```

## How sessions work

A game is held only in the Node.js process memory and receives a random 16-character URL identifier. Anyone with that URL can make changes. Restarting or replacing the App Service process removes all games; inactive games are removed after 24 hours. This is intentional for the current no-authentication, no-database release.

Because Azure App Service can restart during deployments, platform maintenance, or scaling, do not treat this version as durable storage. A future persistence layer should use Azure Cosmos DB, Table Storage, or another shared store before scaling beyond one instance.

## Azure architecture

- **Hosting:** Linux Azure App Service running Node.js 22
- **Infrastructure:** subscription-scoped Bicep in `infra/`
- **Delivery:** GitHub Actions (`.github/workflows/azure-deploy.yml`) with Microsoft Entra workload identity federation (OIDC); no publish profile or long-lived Azure password
- **Validation:** syntax checks, Node test suite, deployment, then `/health` verification
- **Default SKU:** B1 Basic with Always On. This creates billable Azure resources; change `skuName` in `infra/main.bicep` if another supported tier is preferred.

### One-time Azure/GitHub trust setup

The workflow expects these GitHub repository secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

On a trusted Windows workstation with Azure CLI and GitHub CLI installed and authenticated, run:

```powershell
./infra/bootstrap-azure.ps1 -GitHubOwner YOUR_GITHUB_USER -Repository MonoBank -SubscriptionId YOUR_SUBSCRIPTION_ID
```

The script creates/reuses a Microsoft Entra application and service principal, grants it Contributor at the selected subscription, adds a federated credential restricted to the repository's `production` environment, and writes the three repository secrets. You need permission to create app registrations, role assignments, repository secrets, and environments.

For tighter least privilege, run the first deployment with Contributor at subscription scope, then replace it with a custom role restricted to the generated resource group while retaining permission to execute subscription-scope deployments.

### Deployment flow

Every push to `main`:

1. Checks out the repository and uses Node.js 22.
2. Runs syntax checks and all tests.
3. Signs into Azure with OIDC.
4. deploys `infra/main.bicep` idempotently.
5. Packages and ZIP-deploys the app.
6. Polls the public `/health` endpoint and fails if the app does not become healthy.

The workflow can also be run manually from **Actions → Build, test, and deploy to Azure**.

## API overview

- `POST /api/games` — create a game
- `GET /api/games/:id` — read current game state
- `POST /api/games/:id/actions` — perform a transfer, buy, rent, mortgage, building, or trade action
- `GET /health` — App Service health probe and deployment verification

The client sends an expected revision with each action. A stale browser receives HTTP 409 and refreshes instead of silently overwriting a newer transaction.

## Security and accessibility

MonoBank sets a restrictive Content Security Policy and related browser security headers, caps request bodies, validates all actions server-side, escapes player-provided text in the client, uses native dialog and form controls, supports keyboard focus, exposes labels and live notifications, provides strong contrast, adapts to reduced-motion preferences, and includes a 320px-friendly mobile layout.

## License

Private project. All rights reserved unless a license is added by the repository owner.
