import { prisma } from "../lib/prisma";
import { computeLubricationStatus, computeOilAnalysisStatus, FrequencyType } from "../lib/dueDate";
import { notify } from "../lib/notify";

function lpToStatusInput(p: {
  id: string;
  frequencyType: FrequencyType;
  frequencyIntervalDays: number | null;
  lastChangeDateCache: Date | null;
  oaRequired: boolean;
  oaIntervalDays: number | null;
  oaLastSampleDate: Date | null;
}) {
  return p;
}

/**
 * Scans every lubrication point for calendar lubrication or oil-analysis schedules
 * that have newly crossed into OVERDUE, and auto-creates the corresponding "auto"
 * Action Plan (Section 10) + notification — exactly once per occurrence, skipped if
 * an open one already exists for that point so re-runs don't spam duplicates.
 *
 * Due-date status itself is always computed live from dueDate.ts (never cached), so
 * this job's only job is the one-time side effect of flagging the transition — it is
 * NOT the source of truth for status anywhere in the UI.
 *
 * This is also the real source of the Lubrication Timeline's (Section 12.6) "Overdue
 * flagged" / "Oil sample overdue flagged" events: those are just this job's
 * ActionPlan.createdAt timestamps, queried back out in routes/timeline.ts.
 */
export async function checkOverdueAndCreateActions() {
  const [points, overdueActionType, oilSampleActionType] = await Promise.all([
    prisma.lubricationPoint.findMany({ include: { equipment: { include: { area: true } } } }),
    prisma.actionType.findUnique({ where: { name: "Overdue Lubrication" } }),
    prisma.actionType.findUnique({ where: { name: "Oil Sample Overdue" } }),
  ]);

  const relevantTypeIds = [overdueActionType?.id, oilSampleActionType?.id].filter(Boolean) as string[];
  const openAutoPlans = relevantTypeIds.length
    ? await prisma.actionPlan.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, actionTypeId: { in: relevantTypeIds } } })
    : [];

  const alreadyFlagged = new Set<string>();
  for (const plan of openAutoPlans) {
    const lpIds = JSON.parse(plan.lpIds as unknown as string) as string[];
    for (const id of lpIds) alreadyFlagged.add(`${plan.actionTypeId}:${id}`);
  }

  let actionsCreated = 0;

  for (const p of points) {
    const calStatus = computeLubricationStatus(lpToStatusInput(p));
    if (calStatus.bucket === "OVERDUE" && overdueActionType && !alreadyFlagged.has(`${overdueActionType.id}:${p.id}`)) {
      await prisma.actionPlan.create({
        data: {
          actionTypeId: overdueActionType.id,
          equipmentId: p.equipmentId,
          lpIds: JSON.stringify([p.id]),
          description: `${p.lpIdCode} is overdue for lubrication (${Math.abs(calStatus.daysToDue ?? 0)} day(s) past due).`,
          priority: "HIGH",
          status: "OPEN",
        },
      });
      actionsCreated++;
      await notify({
        typeName: "Due/Overdue Lubrication",
        organizationId: p.equipment.area?.organizationId ?? null,
        message: `${p.lpIdCode} (${p.equipment.assetName}) is now overdue for lubrication.`,
        relatedEntityType: "LubricationPoint",
        relatedEntityId: p.id,
      });
    }

    if (p.oaRequired && oilSampleActionType) {
      const oaStatus = computeOilAnalysisStatus(lpToStatusInput(p));
      if (oaStatus.bucket === "OVERDUE" && !alreadyFlagged.has(`${oilSampleActionType.id}:${p.id}`)) {
        await prisma.actionPlan.create({
          data: {
            actionTypeId: oilSampleActionType.id,
            equipmentId: p.equipmentId,
            lpIds: JSON.stringify([p.id]),
            description: `${p.lpIdCode} is overdue for an oil sample.`,
            priority: "HIGH",
            status: "OPEN",
          },
        });
        actionsCreated++;
        await notify({
          typeName: "Oil Sample Required",
          organizationId: p.equipment.area?.organizationId ?? null,
          message: `${p.lpIdCode} (${p.equipment.assetName}) is overdue for an oil sample.`,
          relatedEntityType: "LubricationPoint",
          relatedEntityId: p.id,
        });
      }
    }
  }

  return { pointsScanned: points.length, actionsCreated };
}
