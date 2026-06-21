import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireScreen, requireCapability } from "../middleware/permissions";
import { computeLubricationStatus, computeOilAnalysisStatus } from "../lib/dueDate";
import { notify } from "../lib/notify";

const router = Router();
router.use(authenticate);

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

// GET /api/routes — list static + dynamic routes for the org (ACC: all orgs, read-only)
router.get("/", requireScreen("route_center"), async (req, res) => {
  const user = req.user!;
  const where = user.dataScope === "ALL_ORGS" ? {} : { organizationId: user.organizationId ?? "__none__" };
  const routes = await prisma.route.findMany({
    where,
    include: { organization: true, assignments: { include: { technician: true } } },
    orderBy: { name: "asc" },
  });
  res.json({
    routes: routes.map((r) => {
      const lpIds = JSON.parse(r.lpIds as unknown as string) as string[];
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        organization: r.organization.name,
        pointCount: lpIds.length,
        assignments: r.assignments.map((a) => ({ id: a.id, technician: a.technician.name, status: a.status, assignedDate: a.assignedDate })),
      };
    }),
  });
});

// GET /api/routes/dynamic-preview?type=due_today|due_week|overdue|oil_sample_due
// Computes the live list WITHOUT persisting anything — used to preview before snapshotting into an assignable route.
router.get("/dynamic-preview", requireScreen("route_center"), async (req, res) => {
  const user = req.user!;
  const type = (req.query.type as string) || "overdue";
  const organizationId = user.dataScope === "ALL_ORGS" ? (req.query.organizationId as string) : user.organizationId;
  if (!organizationId) return res.status(400).json({ error: "organizationId is required" });

  const points = await prisma.lubricationPoint.findMany({
    where: { equipment: { area: { organizationId } } },
    include: { equipment: true },
  });

  const matches = points.filter((p) => {
    if (type === "oil_sample_due") {
      if (!p.oaRequired) return false;
      const { bucket } = computeOilAnalysisStatus(lpToStatusInput(p));
      return bucket === "OVERDUE" || bucket === "DUE_THIS_WEEK" || bucket === "DUE_THIS_MONTH";
    }
    const { bucket } = computeLubricationStatus(lpToStatusInput(p));
    if (type === "due_today") return bucket === "DUE_TODAY";
    if (type === "due_week") return bucket === "DUE_THIS_WEEK" || bucket === "DUE_TODAY";
    return bucket === "OVERDUE"; // default/overdue
  });

  res.json({
    type,
    count: matches.length,
    points: matches.map((p) => ({ id: p.id, lpIdCode: p.lpIdCode, equipment: p.equipment.assetName })),
  });
});

const createRouteSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["static", "dynamic"]),
  lpIds: z.array(z.string()).min(1),
  organizationId: z.string().optional(),
});

// POST /api/routes — build a static route, or snapshot a dynamic-preview list into an assignable route
router.post("/", requireCapability("manageRoutes"), async (req, res) => {
  const parsed = createRouteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;
  const organizationId = req.user!.dataScope === "ALL_ORGS" ? data.organizationId : req.user!.organizationId;
  if (!organizationId) return res.status(400).json({ error: "organizationId is required" });

  const route = await prisma.route.create({
    data: { organizationId, name: data.name, type: data.type, lpIds: JSON.stringify(data.lpIds) },
  });
  res.status(201).json({ route });
});

const assignSchema = z.object({ technicianId: z.string() });

// POST /api/routes/:id/assign — Engineer/Manager assigns a route to a technician (creates execution log rows)
router.post("/:id/assign", requireCapability("manageRoutes"), async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const route = await prisma.route.findUnique({ where: { id: req.params.id } });
  if (!route) return res.status(404).json({ error: "Route not found" });
  if (req.user!.dataScope !== "ALL_ORGS" && route.organizationId !== req.user!.organizationId) {
    return res.status(403).json({ error: "Not authorized for this organization's data" });
  }

  const lpIds = JSON.parse(route.lpIds as unknown as string) as string[];
  const assignment = await prisma.routeAssignment.create({
    data: {
      routeId: route.id,
      technicianId: parsed.data.technicianId,
      status: "ASSIGNED",
      executionLogs: { create: lpIds.map((lpId) => ({ lpId, status: "PENDING" as const })) },
    },
  });
  res.status(201).json({ assignment });
});

// GET /api/routes/my-assignments — mobile M02/M03: the logged-in technician's own routes
router.get("/my-assignments", async (req, res) => {
  const assignments = await prisma.routeAssignment.findMany({
    where: { technicianId: req.user!.id },
    include: {
      route: true,
      executionLogs: { include: { lp: { include: { equipment: true } } } },
    },
    orderBy: { assignedDate: "desc" },
  });
  res.json({
    assignments: assignments.map((a) => {
      const done = a.executionLogs.filter((l) => l.status !== "PENDING").length;
      return {
        id: a.id,
        routeName: a.route.name,
        status: a.status,
        assignedDate: a.assignedDate,
        progress: `${done} of ${a.executionLogs.length}`,
        points: a.executionLogs.map((l) => ({
          lpId: l.lpId,
          lpIdCode: l.lp.lpIdCode,
          equipment: l.lp.equipment.assetName,
          isOilSample: l.lp.frequencyType === "OIL_ANALYSIS",
          status: l.status,
          skipReason: l.skipReason,
        })),
      };
    }),
  });
});

// PATCH /api/routes/assignments/:id/start
router.patch("/assignments/:id/start", async (req, res) => {
  const a = await prisma.routeAssignment.findUnique({ where: { id: req.params.id } });
  if (!a || a.technicianId !== req.user!.id) return res.status(404).json({ error: "Assignment not found" });
  await prisma.routeAssignment.update({ where: { id: a.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
  res.json({ success: true });
});

// PATCH /api/routes/assignments/:id/points/:lpId/complete
// For lubrication points, submit the actual record via POST /api/lubrication-records first, then call this to mark the route step done.
// For oil-sample points, this alone is the "mark collected" confirmation (Section 13 M03).
router.patch("/assignments/:id/points/:lpId/complete", async (req, res) => {
  const log = await prisma.routeExecutionLog.findFirst({
    where: { routeAssignmentId: req.params.id, lpId: req.params.lpId },
    include: { routeAssignment: true },
  });
  if (!log || log.routeAssignment.technicianId !== req.user!.id) return res.status(404).json({ error: "Route point not found" });

  await prisma.routeExecutionLog.update({ where: { id: log.id }, data: { status: "DONE", completedAt: new Date() } });
  await maybeCompleteAssignment(req.params.id);
  res.json({ success: true });
});

const skipSchema = z.object({ reason: z.string().min(1, "A reason is required to skip a point") });

// PATCH /api/routes/assignments/:id/points/:lpId/skip
router.patch("/assignments/:id/points/:lpId/skip", async (req, res) => {
  const parsed = skipSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const log = await prisma.routeExecutionLog.findFirst({
    where: { routeAssignmentId: req.params.id, lpId: req.params.lpId },
    include: {
      routeAssignment: { include: { route: true } },
      lp: { include: { equipment: { include: { area: true } } } },
    },
  });
  if (!log || log.routeAssignment.technicianId !== req.user!.id) return res.status(404).json({ error: "Route point not found" });

  await prisma.routeExecutionLog.update({
    where: { id: log.id },
    data: { status: "SKIPPED", skipReason: parsed.data.reason, completedAt: new Date() },
  });

  // Skipping is a judgment-required event: notification only, never an auto-created action (Section 10 design philosophy)
  await notify({
    typeName: "Route Point Skipped",
    organizationId: log.lp.equipment.area?.organizationId ?? null,
    message: `${req.user!.name} skipped ${log.lp.lpIdCode} on route "${log.routeAssignment.route.name}": ${parsed.data.reason}`,
    relatedEntityType: "RouteExecutionLog",
    relatedEntityId: log.id,
  });

  await maybeCompleteAssignment(req.params.id);
  res.json({ success: true });
});

async function maybeCompleteAssignment(assignmentId: string) {
  const logs = await prisma.routeExecutionLog.findMany({ where: { routeAssignmentId: assignmentId } });
  if (logs.length > 0 && logs.every((l) => l.status !== "PENDING")) {
    await prisma.routeAssignment.update({ where: { id: assignmentId }, data: { status: "COMPLETED", completedAt: new Date() } });
  }
}

export default router;
