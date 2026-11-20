# MonoBank feature plan

The prioritized backlog for MonoBank. **Keep this file current:** when a feature ships, move it to *Shipped* with the release/PR, and when priorities change, reorder the backlog. Effort: **S** < 1 day, **M** 1–3 days, **L** larger.

Priorities:

- **P0**: trust and data loss. Do first.
- **P1**: rule gaps and table speed.
- **P2**: multi-device and social.
- **P3**: nice to have.

## Shipped

| Feature | Release | Notes |
| --- | --- | --- |
| Azure Container Apps hosting, GitHub Actions deploy, custom domain `monobank.divviq.app` | PRs #1–#3 | See README "Azure architecture". |
| House rules (Free Parking jackpot + seed, $400 on GO, no rent in jail, auctions, even building, mortgage interest) | PR #4 | `game.rules`, enforced server-side. |
| CSP-safe colors (`data-vars` + `applyStyleVars`) | PR #4 | Fixed colors that never rendered in production. |
| **Undo last action** (#2) | PR #5 | Snapshot history (50 actions); every action is atomic; undone ledger entries are struck through. |
| **Bankruptcy flow** (#4) | PR #5 | Buildings sold at half price; cash and deeds to creditor, or deeds back to the Bank unmortgaged; last player standing wins. |
| **Net worth & end-game summary** (#8) | PR #5 | Net worth on player cards; End game → results dialog with standings and stats; undo reopens the game. |
| **QR code to join** (#12) | PR #5 | Dependency-free encoder in `public/qr.js` (versions 1–10, L/M/Q/H), verified against an independent decoder and the ISO worked example. |
| **Sound & haptics** (#24) | PR #5 | Chime + vibration on payments (local and from other devices); per-device toggle. |

## Backlog

### P0: trust and data loss

| # | Feature | Why | Effort | Notes / acceptance |
| --- | --- | --- | --- | --- |
| 1 | **Durable game storage** | Every deploy to `main` wipes all live games (in-memory store). | M | Azure Table Storage (cheap) behind the `GameStore` interface; write after each action; reload on start. **Requires approval:** changes the "in-memory only" rule in `CLAUDE.md`, adds an Azure resource and cost, and the deploy identity cannot assign data-plane roles (use a connection string secret or Bicep `listKeys`). Keep TTL cleanup. Undo history must persist too, or be explicitly dropped on restart. |
| 3 | **Abuse limits** | Unlimited game creation can exhaust memory. | S | Cap active games (e.g. 5,000) and add per-IP creation rate limits (e.g. 20/hour) with HTTP 429; tests for both. |

### P1: rule gaps and table speed

| # | Feature | Why | Effort | Notes / acceptance |
| --- | --- | --- | --- | --- |
| 5 | **House/hotel shortage (32 houses / 12 hotels)** | An official rule with real strategy ("housing shortage"). | S | Bank stock counters derived from the deeds; block building when stock is out; show stock on the deed desk; hotels return 4 houses to stock; consider a house rule to disable. |
| 6 | **Collect from / pay every player** | Card effects like birthdays and "chairman" cards take N transfers today. | S | New action that records one ledger entry with per-player detail; skips bankrupt players; undoable. |
| 7 | **Card helpers** | General repairs ($ per house/hotel), double railroad rent, 10× utility from a card. | S | Repairs computed from the player's buildings; rent modifiers as options on the rent action. |
| 9 | **Mortgaged-deed transfer interest** | Official rule: receiving a mortgaged deed costs 10% right away (or the full unmortgage cost). | S | Apply in trades and bankruptcy-to-player; respect the mortgage-interest house rule; prompt for "pay interest now" vs "unmortgage now". |
| 10 | **Per-player quick actions** | Tap a player card for "Passed GO", "Pay tax" and so on. Saves two dropdowns on every turn. | S | Menu on each player card; uses the existing transfer action. |
| 11 | **5–8 players** | The classic game supports up to 8 players. | S | More colors/tokens; responsive player ribbon; update validation, tests and setup copy. |

### P2: multi-device and social

| # | Feature | Why | Effort | Notes / acceptance |
| --- | --- | --- | --- | --- |
| 13 | **"This phone is me" mode** | A personal view per device (my balance, my deeds, "pay" pre-filled). | M | Claim a player per device (localStorage token); optional, banker view remains. |
| 14 | **Two-step trades** | Propose, then accept on the other phone, instead of instant trades. | M | Pending-trade state with expiry; accept/decline actions; depends on #13 for identity. |
| 15 | **Live auction mode** | Bid from each phone with a countdown. | M | Depends on #13 and #16. |
| 16 | **Instant updates (server-sent events)** | Replace 3.5 s polling. Every screen updates the moment someone pays. | S–M | `GET /api/games/:id/events` (SSE); fall back to polling; single instance makes fan-out simple. |
| 17 | **Banker-only / spectator role** | A non-player runs the bank, or someone watches without making changes. | S | Read-only share link (separate token) for spectators. |

### P3: nice to have

| # | Feature | Why | Effort | Notes / acceptance |
| --- | --- | --- | --- | --- |
| 18 | **Custom deed sets** | Other city boards, themed and homemade editions. | M | Load deed data from JSON per game; validate; never ship trademarked edition content. |
| 19 | **Currency and number formats** | £, €, M, "1.5M" styles. | S | Per-game currency setting; `Intl.NumberFormat`. |
| 20 | **Virtual dice** | Several competitors include them; low effort, mildly useful. | S | Client-only, with an optional ledger note. |
| 21 | **Charts and game stats** | Balance over time, most rent paid, best deed. | M | Derive from the ledger; extend the results dialog. |
| 22 | **Installable offline app** | The manifest already exists; it needs a service worker. | S | Cache the app shell only; actions still need the server. |
| 23 | **Dark mode** | Useful for evening play. | S | Colors are already CSS variables; add `prefers-color-scheme` and a toggle. |
| 25 | **Other languages** | Wider audience. | M | String table; `lang` attribute; probably needs approval for any i18n dependency. |
| 26 | **Teams (shared balance)** | Two people play one seat. | M | Model as one player with multiple display names. |

## Decisions needed

- **#1 Durable storage:** approve the architecture change and Azure cost.
- **Dependencies:** the repo forbids them. #25 might want one. (The QR code was built without one.)
