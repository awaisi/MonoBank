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

A game is held only in the Node.js process memory and receives a random 16-character URL identifier. Anyone with that URL can make changes. Restarting or replacing the container removes all games; inactive games are removed after 24 hours. This is intentional for the current no-authentication, no-database release.

Because Azure Container Apps restarts the container during deployments and platform maintenance, do not treat this version as durable storage. A future persistence layer should use Azure Cosmos DB, Table Storage, or another shared store before scaling beyond one instance.

## Azure architecture

- **Hosting:** Azure Container Apps (Consumption) running the `Dockerfile` image (Node.js 22 on Alpine). Exactly **one always-on replica** (0.25 vCPU, 0.5 GiB), because games live in process memory. Images are stored in Azure Container Registry (Basic); logs go to a Log Analytics workspace (30-day retention, 1 GB/day cap).
- **Infrastructure:** subscription-scoped Bicep in `infra/`
- **Delivery:** GitHub Actions (`.github/workflows/azure-deploy.yml`) with Microsoft Entra workload identity federation (OIDC); no publish profile or long-lived Azure password
- **Validation:** syntax checks, Node test suite, deployment, then `/health` verification
- **Cost:** billable. The always-on replica uses more than the Container Apps monthly free grant, and Azure Container Registry Basic is billed daily; expect a few dollars to roughly $15 a month in total. Check the Azure pricing calculator for your region. Region defaults to `westus2`; override it with the repository variable `AZURE_LOCATION` (*Settings → Secrets and variables → Actions → Variables*).
- **Why not App Service:** new and trial subscriptions often have 0 App Service quota (`SubscriptionIsOverQuotaForSku`); Container Apps uses separate quota. If you change `AZURE_LOCATION` after `rg-monobank-prod` exists in another region, delete that resource group first.

### One-time Azure/GitHub trust setup

The deploy workflow signs in to Azure with OIDC using three repository secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID`. Until they exist, pushes to `main` build and test but skip deployment. Create them with **either** option below.

#### Option A: GitHub Actions bootstrap workflow (no local tools)

1. **Create a bootstrap service principal** in the Azure portal: *Microsoft Entra ID → App registrations → New registration* (e.g. `monobank-bootstrap`), then *Certificates & secrets → New client secret*.
2. **Grant it rights:**
   - On the subscription (*Subscriptions → Access control (IAM)*): **Owner**, or **Contributor** + **Role Based Access Control Administrator**. It needs to assign roles and deploy resources.
   - In Microsoft Graph (*API permissions → Add → Microsoft Graph → Application permissions*): **Application.ReadWrite.OwnedBy**, then **Grant admin consent**. If your tenant blocks that, assign the Entra role **Cloud Application Administrator** instead.
3. **Create a fine-grained GitHub personal access token** limited to this repository, with repository permissions **Secrets**, **Environments** and **Administration** set to *Read and write*.
4. **Add repository secrets** (*Settings → Secrets and variables → Actions*):

   | Secret | Value |
   | --- | --- |
   | `BOOTSTRAP_AZURE_CLIENT_ID` | Bootstrap app's Application (client) ID |
   | `BOOTSTRAP_AZURE_CLIENT_SECRET` | Bootstrap client secret value |
   | `BOOTSTRAP_AZURE_TENANT_ID` | Directory (tenant) ID |
   | `BOOTSTRAP_AZURE_SUBSCRIPTION_ID` | Target subscription ID |
   | `BOOTSTRAP_GH_TOKEN` | The personal access token |

5. Run **Actions → Bootstrap Azure (one-time) → Run workflow**. It creates the `monobank-github-<owner>` deployment identity (Contributor on the subscription, OIDC trust limited to this repository's `production` environment), writes the three `AZURE_*` secrets, creates the `production` environment, and, by default, provisions the shared infrastructure from `infra/main.bicep`. The app itself is deployed by the deploy workflow.
6. Push to `main` or run the deploy workflow to ship the app.

Once it succeeds, **delete the bootstrap client secret and the `BOOTSTRAP_*` secrets/PAT**. Day-to-day deployments use only the passwordless OIDC identity. The workflow is idempotent if you need to re-run it later.

#### Option B: run the script from a workstation

With Azure CLI and GitHub CLI installed and signed in (`az login`, `gh auth login`):

```bash
./infra/bootstrap-azure.sh awaisi/MonoBank <subscription-id>
```

or, in PowerShell:

```powershell
./infra/bootstrap-azure.ps1 -GitHubOwner awaisi -Repository MonoBank -SubscriptionId <subscription-id>
```

You need permission to create app registrations, role assignments, repository secrets, and environments.

For tighter least privilege, run the first deployment with Contributor at subscription scope, then replace it with a custom role restricted to the generated resource group while retaining permission to execute subscription-scope deployments.

### Custom domain (Cloudflare)

The deploy workflow serves the app at `https://monobank.divviq.app` (override with the repository variable `CUSTOM_DOMAIN`, or set it to `none` to disable). On each deploy it:

1. Creates/updates two DNS records in Cloudflare: `CNAME monobank → <app>.<environment>.azurecontainerapps.io` (**DNS only**, grey cloud) and `TXT asuid.monobank → <Container Apps verification ID>`.
2. Attaches the hostname to the container app and, on first run, has Azure issue a free **managed TLS certificate** and bind it. Later deploys reuse that certificate; Azure renews it automatically.

Keep the record **DNS only**. Azure validates and renews the managed certificate through the CNAME, which fails if Cloudflare proxies it.

Required repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token from *My Profile → API Tokens → Create Token → Edit zone DNS*, limited to the `divviq.app` zone (permission **Zone → DNS → Edit**) |
| `CLOUDFLARE_ZONE_ID` | Zone ID shown on the `divviq.app` overview page in the Cloudflare dashboard (right-hand column, *API* section) |

If the secrets are missing, the workflow skips the custom domain with a warning and the app stays on its `azurecontainerapps.io` URL.

### Deployment flow

Every push to `main`:

1. Checks out the repository and uses Node.js 22.
2. Runs syntax checks and all tests.
3. Signs into Azure with OIDC.
4. Deploys the shared infrastructure in `infra/main.bicep` (resource group, registry, Log Analytics, Container Apps environment) idempotently.
5. Builds the container image, pushes it to the registry tagged with the commit SHA, and deploys the container app with that image.
6. Polls the public `/health` endpoint and fails if the app does not become healthy.

The workflow can also be run manually from **Actions → Build, test, and deploy to Azure**.

## API overview

- `POST /api/games` — create a game
- `GET /api/games/:id` — read current game state
- `POST /api/games/:id/actions` — perform a transfer, buy, rent, mortgage, building, or trade action
- `GET /health` — container liveness/readiness probe and deployment verification

The client sends an expected revision with each action. A stale browser receives HTTP 409 and refreshes instead of silently overwriting a newer transaction.

## Security and accessibility

MonoBank sets a restrictive Content Security Policy and related browser security headers, caps request bodies, validates all actions server-side, escapes player-provided text in the client, uses native dialog and form controls, supports keyboard focus, exposes labels and live notifications, provides strong contrast, adapts to reduced-motion preferences, and includes a 320px-friendly mobile layout.

## License

Private project. All rights reserved unless a license is added by the repository owner.
