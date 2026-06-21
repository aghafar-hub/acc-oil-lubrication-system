# ACC Oil Lubrication Management System

Multi-tenant web application for Arabian Cement Company (ACC) to track
lubrication compliance across 902 lubrication points on 604 pieces of
equipment, executed by two outsourced contractors (RHI and ASEC) with
ACC oversight, correction rights, and full audit transparency.

Built from the locked handover spec (`ACC_Oil_Lubrication_App_Handover.md`)
and seeded with the real historical data from
`ACC_Lubricants_Master_v2.xlsx` — this is not a demo with placeholder
data, it ships with your actual 902-point register and 1,102 historical
change-date records imported as-is.

## ⚠️ Important note on this build

This repository was built and reviewed inside a sandboxed environment
whose network allowlist does **not** include `binaries.prisma.sh`, the
domain Prisma's CLI downloads its query engine from. That means
`npx prisma generate` / `db push` / `db seed` could **not** be executed
or tested inside that sandbox — only the framework-free business logic
(`backend/src/lib/dueDate.ts`) could be run directly, and it was: it
reproduces the spec's reference numbers exactly (560/657 overdue, 14.8%
compliance, 36/104 oil samples overdue) against the real imported data.

This is **not** expected to be an issue on your machine, in CI, or on
any standard hosting provider — `binaries.prisma.sh` is a normal,
publicly reachable domain. But because the Prisma-dependent code
(the schema, `seed.ts`, and every route file) could only be reviewed
manually and never actually executed, **please run the setup steps
below and paste back any errors you hit** — they'll likely be small and
quick to fix, but I'd rather you catch them on a first run than discover
them later.

## Stack

- **Backend**: Node.js + TypeScript + Express + Prisma ORM
  - Dev database: SQLite (zero setup, file-based)
  - Production: swap one line in `prisma/schema.prisma` (`provider = "postgresql"`) and set `DATABASE_URL` — no model changes needed
  - JWT auth, zod validation, bcrypt password hashing
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS v4
  - react-router-dom for routing, recharts for charts, i18next for EN/AR with full RTL mirroring
  - "Industrial equipment-tag" design language: steel-blue navigation, warm paper canvas, status badges modeled on physical inspection tags (see `frontend/src/index.css`)

## Setup

```bash
git clone <your-repo-url>
cd acc-oil-app
npm install                          # installs both backend + frontend workspaces

# Backend
cd backend
cp .env.example .env                 # edit JWT_SECRET before any real deployment
npx prisma generate
npx prisma db push                   # creates dev.db and all tables
npm run db:seed                      # loads the real 902-point dataset + demo users
npm run dev                          # starts the API on http://localhost:4000 (also runs the
                                      # overdue-check job once at boot, then hourly — see below)

# Frontend (in a second terminal)
cd frontend
cp .env.example .env                 # points at the API above by default
npm run dev                          # starts the UI on http://localhost:5173
```

Health check: `curl http://localhost:4000/api/health`

## Demo accounts

All seeded with password `Demo@12345` and `mustChangePassword: true`
(demonstrates the forced first-login password change flow):

| Email | Title | Org | Scope |
|---|---|---|---|
| superadmin@acc-oil.app | Super Admin | — | All orgs, full settings |
| manager@acc.app | ACC Manager | ACC | All orgs, comment + correct data |
| engineer@acc.app | ACC Engineer | ACC | All orgs, comment + correct data |
| manager@rhi.app | RHI Manager | RHI | Own org, manage team |
| engineer@rhi.app | RHI Engineer | RHI | Own org, approve/reject |
| tech@rhi.app | RHI Technician | RHI | Own org, mobile submit only |
| manager@asec.app | ASEC Manager | ASEC | Own org, manage team |
| engineer@asec.app | ASEC Engineer | ASEC | Own org, approve/reject |
| tech@asec.app | ASEC Technician | ASEC | Own org, mobile submit only |

These map to real, separately-editable `PermissionTemplate` rows per
title — editing RHI Engineer's screen access in Settings never touches
ASEC Engineer's (Section 4.3 requirement).


## Data quality notes from the source Excel

The import is faithful to the source file, including its imperfections.
One row (`LP-461.FD090-GWLS`) has the text "Mobil" in the quantity
column instead of a number — almost certainly a brand name typed into
the wrong cell. It was imported with a null quantity rather than
guessed at; worth a quick correction in the master spreadsheet when
convenient.

## Build status

✅ Backend: data model, full historical seed data, due-date/compliance
engine (tested), auth + permission engine, and the **complete REST API**
covering every Section 12/13 screen.

✅ Frontend (verified — actually builds and runs in this environment,
unlike the Prisma-blocked backend): design system, auth + forced
first-login password change, app shell with permission-gated
navigation and live counters, Executive Dashboard with charts, the
Lubrication Explorer with filters/search/CSV export, LP Details with
ACC correction, Pending Approvals (approve/reject), Action Plan
Center (close with mandatory comments), Notification Center, the
Oil Sample Center (search/select, status banner, grouped parameter
table, trend charts, manual entry, batch PDF upload with mandatory
human review), the Route Center (dynamic route preview/build,
assignment), the Oil Management Center (consumption chart, 30-day
forecast, purchase log), the Reports Center (6 report types, CSV
export), and Settings (Users & Roles, Permission Templates editor,
Notification Routing matrix, Audit Log, General) — all with EN/AR
i18n and RTL wired through the shell.

Oil Sample Center note: the parameter table is a samples-as-columns
comparison matrix (sample dates across the top, parameters as rows,
each cell color-coded by its own status independent of the row/sample)
— matching the structure called out in Section 12.7 as "must replicate
the client's reference screenshot," not a simpler one-sample-at-a-time
table. The Sample Timeline list shows key readings (Visc/Fe/Si/Water)
inline per spec, and an Add Action button creates a manual Action Plan
Center entry scoped to the equipment, also per spec.

The Lubrication Timeline (Section 12.6) is also now built: a unified,
filterable plant-wide activity feed (area/equipment/event type/date
range/technician/contractor) aggregated from lubrication records, oil
samples, action plans, and ACC data edits across nine event types.

🚧 Still to build: the dedicated mobile (M01-M06) layouts (the desktop
build is responsive but isn't the purpose-built mobile flow the spec
describes) and the 10 client-pending UI themes.

### The overdue-detection job (Section 10's "auto" half)

Building the Timeline surfaced a real gap: due-date status is always
computed live (by design — see `dueDate.ts`), so nothing ever actually
*created* the "auto" Action Plans (Overdue Lubrication, Oil Sample
Overdue) or their notifications when a point crossed into overdue.
`backend/src/jobs/checkOverdue.ts` fixes this: it scans every point,
and the moment one transitions to OVERDUE, creates the corresponding
auto Action Plan + notification exactly once (skipped on every
subsequent run while that Action Plan stays open). The running server
calls it once ~5s after boot and then hourly; `npm run check-overdue`
runs it standalone for an external cron, which is the more
restart-safe option in production. Its ActionPlan.createdAt timestamps
are also the literal source of the Lubrication Timeline's "Overdue
flagged" / "Oil sample overdue flagged" events.

### A note on `npx eslint`

The scaffolded ESLint config ships `eslint-plugin-react-hooks`'s new
`set-state-in-effect` rule, which flags the standard "setLoading(true),
fetch, setState in `.then()`" pattern used throughout this app (there's
no React Query/SWR layer — just plain `useEffect` + axios). That's
idiomatic data-fetching, not a bug, so the rule is turned off in
`eslint.config.js` with a comment explaining why. The same plugin's
newer `purity` rule (no impure calls like `Date.now()` directly in a
`useState` initializer) caught a few real instances, fixed with the
lazy-initializer form. Everything else lints clean except two
harmless `exhaustive-deps` warnings on stable `load()` functions.

### Architecture

```
backend/
  prisma/
    schema.prisma        22 models — organizations through audit log
    seed.ts              loads prisma/seed-data/*.json in FK-safe order
    seed-data/            generated from the master Excel + hand-authored reference data
  src/
    lib/
      dueDate.ts          due-date/compliance logic (Section 6) — framework-free, unit-tested
      notify.ts           resolves notification routing tokens to recipients (Section 8)
      oilSampleParams.ts   canonical 25-parameter dictionary for manual entry + PDF matching
      prisma.ts           Prisma client singleton
    middleware/
      auth.ts             JWT verification, re-fetches permissions fresh on every request
      permissions.ts      requireScreen() / requireCapability() guards — never hardcoded role checks
    routes/
      auth.ts              login, forced password change
      dashboard.ts          Executive Dashboard KPIs + contractor comparison (Section 12.1)
      lubricationPoints.ts  Explorer + LP Details + ACC correction (Section 12.2/12.3)
      lubricationRecords.ts submission + approval workflow (Section 5, 13)
      actionPlans.ts        Action Plan Center (Section 10)
      oilSamples.ts          Oil Sample Center + batch PDF extraction (Section 12.7)
      routeCenter.ts          Route Center + mobile route execution (Section 12.4, 13)
      oilManagement.ts         Oil Management Center (Section 11)
      reports.ts                Reports Center + CSV export (Section 12.11)
      timeline.ts                Lubrication Timeline (Section 12.6)
      notifications.ts      Notification Center (Section 12.10)
      users.ts               Users & Roles (Section 4)
      auditLog.ts             Audit Log (Section 9)
      settings.ts              general settings + permission template editor + notification routing editor
      lookups.ts                filter dropdown data
    jobs/
      checkOverdue.ts      auto-creates "auto" Action Plans the moment a point goes overdue (Section 10)
      runOnce.ts            standalone entry point — `npm run check-overdue`

frontend/
  src/
    index.css             design tokens — steel/canvas palette, Archivo/Inter/IBM Plex Mono, .status-tag
    lib/api.ts             axios client, JWT attach, 401 handling
    context/AuthContext.tsx
    i18n/                   i18next config + en.json/ar.json resources
    components/             AppShell (sidebar+nav), KpiCard, StatusTag/PriorityTag
    pages/                   LoginPage, DashboardPage, ExplorerPage, LpDetailsPage,
                             PendingApprovalsPage, ActionPlansPage, NotificationsPage,
                             TimelinePage, OilSampleCenterPage, RouteCenterPage,
                             OilManagementPage, ReportsPage, SettingsPage
```

### A note on `npx tsc --noEmit` (backend only)

Until you've run `npx prisma generate` for real, type-checking the
backend will show ~40 `TS7006: implicitly has an 'any' type` errors.
These are expected and not bugs — they come from Prisma Client's types
not existing yet (this sandbox couldn't generate them; see the warning
above). They resolve automatically once `prisma generate` succeeds.
Everything else in the codebase type-checks cleanly — verified by
filtering those errors out and confirming zero remain. The **frontend**
has no such caveat: `npx tsc -b` and `npm run build` were both run
successfully in this environment and produce a clean production build.
