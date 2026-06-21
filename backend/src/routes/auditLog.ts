import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET /api/audit-log
// Super Admin + ACC Manager (viewAuditLog capability) see everything.
// Contractor users see only entries marked visible to their own org (Section 9 transparency rule).
router.get("/", async (req, res) => {
  const user = req.user!;
  const where: any = {};
  if (!user.capabilities.viewAuditLog) {
    where.visibleToOrgId = user.organizationId;
  }

  const entries = await prisma.auditLog.findMany({
    where,
    include: { actor: true },
    orderBy: { timestamp: "desc" },
    take: 500,
  });

  res.json({
    entries: entries.map((e) => ({
      id: e.id,
      actor: e.actor.name,
      actionCategory: e.actionCategory,
      entityType: e.entityType,
      entityId: e.entityId,
      before: e.beforeValue,
      after: e.afterValue,
      reason: e.reason,
      timestamp: e.timestamp,
    })),
  });
});

export default router;
