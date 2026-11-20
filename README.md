# MonoBank

**MonoBank is a free, unofficial digital banker for Monopoly® game night.** Everyone at the table shares one live bank on their phones, replacing the paper money with instant payments, a complete deed desk, automatic rent, trades, mortgages, buildings and an auditable activity feed. Bring your own board game; MonoBank handles the banking.

Live at **https://monobank.divviq.app**.

> MonoBank is an independent, unofficial fan-made app. It is not affiliated with, sponsored or endorsed by Hasbro, Inc. MONOPOLY® is a registered trademark of Hasbro, Inc.

## Highlights

- Start a shared game for **2–8 players** with a unique URL; each seat gets its own color and token.
- Move money between players and the Bank, with GO, jail, and tax shortcuts.
- Manage all 28 classic U.S. deeds, including purchase and auction prices.
- Calculate street, complete-color-set, railroad, and utility rent automatically.
- Mortgage and unmortgage deeds; buy and sell houses/hotels with even-building checks.
- Pick **house rules** per game: Free Parking jackpot, $400 for landing on GO, no rent in jail, auctions on/off, even building on/off, and mortgage interest.
- Track who is in jail, and run a Free Parking pot with its own balance and one-tap payout.
- **Undo** the last action (and keep going back), with undone entries struck through in the activity feed.
- **Bankruptcy**: hand a player's cash and deeds to their creditor or the Bank; the last player standing wins.
- **Net worth** on every player card, and an **End game** results screen with final standings.
- **No overdrafts:** a player can't spend more than they have. MonoBank shows how much is missing and offers to mortgage deeds or sell buildings first, or to declare bankruptcy.
- **Balances on every tab:** a compact strip of every player's balance stays pinned at the top of Quick pay, Deeds, Trade and Activity.
- **Activity filter:** show one player's (or the Bank's) transactions.
- **Deed owner pills:** filter the Deeds tab by owner (All, each player with their deed count, or Bank for unowned deeds).
- **QR code** to join a game from another phone.
- **Live on every phone:** payments appear on every device the moment they happen (server-sent events, with polling as a fallback).
- **"This phone is me":** each device picks its player (or the banker) for a personal view: your balance first, a **You** badge, and your name pre-filled.
- **Spectator link:** a separate view-only link and QR code for people watching the game; it can't change anything and never reveals the game's edit link.
- **Payment sounds and vibration**, with a per-device on/off toggle.
- Trade deeds and cash in one atomic transaction.
- Use an accessible responsive UI designed as a tableside game console. A minimal sticky header shows the brand and the tagline “Unofficial Monopoly® banker”; on a game it adds the live game code, **Invite** (QR code and link), and a **⋯** menu with **Copy game link**, **Sound & vibration**, and **End game**.
- Games are saved durably and survive restarts and deploys; they expire after 24 hours of inactivity.
- Built-in abuse protection: per-IP rate limits and a cap on active games.

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

Or run the production container:

```bash
docker build -t monobank .
docker run -p 3000:3000 monobank
```

Contributor and coding-agent guidance (architecture, conventions, deployment constraints) lives in [`CLAUDE.md`](CLAUDE.md). The prioritized backlog is in [`docs/FEATURE_PLAN.md`](docs/FEATURE_PLAN.md).

## Testing

```bash
npm test           # 116 unit and API tests (node:test)
npm run coverage   # same, with a coverage report — lib/game.mjs, lib/store.mjs, lib/rate-limit.mjs, lib/streams.mjs and public/qr.js are at 100% line coverage
npm run e2e        # 28 browser scenarios with Playwright, including multi-device live updates and spectators (skipped if Playwright isn't installed)
```

The project has no dependencies; the e2e test loads Playwright only if it is already available.

## Undo, bankruptcy, and ending a game

- **Undo:** the **↶ Undo** button (Activity panel and Activity tab) reverses the most recent action: payments, purchases, rent, mortgages, buildings, trades, jail, Free Parking, bankruptcy, or game over. Press it again to keep going back, up to 50 actions. Every action is also atomic: if it fails, nothing changes.
- **Bankruptcy:** open the **Bankruptcy** card at the bottom of **Quick pay** and choose the bankrupt player and who they owe. A **What happens** preview spells out the settlement before you confirm (building sale proceeds, cash and deeds handed over, any debt written off, and whether this ends the game). Their houses and hotels are sold to the Bank at half price. Their cash (if positive) and deeds go to the creditor; mortgaged deeds stay mortgaged. If they owe the Bank, deeds return to the Bank unmortgaged. A negative balance is written off. The player leaves the game, and when only one player remains they win automatically.
- **Net worth:** what a player's holdings are worth to them right now: cash + deeds at list price (a mortgaged deed counts at list price minus what it costs to unmortgage it) + houses and hotels at what the Bank pays back for them (half price). Reversible moves leave it unchanged (build then sell a house, mortgage then unmortgage), and their real costs show up immediately: a $200 house is worth $100, and mortgaging Boardwalk counts the $20 interest owed. It's shown on each player card, the "Playing as" bar and the results screen.
- **No negative balances:** every payment (transfers, taxes, Free Parking, rent, purchases and auctions, unmortgaging, houses and hotels, the cash side of a trade) needs the payer to have the money. Paying exactly everything is fine. If they're short, nothing changes and a **Raise cash first** dialog shows the shortfall with one-tap **Sell** (buildings, half price, evenly) and **Mortgage** buttons. Once there's enough, it says to try the payment again. If selling everything still isn't enough, it suggests **Declare bankruptcy**, which opens the bankruptcy card for that player. A hotel can never be bought on credit. Games saved before this rule may still show a negative balance; it's written off on bankruptcy.
- **End game:** **⋯ → End game** in the header declares the highest net worth the winner (ties are shared) and opens the results screen: standings, game length, transaction count, and top rent collector. An ended game is read-only until someone undoes "Game over".

## Joining and feedback

- **Balances everywhere:** a strip of every player's balance (and the Free Parking pot) sits at the top of every tab and stays pinned under the header while you scroll. On phones, the tabs scroll the player cards out of view.
- **Your name first:** once a phone has picked its player, that player comes first in the player cards, the balance strip, every player list and the activity filter.
- **Paying rent:** open an owned deed, choose **Who pays rent?** and tap **Pay rent to Ana**. The owner is never offered as the payer.
- **Deed owner pills:** on **Deeds**, tap **All**, a player (with their color and deed count) or **Bank** to see only those deeds. Pills combine with the search box and the status filter (available, owned, mortgaged, mine).
- **Activity filter:** **Activity → Show** narrows the feed to one player or the Bank (transactions they paid or received).
- **Who's on this phone:** the first time a device opens a game, it asks *"Who's playing on this phone?"*. Pick a player or **I'm the banker**. The choice is remembered on that device for that game. It shows **Playing as Ana · $1,200 · net worth $1,600** under the title, marks your card **You**, pre-fills *From* in payments, *Player one* in trades, the buyer in the deed desk and the payer when collecting rent, and adds a **My deeds** filter. Change it any time with **Switch** or **⋯ → Switch player…**. It's a convenience view: every device can still bank for anyone, as at a real table.
- **Live updates:** every game screen keeps a live connection to the server. When anyone acts, every phone and spectator updates within a moment, with a short chime. The dot in the game code turns amber while reconnecting, and the app falls back to checking every few seconds until the live connection returns.
- **Spectators:** **Invite → Spectators** (or **⋯ → Copy spectator link**) gives a `/watch/<token>` link and QR code. Spectators see balances, deeds, standings and activity live, but get no payment, trade, bankruptcy, undo or end-game controls, and the server has no write route for spectator links. The spectator token is separate from the game ID, so a spectator can't work out the player link.
- **QR code:** **Invite** in the header shows a scannable code for the player link (or the spectator link). It's generated in the browser by a small built-in encoder, with no third-party service or dependency.
- **Sound and vibration:** payments play a short chime, and phones that support it vibrate. That covers your own actions, changes from other devices, and errors. **⋯ → Sound & vibration** in the header turns this on or off for the current device.

## House rules

Open **House rules** on the new-game screen to choose how your table plays. Rules are fixed once the bank opens, shown under the console title, and recorded in the first activity entry. The server enforces every rule.

| Rule | Default | What it changes |
| --- | --- | --- |
| Free Parking jackpot | Off | Adds a **Free Parking pot** account. The Jail, Tax and Luxury shortcuts pay into it, and any payment can target it. A pot card shows the balance and a **Collect** button for whoever lands on Free Parking. |
| Seed the pot | $0 | With the jackpot on, the Bank puts this amount in the pot at the start and again after every collection (a common choice is $500). |
| $400 for landing on GO | Off | Adds a **Land on GO +$400** shortcut alongside the usual **GO +$200**. |
| No rent while in jail | Off | Adds **Send to jail / Release from jail** to each player card. A jailed owner cannot collect rent. |
| Auctions | On | Off: unbought deeds can only be bought at list price; the auction option disappears. |
| Even building | On | Off: houses can be built and sold unevenly across a color set (owning the full set is still required). |
| Mortgage interest | 10% | Interest added when unmortgaging, from 0% to 100%. |

Games created through the API without `rules` use the defaults above, which match the classic rules.

## How sessions work

Each game gets a random 16-character URL identifier. Anyone with that URL can make changes; there is no sign-in.

**Games are durable.** In production every game is saved as a JSON file on an Azure Files share mounted at `/data`. The file is written atomically after every action and loaded again on first use after a restart. Deploys, restarts and platform maintenance no longer lose games in progress, and undo history survives too. Games are deleted after **24 hours without activity**.

The server keeps a working copy of each active game in memory and writes it through to disk, so it must run as **exactly one instance**. Running several replicas would need a shared database first.

Locally, games stay in memory unless you set `DATA_DIR`:

```bash
DATA_DIR=./data npm run dev
```

If the data directory can't be created or read at startup, the server logs an error and falls back to memory, so the app stays up. `/health` reports which mode is active (`"storage": "file"` or `"memory"`), and the deploy pipeline refuses to call a deploy healthy unless it is `file`.

## Abuse protection

| Limit | Default | Response |
| --- | --- | --- |
| New games per client IP | 20 per hour | HTTP 429 with `Retry-After` |
| API requests per client IP | 600 per minute (a busy table of 8 phones polling uses about 140) | HTTP 429 with `Retry-After` |
| Active games | 5,000 (expired games are swept first) | HTTP 503 "at capacity" |
| Request body | 64 KB | HTTP 413 |

`/health` and static files are never rate limited. Behind Azure's ingress, the client IP comes from `X-Forwarded-For`; the header is trusted only when `TRUST_PROXY=1`, so it can't be spoofed locally.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | unset (memory) | Directory for game files; `/data` in production |
| `MAX_GAMES` | `5000` | Active game cap |
| `RATE_LIMIT_CREATE_PER_HOUR` | `20` | New games per IP per hour |
| `RATE_LIMIT_API_PER_MINUTE` | `600` | API requests per IP per minute |
| `TRUST_PROXY` | unset | Set to `1` behind a trusted reverse proxy to use `X-Forwarded-For` |

## Azure architecture

- **Hosting:** Azure Container Apps (Consumption) running the `Dockerfile` image (Node.js 22 on Alpine). Exactly **one always-on replica** (0.25 vCPU, 0.5 GiB), because games live in process memory. Images are stored in Azure Container Registry (Basic); logs go to a Log Analytics workspace (30-day retention, 1 GB/day cap). Game files live on an **Azure Files** share (Standard LRS storage account, 5 GiB share, 7-day soft delete) mounted at `/data`.
- **Infrastructure:** subscription-scoped Bicep in `infra/`
- **Delivery:** GitHub Actions (`.github/workflows/azure-deploy.yml`) with Microsoft Entra workload identity federation (OIDC); no publish profile or long-lived Azure password
- **Validation:** syntax checks, Node test suite, deployment, then `/health` verification
- **Cost:** billable. The always-on replica uses more than the Container Apps monthly free grant, Azure Container Registry Basic is billed daily, and the game file share adds a few cents. Expect a few dollars to roughly $15 a month in total. Check the Azure pricing calculator for your region. Region defaults to `westus2`; override it with the repository variable `AZURE_LOCATION` (*Settings → Secrets and variables → Actions → Variables*).
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
6. Before deploying, creates a **persistence probe** game on the running app (once it reports file storage).
7. Polls `/health` on both URLs until the new revision reports `"storage": "file"`, then checks that the probe game survived the deploy. Either failure fails the run.

The workflow can also be run manually from **Actions → Build, test, and deploy to Azure**.

## API overview

- `POST /api/games` — create a game: `{ "players": ["Ana", "Ben"], "startingBalance": 1500, "rules": { "freeParkingJackpot": true, "freeParkingSeed": 500 } }` (`rules` is optional; omitted keys use the defaults)
- `GET /api/games/:id/events` — **server-sent events** stream: an `event: game` message with the full public state on connect and after every change, plus a heartbeat comment every 25 s. Up to 50 streams per game and 2,000 in total (HTTP 503 beyond that).
- `GET /api/watch/:token` and `GET /api/watch/:token/events` — the **spectator** equivalents: the same state with `id: null`, `spectator: true` and `undo: null`. There are no write routes for spectator tokens.
- `GET /api/games/:id` — read current game state, including `viewToken` (the spectator token, for sharing), `rules`, `freeParking` (pot balance), each player's `inJail` and `bankrupt`, `status` (`active`/`ended`), `winnerIds`, `standings` (net worth breakdown, `raisable` and rank per player), and `undo` (the action that undo would reverse, or `null`)
- `POST /api/games/:id/actions` — perform one action, selected by `type`:

  | `type` | Fields | Notes |
  | --- | --- | --- |
  | `transfer` | `fromId`, `toId`, `amount`, `note?`, `category?` | Account IDs are player IDs, `bank`, or `parking` (destination only, jackpot on) |
  | `buy` | `playerId`, `propertyId`, `amount?`, `auction?` | List price only when auctions are off |
  | `rent` | `payerId`, `propertyId`, `diceTotal?` | `diceTotal` (2–12) for utilities; blocked for a jailed owner under "No rent while in jail" |
  | `mortgage` / `unmortgage` | `playerId`, `propertyId` | Unmortgage cost uses the game's interest rate |
  | `building` | `playerId`, `propertyId`, `direction` (`buy`/`sell`) | Even-building check depends on the house rule |
  | `trade` | `firstPlayerId`, `secondPlayerId`, `firstCash`, `secondCash`, `firstPropertyIds`, `secondPropertyIds` | Atomic |
  | `collect-parking` | `playerId` | Pays out the pot and reseeds it; jackpot rule only |
  | `jail` | `playerId`, `inJail` (boolean) | Records a player entering or leaving jail |
  | `bankrupt` | `playerId`, `creditorId?` (player ID or `bank`, default `bank`) | Liquidates buildings, hands over cash and deeds, removes the player; ends the game if one player remains |
  | `end-game` | — | Ends the game; highest net worth wins |
  | `undo` | — | Reverses the most recent action (repeatable, last 50) |

  Every action except `undo` is rejected once the game has ended, and any action naming a bankrupt player is rejected.

  A payment the payer can't cover returns HTTP 400 with `code: "insufficient-funds"` and `details: { playerId, needed, balance, shortfall, raisable }`, where `raisable` is what selling every building and mortgaging every unmortgaged deed would bring in.

- `GET /health` — container liveness/readiness probe and deployment verification: `{ "status": "ok", "service": "monobank", "storage": "file" | "memory" }`

API errors use JSON `{ "error": "…" }` with status 400 (invalid input), 404 (unknown or expired game), 409 (stale revision), 413 (body too large), 429 (rate limited, with `Retry-After`), 503 (at capacity), or 500.

The client sends an expected revision with each action. A stale browser receives HTTP 409 and refreshes instead of silently overwriting a newer transaction.

## Branding and SEO

- **Positioning:** the header tagline, hero (“Ditch the paper money. Run the bank from your phone.”) and page title all say what MonoBank is: an unofficial banker for Monopoly game night. The trademark disclaimer appears in the footer of every page.
- **Search and sharing:** a descriptive `<title>` and meta description, canonical URL, Open Graph and Twitter card tags with a 1200×630 share image (`/og-image.jpg`), `WebApplication` structured data (JSON-LD), `robots.txt` and `sitemap.xml`.
- **Private games stay out of search:** `/game/*` pages are served with `X-Robots-Tag: noindex, nofollow`, API responses with `noindex`, and `robots.txt` disallows both.

## Security and accessibility

Static files are served with `Cache-Control: no-cache` and an `ETag`, so browsers revalidate (cheap 304s) and never mix a new page with stale CSS or JavaScript after a deploy. MonoBank sets a restrictive Content Security Policy (no inline scripts or style attributes; per-element colors are applied through the CSSOM) and related browser security headers, caps request bodies, validates all actions server-side, escapes player-provided text in the client, uses native dialog and form controls, supports keyboard focus, exposes labels and live notifications, provides strong contrast, adapts to reduced-motion preferences, and includes a 320px-friendly mobile layout.

## License

Private project. All rights reserved unless a license is added by the repository owner.
