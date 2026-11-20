# MonoBank — repository guide

MonoBank is a mobile-first shared banking companion for a classic property-trading board game. Players open a game, share its URL, and move money, manage deeds, collect rent, trade, mortgage, and build from any device. It is an unofficial fan-made companion: never use Hasbro/Monopoly branding, artwork, or trademarked edition names in code, UI, or docs.

## Commands

```bash
npm test          # node --test (test/*.test.mjs)
npm run check     # node --check on server.mjs, lib/game.mjs, public/app.js
npm run dev       # node --watch server.mjs → http://localhost:3000
docker build -t monobank . && docker run -p 3000:3000 monobank
```

Requires Node.js 22+. There are **no runtime or dev dependencies**; keep it that way. Do not add a framework, bundler, or npm package without explicit approval. Use `node:test` / `node:assert` for tests.

Run `npm run check && npm test` before every commit. If `lib/game.mjs` or `public/app.js` gains new files, add them to the `check` script.

## Architecture

| Path | Role |
| --- | --- |
| `server.mjs` | Node `http` server: JSON API, static files from `public/`, security headers, 64 KB body cap, `/health`. |
| `lib/game.mjs` | All game rules. `createGame`, `performAction`, `calculateRent`, `publicGame`, `GameStore` (in-memory, 24 h TTL). |
| `lib/properties.mjs` | Deed data (28 classic U.S. deeds) and color groups. |
| `public/` | Vanilla JS single-page client (`app.js`), `index.html`, `styles.css`, PWA manifest. No build step. |
| `test/game.test.mjs` | Rules (including every house rule) and API tests. |
| `Dockerfile` | Production image (Node 22 Alpine, runs as `node`). |
| `infra/` | Bicep (Azure Container Apps), bootstrap and Cloudflare DNS scripts. |
| `.github/workflows/` | `azure-deploy.yml` (every push to `main`), `azure-bootstrap.yml` (one-time, manual). |

### Game model rules

- **The server is the source of truth.** Every rule is enforced in `lib/game.mjs`; the client only mirrors rules for display (button labels, hidden controls). Never rely on client-side validation.
- **One action type per change.** New behavior goes through `performAction` with a new `case`, validates input with `GameError` messages written for players, and calls `record()` (or `move()`) exactly once per action so `revision` increments once.
- **Money is whole dollars.** Use the `money()` helper for any amount from input. Balances may go negative (the table settles debts); do not block payments for insufficient funds unless a rule requires it.
- **Optimistic concurrency.** Clients send `expectedRevision`; a mismatch returns HTTP 409 and the client reloads. Keep this for every action.
- **Accounts** are player IDs plus the special IDs `bank` and `parking` (Free Parking pot, only when that house rule is on).
- **House rules** live in `game.rules` (defaults in `DEFAULT_RULES`: Free Parking jackpot + seed, $400 on GO, no rent in jail, auctions, even building, mortgage interest %), are normalized by `normalizeRules()` at creation, and are fixed for the life of a game. The pot balance is `game.freeParking`; jail status is `player.inJail`. The client's `rulesSummary()` in `public/app.js` mirrors the server's for display only. Add a new rule by: default in `DEFAULT_RULES`, validation in `normalizeRules()`, enforcement in `performAction`/`calculateRent`, a setup control in `index.html` + `app.js`, the rules summary in `rulesSummary()`, tests, and the README "House rules" table.
- **State is in memory only.** Restarts and redeploys wipe games. The app must run as exactly one instance; do not add scaling or multiple replicas without first adding a shared store.

### Client conventions

- Escape every player-provided string with `escapeHtml()` before putting it in `innerHTML`.
- The CSP in `server.mjs` (`script-src 'self'`, `style-src 'self'`) blocks inline scripts **and `style="…"` attributes in HTML strings**. For per-element values (player/deed colors), put `data-vars="--name=value;--other=value"` in the markup and call `applyStyleVars(container)` after setting `innerHTML`; it applies them through the CSSOM. Keep all other styling in `styles.css`. Check the browser console for CSP errors after UI changes.
- Keep the 320 px mobile layout, keyboard focus, labels, and `aria-live` toasts working. Respect `prefers-reduced-motion`.
- Verify UI changes in a real browser (Playwright is available in cloud sessions): create a game, exercise the changed flow, and confirm no console errors and no horizontal scroll at 375 px.
- `styles.css` is compact (one block per line); append new rules in the same style.

## Deployment

- Pushing to `main` runs `azure-deploy.yml`: check + test → provision shared infra → build/push image to ACR (tagged with the commit SHA) → deploy the container app → keep Cloudflare DNS and the managed certificate for `monobank.divviq.app` → verify `/health` on both URLs.
- Hosting is **Azure Container Apps** with exactly one always-on replica (`minReplicas = maxReplicas = 1`). The subscription has **no App Service quota**; do not reintroduce App Service.
- Azure auth is OIDC (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`). The deploy identity has **Contributor only**: it cannot create role assignments, which is why ACR uses its admin user for pulls.
- The Cloudflare `monobank` CNAME must stay **DNS only**; Azure renews the managed certificate through it.
- `infra/bootstrap-azure.sh` / the bootstrap workflow are one-time setup and need the `BOOTSTRAP_*` secrets, which may have been deleted. Do not depend on them for routine deploys.
- Never commit secrets. Never put secrets in Bicep parameters files, workflow `env`, or logs.

## Docs to keep in sync

When behavior changes, update in the same change: `README.md` (features, house rules, API actions, deployment), this file, and the setup/help copy in `public/index.html`.
