import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireScreen, requireCapability } from "../middleware/permissions";
import { computeLubricationStatus, computeOilAnalysisStatus } from "../lib/dueDate";

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

// GET /api/lubrication-points  — Explorer (Section 12.2)
router.get("/", requireScreen("lubrication_explorer"), async (req, res) => {
  const user = req.user!;
  const { area, equipment, contractor, frequency, lubricant, status, search, page = "1", pageSize = "50" } = req.query as Record<string, string>;

  const where: any = {};
  if (user.dataScope !== "ALL_ORGS") {
    where.equipment = { area: { organizationId: user.organizationId } };
  } else if (contractor) {
    where.equipment = { ...(where.equipment ?? {}), area: { organizationId: contractor } };
  }
  if (area) where.equipment = { ...(where.equipment ?? {}), areaId: area };
  if (equipment) where.equipmentId = equipment;
  if (frequency) where.frequencyType = frequency;
  if (lubricant) where.lubricantTypeId = lubricant;
  if (search) {
    where.OR = [
      { lpIdCode: { contains: search } },
      { pointDescription: { contains: search } },
      { equipment: { equipmentIdCode: { contains: search } } },
      { equipment: { assetName: { contains: search } } },
    ];
  }

  const points = await prisma.lubricationPoint.findMany({
    where,
    include: { equipment: { include: { area: { include: { organization: true } } } }, lubricantType: true },
  });

  let rows = points.map((p) => {
    const lubStatus = computeLubricationStatus(lpToStatusInput(p));
    const oaStatus = p.oaRequired ? computeOilAnalysisStatus(lpToStatusInput(p)) : null;
    return {
      id: p.id,
      lpIdCode: p.lpIdCode,
      equipmentIdCode: p.equipment.equipmentIdCode,
      assetName: p.equipment.assetName,
      pointDescription: p.pointDescription,
      areaName: p.equipment.area?.name ?? null,
      contractor: p.equipment.area?.organization?.name ?? null,
      lubricantType: p.lubricantType?.name ?? null,
      standardQuantityL: p.standardQuantityL,
      frequencyLabel: p.frequencyLabel,
      frequencyType: p.frequencyType,
      lastChangeDate: p.lastChangeDateCache,
      nextDue: lubStatus.nextDue,
      status: lubStatus.bucket,
      oaStatus: oaStatus?.bucket ?? null,
    };
  });

  if (status) rows = rows.filter((r) => r.status === status);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const start = (pageNum - 1) * size;
  const paged = rows.slice(start, start + size);

  res.json({ total: rows.length, page: pageNum, pageSize: size, rows: paged });
});

// GET /api/lubrication-points/:id  — LP Details (Section 12.3)
router.get("/:id", requireScreen("lp_details"), async (req, res) => {
  const user = req.user!;
  const point = await prisma.lubricationPoint.findUnique({
    where: { id: req.params.id },
    include: {
      equipment: { include: { area: { include: { organization: true } } } },
      lubricantType: true,
      lubricationRecords: { orderBy: { lubricationDate: "desc" }, include: { technician: true, approvedBy: true, oilTypeUsed: true } },
      oilSamples: { orderBy: { sampledDate: "desc" } },
    },
  });
  if (!point) return res.status(404).json({ error: "Lubrication point not found" });

  if (user.dataScope !== "ALL_ORGS" && point.equipment.area?.organizationId !== user.organizationId) {
    return res.status(403).json({ error: "Not authorized for this organization's data" });
  }

  const actionPlans = await prisma.actionPlan.findMany({
    where: { equipmentId: point.equipmentId },
    include: { actionType: true, owner: true },
    orderBy: { createdAt: "desc" },
  });
  const relevantActionPlans = actionPlans.filter((a) => {
    const ids = JSON.parse(a.lpIds as unknown as string) as string[];
    return ids.length === 0 || ids.includes(point.id);
  });

  const lubStatus = computeLubricationStatus(lpToStatusInput(point));
  const oaStatus = point.oaRequired ? computeOilAnalysisStatus(lpToStatusInput(point)) : null;

  res.json({
    id: point.id,
    lpIdCode: point.lpIdCode,
    pointDescription: point.pointDescription,
    pointCode: point.pointCode,
    position: point.position,
    equipment: {
      id: point.equipment.id,
      code: point.equipment.equipmentIdCode,
      name: point.equipment.assetName,
      area: point.equipment.area?.name ?? null,
      contractor: point.equipment.area?.organization?.name ?? null,
      gearboxBrand: point.equipment.gearboxBrand,
      opTempC: point.equipment.opTempC,
      annualRhActual: point.equipment.annualRhActual,
    },
    lubricantType: point.lubricantType ? { name: point.lubricantType.name, brand: point.lubricantType.brand } : null,
    standardQuantityL: point.standardQuantityL,
    frequencyLabel: point.frequencyLabel,
    frequencyType: point.frequencyType,
    ohHoursReference: point.ohHoursReference,
    oaRequired: point.oaRequired,
    oaIntervalLabel: point.oaIntervalLabel,
    remarks: point.remarks,
    status: lubStatus.bucket,
    nextDue: lubStatus.nextDue,
    oaStatus: oaStatus?.bucket ?? null,
    history: point.lubricationRecords.map((r) => ({
      id: r.id,
      date: r.lubricationDate,
      technician: r.technician?.name ?? (r.isLegacyImport ? "Legacy import" : null),
      quantityUsedL: r.quantityUsedL,
      oilType: r.oilTypeUsed?.name ?? null,
      status: r.status,
      remarks: r.remarks,
      isLegacyImport: r.isLegacyImport,
      approvedBy: r.approvedBy?.name ?? null,
    })),
    oilSamples: point.oilSamples.map((s) => ({
      id: s.id,
      sampledDate: s.sampledDate,
      reportStatus: s.reportStatus,
      sampleIdLab: s.sampleIdLab,
    })),
    actionPlans: relevantActionPlans.map((a) => ({
      id: a.id,
      type: a.actionType.name,
      description: a.description,
      priority: a.priority,
      status: a.status,
      owner: a.owner?.name ?? null,
      dueDate: a.dueDate,
    })),
  });
});

const editSchema = z.object({
  standardQuantityL: z.number().nullable().optional(),
  lubricantTypeId: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  reason: z.string().min(1, "A reason is required for ACC corrections"),
});

// PATCH /api/lubrication-points/:id  — ACC correction (Section 5: edits logged, visible to contractor)
router.patch("/:id", requireCapability("editData"), async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { reason, ...changes } = parsed.data;

  const before = await prisma.lubricationPoint.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Lubrication point not found" });

  const updateData: any = {};
  for (const [k, v] of Object.entries(changes)) if (v !== undefined) updateData[k] = v;

  const after = await prisma.lubricationPoint.update({ where: { id: req.params.id }, data: updateData });

  const org = await prisma.equipment
    .findUnique({ where: { id: before.equipmentId }, include: { area: true } })
    .then((e) => e?.area?.organizationId ?? null);

  await prisma.auditLog.create({
    data: {
      actorId: req.user!.id,
      actionCategory: "DATA_EDIT",
      entityType: "LubricationPoint",
      entityId: before.id,
      beforeValue: JSON.stringify(before),
      afterValue: JSON.stringify(after),
      reason,
      visibleToOrgId: org,
    },
  });

  res.json({ success: true, lubricationPoint: after });
});

export default router;
