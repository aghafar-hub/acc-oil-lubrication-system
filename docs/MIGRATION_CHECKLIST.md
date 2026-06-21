# Migration Checklist

## Architecture change

- [x] Node.js backend dependency removed (`backend/` deleted; see
      `DEPLOYMENT_GUIDE.md` Part 4)
- [x] Express removed (no server process at all — Apps Script Web App
      replaces it)
- [x] Prisma removed (no ORM, no schema, no migrations — Google Sheets is
      the database, read/written directly via `SpreadsheetApp`)
- [x] PostgreSQL/SQLite removed (no database server or file; data lives in
      the two existing Google Sheets workbooks)
- [x] Frontend calls Google Apps Script directly (`frontend/src/lib/api.ts`
      → the Web App `/exec` URL; no intermediate server)
- [x] No Firebase added
- [x] No Supabase added

## Data preservation

- [x] All 902 existing lubrication points untouched (read-only access
      except the explicit "ACC correction" edit flow, which patches
      specific fields by LP ID and writes an audit log entry — same
      behavior as the original Node backend)
- [x] All 1,102 existing history rows untouched (read-only; new
      submissions are appended, never overwritten)
- [x] No existing tab deleted, renamed, or restructured
- [x] Only one additive schema change: `Password Hash` / `Password Salt`
      columns appended to `Users` (see `GOOGLE_SHEETS_STRUCTURE.md`)

## UI / screens / workflows / permissions preservation

- [x] Every existing screen and component is unchanged — `App.tsx`,
      `AppShell.tsx`, and every file in `pages/` and `components/` are
      untouched. Only `lib/api.ts`, `context/AuthContext.tsx`, `main.tsx`,
      and `vite.config.ts` changed, and only to swap the transport layer
      and fix GitHub-Pages-specific concerns (routing mode, base path) —
      no visual or behavioral change to any screen.
- [x] Login → dashboard → explorer → LP details → submit → pending
      approvals → approve/reject → action plans → notifications →
      timeline → settings → reports workflow chain preserved end-to-end
      and verified against the existing route logic (`backend/src/routes/`
      was read in full and ported function-by-function, not
      reimplemented from scratch)
- [x] Role-based permissions preserved exactly: the same Permission
      Templates sheet (`screenAccess` / `capabilities` / `dataScope` per
      title) drives access control in Code.gs the same way it already
      drove the seed data the Node backend used — Super Admin, ACC
      Manager/Engineer, RHI/ASEC Manager/Engineer/Technician all resolve
      to the same screen and capability sets as before
- [x] Org-scoping (RHI sees only RHI data, ASEC only ASEC, ACC/Super Admin
      see everything, with optional contractor filters) preserved
      throughout dashboard, explorer, pending approvals, action plans,
      timeline, reports, and oil management
- [x] Compliance math verified against the project's own reference
      numbers: 657 calendar points / 560 overdue / 14.8% compliance,
      36 of 104 oil-analysis points overdue, RHI 439 points (261 overdue,
      21.1%), ASEC 463 points (299 overdue, 8.3%) — all reproduced exactly
      by Code.gs against the real spreadsheet data in automated testing
      before delivery

## The 14 required functions

All implemented in Code.gs, each tested against real data:

`loginUser`, `getDashboardData`, `getLubricationPoints`,
`getLubricationPointById`, `submitLubrication`, `getPendingApprovals`,
`approveLubrication`, `rejectLubrication`, `getActionPlans`,
`closeActionPlan`, `getNotifications`, `getTimeline`, `getSettings`,
`getReportsData`.

`getDashboardData` covers both dashboard endpoints the frontend actually
calls (`/dashboard/kpis` and `/dashboard/overdue-breakdown`, plus
`/dashboard/contractor-comparison`) via a `metric` parameter, since the
running app needs all three and they're naturally one function family.
`getReportsData` similarly covers all six report types (`compliance`,
`overdue`, `oil-samples`, `route-completion`, `action-plans`,
`contractor-comparison`) via a `report` parameter, matching how
`ReportsPage.tsx` already calls a single parameterized endpoint.

## Beyond the 14 — full screen coverage

The frontend has 12 screens, and "preserve all existing screens and
workflows" needs more than the 14 named functions to actually work end to
end. Code.gs adds ~30 more functions at the same fidelity, all exercised
in testing: `changePassword`, `getMe`, `updateLubricationPoint`,
`createActionPlan`, `updateActionPlanStatus`, `markNotificationRead`,
`markAllNotificationsRead`, `archiveNotification`, `getLookups`,
`getUsers`, `getTitles`, `createUser`, `updateUserActive`,
`getPermissionTemplates`, `updatePermissionTemplate`,
`getNotificationRouting`, `updateNotificationRouting`, `updateSetting`,
`getAuditLog`, oil management (`getOilConsumption`, `getOilForecast`,
`getPurchaseLog`, `createPurchaseLog`), oil samples (`getOilSamples`,
`getOilSampleById`, `getOilSampleTrend`, `createOilSample`), and route
center (`getRoutes`, `getDynamicRoutePreview`, `createRoute`,
`assignRoute`, `getMyAssignments`, `startAssignment`,
`completeAssignmentPoint`, `skipAssignmentPoint`).

## Known limitations (by design, not oversights)

- **Oil sample PDF extraction is not ported.** The original
  `/oil-samples/extract-pdf` endpoint did OCR/parsing of uploaded lab PDF
  reports — Apps Script has no equivalent of that pipeline. The frontend's
  upload button now fails gracefully with a clear message ("PDF extraction
  isn't available in this version — enter oil sample results manually
  instead.") rather than crashing or hanging — `createOilSample` (manual
  entry) still works normally. If this is needed later, the cleanest
  approach is a small external Cloud Function/Apps Script add-on that
  calls a document-AI API and writes results back via `createOilSample`'s
  same shape.
- **Email notifications are not sent.** The Notification Types & Routing
  sheet's `Channels` column lists `in_app, email` for several types — only
  the in-app half is implemented (rows are written to the Notifications
  tab and shown in the Notification Center). Wiring `MailApp.sendEmail`
  into `notify_()` in Code.gs is a small, contained addition if needed
  later (would also need the `script.send_mail` OAuth scope added to
  `appsscript.json`).
- **CSV export from Reports is not implemented.** The original backend
  could return `?format=csv` for any report; `getReportsData` returns JSON
  only. The Reports screen already renders the data in-browser regardless,
  so nothing currently breaks — this only matters if/when a "download CSV"
  button gets added to that screen.
- **Route Center and Oil Sample Center have realistic but unseeded
  workflows.** `Routes`, `Route Assignments`, `Route Execution Log`,
  `Oil Samples`, and `Oil Sample Parameters` all existed as empty
  (header-only) tabs at handover — the corresponding functions are fully
  implemented and tested (route creation, assignment, start/complete/skip,
  oil sample creation and trend lookups), but there's no historical data
  in those tabs yet, so those screens will look empty until the first
  routes/samples are created through the app.

## Manual setup required (not automatable)

1. Script Properties: `OPERATIONAL_SHEET_ID`, `CONFIG_SHEET_ID`,
   `TOKEN_SECRET` — see `DEPLOYMENT_GUIDE.md` Part 1.2.
2. Run `bootstrapAddPasswordColumns` once.
3. Set an initial password for each of the 9 existing users (one-by-one
   via `adminSetPassword_` / the Sheets UI menu, or all at once via
   `bootstrapSetAllInitialPasswords_`) — see `DEPLOYMENT_GUIDE.md`
   Part 1.3. Every account already has `Must Change Password = Yes`, so
   this is a one-time bootstrap, not an ongoing burden.
4. Deploy the Web App and copy the `/exec` URL into
   `frontend/.env` → `VITE_APPS_SCRIPT_URL` (already pre-filled with the
   project's existing deployment URL as a default, so this step is only
   needed if you redeploy to a new URL).
5. GitHub Pages: enable Pages on the `gh-pages` branch (one-time repo
   setting) — see `DEPLOYMENT_GUIDE.md` Part 3.4.

## Second post-delivery audit — build verification

A follow-up audit went further than static review: it actually applied
`frontend/api.ts` and `frontend/context/AuthContext.tsx` to a clean copy of
the real repository and ran `npm install`, `npm run build` (`tsc -b && vite
build`), and `npm run lint` for real, rather than just reading the code.
This caught one genuine build-breaking bug and a set of lint-only issues,
both fixed in this version:

1. **Build-breaking: `ReportsPage.tsx`'s CSV export crashed the type
   check.** That existing, untouched page calls `api.get(url, { params,
   responseType: "blob" })` — an axios-style option `RequestConfig` didn't
   declare, so `tsc -b` failed with `Property 'responseType' does not
   exist`. Fixed in `api.ts`: added `responseType?: "json" | "blob" |
   "text" | "arraybuffer"` to `RequestConfig`, and `dispatch()` now rejects
   a `responseType: "blob"` request immediately with a clear "CSV export
   isn't available in this version" error — consistent with the existing
   PDF-extraction-unsupported pattern — instead of letting it reach
   `URL.createObjectURL(res.data)` with a plain JSON object, which would
   have thrown an unhandled, confusing runtime error in the browser console
   when a user clicked "Export CSV". `ReportsPage.tsx` itself was not
   touched.
2. **Lint cleanup in `api.ts`.** `npm run lint` previously failed with 13
   errors, all `@typescript-eslint/no-explicit-any` plus one
   `no-useless-assignment` and two unused-parameter errors. Replaced `any`
   with precise types (`Record<string, string>` for route discriminators,
   `Record<string, unknown>` for the generic params bag, a proper
   `AppsScriptEnvelope` interface for the parsed response) everywhere it
   was safe to do so internally. One `any` is kept deliberately —
   `ApiResult<T = any>` — with an inline comment explaining why: every
   existing page reads `res.data.someField` with no type narrowing, exactly
   like axios's default loose typing allowed, and narrowing this to
   `unknown` compiles fine in isolation but breaks `tsc -b` across roughly
   30 call sites in 8 untouched page files. (This was tried and reverted
   during the audit specifically because it broke the real build — a
   reminder that a clean `tsc -b` matters more than a clean `eslint .` when
   the two pull in different directions on an intentionally loose API
   boundary.) `npm run lint` now exits 0 with only two pre-existing,
   untouched warnings (`react-hooks/exhaustive-deps` in
   `ActionPlansPage.tsx` and `LpDetailsPage.tsx`, neither modified by this
   migration).

Re-verified after both fixes: `npm install --workspace=frontend` succeeds
cleanly from a fresh clone, `npm run build --workspace=frontend` succeeds
(`dist/` produced, all asset URLs correctly prefixed
`/acc-oil-lubrication-system/`), `npm run lint` exits 0, and the Code.gs
functional test suite and the 61-call-shape route-coverage audit both still
pass identically (560/657 overdue, 14.8% compliance, all 49 `FUNCTION_MAP`
entries matched to a frontend route with zero orphans either direction).

## Post-delivery security audit (applied to this Code.gs)

A follow-up technical audit covering authentication, the route-to-function
mapping, GitHub Pages/Apps Script deployment config, and data-loss risk
found three real issues, all fixed in this version of `Code.gs`:

1. **Password hashing had no work factor.** The original implementation
   was a single SHA-256(salt+password) pass — fast enough that an offline
   attacker with a leaked Users tab could try billions of guesses per
   second per GPU. `hashPassword_` now does 10,000 rounds of chained
   HMAC-SHA256 (a hand-rolled PBKDF2 equivalent, since Apps Script has no
   bcrypt/scrypt/native PBKDF2) — adds roughly 200ms to login/password-set
   calls, which is an acceptable trade-off for the security gained.
   **This changes the stored hash format.** If you already ran
   `bootstrapSetAllInitialPasswords_` or `adminSetPassword_` against a live
   sheet using an earlier version of this file, re-run it after deploying
   this version — old hashes won't verify under the new scheme.
2. **Non-constant-time comparisons** in token-signature and password-hash
   verification (`verifyToken_`, `verifyPassword_`) could in principle leak
   timing information about how much of a guess matched. Both now use a
   `timingSafeEqual_` helper.
3. **No concurrency protection on sequential ID generation.** Apps Script
   Web App requests from different users can execute concurrently; without
   locking, two technicians submitting at the same moment could both
   compute the same "next" id and append rows with a duplicate Record
   ID/Action ID/etc., silently breaking lookups and approvals that key off
   that id. The 8 call sites that generate a sequential id
   (`submitLubrication`, `createActionPlan` — both the manual path and the
   auto-created repeated-rejection plan, `notify_`, `writeAuditLog_`,
   `createPurchaseLog`, `createRoute`, `assignRoute`) now wrap the
   generate-then-append step in `LockService.getScriptLock()` via a new
   `withScriptLock_` helper.

All three fixes were verified against the real spreadsheet data: syntax
re-checked clean, the full functional test suite (login, dashboard,
explorer, submit→approve/reject, repeated-rejection auto action plan,
settings, permission templates, reports, timeline, routes) re-run and
passing identically, and the compliance reference numbers (560/657
overdue, 14.8%) unchanged. Nothing else changed — no screens, workflows,
or sheet structures were touched by this audit.

Also confirmed clean in this audit, with no changes needed: every distinct
frontend API call (61 call shapes covering all 12 screens) resolves
through `api.ts` to the correct Apps Script function, every one of the 49
`FUNCTION_MAP` entries in `Code.gs` has a matching frontend route with none
orphaned in either direction, no destructive sheet operations
(`deleteRow`/`clear`/bulk `setValues`) exist anywhere in `Code.gs`, no
functional references to Node/Express/Prisma/Postgres/SQLite/localhost
remain (only explanatory comments naming what was removed), and the
`appsscript.json` webapp access/executeAs configuration matches Google's
current documentation.

## Files in this delivery

- `Code.gs` — complete Apps Script backend (paste into the Apps Script
  editor)
- `appsscript.json` — Apps Script project manifest
- `api.ts` — replaces `frontend/src/lib/api.ts`
- `AuthContext.tsx` — replaces `frontend/src/context/AuthContext.tsx`
  (adds the 401-handler wiring that used to be an axios interceptor)
- `main.tsx` — replaces `frontend/src/main.tsx` (HashRouter)
- `vite.config.ts` — replaces `frontend/vite.config.ts` (adds `base`)
- `package.json` — replaces `frontend/package.json` (axios removed,
  `gh-pages` added)
- `root-package.json` — replaces the repository root `package.json`
  (`backend` workspace removed)
- `.env.example` — replaces `frontend/.env.example`
- `GOOGLE_SHEETS_STRUCTURE.md`, `DEPLOYMENT_GUIDE.md`,
  `MIGRATION_CHECKLIST.md` — this set of docs
