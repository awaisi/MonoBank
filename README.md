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
- **Net worth** in each player's sheet, and **Finish game** at any time: pick the winner from the players still in (or let net worth decide), then see the final standings.
- **No overdrafts:** a player can't spend more than they have. MonoBank shows how much is missing and offers to mortgage deeds or sell buildings first, or to declare bankruptcy.
- **Sets view:** on **Deeds**, switch **List | Sets** to see every color group in one screen: who owns each deed, houses and hotels, mortgages, complete sets, and who is one deed away.
- **Private balances by default:** each phone sees only its own player's cash and net worth, like keeping your money face down; everything is revealed when the game ends. Turn on **Show everyone's money** at setup to keep balances open.
- **Player tiles:** one row of tiles at the top of every tab shows each player's balance (your own, or everyone's with open balances), net worth, deed count and status. Tap a player for their sheet (breakdown, deeds, one-tap quick actions). On **Deeds** the same tiles filter deeds by owner.
- **Per-player quick actions:** Passed GO, Income Tax, Luxury Tax, Jail fee or any amount to or from the Bank, in one tap from the player's sheet.
- **Activity built for long games:** the full history in 15-minute blocks with clock times, filters by player, type and search, each player's money in/out with their balance after every move, a "Game so far" summary, and a CSV download.
- **QR code** to join a game from another phone.
- **Live on every phone:** payments appear on every device the moment they happen (server-sent events, with polling as a fallback).
- **"This phone is me":** each device picks its player (or the banker) for a personal view: your tile first (marked **You**), and your name pre-filled.
- **Spectator link:** a separate view-only link and QR code for people watching the game; it can't change anything and never reveals the game's edit link.
- **Payment sounds and vibration**, with a per-device on/off toggle.
- Trade deeds and cash in one atomic transaction.
- Use an accessible responsive UI designed as a tableside game console. A minimal sticky header shows the brand and the tagline “Unofficial Monopoly® banker”; on a game it adds the live game code, **Invite** (QR code and link), and a **⋯** menu with **Copy game link**, **Sound & vibration**, and **Finish game…**.
- Games are saved durably and survive restarts and deploys. A paused game is kept for **30 days** after its last move (a finished one for 7 days), so you can pick up next weekend.
- Built-in abuse protection: per-IP rate limits and a cap on active games.

## How to use

A game night with MonoBank, start to finish. Everyone still plays on the physical board; MonoBank replaces the paper money and the deed cards' bookkeeping.

1. **Open the bank.** Go to [monobank.divviq.app](https://monobank.divviq.app), add 2–8 players and the starting cash. Open **House rules** to pick any your table plays: Free Parking jackpot, $400 for landing on GO, no rent in jail, auctions, even building, mortgage interest, and **Show everyone's money** (off by default, so each phone sees only its own player's money). Tap **Open the bank**.
2. **Bring everyone in.** Tap **Invite** to show a QR code, or use **⋯ → Copy game link**, and everyone opens the same game on their phone. For people who are only watching (or a TV), switch the Invite card to **Spectators**: that link is view-only.
3. **Say who's on each phone.** Each phone picks its player (or **I'm the banker**). That phone's tile comes first, forms are pre-filled with that player, and it sees that player's money. Change it any time with **Switch** or **⋯ → Switch player…**. Anyone can still bank for anyone.
4. **Play.**
   - **Pay someone:** **Pay** tab: choose *From*, *To* and the amount, or use a preset (GO, Jail, Tax, Luxury). With the jackpot rule, taxes and fees go to the Free Parking pot.
   - **One-tap payments:** tap a player's tile for their sheet: **Passed GO**, **Income Tax**, **Luxury Tax**, **Jail fee**, or any amount to or from the Bank.
   - **Buy a deed:** **Deeds** tab: tap the deed, choose the buyer and the price (or an auction price, if auctions are on), and tap **Acquire deed**.
   - **Collect rent:** tap an owned deed, choose **Who pays rent?** and tap **Pay rent to …** (the owner's name). MonoBank works out the amount (sets, houses, hotels, railroads, and utilities from the dice total).
   - **Build, sell, mortgage:** in the same deed dialog: **＋** to add a house or hotel, **− Sell building**, **Mortgage** and **Unmortgage**. Houses go on full color sets, evenly unless the table turned that rule off.
   - **Trade:** **Trade** tab: pick two players, the deeds and any cash each side gives, and confirm.
   - **Not enough cash?** MonoBank won't let a balance go negative. It shows how much is missing and offers to sell buildings or mortgage deeds right there.
   - **Jail and Free Parking:** with those house rules, the player sheet has **Send to jail / Release**, and tapping the Free Parking tile lets you **Collect** the pot for whoever landed there.
   - **Made a mistake?** Tap **↶ Undo**. It works for every kind of move, and you can keep going back.
5. **Keep track.** The player tiles at the top show balances (your own, or everyone's with open balances), net worth and deed counts. **Deeds → Sets** shows who owns each color set and who is one deed away. **Activity** lists every move in time order, with filters by player and type, search, and **⋯ → Download activity (CSV)**.
6. **When someone can't pay.** In the **Pay** tab, open **Bankruptcy**: it previews exactly what happens (buildings sold, cash and deeds to the creditor or back to the Bank) before you confirm. The last player standing wins automatically.
7. **Finish whenever you like.** **⋯ → Finish game…** ends the game: let the highest net worth win, or pick the winner from the players still in. The results screen shows the final standings, how long you played and every player's money. **Undo** reopens the game if you finished by mistake.
8. **Pause and come back.** Just close the app. Reopen the same game link (or scan the QR again) any time within 30 days of the last move; finished games stay available for 7 days.

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
npm test           # 153 unit and API tests (node:test)
npm run coverage   # same, with a coverage report
npm run coverage:check  # fails unless lib/game.mjs, lib/store.mjs, lib/rate-limit.mjs, lib/streams.mjs, lib/admin.mjs and public/qr.js have 100% line coverage (CI runs this)
npm run e2e        # 37 browser scenarios with Playwright, including multi-device live updates and spectators (skipped if Playwright isn't installed)
```

The project has no dependencies; the e2e test loads Playwright only if it is already available. CI installs Playwright in a scratch folder (outside the repo, found through `NODE_PATH`) and sets `E2E_REQUIRED=1`, so there a missing browser fails the run instead of skipping it.

## Undo, bankruptcy, and ending a game

- **Undo:** the **↶ Undo** button (Activity panel and Activity tab) reverses the most recent action: payments, purchases, rent, mortgages, buildings, trades, jail, Free Parking, bankruptcy, or game over. Press it again to keep going back, up to 50 actions. Every action is also atomic: if it fails, nothing changes.
- **Bankruptcy:** open the **Bankruptcy** card at the bottom of **Quick pay** and choose the bankrupt player and who they owe. A **What happens** preview spells out the settlement before you confirm (building sale proceeds, cash and deeds handed over, any debt written off, and whether this ends the game). Their houses and hotels are sold to the Bank at half price. Their cash (if positive) and deeds go to the creditor; mortgaged deeds stay mortgaged. If they owe the Bank, deeds return to the Bank unmortgaged. A negative balance is written off. The player leaves the game, and when only one player remains they win automatically.
- **Net worth:** what a player's holdings are worth to them right now: cash + deeds at list price (a mortgaged deed counts at list price minus what it costs to unmortgage it) + houses and hotels at what the Bank pays back for them (half price). Reversible moves leave it unchanged (build then sell a house, mortgage then unmortgage), and their real costs show up immediately: a $200 house is worth $100, and mortgaging Boardwalk counts the $20 interest owed. It's shown on each player sheet and the results screen.
- **No negative balances:** every payment (transfers, taxes, Free Parking, rent, purchases and auctions, unmortgaging, houses and hotels, the cash side of a trade) needs the payer to have the money. Paying exactly everything is fine. If they're short, nothing changes and a **Raise cash first** dialog shows the shortfall with one-tap **Sell** (buildings, half price, evenly) and **Mortgage** buttons. Once there's enough, it says to try the payment again. If selling everything still isn't enough, it suggests **Declare bankruptcy**, which opens the bankruptcy card for that player. A hotel can never be bought on credit. Games saved before this rule may still show a negative balance; it's written off on bankruptcy.
- **Finish game:** **⋯ → Finish game…** ends the game at any point, so you don't have to play until everyone else is bankrupt. Choose **Highest net worth** (ties are shared) or tap any player still in the game to name them the winner. Bankrupt players can't be picked, and the confirm button names the winner. It then opens the results screen: standings, play time, transaction count, and top rent collector. **Play time** runs from the first move to the last move before **Finish game** was pressed (for example *Played 1 h 35 min (7:00 PM–8:35 PM)*), so setting up the game early or closing it later doesn't count. An ended game is read-only until someone undoes "Game over".

## Joining and feedback

- **Player tiles:** one row of tiles at the top of every tab. Each shows the player's token, name (with a **You** badge on this phone's player), balance, net worth and deed count, plus *In jail*, *Bankrupt* or *Winner* when it applies. With the jackpot rule on, a Free Parking tile shows the pot. The row scrolls sideways with many players and keeps its position when balances update. It scrolls away with the page rather than staying pinned, so nothing shows through it.
- **Player sheet:** tap a player tile to see that player's cash, net worth and how much they could raise, the net-worth breakdown and their deeds, with shortcuts: **Show deeds**, **Pay from …**, **This is me**, and **Send to jail / Release** when the no-rent-in-jail rule is on.
- **Quick actions:** the sheet also has one-tap **Passed GO +$200** (and **Landed on GO +$400** with that house rule), **Income Tax −$200**, **Luxury Tax −$100** and **Jail fee −$50**, plus an *Other amount* box with **+ From Bank** / **− To Bank** for card effects. Taxes and the jail fee go to the Free Parking pot when the jackpot rule is on. Each is an ordinary transfer: it shows in the activity feed, can be undone, and opens Raise cash if the player is short. The sheet stays open, so you can do several in a row. Tap the Free Parking chip to pay out the pot.
- **Your name first:** once a phone has picked its player, that player comes first in the player tiles, every player list and the activity filter.
- **Paying rent:** open an owned deed, choose **Who pays rent?** and tap **Pay rent to Ana**. The owner is never offered as the payer.
- **Filter deeds by owner:** on **Deeds**, the player tiles turn into an owner filter: tap **All deeds**, a player or **Bank** to see only those deeds. It combines with the search box and the status filter (available, owned, mortgaged).
- **Sets view:** **Deeds → Sets** shows one row per color group (plus railroads and utilities) instead of the deed list. Each deed tile shows its owner's token (or *Bank*), houses (green blocks) or a hotel (red), and a striped *Mortgaged* look. The row label says where the set stands: **✓ Ali's set** (outlined in the owner's color), **Ovais needs 1**, **Split**, **Unowned**, or a railroad count like **Ali 2 · Ovais 1**. Tap a tile for the usual deed dialog. The player tiles still work as the owner filter: other owners' deeds are dimmed rather than hidden, so the sets stay in context. Each device remembers whether it last used List or Sets. It's a grid of MonoBank's own tiles, deliberately not a picture of the game board.
- **Activity:** the Activity tab keeps the **whole game** (up to 2,000 entries), so a long game's opening moves aren't lost.
  - **Timeline:** entries are grouped into 15-minute blocks (*8:30 PM · 12 moves*). Each row shows its clock time; the last ten minutes show *now* or *5m*. Rows are compact, one line on wider screens.
  - **Compact controls:** one toolbar row holds a player picker (everyone, one player or the Bank), a type picker (**Payments**, **Rent**, **Deeds** for buying and mortgages, **Building**, **Trades**) and search, which matches deeds, players and notes. They all combine. On phones the search box opens from the 🔍 button (and stays open while it holds a search), **Undo** sits in the same row, and the tab's title row is dropped, so the list starts right under the controls.
  - **A player's money:** with a player selected, amounts are signed from their side (**+$200** / **−$50**) and each row shows their balance after the move, including both sides of a trade. A summary card shows their money in and out, net, rent collected and paid, taxes and fees, and how many times they passed GO.
  - **Game so far:** with no player selected, the card shows moves, money moved, trades, the top rent earner and Free Parking paid out. On the page it is one line (*Game so far · 195 moves · $23,886 moved*) that expands when tapped; on wide screens the full card sits in the sidebar instead of a second copy of the list.
  - **Undone entries** are hidden until you tap **Show N undone**.
  - **Paging:** 50 rows show at first; **Show earlier** reveals more and fetches older entries from the server as needed.
  - **Download:** **⋯ → Download activity (CSV)** (also on the results screen) saves every stored entry, oldest first, with each player's balance after every move. It works from spectator links too.
- **Who's on this phone:** the first time a device opens a game, it asks *"Who's playing on this phone?"*. Pick a player or **I'm the banker**. The choice is remembered on that device for that game. It shows **Playing as Ana** next to the house rules, puts your tile first (with a **You** badge), and pre-fills *From* in payments, *Player one* in trades, the buyer in the deed desk and the payer when collecting rent. Tap your own tile on **Deeds** to see only your deeds. Change it any time with **Switch** or **⋯ → Switch player…**. It's a convenience view: every device can still bank for anyone, as at a real table.
- **Live updates:** every game screen keeps a live connection to the server. When anyone acts, every phone and spectator updates within a moment, with a short chime. The dot in the game code turns amber while reconnecting, and the app falls back to checking every few seconds until the live connection returns.
- **Spectators:** **Invite → Spectators** (or **⋯ → Copy spectator link**) gives a `/watch/<token>` link and QR code. Spectators see balances, deeds, standings and activity live, but get no payment, trade, bankruptcy, undo or end-game controls, and the server has no write route for spectator links. The spectator token is separate from the game ID, so a spectator can't work out the player link.
- **Private balances:** unless the table turned on **Show everyone's money**, a phone sees only the money of the player it is set to ("This phone is me"). A banker-only phone and spectators see no balances until the game ends. Payments, deeds and buildings stay visible to everyone, as at a real table. This is a courtesy of the display, not a lock: every player has the game link, and a phone can switch players. Only spectator links get balances removed on the server.
- **QR code:** **Invite** in the header shows a scannable code for the player link (or the spectator link). It's generated in the browser by a small built-in encoder, with no third-party service or dependency.
- **Sound and vibration:** payments play a short chime, and phones that support it vibrate. That covers your own actions, changes from other devices, and errors. **⋯ → Sound & vibration** in the header turns this on or off for the current device.

## House rules

Open **House rules** on the new-game screen to choose how your table plays. Rules are fixed once the bank opens, shown under the console title, and recorded in the first activity entry. The server enforces every rule.

| Rule | Default | What it changes |
| --- | --- | --- |
| Free Parking jackpot | Off | Adds a **Free Parking pot** account. The Jail, Tax and Luxury shortcuts pay into it, and any payment can target it. A pot card shows the balance and a **Collect** button for whoever lands on Free Parking. |
| Seed the pot | $0 | With the jackpot on, the Bank puts this amount in the pot at the start and again after every collection (a common choice is $500). |
| $400 for landing on GO | Off | Adds a **Land on GO +$400** shortcut alongside the usual **GO +$200**. |
| No rent while in jail | Off | Adds **Send to jail / Release from jail** to each player's sheet (a 🔒 marks jailed players in the bar). A jailed owner cannot collect rent. |
| Auctions | On | Off: unbought deeds can only be bought at list price; the auction option disappears. |
| Even building | On | Off: houses can be built and sold unevenly across a color set (owning the full set is still required). |
| Mortgage interest | 10% | Interest added when unmortgaging, from 0% to 100%. |
| Show everyone's money | Off | Off: each phone sees only its own player's cash and net worth (others show `••••` in the tiles, player sheet, identity picker and Finish game dialog, and Activity hides their balance after each move); spectators get no balances from the server; everything is revealed when the game ends. On: everyone sees all balances. Games created before this setting keep open balances. |

Games created through the API without `rules` use the defaults above, which match the classic rules.

## How sessions work

Each game gets a random 16-character URL identifier. Anyone with that URL can make changes; there is no sign-in.

**Games are durable.** In production every game is saved as a JSON file on an Azure Files share mounted at `/data`. The file is written atomically after every action and loaded again on first use after a restart. Deploys, restarts and platform maintenance no longer lose games in progress, and undo history survives too. Games are deleted **30 days after their last move**, or **7 days** after they finish. Games that have been idle for two hours are dropped from memory (they stay on disk and load again on the next visit), so long retention doesn't grow the server's memory. Every game file is also **backed up daily** (see [Backups](#backups)).

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
| `ADMIN_TOKEN` | unset | Secret (24+ characters) that enables the private `/admin` usage page; unset or shorter keeps it disabled |

## Admin usage page

A private dashboard at **`/admin`** shows how MonoBank is used, to help decide what to improve. It exists only when `ADMIN_TOKEN` is set (otherwise `/admin` and its API return 404).

- **Sign in:** enter the token on the page. It is kept only in that browser tab (`sessionStorage`) and sent as an `Authorization: Bearer` header, never in a URL. Wrong tokens are limited to 10 per 15 minutes per address. **Sign out** forgets it.
- **What it shows:**
  - stored games, new games today/this week, games being played now, finished share, median game length;
  - a funnel from *created* → *first move* → *10+ moves* → *finished in the app*;
  - new games per day (30 days) and the hours games start (in your time zone);
  - table sizes, house rules people turn on, the mix of moves (payments, rent, purchases, building, trades, undos…), how games end, the most-used payment notes and starting cash;
  - server health since the last restart: requests, server errors, errors players hit (not enough cash, two phones at once, rate limits), save speed, live connections, memory and storage.

  A **What to look at** list turns these into plain-language pointers (for example, many games never getting a first move, or a high undo rate).
- **Privacy:** it never shows game links, spectator tokens or player names, and payment notes appear only when typed 3+ times across games.
- **Search engines:** the page, its script and its API send `X-Robots-Tag: noindex` (plus a `noindex, nofollow, noarchive` meta tag), are never cached, aren't linked from anywhere and aren't in the sitemap. They're deliberately not listed in `robots.txt`, which would only advertise the path and stop crawlers from seeing the noindex.
- **Production:** add a repository secret **`ADMIN_TOKEN`** (for example `openssl rand -base64 32`). The deploy passes it to Bicep as a secure parameter, which stores it as a Container Apps secret. Remove the secret and redeploy to turn the page off.
- **How it's computed:** stats are calculated on demand from the stored game files. Each file is summarized once and re-read only when it changes, so refreshing the page is cheap.

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

Every pull request to `main` runs steps 1–2 (no deploy), so problems show up before merging. Every push to `main`:

1. Checks out the repository and uses Node.js 22.
2. Runs syntax checks, all tests, the 100% line-coverage gate on the core modules, and the Playwright browser tests.
3. Signs into Azure with OIDC.
4. Deploys the shared infrastructure in `infra/main.bicep` (resource group, registry, Log Analytics, Container Apps environment) idempotently.
5. Builds the container image, pushes it to the registry tagged with the commit SHA, and deploys the container app with that image.
6. Before deploying, creates a **persistence probe** game on the running app (once it reports file storage).
7. Polls `/health` on both URLs until the new revision reports `"storage": "file"`, then checks that the probe game survived the deploy. Either failure fails the run.

The workflow can also be run manually from **Actions → Build, test, and deploy to Azure**.

### Backups

**Back up game files** (`.github/workflows/azure-backup.yml`) runs every day at 09:23 UTC, after US game nights, and can also be run by hand from **Actions**:

1. It signs in to Azure with the same OIDC identity as the deploy (the `production` environment).
2. It takes a **snapshot** of the `games` Azure Files share: a read-only, point-in-time copy of every game file, kept alongside the share.
3. It deletes snapshots older than **14 days**.

It uses only Azure Resource Manager commands, so the deploy identity's Contributor role is enough (no storage keys, no extra roles). Snapshots belong to the share: they protect against bad writes, bugs and accidental deletes, and the share's 7-day soft delete protects the share itself, but they are not an off-site copy of the storage account.

**To restore one game,** run **Actions → Restore a game from a backup**:

1. Run it with **action: list** to see the snapshot times (newest first).
2. Run it again with **action: restore-game**, the **snapshot** time, the **game ID** (the 16 characters at the end of the game link) and **RESTORE** in the confirm box.

The restore first takes a fresh snapshot (so the current state can be recovered too), checks the backed-up file is a valid game with that ID, and puts it back. It refreshes the game's last-change time so it gets a new 30-day window, recreates its spectator link, restarts the app so the restored copy is loaded, and checks the game opens. The game ID is masked in the logs. Restore while nobody is playing that game: a move made between the restore and the restart would be overwritten.

**To restore many games or the whole share,** browse the snapshot in the Azure portal (storage account `mbst…` → **File shares** → `games` → **Snapshots**) and copy the files back, then restart the container app (**Revisions** → **Restart**).

## API overview

- `POST /api/games` — create a game: `{ "players": ["Ana", "Ben"], "startingBalance": 1500, "rules": { "freeParkingJackpot": true, "freeParkingSeed": 500 } }` (`rules` is optional; omitted keys use the defaults)
- `GET /api/games/:id/events` — **server-sent events** stream: an `event: game` message with the full public state on connect and after every change, plus a heartbeat comment every 25 s. Up to 50 streams per game and 2,000 in total (HTTP 503 beyond that).
- `GET /api/games/:id/transactions?before=<entryId>&limit=100` — older ledger entries after the given entry, newest first: `{ transactions, hasMore }` (404 if that entry is no longer stored).
- `GET /api/admin/stats` — admin usage statistics (`usage`, `storage`, `runtime`); requires `Authorization: Bearer <ADMIN_TOKEN>`, 401 otherwise, 404 when no admin token is configured. Never includes game IDs, tokens or player names.
- `GET /api/games/:id/activity.csv` — the whole stored ledger as a CSV download (oldest first, with every player's balance after each move; cells that look like spreadsheet formulas are escaped).
- `GET /api/watch/:token` and `GET /api/watch/:token/events` (plus read-only `/transactions` and `/activity.csv`) — the **spectator** equivalents: the same state with `id: null`, `spectator: true` and `undo: null`. There are no write routes for spectator tokens.
- `GET /api/games/:id` — read current game state, including `viewToken` (the spectator token, for sharing), `rules`, `freeParking` (pot balance), each player's `inJail` and `bankrupt`, `status` (`active`/`ended`), `winnerIds`, `standings` (net worth breakdown, `raisable` and rank per player), `playTime` (once ended: `{ startedAt, endedAt, minutes }`, from the first move to the last move before Finish game), `transactions` (the newest 150 ledger entries, each with `balances` and `deltas` per seat after the move), `transactionCount`, `transactionsDropped` (entries trimmed past 2,000), `activity` (totals: moves, money moved, trades, Free Parking paid out, and per-player money in/out, rent, taxes and GO passes), and `undo` (the action that undo would reverse, or `null`)
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
  | `end-game` | `winnerId` (optional) | Ends the game at any time. Without `winnerId` the highest net worth wins (ties share); with it, that player (who must not be bankrupt) wins |
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

Static files are served with `Cache-Control: no-cache` and an `ETag`, so browsers revalidate (cheap 304s) and never mix a new page with stale CSS or JavaScript after a deploy. MonoBank sets a restrictive Content Security Policy (no inline scripts or style attributes; per-element colors are applied through the CSSOM) and related browser security headers (including HSTS), compresses responses (brotli for the app's files, gzip for game state, exports and the live stream; a long game's update shrinks from about 56 KB to a few KB), caps request bodies, validates all actions server-side, escapes player-provided text in the client, uses native dialog and form controls, supports keyboard focus, exposes labels and live notifications, keeps text at 10px or larger with WCAG AA contrast (4.5:1) for secondary text, explains network problems in plain words (offline, or a move that couldn't be confirmed, after which the game refreshes), adapts to reduced-motion preferences, and includes a 320px-friendly mobile layout.

## License

Private project. All rights reserved unless a license is added by the repository owner.

k9Pm2Xq7Lv4Rt8Bn5Wz1Hj6Fc3Yd
