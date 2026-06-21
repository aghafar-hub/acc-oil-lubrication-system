# Production Deployment Runbook

ACC Oil Lubrication System — Google Apps Script + GitHub Pages

This consolidates the deployment-stage instructions already in
`DEPLOYMENT_GUIDE.md` into the specific checklist format needed for the
production cutover, plus three documents that didn't exist yet: a
validation checklist, a rollback procedure, and a go-live signoff. No code
changes are made in this document — it's operational instructions only,
against the audited files already in this delivery (`Code.gs`,
`appsscript.json`, `frontend/`).

**One correction before the checklists below:** task 6 in the request asks
to verify "API_KEY configuration." There is no API_KEY in this
architecture — that concept belonged to the very first draft script
(`code.gs`, the generic CRUD-proxy stub from early in this project, called
by the old Node backend). The production `Code.gs` replaced that scheme
entirely with per-user login (email + password, hashed and salted on the
Users tab) plus signed session tokens (`TOKEN_SECRET`, Script Property —
see A.2 below). If "API_KEY" refers to something else in your environment,
it isn't part of what's been built here; flag it and I'll check.

---

## A. Google Apps Script Deployment Steps

### A.1 — Exact deployment procedure

1. Open the Operational spreadsheet (Sheet ID
   `1PvWrm5Sf1w3o3yIil_YWiwwQNrUDH_JRNB_gJqZsYFY`) in Google Sheets.
2. **Extensions → Apps Script.**
3. In the script editor, delete the default `Code.gs` content and paste in
   the full contents of the delivered `Code.gs` (2,340 lines — paste the
   whole file, don't partially merge).
4. Gear icon (Project Settings) → check **"Show appsscript.json manifest
   file in editor."**
5. Open `appsscript.json` in the editor's file list, delete its contents,
   and paste in the delivered `appsscript.json`.
6. Save the project (Ctrl/Cmd+S).

### A.2 — Exact Script Properties

Gear icon → **Script Properties** → **Add script property**, three times:

| Property name | Value |
|---|---|
| `OPERATIONAL_SHEET_ID` | `1PvWrm5Sf1w3o3yIil_YWiwwQNrUDH_JRNB_gJqZsYFY` |
| `CONFIG_SHEET_ID` | `1r9ZOBsy5Ml_rGZe8vvneDv4VyLm90S8eDERWze80MzY` |
| `TOKEN_SECRET` | output of running `generateTokenSecret_` once (below) |

To generate `TOKEN_SECRET`: function dropdown (top toolbar) → select
`generateTokenSecret_` → **Run** → **View → Logs** → copy the printed
value → paste as the `TOKEN_SECRET` property value. This value signs every
session token; treat it like a password (don't paste it anywhere outside
Script Properties).

### A.3 — One-time password bootstrap (must happen before A.4, or no one can log in)

1. Function dropdown → `bootstrapAddPasswordColumns` → **Run**. Adds
   `Password Hash` / `Password Salt` to the end of the `Users` tab. Safe to
   re-run; no-ops if already present.
2. Set an initial password per existing user (9 accounts):
   - One at a time (recommended): function dropdown → `adminSetPassword_`
     → edit the two arguments in the editor (`email`, `tempPassword`) →
     Run. Repeat per user. Or use the **ACC Oil Admin** menu that appears
     in the spreadsheet's own UI after a reload (**ACC Oil Admin → 2. Set
     a user password…**).
   - All at once (fastest for initial testing only): function dropdown →
     `bootstrapSetAllInitialPasswords_` → edit the argument to a temporary
     password → Run.
3. No further action needed per-user beyond this — every existing account
   already has `Must Change Password = Yes`, so each person sets their own
   password via the in-app flow on first login.

### A.4 — Exact deployment settings

1. **Deploy → New deployment** (or, if updating the existing deployment at
   the URL below, **Deploy → Manage deployments → pencil icon → New
   version** instead, so the URL doesn't change).
2. Type: **Web app**.
3. Execute as: **Me** (manifest value `USER_DEPLOYING` — already set in
   `appsscript.json`, the dropdown should reflect it automatically).
4. Who has access: **Anyone** (manifest value `ANYONE_ANONYMOUS` — already
   set; the app's own login screen is what actually gates access, not this
   setting, since Apps Script Web Apps can't be restricted to "anyone with
   the link" without breaking anonymous fetch() calls from the browser).
5. **Deploy**. Authorize the requested Sheets scope when prompted (you,
   the deployer, authorize once — end users never see this prompt).
6. Confirm the Web app URL matches the one already in use:
   `https://script.google.com/macros/s/AKfycbyEaJfrkv7zBUuXORkG_KgSnvUvxPbd25cRUehwrNDKZtWdW0M1bhhrCqZnY7p88mxtQg/exec`
   — if it doesn't (new deployment instead of new version), update
   `frontend/.env`'s `VITE_APPS_SCRIPT_URL` and rebuild the frontend
   (Section B) before going live.

### A.5 — Deployment smoke check (do this before touching the frontend)

```
curl "https://script.google.com/macros/s/AKfycbyEaJfrkv7zBUuXORkG_KgSnvUvxPbd25cRUehwrNDKZtWdW0M1bhhrCqZnY7p88mxtQg/exec?fn=getDashboardData&token=x"
```

Expected: `{"ok":false,"error":"Missing or invalid session token.","status":401}`
— this confirms the deployment is reachable and auth is enforced. Anything
else (HTML error page, "Script function not found", a 500) means stop and
fix before proceeding.

---

## B. GitHub Pages Deployment Steps

### B.1 — Apply the delivered files to the repository

```bash
git checkout -b deploy/apps-script-migration
rm -rf backend/
cp <delivery>/frontend/api.ts          frontend/src/lib/api.ts
cp <delivery>/frontend/AuthContext.tsx frontend/src/context/AuthContext.tsx
cp <delivery>/frontend/main.tsx        frontend/src/main.tsx
cp <delivery>/frontend/vite.config.ts  frontend/vite.config.ts
cp <delivery>/frontend/package.json    frontend/package.json
cp <delivery>/frontend/root-package.json package.json
cp <delivery>/frontend/.env.example    frontend/.env.example
```

### B.2 — Build commands

```bash
cp frontend/.env.example frontend/.env
# only edit frontend/.env if the Apps Script URL changed in A.4 step 6
npm install --workspace=frontend
npm run build --workspace=frontend
```

Expected: `tsc -b && vite build` exits 0, `frontend/dist/` is produced,
`frontend/dist/index.html`'s asset URLs are prefixed
`/acc-oil-lubrication-system/`.

### B.3 — Publish commands

```bash
npm run deploy --workspace=frontend
```

This runs `predeploy` (`npm run build`) automatically, then pushes
`frontend/dist/` to the `gh-pages` branch via the `gh-pages` package
already in `devDependencies`.

### B.4 — Repository settings (one-time)

**Settings → Pages → Build and deployment → Source: Deploy from a
branch → Branch: `gh-pages` / `(root)` → Save.**

Wait 1–2 minutes for the first publish, then confirm
`https://<github-username>.github.io/acc-oil-lubrication-system/` loads
the login screen.

### B.5 — If using GitHub Actions instead of manual `npm run deploy`

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

---

## C. Production Validation Checklist

Run this against the live URLs after both A and B are complete, signed in
as the role noted for each item (use real accounts from the `Users` tab,
not test data). Check off each line; don't skip ahead on a failure — note
the failure, fix, and re-run that line before continuing.

**Login**
- [ ] Wrong password is rejected with a clear error, no token issued
- [ ] Correct password logs in and lands on the Dashboard
- [ ] A fresh account (or one with `Must Change Password = Yes`) is
      prompted to set a new password before proceeding
- [ ] After changing password, the old password no longer works and the
      new one does

**Dashboard**
- [ ] KPI tiles load for a contractor-scoped user (RHI/ASEC) and show only
      that org's numbers
- [ ] KPI tiles load for Super Admin/ACC and show all 902 points
- [ ] Overdue breakdown chart renders by area without error
- [ ] Contractor comparison is visible to Super Admin/ACC and returns a
      403 (not a crash) for a contractor-scoped user

**Lubrication Explorer**
- [ ] List loads and paginates
- [ ] Org scoping holds (an RHI user never sees ASEC rows or vice versa)
- [ ] Status filter (Overdue / Due This Week / etc.) changes the result
      set correctly

**LP Details**
- [ ] Opening a point from the Explorer shows its full detail, history,
      and any action plans
- [ ] An ACC-level correction edit (if your role has `editData`) saves and
      appears in the Audit Log with a reason

**Submit Lubrication**
- [ ] A Technician can submit a lubrication record for a point in their
      org
- [ ] The new record appears with status `PENDING_APPROVAL`

**Pending Approval**
- [ ] An Engineer/Manager in the same org sees the new pending submission
- [ ] A user from a different org does not see it

**Approval**
- [ ] Approving the record moves it out of Pending Approvals
- [ ] The record's status becomes `APPROVED` and is reflected in the
      point's history

**Rejection**
- [ ] Rejecting a record with a reason removes it from Pending Approvals
      and marks it `REJECTED`
- [ ] After 3 rejections for the same technician (the configured
      `repeated_rejection.threshold`), a "Repeated Rejection" action plan
      is auto-created

**Timeline**
- [ ] Recent events (submissions, approvals, rejections, action plan
      activity) appear in descending date order
- [ ] Filtering by event type / area / technician narrows the results

**Notifications**
- [ ] The notification bell's unread count matches the Notification
      Center's unread list
- [ ] Marking one notification read, and "mark all read," both update the
      count correctly

**Reports**
- [ ] Compliance report renders and the overall number is plausible
      (matches the org's known overdue ratio)
- [ ] Switching report type (overdue / oil-samples / action-plans /
      route-completion / contractor-comparison) loads without error

**Settings**
- [ ] General Settings values load and an edit (Super Admin only) saves
      and is reflected on reload
- [ ] Permission Templates and Notification Routing load for Super Admin
      and are blocked (403, not a crash) for everyone else

**User Management**
- [ ] User list loads, scoped correctly (org-scoped vs. all-orgs per role)
- [ ] Creating a new user produces a temporary password and the new
      account can log in and is forced to change it
- [ ] Deactivating a user prevents that account from logging in afterward

---

## D. Rollback Procedure

Use this if anything in Section C fails after go-live and can't be
hot-fixed quickly.

### D.1 — Frontend rollback (GitHub Pages)

The previous build is still sitting in `gh-pages` branch history.

```bash
git fetch origin gh-pages
git log origin/gh-pages --oneline   # find the last-known-good commit
git push origin <good-commit-sha>:gh-pages --force
```

GitHub Pages picks up the reverted branch within ~1 minute; no rebuild
needed. If you deployed via the Actions workflow instead, re-run a prior
successful workflow run from the Actions tab ("Re-run jobs") rather than
force-pushing.

### D.2 — Apps Script rollback

Apps Script keeps every deployed version. To revert:

1. Script editor → **Deploy → Manage deployments**.
2. Click the pencil icon on the active Web app deployment.
3. Under **Version**, select the previous version from the dropdown
   (Apps Script numbers them automatically — each "New version" in A.4
   step 1 created one).
4. **Deploy**. The `/exec` URL stays the same; only the code behind it
   changes back.

If the bad version also corrupted Script Properties (unlikely, since
nothing in `Code.gs` writes to Script Properties at runtime), reset them
to the values in A.2.

### D.3 — Data rollback

There is no database to restore — the two Google Sheets workbooks are the
only data store, and `Code.gs` never does destructive writes (no
`deleteRow`/`clear`/bulk overwrite anywhere in the script; every write is
either an `appendRow` of a brand-new row or a targeted single-row update
by natural key). This means:

- **Bad data from a bug** (e.g., a malformed submission) is fixed by
  directly editing the affected cell(s) in the Sheets UI — there's no
  schema migration or restore procedure needed, since it's literally a
  spreadsheet.
- **As a precaution before any deployment**, make a copy of both
  workbooks first (**File → Make a copy** in Sheets, or
  **File → Download** for an offline backup) so you have an exact restore
  point if something more serious goes wrong. This takes under a minute
  and costs nothing — do it every time, not just on suspicion of trouble.

### D.4 — Taking the system offline temporarily

If you need to stop all writes while investigating (not usually
necessary, since rollback doesn't require downtime):

1. Script editor → **Deploy → Manage deployments → pencil icon**.
2. Change **Who has access** to **Only myself**.
3. **Deploy**. The frontend's login screen will show a network/auth error
   to all users until access is restored — communicate this to users
   before doing it.

### D.5 — Communication

Notify affected users (the 9 accounts, or all technicians/engineers if
already rolled out further) before and after any rollback — a quick
message stating what broke, what was reverted, and when to expect it back
is enough; there's no user-facing maintenance page built into this system.

---

## E. Go-Live Signoff Checklist

Complete this immediately before announcing the system to real users.
Every line should be checked by someone who personally verified it, not
assumed from an earlier step.

**Apps Script**
- [ ] `Code.gs` deployed matches the audited file exactly (no manual edits
      made directly in the script editor after pasting)
- [ ] `appsscript.json` manifest matches the delivered file
- [ ] All three Script Properties set: `OPERATIONAL_SHEET_ID`,
      `CONFIG_SHEET_ID`, `TOKEN_SECRET`
- [ ] `bootstrapAddPasswordColumns` has been run
- [ ] All 9 existing users have a password set and can log in
- [ ] Section A.5 smoke check returns the expected 401 response
- [ ] Deployment URL confirmed and matches `frontend/.env`

**Frontend**
- [ ] `frontend/.env`'s `VITE_APPS_SCRIPT_URL` points at the URL just
      confirmed above
- [ ] `npm run build --workspace=frontend` succeeds with zero errors
- [ ] GitHub Pages is live at the expected URL and shows the login screen
- [ ] A hard refresh on a deep link (e.g.
      `.../#/explorer/LP-111.AF040-GB-R`) loads correctly, not a 404

**Validation**
- [ ] Every item in Section C is checked off, tested by an actual human
      against the live URLs (not assumed from the earlier automated audit)
- [ ] At least one full role tested per data scope: Super Admin/ACC
      (all-orgs), one RHI account, one ASEC account

**Data safety**
- [ ] A backup copy of both workbooks (Operational + Config) was made
      immediately before this go-live, per D.3
- [ ] Confirmed the 902 lubrication points and 1,102 history records are
      present and untouched in the live workbook (spot-check a few rows
      against the pre-migration originals)

**Operational readiness**
- [ ] Rollback procedure (Section D) has been read by whoever is on call
      for the first 24–48 hours after go-live
- [ ] Known limitations communicated to stakeholders: oil-sample PDF
      extraction isn't ported (manual entry only), email notifications
      aren't sent (in-app only), CSV export from Reports isn't
      implemented — see `MIGRATION_CHECKLIST.md`
- [ ] Old Node/Express backend kept available (not deleted) for a defined
      grace period after go-live, in case of an unforeseen need to compare
      against it, before final teardown

**Signoff**

| Role | Name | Date | Signature |
|---|---|---|---|
| Deployment engineer | | | |
| Product/business owner | | | |
| First on-call (post go-live) | | | |
