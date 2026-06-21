# Deployment Guide

This covers three things: deploying the Apps Script backend, the one-time
manual setup it needs, and building/deploying the frontend to GitHub Pages.

## Part 1 — Deploy the Apps Script backend

### 1.1 Open the Apps Script project

The cleanest way to bind a script to both spreadsheets it needs is to open
it from either one and add the other by ID:

1. Open the **Operational** spreadsheet
   (`1PvWrm5Sf1w3o3yIil_YWiwwQNrUDH_JRNB_gJqZsYFY`) in Google Sheets.
2. **Extensions → Apps Script**. This creates a script bound to that sheet
   (so the `onOpen` admin menu in Code.gs shows up there).
3. Delete the default `Code.gs` content and paste in the full `Code.gs`
   from this delivery.
4. In the Apps Script editor's project settings, also add the manifest:
   click the gear icon → **Show "appsscript.json" manifest file in editor**,
   then replace its contents with the `appsscript.json` from this delivery.

### 1.2 Set Script Properties

Project Settings (gear icon) → **Script Properties** → add three:

| Property | Value |
|---|---|
| `OPERATIONAL_SHEET_ID` | `1PvWrm5Sf1w3o3yIil_YWiwwQNrUDH_JRNB_gJqZsYFY` |
| `CONFIG_SHEET_ID` | `1r9ZOBsy5Ml_rGZe8vvneDv4VyLm90S8eDERWze80MzY` |
| `TOKEN_SECRET` | any long random string — signs session tokens |

For `TOKEN_SECRET`, you can generate one from inside the editor: select
`generateTokenSecret_` from the function dropdown, click Run, then **View →
Logs** and copy the value it prints. Anyone with this value could forge a
session token, so treat it like a password — don't commit it anywhere.

### 1.3 Manual setup — passwords (required before anyone can log in)

The previous backend stored password hashes in Postgres. The spreadsheet
never had a password column, so this is the one piece of manual setup the
migration genuinely requires:

1. Run `bootstrapAddPasswordColumns` once (function dropdown → Run). This
   adds `Password Hash` and `Password Salt` to the end of the `Users` tab.
   Safe to run more than once.
2. Set an initial password for each of the 9 existing users. Two ways:
   - **One at a time** (recommended — lets you give each contractor their
     own temporary password): run `adminSetPassword_('user@email.com',
     'TempPass123!')` from the function dropdown, editing the two
     arguments each time, OR use the **ACC Oil Admin** menu that appears
     on the bound spreadsheet (Sheets UI → reload the sheet once after
     pasting the script → "ACC Oil Admin" → "2. Set a user password…").
   - **All at once** (fastest for initial testing): run
     `bootstrapSetAllInitialPasswords_('SomeTempPass123!')` to set the same
     temporary password for every existing user.
3. Every existing user's `Must Change Password` is already `Yes`
   in the spreadsheet, so whichever method you use, each person is forced
   to set their own password via the in-app "change password" flow on
   first login.

New users created later through the app's Settings screen get a random
temporary password automatically (shown once to the creator) — this manual
step is only for the 9 accounts that already existed before this
migration.

### 1.4 Deploy as a Web App

1. **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me** (so the script runs with your access to the
   spreadsheets, regardless of who's signed into the app — the app does
   its own login/permission checks independently of this).
4. Who has access: **Anyone**.
5. Click **Deploy**, authorize the requested scopes (Sheets access) when
   prompted, and copy the Web app URL (ends in `/exec`).

This project already has a deployment at
`https://script.google.com/macros/s/AKfycbyEaJfrkv7zBUuXORkG_KgSnvUvxPbd25cRUehwrNDKZtWdW0M1bhhrCqZnY7p88mxtQg/exec`
— if you're updating that existing deployment rather than creating a new
one, use **Deploy → Manage deployments → Edit (pencil icon) → New version**
instead of New deployment, so the URL stays the same and you don't need to
update the frontend's environment variable.

### 1.5 Verify it's live

Visit `<your-exec-url>?fn=getLookups&token=x&p=%7B%22type%22%3A%22organizations%22%7D`
in a browser. You should get back
`{"ok":false,"error":"Missing or invalid session token."}` — that's
correct (it proves the deployment is reachable and the auth check is
running); you just don't have a valid token from a browser address bar.

## Part 2 — Why fn-routing, not REST paths

Code.gs exposes one URL and dispatches on a `fn` parameter
(`?fn=getDashboardData&token=...`) rather than mimicking REST paths like
`/api/dashboard/kpis`. This isn't a style preference — Apps Script Web Apps
only expose a single path (`.../exec`), so "REST paths" would have to be
faked through query strings anyway, and two real CORS constraints make
fn-routing the simpler choice:

1. A custom `Authorization` header on a cross-origin request forces the
   browser to send a CORS preflight (`OPTIONS`) request first. Apps Script
   Web Apps don't implement `doOptions`, so a preflighted request just
   fails. The session token is sent as a body/query parameter instead.
2. `Content-Type: application/json` also forces a preflight. POST bodies
   are sent as plain strings instead — the browser's default content type
   for a string `fetch` body is `text/plain`, which is CORS-safelisted and
   skips the preflight — and Code.gs parses the JSON manually from
   `e.postData.contents`.

Both of these are already handled in the new `frontend/src/lib/api.ts`; you
don't need to do anything extra for this to work.

## Part 3 — Frontend: build and deploy to GitHub Pages

### 3.1 Local setup

```bash
cd frontend
cp .env.example .env
# edit .env if your Apps Script URL differs from the default already in it
npm install
npm run dev    # http://localhost:5173
```

### 3.2 One routing change, and why

`main.tsx` now uses `HashRouter` instead of `BrowserRouter`. GitHub Pages
serves static files with no server-side rewrite rule, so a path like
`/explorer/LP-111.AF040-GB-R` only works on first load — a hard refresh or
a shared link 404s, because GitHub Pages has no server to redirect that
path back to `index.html`. `HashRouter` keeps the route in the URL
fragment (`#/explorer/LP-111.AF040-GB-R`), which the browser never sends to
the server at all, so it always resolves to `index.html` and React Router
takes it from there. This is the only routing-mechanism change in the
whole migration — no screen, component, or navigation behavior changed.

### 3.3 Build

```bash
npm run build
```

`vite.config.ts` sets `base: '/acc-oil-lubrication-system/'` so built asset
URLs resolve correctly once served from
`https://<your-github-username>.github.io/acc-oil-lubrication-system/`. If
your repo name differs, or you're deploying to a custom domain / a GitHub
*user/org* page (`https://<username>.github.io/`, not a project page),
change `base` to match — `'/your-repo-name/'` or `'/'` respectively.

### 3.4 Deploy

The simplest path, using the `gh-pages` package already added to
`devDependencies`:

```bash
npm run deploy
```

This builds (`predeploy` runs `npm run build` automatically) and pushes
`dist/` to a `gh-pages` branch. Then, one-time, in the repo's GitHub
settings: **Settings → Pages → Source → Deploy from a branch → `gh-pages`
/ `(root)`**.

Alternatively, use a GitHub Actions workflow if you'd rather deploy on
every push to `main` — a minimal one:

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install --workspace=frontend
      - run: npm run build --workspace=frontend
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./frontend/dist
```

### 3.5 Updating the Apps Script URL later

If you ever redeploy the Apps Script project as a brand-new deployment
(not "New version" on the existing one), the `/exec` URL changes. Update
`VITE_APPS_SCRIPT_URL` in `frontend/.env`, rebuild, and redeploy the
frontend — no other code changes needed.

## Part 4 — Removing the old Node/Express/Prisma backend

Once the above is live and verified:

```bash
rm -rf backend/
```

Replace the repository root `package.json` with the version in this
delivery (`workspaces: ["frontend"]` only — the `backend` workspace and its
`dev:backend` / `db:seed` scripts are removed). No other repository files
reference the backend. `frontend/package.json` no longer lists `axios` as
a dependency — `npm install` after pulling this delivery will remove it
from `node_modules`.
