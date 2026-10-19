# ChoreScores

A shared household chore log for two (or a few) people. Every chore has a point
value; whoever does it taps it and gets the points. Weeks run Monday–Sunday.
Everyone sees everyone's points, a per-chore breakdown, and the full activity
log, for this week and past weeks. A button shares any week's summary to
WhatsApp.

It is a Progressive Web App: open it in Safari on iPhone and add it to the
Home Screen. No App Store involved.

## Stack

- **Cloudflare Workers** serves the static app (`public/`) and the JSON API (`src/worker.js`).
- **Cloudflare D1** (SQLite) stores users, sessions, chores and completions (`migrations/`).
- Plain HTML/CSS/JS in the frontend, with no build step.

All of this fits in Cloudflare's free plan.

## Run locally

```sh
npm install
npm run db:migrate:local
npm run dev            # http://localhost:8787, PIN comes from .dev.vars
```

`.dev.vars` (gitignored) holds the local PIN:

```
APP_PIN=1234
```

## Deploy

One-time setup:

```sh
npx wrangler login
npx wrangler d1 create chorescores
# copy the printed database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put APP_PIN      # choose your household PIN
npm run deploy
```

Wrangler prints the URL (`https://chorescores.<your-subdomain>.workers.dev`).

After a code change, run `npm run deploy` again. After you add a migration, also run `npm run db:migrate:remote`.

## Install on iPhone

1. Open the URL in **Safari**.
2. Tap Share → **Add to Home Screen**.
3. Open the app from the home screen, enter the PIN, pick or add your name.

Sign in from the home-screen app itself. iOS keeps its storage separate from
Safari, so signing in through Safari does not carry over.

## How it works

- **Points are snapshotted** when a chore is logged. Changing a chore's points
  affects only new entries, so past weeks never change.
- **Deleting a chore** archives it. It disappears from the list but stays in history.
- You can remove only your own log entries. Use the Undo toast right after
  logging, or the ✕ in the Week view.
- Week boundaries use the phone's local time.
- The app refreshes every 30 s while open, and when you switch back to it.
- Chore photos are cropped and shrunk to 128×128 JPEG in the browser and
  stored in D1.

## Security

- Household PIN (Worker secret) plus a per-person session cookie
  (HttpOnly, Secure, SameSite=Lax, 400 days). Only the SHA-256 of a session
  token is stored.
- Login is limited to 10 failed PINs per IP per 15 minutes.
- Mutating requests from other origins are rejected.

Choose a PIN longer than 4 digits for the deployed app.

## Regenerating icons

```sh
npm run icons
```
