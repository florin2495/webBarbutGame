@AGENTS.md

# webBarbutGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webBarbutGame`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- The user connects the repo to Vercel by hand. Once connected, every push to `main` deploys to production.
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project `vgpcagpqbeiqplfidmwo`)
One Supabase project hosts every hailatat.icu mini-game. **Every table of this game starts with `barbut_`**
(lowercase: Postgres folds unquoted names). Never touch other games' tables.
Migrations are run by hand in the Supabase SQL editor, so this list is the source of truth.
**Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-06, verified) | `barbut_rooms`, `barbut_players`, `barbut_throws`, `barbut_bets` |

Production domain: https://barbut.hailatat.icu

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/`, additive when possible, and the same change folded
  into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 2 players + spectators (create, join, spectate, start, throw, bet braila/san,
  seat sit/stand, settings, leave mid-round, kick, 6th spectator refused) against `npm run dev`. Delete test rooms afterwards.
