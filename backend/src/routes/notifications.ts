import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET /api/notifications?status=UNREAD|READ|ARCHIVED
router.get("/", async (req, res) => {
  const { status, priority } = req.query as Record<string, string>;
  const where: any = { userId: req.user!.id };
  if (status) where.status = status;
  if (priority) where.priority = priority;

  const notifications = await prisma.notification.findMany({
    where,
    include: { type: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const unreadCount = await prisma.notification.count({ where: { userId: req.user!.id, status: "UNREAD" } });

  res.json({
    unreadCount,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type.name,
      message: n.message,
      priority: n.priority,
      status: n.status,
      relatedEntityType: n.relatedEntityType,
      relatedEntityId: n.relatedEntityId,
      createdAt: n.createdAt,
    })),
  });
});

// PATCH /api/notifications/:id/read
router.patch("/:id/read", async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!n || n.userId !== req.user!.id) return res.status(404).json({ error: "Notification not found" });
  await prisma.notification.update({ where: { id: n.id }, data: { status: "READ" } });
  res.json({ success: true });
});

// PATCH /api/notifications/:id/archive
router.patch("/:id/archive", async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!n || n.userId !== req.user!.id) return res.status(404).json({ error: "Notification not found" });
  await prisma.notification.update({ where: { id: n.id }, data: { status: "ARCHIVED" } });
  res.json({ success: true });
});

// PATCH /api/notifications/mark-all-read
router.patch("/mark-all-read", async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, status: "UNREAD" }, data: { status: "READ" } });
  res.json({ success: true });
});

export default router;
