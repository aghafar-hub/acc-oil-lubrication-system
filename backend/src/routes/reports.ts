import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireScreen } from "../middleware/permissions";
import { computeLubricationStatus, computeOilAnalysisStatus, computeComplianceStats } from "../lib/dueDate";

const router = Router();
router.use(authenticate, requireScreen("reports_center"));

function lpToStatusInput(p: any) {
  return {
    id: p.id,
    frequencyType: p.frequencyType,
    frequencyIntervalDays: p.frequencyIntervalDays,
    lastChangeDateCache: p.lastChangeDateCache,
    oaRequired: p.oaRequired,
    oaIntervalDays: p.oaIntervalDays,
    oaLastSampleDate: p.oaLastSampleDate,
  };
}

function orgScope(user: { dataScope: string; organizationId: string | null }, contractor?: string) {
  if (user.dataScope === "ALL_ORGS") return contractor ? { area: { organizationId: contractor } } : {};
  return { area: { organizationId: user.organizationId ?? "__none__" } };
}

/** Renders rows as CSV (RFC4180-ish, good enough for Excel) when ?format=csv is requested. */
function respondTabular(req: any, res: any, filename: string, rows: Record<string, any>[]) {
  if ((req.query.format as string) !== "csv") return res.json({ rows });
  if (rows.length === 0) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    return res.send("");
  }
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  res.send(csv);
}

// GET /api/reports/compliance — overall + per-area compliance %
router.get("/compliance", async (req, res) => {
  const { contractor } = req.query as Record<string, string>;
  const points = await prisma.lubricationPoint.findMany({
    where: { equipment: orgScope(req.user!, contractor) },
    include: { equipment: { include: { area: true } } },
  });
  const overall = computeComplianceStats(points.map(lpToStatusInput));

  const byArea: Record<string, any[]> = {};
  for (const p of points) {
    const area = p.equipment.area?.name ?? "Unassigned";
    byArea[area] = byArea[area] || [];
    byArea[area].push(p);
  }
  const rows = Object.entries(byArea).map(([area, pts]) => {
    const stats = computeComplianceStats(pts.map(lpToStatusInput));
    return { area, totalCalendarPoints: stats.totalCalendarPoints, overdue: stats.overdue, compliancePct: stats.compliancePct };
  });

  if ((req.query.format as string) === "csv") return respondTabular(req, res, "compliance_report", rows);
  res.json({ overall, byArea: rows });
});

// GET /api/reports/overdue — flat list of every overdue point
router.get("/overdue", async (req, res) => {
  const { contractor } = req.query as Record<string, string>;
  const points = await prisma.lubricationPoint.findMany({
    where: { equipment: orgScope(req.user!, contractor) },
    include: { equipment: { include: { area: { include: { organization: true } } } } },
  });
  const rows = points
    .map((p) => ({ p, status: computeLubricationStatus(lpToStatusInput(p)) }))
    .filter((x) => x.status.bucket === "OVERDUE")
    .map((x) => ({
      lpIdCode: x.p.lpIdCode,
      equipment: x.p.equipment.assetName,
      area: x.p.equipment.area?.name ?? "",
      contractor: x.p.equipment.area?.organization?.name ?? "",
      daysOverdue: x.status.daysToDue != null ? Math.abs(x.status.daysToDue) : null,
      nextDue: x.status.nextDue,
    }))
    .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
  respondTabular(req, res, "overdue_report", rows);
});

// GET /api/reports/oil-samples?status=overdue|due
router.get("/oil-samples", async (req, res) => {
  const { contractor, status } = req.query as Record<string, string>;
  const points = await prisma.lubricationPoint.findMany({
    where: { oaRequired: true, equipment: orgScope(req.user!, contractor) },
    include: { equipment: { include: { area: { include: { organization: true } } } } },
  });
  const rows = points
    .map((p) => ({ p, status: computeOilAnalysisStatus(lpToStatusInput(p)) }))
    .filter((x) => (status === "due" ? x.status.bucket === "DUE_THIS_MONTH" || x.status.bucket === "DUE_THIS_WEEK" : x.status.bucket === "OVERDUE"))
    .map((x) => ({
      lpIdCode: x.p.lpIdCode,
      equipment: x.p.equipment.assetName,
      contractor: x.p.equipment.area?.organization?.name ?? "",
      lastSample: x.p.oaLastSampleDate,
      nextDue: x.status.nextDue,
    }));
  respondTabular(req, res, "oil_sample_report", rows);
});

// GET /api/reports/route-completion
router.get("/route-completion", async (req, res) => {
  const { contractor } = req.query as Record<string, string>;
  const where = req.user!.dataScope === "ALL_ORGS" ? (contractor ? { organizationId: contractor } : {}) : { organizationId: req.user!.organizationId ?? "__none__" };
  const assignments = await prisma.routeAssignment.findMany({
    where: { route: where },
    include: { route: true, technician: true, executionLogs: true },
    orderBy: { assignedDate: "desc" },
  });
  const rows = assignments.map((a) => {
    const done = a.executionLogs.filter((l) => l.status === "DONE").length;
    const skipped = a.executionLogs.filter((l) => l.status === "SKIPPED").length;
    return {
      route: a.route.name,
      technician: a.technician.name,
      assignedDate: a.assignedDate,
      status: a.status,
      totalPoints: a.executionLogs.length,
      done,
      skipped,
      completionPct: a.executionLogs.length ? Math.round((done / a.executionLogs.length) * 100) : 0,
    };
  });
  respondTabular(req, res, "route_completion_report", rows);
});

// GET /api/reports/action-plans?status=
router.get("/action-plans", async (req, res) => {
  const { contractor, status } = req.query as Record<string, string>;
  const where: any = { equipment: orgScope(req.user!, contractor) };
  if (status) where.status = status;
  const plans = await prisma.actionPlan.findMany({
    where,
    include: { actionType: true, equipment: { include: { area: { include: { organization: true } } } }, owner: true },
  });
  const rows = plans.map((p) => ({
    actionType: p.actionType.name,
    equipment: p.equipment.assetName,
    contractor: p.equipment.area?.organization?.name ?? "",
    description: p.description,
    priority: p.priority,
    status: p.status,
    owner: p.owner?.name ?? "",
    dueDate: p.dueDate,
    createdAt: p.createdAt,
    closedDate: p.closedDate,
  }));
  respondTabular(req, res, "action_plan_report", rows);
});

// GET /api/reports/contractor-comparison — ACC only (Section 12.11)
router.get("/contractor-comparison", async (req, res) => {
  if (req.user!.dataScope !== "ALL_ORGS") return res.status(403).json({ error: "ACC/Super Admin only" });
  const orgs = await prisma.organization.findMany({ where: { type: "CONTRACTOR" } });
  const rows = [];
  for (const org of orgs) {
    const points = await prisma.lubricationPoint.findMany({ where: { equipment: { area: { organizationId: org.id } } } });
    const stats = computeComplianceStats(points.map(lpToStatusInput));
    rows.push({ contractor: org.name, totalPoints: points.length, overdue: stats.overdue, compliancePct: stats.compliancePct });
  }
  respondTabular(req, res, "contractor_comparison_report", rows);
});

export default router;
