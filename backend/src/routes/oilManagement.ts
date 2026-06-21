import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireScreen, requireCapability } from "../middleware/permissions";
import { computeLubricationStatus } from "../lib/dueDate";
import { notify } from "../lib/notify";

const router = Router();
router.use(authenticate, requireScreen("oil_management_center"));

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

// GET /api/oil-management/consumption?from=&to=&groupBy=area|equipment|lubricant
// Planned = standardQuantityL x expected occurrences of that point's frequency within the
// date range (only meaningful for CALENDAR points, which carry a fixed interval).
// Actual = sum of quantityUsedL on APPROVED records within the date range, all frequency types.
router.get("/consumption", async (req, res) => {
  const user = req.user!;
  const { from, to, groupBy = "lubricant", contractor } = req.query as Record<string, string>;
  const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
  const toDate = to ? new Date(to) : new Date();
  const rangeDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000));

  const orgFilter =
    user.dataScope === "ALL_ORGS"
      ? contractor
        ? { area: { organizationId: contractor } }
        : {}
      : { area: { organizationId: user.organizationId ?? "__none__" } };

  const points = await prisma.lubricationPoint.findMany({
    where: { equipment: orgFilter },
    include: { equipment: { include: { area: true } }, lubricantType: true },
  });

  const records = await prisma.lubricationRecord.findMany({
    where: {
      status: "APPROVED",
      lubricationDate: { gte: fromDate, lte: toDate },
      lp: { equipment: orgFilter },
    },
    include: { lp: { include: { equipment: { include: { area: true } }, lubricantType: true } } },
  });

  const groupKey = (lubricantTypeName: string | null, areaName: string | null, equipmentName: string | null) => {
    if (groupBy === "area") return areaName ?? "Unassigned";
    if (groupBy === "equipment") return equipmentName ?? "Unknown";
    return lubricantTypeName ?? "Unspecified";
  };

  const buckets: Record<string, { planned: number; actual: number }> = {};

  for (const p of points) {
    if (p.frequencyType !== "CALENDAR" || !p.frequencyIntervalDays || !p.standardQuantityL) continue;
    const occurrences = rangeDays / p.frequencyIntervalDays;
    const key = groupKey(p.lubricantType?.name ?? null, p.equipment.area?.name ?? null, p.equipment.assetName);
    buckets[key] = buckets[key] || { planned: 0, actual: 0 };
    buckets[key].planned += p.standardQuantityL * occurrences;
  }

  for (const r of records) {
    if (!r.quantityUsedL) continue;
    const key = groupKey(r.lp.lubricantType?.name ?? null, r.lp.equipment.area?.name ?? null, r.lp.equipment.assetName);
    buckets[key] = buckets[key] || { planned: 0, actual: 0 };
    buckets[key].actual += r.quantityUsedL;
  }

  res.json({
    from: fromDate, to: toDate, groupBy,
    rows: Object.entries(buckets).map(([key, v]) => ({
      key,
      plannedL: Math.round(v.planned * 10) / 10,
      actualL: Math.round(v.actual * 10) / 10,
      varianceL: Math.round((v.actual - v.planned) * 10) / 10,
    })),
  });
});

// GET /api/oil-management/forecast — next 30 days, calendar points only, grouped by lubricant type (Section 11.2)
router.get("/forecast", async (req, res) => {
  const user = req.user!;
  const organizationId = user.dataScope === "ALL_ORGS" ? (req.query.organizationId as string) : user.organizationId;
  if (!organizationId) return res.status(400).json({ error: "organizationId is required" });

  const points = await prisma.lubricationPoint.findMany({
    where: { frequencyType: "CALENDAR", equipment: { area: { organizationId } } },
    include: { lubricantType: true },
  });

  const buckets: Record<string, number> = {};
  for (const p of points) {
    const { bucket } = computeLubricationStatus(lpToStatusInput(p));
    if (bucket === "OVERDUE" || bucket === "DUE_TODAY" || bucket === "DUE_THIS_WEEK" || bucket === "DUE_THIS_MONTH") {
      const key = p.lubricantType?.name ?? "Unspecified";
      buckets[key] = (buckets[key] ?? 0) + (p.standardQuantityL ?? 0);
    }
  }

  const forecast = Object.entries(buckets).map(([lubricantType, quantityL]) => ({ lubricantType, quantityL: Math.round(quantityL * 10) / 10 }));

  await notify({
    typeName: "30-Day Oil Need Forecast",
    organizationId,
    message: `30-day oil forecast generated: ${forecast.length} lubricant type(s) needed for upcoming due/overdue points.`,
  });

  res.json({ forecast });
});

// GET /api/oil-management/purchase-log
router.get("/purchase-log", async (req, res) => {
  const user = req.user!;
  const where = user.dataScope === "ALL_ORGS" ? {} : { organizationId: user.organizationId ?? "__none__" };
  const logs = await prisma.oilPurchaseLog.findMany({
    where,
    include: { lubricantType: true, organization: true, loggedBy: true },
    orderBy: { purchaseDate: "desc" },
  });
  res.json({
    purchases: logs.map((l) => ({
      id: l.id,
      organization: l.organization.name,
      lubricantType: l.lubricantType.name,
      quantityL: l.quantityL,
      purchaseDate: l.purchaseDate,
      loggedBy: l.loggedBy?.name ?? null,
    })),
  });
});

const createPurchaseSchema = z.object({
  lubricantTypeId: z.string(),
  quantityL: z.number().positive(),
  purchaseDate: z.string(),
});

// POST /api/oil-management/purchase-log — contractor logs actual purchases (Section 11.3 procurement accountability loop)
router.post("/purchase-log", requireCapability("managePurchaseLog"), async (req, res) => {
  const parsed = createPurchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!req.user!.organizationId) return res.status(400).json({ error: "Your account has no organization assigned" });

  const log = await prisma.oilPurchaseLog.create({
    data: {
      organizationId: req.user!.organizationId,
      lubricantTypeId: parsed.data.lubricantTypeId,
      quantityL: parsed.data.quantityL,
      purchaseDate: new Date(parsed.data.purchaseDate),
      loggedById: req.user!.id,
    },
  });
  res.status(201).json({ purchase: log });
});

export default router;
