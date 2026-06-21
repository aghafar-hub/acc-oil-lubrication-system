import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireScreen } from "../middleware/permissions";

const router = Router();
router.use(authenticate, requireScreen("lubrication_timeline"));

interface TimelineEvent {
  id: string;
  timestamp: Date;
  eventType: string;
  lpId: string | null;
  lpIdCode: string | null;
  equipmentId: string | null;
  equipmentName: string | null;
  areaName: string | null;
  contractor: string | null;
  actor: string | null;
  actorId: string | null;
  detail: string;
}

// GET /api/timeline?area=&equipment=&eventType=&from=&to=&technician=&contractor=
// Access: RHI/ASEC see only their own org's events. ACC/Super Admin see everything,
// with an optional contractor filter (Section 12.6).
router.get("/", async (req, res) => {
  const user = req.user!;
  const { area, equipment, eventType, from, to, technician, contractor } = req.query as Record<string, string>;

  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
  const toDate = to ? new Date(to + "T23:59:59") : new Date();
  const orgId = user.dataScope === "ALL_ORGS" ? contractor || undefined : user.organizationId ?? "__none__";

  const equipmentWhere: any = {};
  if (orgId) equipmentWhere.area = { organizationId: orgId };
  if (equipment) equipmentWhere.id = equipment;

  const events: TimelineEvent[] = [];
  const wantsType = (t: string) => !eventType || eventType === t;

  // 1 & 2 & 3 — Lubrication completed / Approved / Rejected
  if (wantsType("LUBRICATION_COMPLETED") || wantsType("APPROVED") || wantsType("REJECTED")) {
    const records = await prisma.lubricationRecord.findMany({
      where: {
        lp: { equipment: equipmentWhere },
        OR: [
          { submittedAt: { gte: fromDate, lte: toDate } },
          { approvedAt: { gte: fromDate, lte: toDate } },
          { rejectedAt: { gte: fromDate, lte: toDate } },
        ],
      },
      include: { lp: { include: { equipment: { include: { area: { include: { organization: true } } } } } }, technician: true, approvedBy: true },
    });
    for (const r of records) {
      const base = {
        lpId: r.lpId, lpIdCode: r.lp.lpIdCode, equipmentId: r.lp.equipmentId, equipmentName: r.lp.equipment.assetName,
        areaName: r.lp.equipment.area?.name ?? null, contractor: r.lp.equipment.area?.organization?.name ?? null,
      };
      if (wantsType("LUBRICATION_COMPLETED") && r.submittedAt && r.submittedAt >= fromDate && r.submittedAt <= toDate && (!technician || r.technicianId === technician)) {
        events.push({ ...base, id: `lr-sub-${r.id}`, timestamp: r.submittedAt, eventType: "LUBRICATION_COMPLETED", actor: r.technician?.name ?? null, actorId: r.technicianId, detail: `Lubrication submitted${r.quantityUsedL ? ` (${r.quantityUsedL} L)` : ""}` });
      }
      if (wantsType("APPROVED") && r.status === "APPROVED" && r.approvedAt && r.approvedAt >= fromDate && r.approvedAt <= toDate && (!technician || r.approvedById === technician)) {
        events.push({ ...base, id: `lr-app-${r.id}`, timestamp: r.approvedAt, eventType: "APPROVED", actor: r.approvedBy?.name ?? null, actorId: r.approvedById, detail: "Submission approved" });
      }
      if (wantsType("REJECTED") && r.status === "REJECTED" && r.rejectedAt && r.rejectedAt >= fromDate && r.rejectedAt <= toDate && (!technician || r.approvedById === technician)) {
        events.push({ ...base, id: `lr-rej-${r.id}`, timestamp: r.rejectedAt, eventType: "REJECTED", actor: r.approvedBy?.name ?? null, actorId: r.approvedById, detail: r.rejectedReason ?? "Submission rejected" });
      }
    }
  }

  // 4 & 6 — Overdue flagged / Oil sample overdue flagged (auto Action Plans — see jobs/checkOverdue.ts)
  // 7 & 8 — Action created (manual) / Action closed (any)
  if (wantsType("OVERDUE_FLAGGED") || wantsType("OIL_SAMPLE_OVERDUE_FLAGGED") || wantsType("ACTION_CREATED") || wantsType("ACTION_CLOSED")) {
    const plans = await prisma.actionPlan.findMany({
      where: {
        equipment: equipmentWhere,
        OR: [{ createdAt: { gte: fromDate, lte: toDate } }, { closedDate: { gte: fromDate, lte: toDate } }],
      },
      include: { actionType: true, equipment: { include: { area: { include: { organization: true } } } }, createdBy: true },
    });
    for (const p of plans) {
      const base = {
        lpId: null, lpIdCode: null, equipmentId: p.equipmentId, equipmentName: p.equipment.assetName,
        areaName: p.equipment.area?.name ?? null, contractor: p.equipment.area?.organization?.name ?? null,
      };
      const isOverdueType = p.actionType.name === "Overdue Lubrication";
      const isOilSampleType = p.actionType.name === "Oil Sample Overdue";
      if (p.createdAt >= fromDate && p.createdAt <= toDate) {
        if (wantsType("OVERDUE_FLAGGED") && isOverdueType) {
          events.push({ ...base, id: `ap-flag-${p.id}`, timestamp: p.createdAt, eventType: "OVERDUE_FLAGGED", actor: "System", actorId: null, detail: p.description });
        }
        if (wantsType("OIL_SAMPLE_OVERDUE_FLAGGED") && isOilSampleType) {
          events.push({ ...base, id: `ap-oaflag-${p.id}`, timestamp: p.createdAt, eventType: "OIL_SAMPLE_OVERDUE_FLAGGED", actor: "System", actorId: null, detail: p.description });
        }
        if (wantsType("ACTION_CREATED") && p.actionType.autoOrManual === "manual" && (!technician || p.createdById === technician)) {
          events.push({ ...base, id: `ap-create-${p.id}`, timestamp: p.createdAt, eventType: "ACTION_CREATED", actor: p.createdBy?.name ?? null, actorId: p.createdById, detail: `${p.actionType.name}: ${p.description}` });
        }
      }
      if (wantsType("ACTION_CLOSED") && p.closedDate && p.closedDate >= fromDate && p.closedDate <= toDate) {
        events.push({ ...base, id: `ap-close-${p.id}`, timestamp: p.closedDate, eventType: "ACTION_CLOSED", actor: null, actorId: null, detail: p.closureComments ?? `${p.actionType.name} closed` });
      }
    }
  }

  // 5 — Oil sample completed
  if (wantsType("OIL_SAMPLE_COMPLETED")) {
    const samples = await prisma.oilSample.findMany({
      where: { uploadedAt: { gte: fromDate, lte: toDate }, lp: { equipment: equipmentWhere } },
      include: { lp: { include: { equipment: { include: { area: { include: { organization: true } } } } } }, uploadedBy: true },
    });
    for (const s of samples) {
      if (technician && s.uploadedById !== technician) continue;
      events.push({
        id: `os-${s.id}`, timestamp: s.uploadedAt, eventType: "OIL_SAMPLE_COMPLETED",
        lpId: s.lpId, lpIdCode: s.lp.lpIdCode, equipmentId: s.lp.equipmentId, equipmentName: s.lp.equipment.assetName,
        areaName: s.lp.equipment.area?.name ?? null, contractor: s.lp.equipment.area?.organization?.name ?? null,
        actor: s.uploadedBy?.name ?? null, actorId: s.uploadedById, detail: `Oil sample recorded — ${s.reportStatus}`,
      });
    }
  }

  // 9 — ACC data edit (Section 12.6 distinguishes this from the narrower Settings Audit Log)
  if (wantsType("ACC_DATA_EDIT")) {
    const auditWhere: any = { actionCategory: "DATA_EDIT", entityType: "LubricationPoint", timestamp: { gte: fromDate, lte: toDate } };
    if (orgId) auditWhere.visibleToOrgId = orgId;
    const edits = await prisma.auditLog.findMany({ where: auditWhere, include: { actor: true } });
    const lpIds = edits.map((e) => e.entityId);
    const lps: any[] = await prisma.lubricationPoint.findMany({ where: { id: { in: lpIds } }, include: { equipment: { include: { area: { include: { organization: true } } } } } });
    const lpById = new Map(lps.map((lp) => [lp.id, lp]));
    for (const e of edits) {
      if (technician && e.actorId !== technician) continue;
      const lp = lpById.get(e.entityId);
      if (equipment && lp?.equipmentId !== equipment) continue;
      events.push({
        id: `audit-${e.id}`, timestamp: e.timestamp, eventType: "ACC_DATA_EDIT",
        lpId: e.entityId, lpIdCode: lp?.lpIdCode ?? null, equipmentId: lp?.equipmentId ?? null, equipmentName: lp?.equipment.assetName ?? null,
        areaName: lp?.equipment.area?.name ?? null, contractor: lp?.equipment.area?.organization?.name ?? null,
        actor: e.actor.name, actorId: e.actorId, detail: e.reason ?? "Data corrected",
      });
    }
  }

  // Area filter applied uniformly at the end, since not every source resolves it the same way
  const filtered = area ? events.filter((e) => e.areaName === area) : events;
  filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  res.json({ events: filtered.slice(0, 300) });
});

export default router;
