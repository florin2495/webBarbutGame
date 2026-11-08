@AGENTS.md

# webBarbutGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webBarbutGame`, private). Never the work account.
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

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`, `kick.ts`, `reconnect.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 2 players + spectators (create, join, spectate, start, throw, bet braila/san,
  seat sit/stand, settings, leave mid-round, kick, 6th spectator refused) against `npm run dev`. Delete test rooms afterwards.
