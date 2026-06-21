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
- **Frontend**: React + Vite + TypeScript + Tailwind (in progress — see Build Status below)

## Setup

```bash
git clone <your-repo-url>
cd acc-oil-app
npm install                          # installs both backend + frontend workspaces

cd backend
cp .env.example .env                 # edit JWT_SECRET before any real deployment
npx prisma generate
npx prisma db push                   # creates dev.db and all tables
npm run db:seed                      # loads the real 902-point dataset + demo users

npm run dev                          # starts the API on http://localhost:4000
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

## Architecture

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
      notifications.ts      Notification Center (Section 12.10)
      users.ts               Users & Roles (Section 4)
      auditLog.ts             Audit Log (Section 9)
      settings.ts              general settings + permission template editor + notification routing editor
      lookups.ts                filter dropdown data
```

## Data quality notes from the source Excel

The import is faithful to the source file, including its imperfections.
One row (`LP-461.FD090-GWLS`) has the text "Mobil" in the quantity
column instead of a number — almost certainly a brand name typed into
the wrong cell. It was imported with a null quantity rather than
guessed at; worth a quick correction in the master spreadsheet when
convenient.

## Build status

✅ Done: data model, full historical seed data, due-date/compliance
engine (tested), auth + permission engine, core REST API (dashboard,
explorer, LP details, approval workflow, action plans, notifications,
users, audit log, settings).

🚧 Not yet built: Oil Sample Center + PDF/OCR import (Section 12.7),
Route Center + mobile route execution (Section 12.4/13), Oil
Management Center forecast/purchase log (Section 11), Reports Center
(Section 12.11), and the entire frontend (Section 12/13 screens).
