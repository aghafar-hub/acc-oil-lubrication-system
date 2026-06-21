import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireCapability, requireScreen } from "../middleware/permissions";
import { notify } from "../lib/notify";

const router = Router();
router.use(authenticate);

async function getSetting(key: string, fallback: string): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return s?.value ?? fallback;
}

const submitSchema = z.object({
  lpId: z.string(),
  lubricationDate: z.string(), // ISO date, today by default, past OK, future blocked (Section 13 M04)
  quantityUsedL: z.number().nullable().optional(),
  oilTypeUsedId: z.string().nullable().optional(),
  runningHours: z.number().nullable().optional(),
  remarks: z.string().nullable().optional(),
  photoUrls: z.array(z.string()).max(3).optional(),
});

// POST /api/lubrication-records  — M04 Lubrication Entry submission
router.post("/", requireCapability("submit"), async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const lubricationDate = new Date(data.lubricationDate);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (lubricationDate > today) {
    return res.status(400).json({ error: "Lubrication date cannot be in the future" });
  }

  const lp = await prisma.lubricationPoint.findUnique({
    where: { id: data.lpId },
    include: { equipment: { include: { area: true } } },
  });
  if (!lp) return res.status(404).json({ error: "Lubrication point not found" });

  const organizationId = lp.equipment.area?.organizationId ?? null;
  if (req.user!.dataScope !== "ALL_ORGS" && organizationId !== req.user!.organizationId) {
    return res.status(403).json({ error: "Not authorized for this organization's data" });
  }

  const record = await prisma.lubricationRecord.create({
    data: {
      lpId: lp.id,
      technicianId: req.user!.id,
      lubricationDate,
      quantityUsedL: data.quantityUsedL ?? null,
      oilTypeUsedId: data.oilTypeUsedId ?? null,
      runningHours: data.runningHours ?? null,
      photoUrls: JSON.stringify(data.photoUrls ?? []),
      remarks: data.remarks ?? null,
      status: "PENDING_APPROVAL",
      submittedAt: new Date(),
    },
  });

  await notify({
    typeName: "Pending Approval",
    organizationId,
    message: `${req.user!.name} submitted a lubrication record for ${lp.lpIdCode} — awaiting approval.`,
    relatedEntityType: "LubricationRecord",
    relatedEntityId: record.id,
  });

  // Quantity deviation check (Section 13 M04 — notification only, not auto-action)
  if (data.quantityUsedL != null && lp.standardQuantityL) {
    const thresholdPct = parseFloat(await getSetting("deviation.quantity_threshold_pct", "20"));
    const deviationPct = Math.abs((data.quantityUsedL - lp.standardQuantityL) / lp.standardQuantityL) * 100;
    if (deviationPct > thresholdPct) {
      await notify({
        typeName: "Quantity Deviation",
        organizationId,
        message: `${lp.lpIdCode}: submitted quantity ${data.quantityUsedL}L deviates ${deviationPct.toFixed(0)}% from standard ${lp.standardQuantityL}L.`,
        relatedEntityType: "LubricationRecord",
        relatedEntityId: record.id,
      });
    }
  }

  // Oil type changed check
  if (data.oilTypeUsedId && lp.lubricantTypeId && data.oilTypeUsedId !== lp.lubricantTypeId) {
    await notify({
      typeName: "Oil Type Changed",
      organizationId,
      message: `${lp.lpIdCode}: oil type used differs from the standard lubricant type on file.`,
      relatedEntityType: "LubricationRecord",
      relatedEntityId: record.id,
    });
  }

  res.status(201).json({ record });
});

// GET /api/lubrication-records/pending — Section 12.5 Pending Approvals
router.get("/pending", requireScreen("pending_approvals"), async (req, res) => {
  const user = req.user!;
  const where: any = { status: "PENDING_APPROVAL" };
  if (user.dataScope !== "ALL_ORGS") {
    where.lp = { equipment: { area: { organizationId: user.organizationId } } };
  }
  const records = await prisma.lubricationRecord.findMany({
    where,
    include: { lp: { include: { equipment: { include: { area: { include: { organization: true } } } } } }, technician: true, oilTypeUsed: true },
    orderBy: { submittedAt: "asc" },
  });
  res.json({
    records: records.map((r) => ({
      id: r.id,
      lpIdCode: r.lp.lpIdCode,
      equipment: r.lp.equipment.assetName,
      contractor: r.lp.equipment.area?.organization?.name ?? null,
      technician: r.technician?.name ?? null,
      lubricationDate: r.lubricationDate,
      quantityUsedL: r.quantityUsedL,
      oilType: r.oilTypeUsed?.name ?? null,
      remarks: r.remarks,
      submittedAt: r.submittedAt,
    })),
  });
});

// PATCH /api/lubrication-records/:id/approve — Engineer sole authority (Section 5)
router.patch("/:id/approve", requireCapability("approve"), async (req, res) => {
  const record = await prisma.lubricationRecord.findUnique({
    where: { id: req.params.id },
    include: { lp: { include: { equipment: { include: { area: true } } } } },
  });
  if (!record) return res.status(404).json({ error: "Record not found" });
  if (record.status !== "PENDING_APPROVAL") return res.status(400).json({ error: "Record is not pending approval" });

  const orgId = record.lp.equipment.area?.organizationId ?? null;
  if (req.user!.dataScope !== "ALL_ORGS" && orgId !== req.user!.organizationId) {
    return res.status(403).json({ error: "Not authorized for this organization's data" });
  }

  await prisma.lubricationRecord.update({
    where: { id: record.id },
    data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date() },
  });

  if (!record.lp.lastChangeDateCache || record.lubricationDate > record.lp.lastChangeDateCache) {
    await prisma.lubricationPoint.update({
      where: { id: record.lpId },
      data: { lastChangeDateCache: record.lubricationDate },
    });
  }

  res.json({ success: true });
});

const rejectSchema = z.object({ reason: z.string().min(1, "A rejection reason is required") });

// PATCH /api/lubrication-records/:id/reject
router.patch("/:id/reject", requireCapability("reject"), async (req, res) => {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const record = await prisma.lubricationRecord.findUnique({
    where: { id: req.params.id },
    include: { lp: { include: { equipment: { include: { area: true } } } } },
  });
  if (!record) return res.status(404).json({ error: "Record not found" });
  if (record.status !== "PENDING_APPROVAL") return res.status(400).json({ error: "Record is not pending approval" });

  const orgId = record.lp.equipment.area?.organizationId ?? null;
  if (req.user!.dataScope !== "ALL_ORGS" && orgId !== req.user!.organizationId) {
    return res.status(403).json({ error: "Not authorized for this organization's data" });
  }

  await prisma.lubricationRecord.update({
    where: { id: record.id },
    data: { status: "REJECTED", rejectedReason: parsed.data.reason, rejectedAt: new Date(), approvedById: req.user!.id },
  });

  if (record.technicianId) {
    await notify({
      typeName: "Rejected Record",
      organizationId: orgId,
      message: `Your submission for ${record.lp.lpIdCode} was rejected: ${parsed.data.reason}`,
      relatedEntityType: "LubricationRecord",
      relatedEntityId: record.id,
      extraUserIds: [record.technicianId],
    });

    // Repeated rejection — auto-creates an Action Plan past a configurable threshold (Section 10)
    const threshold = parseInt(await getSetting("repeated_rejection.threshold", "3"), 10);
    const rejectionCount = await prisma.lubricationRecord.count({
      where: { technicianId: record.technicianId, status: "REJECTED" },
    });
    if (rejectionCount >= threshold) {
      const actionType = await prisma.actionType.findUnique({ where: { name: "Repeated Rejection" } });
      const engineer = orgId
        ? await prisma.user.findFirst({ where: { organizationId: orgId, title: { name: { contains: "Engineer" } } } })
        : null;
      if (actionType) {
        await prisma.actionPlan.create({
          data: {
            actionTypeId: actionType.id,
            equipmentId: record.lp.equipmentId,
            lpIds: JSON.stringify([record.lpId]),
            description: `${rejectionCount} rejected submissions for this technician — review training/process.`,
            priority: actionType.defaultPriority,
            ownerId: engineer?.id,
            status: "OPEN",
            createdById: req.user!.id,
          },
        });
      }
    }
  }

  res.json({ success: true });
});

export default router;
