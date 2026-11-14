@AGENTS.md

# webBarbutGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webBarbutGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- The user connects the repo to Vercel by hand. Once connected, every push to `main` deploys to production.
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".
- Functions run in `fra1` (Frankfurt, `vercel.json` `{ "regions": ["fra1"] }`), next to the Supabase DB. Never remove it: the Vercel default `iad1` (Washington) makes every DB query cross the Atlantic (1-2 s per request instead of ~0.3 s).

## Database (shared Supabase project `vgpcagpqbeiqplfidmwo`)
One Supabase project hosts every hailatat.icu mini-game. **Every table of this game starts with `barbut_`**
(lowercase: Postgres folds unquoted names). Never touch other games' tables.
Migrations are run by hand in the Supabase SQL editor, so this list is the source of truth.
**Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-06, verified) | `barbut_rooms`, `barbut_players`, `barbut_throws`, `barbut_bets` |
| `supabase/migrations/001_pending_kick.sql` | yes (2026-11-07, verified) | `barbut_players.kick_requested_at` (pending host kick, 10 s to press "Ignoră"); the code needs it, do not push before it ran |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `barbut_players.last_seen_at`, `device_hash` + index (rejoin the same seat). The code needs it, do not push before it ran |
| `supabase/migrations/003_spectator_queue.sql` | **not applied yet** | `barbut_players.queued_at` ("Intră la runda următoare" queue, `/queue`). The code needs it, do not push before it ran |

Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (at most every 10 s);
re-joining with a nickname already in the room reclaims that member (new token, same player id: seat, balance and
bets kept, a spectator stays a spectator) from the same device (`device_hash`) or once it has been unseen for 45 s,
also mid-round. `/state` exposes only a derived `connected` flag; never select `token_hash` / `device_hash` into it.

Production domain: https://games.hailatat.icu/barbut (basePath `/barbut`, proxied by the hub; Vercel project web-barbut-game.vercel.app)

Leaderboard: at the end of a round `src/lib/server/leaderboard.ts` reports to the hub's `hub_leaderboard` / `hub_leaderboard_rounds` (hub migration `002_hub_leaderboard.sql`, best effort). Do not push before the hub migration ran.
Spectators: max 16, queue via `POST /queue`, host reorder via `POST /reorder` (decides who throws first).

Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by `florin2495/hailataticu-hub`, slug `barbut`); this game must not be deployed before that table exists.

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/`, additive when possible, and the same change folded
  into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

## Abandoned rooms (120 s)
- `GET /api/rooms` (the room list behind "Intră în cameră") first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
  every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (120 s, `game.ts`)
  and with no member (seated player or spectator, both `barbut_players` rows) `last_seen_at` within 120 s is deleted
  (players, throws, bets cascade). Open room pages keep both fresh (`/state` polls every 15 s, `last_seen_at` touched
  every 10 s, `last_activity_at` every 20 s), so only rooms nobody has open disappear. The 10/30-minute expiry stays too.

## Testing (GitHub Actions, manual only)
All checks run in GitHub Actions on the free tier (public repo, standard `ubuntu-latest` runners only, never billed /
larger / macOS runners), never locally (user's rule, see `D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch`
only (no automatic trigger, the user's choice): nothing gates a push, and Vercel deploys `main` regardless.
Start one with `gh workflow run <file> --ref main`, then `gh run watch` (or the Actions tab, "Run workflow").
| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (typegen first, so route types in `.next/types` are checked), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest: `src/lib/game.test.ts`, `kick.test.ts`, `reconnect.test.ts`; pure rules, no DB) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/barbut`); one run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit). Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (only for the cleanup safety net;
  locally the script falls back to `.env.local`). It checks that the deployed client JS contains the `package.json`
  version of the checked-out ref, so run it on `main` after the Vercel deploy of that version has finished.
- What E2E does: checks page / `_next` assets / version / manifest / icons / `room/XXXXXX` over HTTP and that
  `web-barbut-game.vercel.app/barbut` serves the same JS, then drives the real API (production DB) with 4 members:
  create (password, bad stake), join, wrong / missing password, unknown room, public room list (no hash leak),
  16 spectators then the 17th refused (full room still listed), rejoin (same device, old token dead, mid-round),
  settings (host only, not mid-round), start (seated only, once), out-of-turn / spectator / bad-token throws,
  Brăila and Șan bets (spectators only, one each, validation), every member sees the same state (no token / hash
  leak), concurrent double throw, two full rounds checked against the rules (outcomes, dice passing, bet settlement,
  balances), sit / stand between rounds, spectator queue (toggle, positions) and host reorder (seat A throws first,
  queue order, 403 / 400 / 409 mid-round), kick (immediate between rounds, pending mid-round, "Ignoră", enforced
  after 12 s with the queued spectator taking the seat), host handover on leave, last one out closes the room.
  Rooms are named `e2e-test-…` and deleted at the end; it never calls `/api/feedback`. Finished rounds are reported
  to the hub leaderboard like any other round (players "Ana", "Bob", "Cris").
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; every change must reach the other screens within 5 s
  without a reload, polling is 15 s, so this checks Realtime). Dice are random: the helpers read whose turn it is
  from the screen (`throw-button` visible on exactly one) and throw until the round ends, never a fixed result.
  - `game.e2e.ts` (both projects): two browser contexts (= two devices) create a password room, join by link, start,
    play a full round live (throw counter on the other screen), winner banner and +/- stake on both, round 2 started
    by the guest (winner keeps the dice), guest leaves mid-round (seat freed live), host leaves.
  - `spectator.e2e.ts` (desktop Chromium only): a third person joins mid-round = spectator (bet panel, no throw /
    start buttons), the players see them, Brăila + Șan bets appear on the players' screens, queue ("coadă #1" seen by
    the players), every throw live, end of round with bets settled, a player leaves and the queued spectator takes
    the seat and starts round 2.
  - `mobile.e2e.ts` (iPhone only): no horizontal scroll on home / room between rounds / round in progress, main
    buttons >= 24 px, a touch tap on "Aruncă zarurile" throws and the other phone sees it.
  Rooms are `e2e-test-ui-…`; a leftover is deleted with the service key from the same repo secrets.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- The UI tests find elements by `data-testid`: `home-submit` (Home), `join-submit`, `leave`, `room-status`
  (RoomClient), `seat-a`, `seat-b`, `dice-area` (with `data-throw-count` = throws of the round), `throw-button`,
  `turn-info`, `round-winner`, `start-round`, `stand-up`, `sit-down`, `queue-toggle`, `bet-panel`, `bet-braila`,
  `bet-san`, `bet-list` (items with `data-status`), `throw-history`, `people-list` (Table). Renaming or removing one
  breaks `tests/ui`.
