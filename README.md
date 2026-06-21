# ACC Oil Lubrication Management System

Multi-tenant web application for Arabian Cement Company (ACC) to track
lubrication compliance across 902 lubrication points on 604 pieces of
equipment, executed by two outsourced contractors (RHI and ASEC) with
ACC oversight, correction rights, and full audit transparency.

Ships with the real historical data: 902 lubrication points and 1,102
historical change-date records, not placeholder demo data.

## Stack

- **Backend**: Google Apps Script Web App (`apps-script/Code.gs`),
  reading and writing two Google Sheets workbooks directly — no server,
  no database. Per-user login (salted, iterated-HMAC-hashed passwords
  stored on the `Users` tab) and signed session tokens
  (`TOKEN_SECRET` Script Property).
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS v4, deployed
  as a static site (GitHub Pages). `react-router-dom` (`HashRouter`,
  required for static hosting with no server-side rewrite rules),
  `recharts` for charts, `i18next` for EN/AR with full RTL mirroring.
  "Industrial equipment-tag" design language: steel-blue navigation, warm
  paper canvas, status badges modeled on physical inspection tags (see
  `frontend/src/index.css`).

This was migrated from an earlier Node.js + Express + Prisma + Postgres
prototype to the architecture above. See `docs/MIGRATION_CHECKLIST.md`
for exactly what changed and why, and `docs/DEPLOYMENT_GUIDE.md` /
`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` for full setup and go-live steps.
What follows here is the short version.

## Setup

### 1. Backend (Apps Script)

1. Open the Operational Google Sheet in your browser, then
   **Extensions → Apps Script**.
2. Paste `apps-script/Code.gs` into `Code.gs`, and
   `apps-script/appsscript.json` into the manifest (enable
   "Show appsscript.json manifest file in editor" under Project Settings
   first).
3. Set three Script Properties: `OPERATIONAL_SHEET_ID`, `CONFIG_SHEET_ID`,
   `TOKEN_SECRET`.
4. Run `bootstrapAddPasswordColumns`, then set an initial password for
   each existing user (`adminSetPassword_` or
   `bootstrapSetAllInitialPasswords_`).
5. **Deploy → New deployment → Web app**, Execute as **Me**, Who has
   access **Anyone**. Copy the `/exec` URL.

Full step-by-step instructions, exact values, and a deployment smoke test
are in `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`.

### 2. Frontend

```bash
npm install                          # installs the frontend workspace
cd frontend
cp .env.example .env                 # set VITE_APPS_SCRIPT_URL to the /exec URL from step 1.5
cd ..
npm run dev                          # starts the UI on http://localhost:5173
```

### 3. Deploying the frontend (GitHub Pages)

```bash
npm run build                        # tsc -b && vite build
npm run deploy --workspace=frontend  # publishes frontend/dist to the gh-pages branch
```

Then, one-time: repo **Settings → Pages → Source → Deploy from a branch →
`gh-pages` / `(root)`**. `frontend/vite.config.ts`'s `base` is set to
`/acc-oil-lubrication-system/` — update it if your repo name differs.

## Accounts

There's no seeded demo password — passwords aren't stored anywhere in the
source data by design. After running the password bootstrap step above,
log in as `superadmin@acc-oil.app` (Super Admin, all-orgs, full access)
with whatever password you assigned, and create/manage the other 8
existing accounts (ACC, RHI, and ASEC managers/engineers/technicians) and
any new ones from **Settings → Users** from there.

## Known limitations

Carried over from the migration (see `docs/MIGRATION_CHECKLIST.md` for
why, and what it would take to add each back):

- Oil sample PDF extraction isn't implemented — enter sample results
  manually instead.
- Email notifications aren't sent — notifications are in-app only.
- CSV export from the Reports screen isn't implemented — the data still
  renders on-screen.

## Architecture

```
apps-script/
  Code.gs              Apps Script Web App backend — auth, all 12
                        screens' data/actions, reads & writes the two
                        Google Sheets workbooks directly
  appsscript.json       project manifest (web app access, oauth scopes)

frontend/
  src/
    index.css           design tokens — steel/canvas palette, Archivo/Inter/IBM Plex Mono, .status-tag
    lib/api.ts           Apps Script client — get/post/patch/delete matching the old axios interface,
                          maps REST-shaped calls to Apps Script function names
    context/AuthContext.tsx
    i18n/                 i18next config + en.json/ar.json resources
    components/           AppShell (sidebar+nav), KpiCard, StatusTag/PriorityTag
    pages/                 LoginPage, DashboardPage, ExplorerPage, LpDetailsPage,
                           PendingApprovalsPage, ActionPlansPage, NotificationsPage,
                           TimelinePage, OilSampleCenterPage, RouteCenterPage,
                           OilManagementPage, ReportsPage, SettingsPage

docs/
  GOOGLE_SHEETS_STRUCTURE.md       tab-by-tab reference for both workbooks
  DEPLOYMENT_GUIDE.md               narrative deployment walkthrough
  MIGRATION_CHECKLIST.md            what changed from the old stack, and known limitations
  PRODUCTION_DEPLOYMENT_RUNBOOK.md  deployment/validation/rollback/go-live checklists
```
