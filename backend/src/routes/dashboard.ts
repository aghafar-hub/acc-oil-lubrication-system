import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireScreen } from "../middleware/permissions";
import { computeComplianceStats, computeOilAnalysisStats, computeLubricationStatus, LpForStatus } from "../lib/dueDate";

const router = Router();
router.use(authenticate, requireScreen("dashboard"));

/** Loads every lubrication point with enough org context to scope/group by org. */
async function loadPointsWithOrg(organizationId?: string) {
  const points = await prisma.lubricationPoint.findMany({
    where: organizationId ? { equipment: { area: { organizationId } } } : undefined,
    include: { equipment: { include: { area: { include: { organization: true } } } } },
  });
  return points;
}

function toLpForStatus(p: Awaited<ReturnType<typeof loadPointsWithOrg>>[number]): LpForStatus {
  return {
    id: p.id,
    frequencyType: p.frequencyType as any,
    frequencyIntervalDays: p.frequencyIntervalDays,
    lastChangeDateCache: p.lastChangeDateCache,
    oaRequired: p.oaRequired,
    oaIntervalDays: p.oaIntervalDays,
    oaLastSampleDate: p.oaLastSampleDate,
  };
}

// GET /api/dashboard/kpis?scope=all|rhi|asec
router.get("/kpis", async (req, res) => {
  const user = req.user!;
  let organizationId: string | undefined;

  if (user.dataScope === "ALL_ORGS") {
    const scope = (req.query.scope as string)?.toLowerCase();
    if (scope && scope !== "all") {
      const org = await prisma.organization.findFirst({ where: { name: { equals: scope.toUpperCase() } } });
      organizationId = org?.id;
    }
  } else {
    organizationId = user.organizationId ?? undefined;
  }

  const points = await loadPointsWithOrg(organizationId);
  const lpForStatus = points.map(toLpForStatus);
  const compliance = computeComplianceStats(lpForStatus);
  const oilAnalysis = computeOilAnalysisStats(lpForStatus);
  const conditionMonitoring = points.filter((p) => p.frequencyType === "AS_NEEDED").length;

  const orgWhere = organizationId ? { lp: { equipment: { area: { organizationId } } } } : {};
  const [pendingApproval, completedThisMonth, openActions, overdueActions] = await Promise.all([
    prisma.lubricationRecord.count({ where: { status: "PENDING_APPROVAL", ...orgWhere } }),
    prisma.lubricationRecord.count({
      where: {
        status: "APPROVED",
        isLegacyImport: false,
        approvedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        ...orgWhere,
      },
    }),
    prisma.actionPlan.count({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] },
        ...(organizationId ? { equipment: { area: { organizationId } } } : {}),
      },
    }),
    prisma.actionPlan.count({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] },
        dueDate: { lt: new Date() },
        ...(organizationId ? { equipment: { area: { organizationId } } } : {}),
      },
    }),
  ]);

  res.json({
    totalLubricationPoints: points.length,
    overdue: compliance.overdue,
    dueToday: compliance.dueToday,
    dueThisWeek: compliance.dueThisWeek,
    dueThisMonth: compliance.dueThisMonth,
    ok: compliance.ok,
    noHistory: compliance.noHistory,
    compliancePct: compliance.compliancePct,
    conditionMonitoringPoints: conditionMonitoring,
    oilSamplesOverdue: oilAnalysis.overdue,
    oilSamplesDueThisMonth: oilAnalysis.dueThisMonth,
    pendingApproval,
    completedThisMonth,
    openActionPlans: openActions,
    overdueActionPlans: overdueActions,
  });
});

// GET /api/dashboard/overdue-breakdown?groupBy=area|contractor|frequency
router.get("/overdue-breakdown", async (req, res) => {
  const user = req.user!;
  const organizationId = user.dataScope === "ALL_ORGS" ? undefined : user.organizationId ?? undefined;
  const groupBy = (req.query.groupBy as string) || "contractor";

  const points = await loadPointsWithOrg(organizationId);
  const buckets: Record<string, number> = {};

  for (const p of points) {
    const status = toLpForStatus(p);
    const result = computeLubricationStatus(status);
    if (result.bucket !== "OVERDUE") continue;

    let key: string;
    if (groupBy === "area") key = p.equipment.area?.name ?? "Unassigned";
    else if (groupBy === "frequency") key = p.frequencyLabel ?? "Unknown";
    else key = p.equipment.area?.organization?.name ?? "Unknown";

    buckets[key] = (buckets[key] ?? 0) + 1;
  }

  res.json({ groupBy, breakdown: Object.entries(buckets).map(([key, count]) => ({ key, count })) });
});

// GET /api/dashboard/contractor-comparison  — ACC only (Section 12.1.2)
router.get("/contractor-comparison", async (req, res) => {
  if (req.user!.dataScope !== "ALL_ORGS") {
    return res.status(403).json({ error: "Contractor comparison is ACC/Super Admin only" });
  }
  const orgs = await prisma.organization.findMany({ where: { type: "CONTRACTOR" } });
  const results = [];
  for (const org of orgs) {
    const points = await loadPointsWithOrg(org.id);
    const compliance = computeComplianceStats(points.map(toLpForStatus));
    const oilAnalysis = computeOilAnalysisStats(points.map(toLpForStatus));
    const orgWhere = { lp: { equipment: { area: { organizationId: org.id } } } };
    const [pending, openActions] = await Promise.all([
      prisma.lubricationRecord.count({ where: { status: "PENDING_APPROVAL", ...orgWhere } }),
      prisma.actionPlan.count({
        where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] }, equipment: { area: { organizationId: org.id } } },
      }),
    ]);
    results.push({
      organization: org.name,
      totalPoints: points.length,
      overdue: compliance.overdue,
      compliancePct: compliance.compliancePct,
      oilSamplesOverdue: oilAnalysis.overdue,
      pendingApproval: pending,
      openActionPlans: openActions,
    });
  }
  res.json({ comparison: results });
});

export default router;
