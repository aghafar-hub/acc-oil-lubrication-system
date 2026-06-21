import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireCapability } from "../middleware/permissions";

const router = Router();
router.use(authenticate);

// GET /api/settings — general key/value settings
router.get("/", async (req, res) => {
  const settings = await prisma.setting.findMany();
  res.json({ settings });
});

const updateSettingSchema = z.object({ value: z.string() });

// PATCH /api/settings/:key — Super Admin only by default (Section 12.12 "General: Super Admin")
router.patch("/:key", requireCapability("manageSettings"), async (req, res) => {
  const parsed = updateSettingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const updated = await prisma.setting.update({ where: { key: req.params.key }, data: { value: parsed.data.value } });
  await prisma.auditLog.create({
    data: {
      actorId: req.user!.id,
      actionCategory: "PERMISSION_CHANGE",
      entityType: "Setting",
      entityId: updated.key,
      afterValue: JSON.stringify(updated),
      reason: "Settings update",
    },
  });
  res.json({ setting: updated });
});

// GET /api/settings/permission-templates — the configurable screen/capability matrix per title (Section 4.3)
router.get("/permission-templates", requireCapability("managePermissions"), async (req, res) => {
  const templates = await prisma.permissionTemplate.findMany({ include: { titles: true } });
  res.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      dataScope: t.dataScope,
      screenAccess: JSON.parse(t.screenAccess as unknown as string),
      capabilities: JSON.parse(t.capabilities as unknown as string),
      titles: t.titles.map((ti) => ti.name),
    })),
  });
});

const updateTemplateSchema = z.object({
  screenAccess: z.record(z.boolean()).optional(),
  capabilities: z.record(z.boolean()).optional(),
  dataScope: z.enum(["OWN_ORG", "ALL_ORGS"]).optional(),
});

// PATCH /api/settings/permission-templates/:id — Super Admin edits one title's access without affecting any other title (Section 4.3)
router.patch("/permission-templates/:id", requireCapability("managePermissions"), async (req, res) => {
  const parsed = updateTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const before = await prisma.permissionTemplate.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Permission template not found" });

  const data: any = {};
  if (parsed.data.screenAccess) data.screenAccess = JSON.stringify(parsed.data.screenAccess);
  if (parsed.data.capabilities) data.capabilities = JSON.stringify(parsed.data.capabilities);
  if (parsed.data.dataScope) data.dataScope = parsed.data.dataScope;

  const after = await prisma.permissionTemplate.update({ where: { id: req.params.id }, data });

  await prisma.auditLog.create({
    data: {
      actorId: req.user!.id,
      actionCategory: "PERMISSION_CHANGE",
      entityType: "PermissionTemplate",
      entityId: before.id,
      beforeValue: JSON.stringify(before),
      afterValue: JSON.stringify(after),
      reason: `Permission template "${before.name}" updated`,
    },
  });

  res.json({ template: after });
});

// GET /api/settings/notification-routing
router.get("/notification-routing", requireCapability("manageNotificationRouting"), async (req, res) => {
  const types = await prisma.notificationType.findMany({ include: { routingRules: true } });
  res.json({
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      defaultPriority: t.defaultPriority,
      rule: t.routingRules[0]
        ? {
            id: t.routingRules[0].id,
            recipientTokens: JSON.parse(t.routingRules[0].recipientTitleNames as unknown as string),
            channels: JSON.parse(t.routingRules[0].channels as unknown as string),
          }
        : null,
    })),
  });
});

const updateRoutingSchema = z.object({
  recipientTokens: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
});

// PATCH /api/settings/notification-routing/:ruleId
router.patch("/notification-routing/:ruleId", requireCapability("manageNotificationRouting"), async (req, res) => {
  const parsed = updateRoutingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const data: any = {};
  if (parsed.data.recipientTokens) data.recipientTitleNames = JSON.stringify(parsed.data.recipientTokens);
  if (parsed.data.channels) data.channels = JSON.stringify(parsed.data.channels);

  const updated = await prisma.notificationRoutingRule.update({ where: { id: req.params.ruleId }, data });

  await prisma.auditLog.create({
    data: {
      actorId: req.user!.id,
      actionCategory: "NOTIFICATION_RULE_CHANGE",
      entityType: "NotificationRoutingRule",
      entityId: updated.id,
      afterValue: JSON.stringify(updated),
      reason: "Notification routing rule updated",
    },
  });

  res.json({ rule: updated });
});

export default router;
