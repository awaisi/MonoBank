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
| **Durable game storage** (#1) | PR #7 | Azure Files share mounted at `/data`; one JSON file per game written atomically after every action; games and undo history survive restarts and deploys; the deploy verifies a probe game survives. |
| **Abuse limits** (#3) | PR #7 | 20 new games/hour and 600 API requests/minute per IP (429 + `Retry-After`), 5,000 active-game cap (503), `TRUST_PROXY` for `X-Forwarded-For`. |
| **No negative balances + Raise cash dialog** | PR #11 | Every debit checks the payer's cash; shortfall, raisable amount, Sell/Mortgage buttons and a bankruptcy shortcut. Hotels can't be bought on credit. |
| **Net worth as equity** | PR #11 | Mortgaged deeds net of payoff, buildings at resale; reversible moves net to zero (was purchase price, which hid resale losses and interest). |
| **Balance strip, activity filter, deed owner pills, Pay rent wording, your name first** | PR #11 | Balances pinned on every tab; Activity filter by player or Bank; Deeds owner pills with counts; "Who pays rent? → Pay rent to …"; this phone's player first in all lists. |
| **Private balances by default** | PR #22 | New `showAllBalances` setting (off for new games; older games stay open): each phone sees only its own player's cash and net worth until the game ends; tiles, sheet, identity picker, Finish game and Activity balance-after hide others; spectators get balances stripped server-side (view, ledger pages, CSV). |
| **Admin usage page** | PR #21 | Private `/admin` dashboard behind `ADMIN_TOKEN` (Bearer, constant-time, 10 wrong tries per 15 min): games, funnel, daily and hourly starts, table sizes, house rules, move mix, endings, notes, starting cash, server health and errors since restart, plus "What to look at" pointers. Anonymous (no game links or names), noindex and never cached. |
| **Project review batch: retention, compression, CI gates, network errors, readability, HSTS** | PR #20 | Games kept 30 days (7 once finished) instead of 24 h, idle games unloaded from memory; brotli/gzip for files, JSON, CSV and the live stream (~10× less data per update); CI runs the coverage gate and Playwright e2e, also on pull requests; plain-language offline/network errors with a resync; no text under 10px and AA contrast for secondary text; no `aria-live` on the Activity summary; HSTS. |
| **Deeds Sets view** | PR #19 | Deeds → List / Sets. Sets: one row per color group (plus railroads, utilities) with owner tokens, buildings, mortgages, complete-set outline and "needs 1" hints; owner filter dims; tap for the deed dialog; mode remembered per device. Chosen over a board map for phones and lower trade-dress risk. |
| **Compact Activity controls** | PR #18 | On phones the list starts about 110 px into the tab instead of about 700 px: one toolbar row (player and type pickers, search on demand, Undo icon), no title row, and the summary collapsed to one line that expands on tap. |
| **Activity page for long games** | PR #17 | Full history (2,000 entries, paged to phones 150 at a time) instead of a silent 300 cap; 15-minute timeline with clock times; compact rows; type chips and search; per-player signed amounts and balance after each move (server balance stamps); player and "Game so far" summaries (server `activity` stats, also used by the results screen); undone entries hidden by default; Show earlier paging; sidebar summary on desktop; CSV export. |
| **Play time from first to last move** | PR #16 | Results show how long the table actually played (first move to the last move before Finish game, with clock times), not creation-to-Finish, so setting up early or closing late doesn't inflate it. |
| **Bigger player tiles; scrolling fixes** | PR #15 | Tiles show balance, net worth, deed count, You badge and status, and scroll with the page instead of a pinned translucent bar. The row keeps its sideways position on live updates, keeps the same height on every tab, and the header respects the iPhone safe area. |
| **Finish game at any time, choose the winner** | PR #14 | ⋯ → Finish game… opens a winner picker (Highest net worth, or any player still in); `end-game` takes an optional `winnerId`; undoable. |
| **Per-player quick actions** (#10) | PR #13 | Player sheet: Passed GO, Landed on GO (house rule), Income Tax, Luxury Tax, Jail fee, and any amount to/from the Bank, as ordinary undoable transfers; taxes and fees feed the Free Parking pot when that rule is on. |
| **One players bar + player sheet (space-efficient redesign)** | PR #12 | Player cards, balance strip and Deeds owner pills merged into one sticky players bar (owner filter on Deeds); tap a player for a sheet with net worth, deeds and shortcuts; compact headings, one-row phone head, two-column deeds on small phones. |
| **5–8 players** (#11) | PR #10 | Up to 8 players with distinct colors and generic tokens; denser player grid and two-column identity picker for big tables; setup shows "N of 8 players". |
| **"This phone is me" mode** (#13) | PR #9 | Per-device player or banker choice (localStorage); me-bar, You badge, pre-filled forms, My deeds filter, Switch player. |
| **Instant updates** (#16) | PR #9 | Server-sent events per game with heartbeat and caps; polling fallback (3.5 s down / 30 s safety net); amber dot while reconnecting. |
| **Spectator link** (#17) | PR #9 | Separate `viewToken`; `/watch/<token>` read-only live view; no write routes; Invite dialog players/spectators toggle. "Banker-only" is covered by #13's banker choice. |
| Branding and SEO | PR #8 | Clear "unofficial Monopoly® banker" positioning in the header tagline, hero and title; Hasbro trademark disclaimer on every page; title/description/canonical, Open Graph + Twitter cards with share image, JSON-LD, robots.txt, sitemap, `noindex` for game pages and API. |
| Minimal header with overflow menu; asset caching fix | PR #7 | Brand-only home header; game header = live code + Invite + ⋯ menu (Copy link, Sound, End game). Static files now `no-cache` + `ETag`; PR #6 looked broken on phones because `styles.css`/`app.js` were cached for an hour while `index.html` was fresh. |
| Header and bankruptcy redesign | PR #6 | One sticky header on every page (Start a game / live badge, game code and actions); bankruptcy as a danger-zone card with a "What happens" preview. |

## Backlog

### P0: trust and data loss

All P0 items have shipped (#1 and #3 in PR #7). New P0s go here.

### From the project review (November 2026)

| # | Item | Why | Effort | Notes |
| --- | --- | --- | --- | --- |
| 29 | **Backups of game files** | The share is soft-delete protected, but individual files are not; a bug or bad deploy could erase games. | S | Daily Azure Files share snapshots (keep ~7); document restore. |
| 30 | **Uptime and restart alerts** | Nobody is told if the site is down until game night. | S | Azure availability test on `/health` plus an alert on container restarts. |
| 31 | **Lighter saves** | A long game's file reaches ~760 KB and is rewritten after every action. | M | Coalesce saves per game (~300 ms); drop per-entry `deltas` (derivable from consecutive `balances`). |
| 32 | **Independent e2e scenarios** | One failing step currently cascades into many failures. | M | Seed each scenario's game through the store; keep the shared flow short. |
| 33 | **Split `public/app.js` into modules** | 1,270 lines in one file; pure helpers have no unit tests. | M | Native ES modules (CSP allows `'self'`), no build step; unit-test `setStatus`, `cashChange`, `playTimeText`. |
| 34 | **Consolidate `styles.css`** | Successive redesigns redefine selectors 4–5 times (45 KB). | M | One block per component; remove dead overrides. |
| 35 | **Who made each change** | Any phone can undo anything; Activity can't say which phone did it. | M | Optional client-supplied actor (the device's "playing as") stored on ledger entries; shown in Activity; not a permission system. |

### P1: rule gaps and table speed

| # | Feature | Why | Effort | Notes / acceptance |
| --- | --- | --- | --- | --- |
| 5 | **House/hotel shortage (32 houses / 12 hotels)** | An official rule with real strategy ("housing shortage"). | S | Bank stock counters derived from the deeds; block building when stock is out; show stock on the deed desk; hotels return 4 houses to stock; consider a house rule to disable. |
| 6 | **Collect from / pay every player** | Card effects like birthdays and "chairman" cards take N transfers today. | S | New action that records one ledger entry with per-player detail; skips bankrupt players; undoable. |
| 7 | **Card helpers** | General repairs ($ per house/hotel), double railroad rent, 10× utility from a card. | S | Repairs computed from the player's buildings; rent modifiers as options on the rent action. |
| 9 | **Mortgaged-deed transfer interest** | Official rule: receiving a mortgaged deed costs 10% right away (or the full unmortgage cost). | S | Apply in trades and bankruptcy-to-player; respect the mortgage-interest house rule; prompt for "pay interest now" vs "unmortgage now". |

### P2: multi-device and social

| # | Feature | Why | Effort | Notes / acceptance |
| --- | --- | --- | --- | --- |
| 14 | **Two-step trades** | Propose, then accept on the other phone, instead of instant trades. | M | Pending-trade state with expiry; accept/decline actions. #13 identity is client-only today; decide whether accepting needs a server-side claim per device. |
| 15 | **Live auction mode** | Bid from each phone with a countdown. | M | #13 and #16 have shipped; needs bidder identity per device (see #14). |

### P3: nice to have

| # | Feature | Why | Effort | Notes / acceptance |
| --- | --- | --- | --- | --- |
| 28 | **Board map for spectators/TV** | A big-screen "who owns what" view in board order for game night (mocked up alongside the Sets view). | M | Desktop/spectator only (too small on phones). Must stay schematic in MonoBank's style: plain-text corners, blank non-deed spaces, no Hasbro artwork, icons, fonts or center logo. Check with an IP lawyer before any monetization. |
| 27 | **"How it works" / FAQ content** | More indexable text and answers to common questions ("Do I need the board game?", "Is it free?"). | S | A short section or page below the hero; FAQPage JSON-LD; keep the trademark rules. |
| 18 | **Custom deed sets** | Other city boards, themed and homemade editions. | M | Load deed data from JSON per game; validate; never ship trademarked edition content. |
| 19 | **Currency and number formats** | £, €, M, "1.5M" styles. | S | Per-game currency setting; `Intl.NumberFormat`. |
| 20 | **Virtual dice** | Several competitors include them; low effort, mildly useful. | S | Client-only, with an optional ledger note. |
| 21 | **Charts and game stats** | Balance over time, most rent paid, best deed. | M | Balance stamps (`balances` per entry) and `activity` stats now exist; chart them in the results dialog and the player sheet. |
| 22 | **Installable offline app** | The manifest already exists; it needs a service worker. | S | Cache the app shell only; actions still need the server. |
| 23 | **Dark mode** | Useful for evening play. | S | Colors are already CSS variables; add `prefers-color-scheme` and a toggle. |
| 25 | **Other languages** | Wider audience. | M | String table; `lang` attribute; probably needs approval for any i18n dependency. |
| 26 | **Teams (shared balance)** | Two people play one seat. | M | Model as one player with multiple display names. |

## Decisions needed

- **Dependencies:** the repo forbids them. #25 might want one. (The QR code was built without one.)
