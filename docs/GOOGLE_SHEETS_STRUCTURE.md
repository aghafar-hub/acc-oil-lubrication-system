# Google Sheets Structure

This migration deliberately does **not** redesign the spreadsheet. Both
workbooks were already built to the application's exact data model before
this migration started, and the 902 lubrication points / 1,102 history rows
in the Operational workbook are used as-is — nothing in this document
involves deleting, overwriting, or recreating that data.

Two workbooks, same IDs as before:

| Workbook | Spreadsheet ID | Script property |
|---|---|---|
| ACC Oil — Operational Data | `1PvWrm5Sf1w3o3yIil_YWiwwQNrUDH_JRNB_gJqZsYFY` | `OPERATIONAL_SHEET_ID` |
| ACC Oil — Users & Config | `1r9ZOBsy5Ml_rGZe8vvneDv4VyLm90S8eDERWze80MzY` | `CONFIG_SHEET_ID` |

## What the migration brief asked for, and where it already lives

The brief asked for tabs covering Users, Settings, Lubrication History,
Pending Approvals, Action Plans, Notifications, Reports, and Audit Logs.
Reviewing both workbooks tab-by-tab against that list:

| Requested | Status |
|---|---|
| Users | Already exists (Config workbook, `Users` tab) |
| Settings | Already exists (Config workbook, `General Settings` tab) |
| Lubrication History | Already exists (Operational workbook, `Lubrication History` tab, 1,102 rows) |
| Pending Approvals | **Not a separate tab, by design** — see below |
| Action Plans | Already exists (Operational workbook, `Action Plans` tab, currently empty) |
| Notifications | Already exists (Operational workbook, `Notifications` tab, currently empty) |
| Reports | **Not a separate tab, by design** — see below |
| Audit Logs | Already exists (Operational workbook, `Audit Log` tab, currently empty) |

**Pending Approvals** is a status filter on `Lubrication History`
(`Status = PENDING_APPROVAL`), not a separate tab — every row, including
the 1,102 legacy rows, already carries a `Status` column, and all 1,102
existing rows are `APPROVED`. `getPendingApprovals` in Code.gs simply reads
`Lubrication History` filtered by status.

**Reports** are computed on read from existing data (compliance %, overdue
lists, oil-sample due lists, route completion, action-plan rollups,
contractor comparison) — there's nothing to store, so there's no tab for
it. `getReportsData` in Code.gs generates each report fresh on every call.

So of everything requested, **only one schema change was actually
required**, and it's purely additive.

## The one schema change: passwords on the Users tab

The previous architecture (Express + Prisma + Postgres) stored password
hashes in Postgres, outside the spreadsheet entirely. With Postgres gone,
Code.gs needs somewhere in the spreadsheet to keep them. Two columns are
added to the end of the existing `Users` tab:

| Column | Purpose |
|---|---|
| `Password Hash` | SHA-256(salt + password), hex-encoded |
| `Password Salt` | Per-user random salt (UUID) |

This is purely additive — every existing column (`Email`, `Name`, `Title`,
`Organization`, `Active`, `Must Change Password`) and every existing row's
values in those columns are untouched. The columns start empty for all 9
existing users; see `DEPLOYMENT_GUIDE.md` → "Manual setup" for the one-time
step that sets an initial password per account. Code.gs's
`bootstrapAddPasswordColumns()` function adds these two columns
automatically and is safe to run more than once (no-ops if they already
exist).

## Full tab reference

### Operational workbook (`ACC_Oil_Operational_Data.xlsx`)

| Tab | Header row | Columns |
|---|---|---|
| `README` | — | Informational only |
| `Lubrication Points` | row 1 | LP ID, Equipment Code, Equipment Name, Area, Contractor, Point Description, Point Code, Position, Lubricant Type, Standard Qty (L), Frequency Type, Frequency Label, Frequency Interval (days), OH Hours Reference, Oil Analysis Required, Last Oil Sample Date, OA Interval (days), OA Interval Label, Remarks |
| `Lubrication History` | row 3 (note in A1, blank row 2) | Record ID, LP ID, Equipment, Lubrication Date, Technician, Quantity Used (L), Oil Type Used, Running Hours, Remarks, Status, Submitted At, Approved By, Approved At, Rejected Reason, Rejected At, Legacy Import |
| `Oil Samples` | row 3 | Lab Sample ID, LP ID, Equipment, Sampled Date, Report Status, Recommendations, Source PDF URL, Uploaded By, Uploaded At |
| `Oil Sample Parameters` | row 3 | Lab Sample ID, Parameter Group, Parameter Key, Parameter Label, Unit, Value, Status |
| `Action Plans` | row 3 | Action ID, Action Type, Auto/Manual, Equipment, LP IDs, Description, Priority, Owner, Due Date, Status, Created By, Created At, Closed Date, Closure Comments |
| `Routes` | row 3 | Route ID, Organization, Name, Type, LP IDs |
| `Route Assignments` | row 3 | Assignment ID, Route ID, Technician, Assigned Date, Status, Started At, Completed At |
| `Route Execution Log` | row 3 | Assignment ID, LP ID, Status, Skip Reason, Completed At |
| `Notifications` | row 3 | Notification ID, User Email, Type, Message, Related Entity Type, Related Entity ID, Priority, Status, Created At |
| `Audit Log` | row 3 | Log ID, Actor Email, Action Category, Entity Type, Entity ID, Before Value, After Value, Reason, Timestamp, Visible To Org |
| `Oil Purchase Log` | row 3 | Purchase ID, Organization, Lubricant Type, Quantity (L), Purchase Date, Logged By |

Tabs with an explanatory note use the note-row1/blank-row2/header-row3
layout; tabs without one have the header directly in row 1. Code.gs detects
which layout a tab uses automatically (`findHeaderRow_`), so it doesn't
matter which a tab uses.

**`Action Plans.Equipment` convention**: this column stores the Equipment
**Code** (e.g. `111.AF040`), not the equipment name, since equipment names
aren't unique across areas. This tab was empty at handover, so this is a
convention this migration establishes, not a change to existing data.

### Config workbook (`ACC_Oil_Users_Config.xlsx`)

| Tab | Header row | Columns |
|---|---|---|
| `README` | — | Informational only |
| `Users` | row 3 | Email, Name, Title, Organization, Active, Must Change Password, **Password Hash** *(new)*, **Password Salt** *(new)* |
| `Titles` | row 1 | Title Name, Organization, Permission Template |
| `Permission Templates` | row 3 | Title, Data Scope, 16x `Screen: <Name>` columns, 16x `Can: <capability>` columns |
| `Organizations` | row 1 | Name, Type |
| `Equipment` | row 1 | Equipment Code, Asset Name, Area, Contractor, Gearbox Brand, Operating Temp (degC), Annual RH Actual |
| `Areas` | row 1 | Location Code, Area Name, Contractor |
| `Lubricant Types` | row 1 | Name, Brand |
| `Action Types` | row 3 | Name, Auto or Manual, Default Priority |
| `Notification Types & Routing` | row 3 | Name, Default Priority, Recipients, Channels |
| `General Settings` | row 1 | Key, Value, Editable By |

`Permission Templates` screen columns map to the frontend's screenKey
values by stripping `"Screen: "`, lowercasing, and replacing spaces with
underscores (`"Screen: Lubrication Explorer"` becomes `lubrication_explorer`).
Capability columns map by stripping `"Can: "` only, since they're already
camelCase (`"Can: editData"` becomes `editData`). This mapping is implemented in
`screenKeyFromHeader_` / `capabilityKeyFromHeader_` in Code.gs and verified
against the exact screenKey strings the frontend's nav (`AppShell.tsx`) and
route guards use.

## Natural keys, not synthetic IDs

The spreadsheet design already uses human-readable natural keys instead of
opaque database IDs: LP ID (`LP-111.AF040-GB-R`), Equipment Code
(`111.AF040`), Email, Title Name, Lubricant Type Name, Action Type Name,
Notification Type Name, Organization Name. Code.gs uses these same natural
keys as the "id" fields the frontend already expects, rather than
introducing new synthetic IDs. The exception is records that need a fresh
sequential ID on creation: Lubrication History (`REC-00001`), Action Plans
(`ACT-00001`), Notifications (`NTF-00001`), Audit Log (`AUD-00001`), Oil
Purchase Log (`PUR-0001`), Routes (`RT-001`), Route Assignments
(`ASG-0001`), which Code.gs generates by scanning the existing column for
the highest numeric suffix and incrementing (`nextSequentialId_`).
