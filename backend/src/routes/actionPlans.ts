import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireScreen } from "../middleware/permissions";

const router = Router();
router.use(authenticate, requireScreen("action_plan_center"));

// GET /api/action-plans?status=&contractor=
router.get("/", async (req, res) => {
  const user = req.user!;
  const { status, contractor } = req.query as Record<string, string>;
  const where: any = {};
  if (status) where.status = status;
  if (user.dataScope !== "ALL_ORGS") {
    where.equipment = { area: { organizationId: user.organizationId } };
  } else if (contractor) {
    where.equipment = { area: { organizationId: contractor } };
  }

  const plans = await prisma.actionPlan.findMany({
    where,
    include: { actionType: true, equipment: { include: { area: { include: { organization: true } } } }, owner: true, createdBy: true },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    actionPlans: plans.map((p) => ({
      id: p.id,
      actionType: p.actionType.name,
      autoOrManual: p.actionType.autoOrManual,
      equipment: p.equipment.assetName,
      equipmentCode: p.equipment.equipmentIdCode,
      contractor: p.equipment.area?.organization?.name ?? null,
      description: p.description,
      priority: p.priority,
      owner: p.owner?.name ?? null,
      dueDate: p.dueDate,
      status: p.status,
      createdBy: p.createdBy?.name ?? null,
      createdAt: p.createdAt,
      closedDate: p.closedDate,
      closureComments: p.closureComments,
    })),
  });
});

const createSchema = z.object({
  actionTypeName: z.string(),
  equipmentId: z.string(),
  lpIds: z.array(z.string()).default([]),
  description: z.string().min(1),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  ownerId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

// POST /api/action-plans — manual creation (Engineer/Manager) or system auto-creation
router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const actionType = await prisma.actionType.findUnique({ where: { name: data.actionTypeName } });
  if (!actionType) return res.status(400).json({ error: "Unknown action type" });

  const plan = await prisma.actionPlan.create({
    data: {
      actionTypeId: actionType.id,
      equipmentId: data.equipmentId,
      lpIds: JSON.stringify(data.lpIds),
      description: data.description,
      priority: data.priority,
      ownerId: data.ownerId ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      status: "OPEN",
      createdById: req.user!.id,
    },
  });
  res.status(201).json({ actionPlan: plan });
});

const closeSchema = z.object({ closureComments: z.string().min(1, "Closure comments are required") });

// PATCH /api/action-plans/:id/close — owning org's Engineer or Manager only (Section 10)
router.patch("/:id/close", requireScreen("action_plan_center"), async (req, res) => {
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!req.user!.capabilities.closeActions) return res.status(403).json({ error: "Missing capability: closeActions" });

  const plan = await prisma.actionPlan.findUnique({ where: { id: req.params.id }, include: { equipment: { include: { area: true } } } });
  if (!plan) return res.status(404).json({ error: "Action plan not found" });
  if (req.user!.dataScope !== "ALL_ORGS" && plan.equipment.area?.organizationId !== req.user!.organizationId) {
    return res.status(403).json({ error: "Not authorized for this organization's data" });
  }

  await prisma.actionPlan.update({
    where: { id: plan.id },
    data: { status: "COMPLETED", closedDate: new Date(), closureComments: parsed.data.closureComments },
  });
  res.json({ success: true });
});

// PATCH /api/action-plans/:id/status — generic status update (In Progress / Waiting / Cancelled)
const statusSchema = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "CANCELLED"]) });
router.patch("/:id/status", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const plan = await prisma.actionPlan.findUnique({ where: { id: req.params.id }, include: { equipment: { include: { area: true } } } });
  if (!plan) return res.status(404).json({ error: "Action plan not found" });
  if (req.user!.dataScope !== "ALL_ORGS" && plan.equipment.area?.organizationId !== req.user!.organizationId) {
    return res.status(403).json({ error: "Not authorized for this organization's data" });
  }
  await prisma.actionPlan.update({ where: { id: plan.id }, data: { status: parsed.data.status } });
  res.json({ success: true });
});

export default router;
