import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireCapability, requireScreen } from "../middleware/permissions";

const router = Router();
router.use(authenticate, requireScreen("settings"));

// GET /api/users — Super Admin sees all, ACC Manager sees own team, contractor Manager sees own team
router.get("/", async (req, res) => {
  const user = req.user!;
  const where = user.dataScope === "ALL_ORGS" && user.titleName === "Super Admin" ? {} : { organizationId: user.organizationId };
  const users = await prisma.user.findMany({ where, include: { title: true, organization: true }, orderBy: { name: "asc" } });
  res.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      title: u.title?.name ?? null,
      organization: u.organization?.name ?? null,
      active: u.active,
      mustChangePassword: u.mustChangePassword,
    })),
  });
});

// GET /api/users/titles — for the "assign title" dropdown when creating a user
router.get("/titles", async (req, res) => {
  const user = req.user!;
  const where = user.dataScope === "ALL_ORGS" && user.titleName === "Super Admin" ? {} : { organizationId: user.organizationId };
  const titles = await prisma.title.findMany({ where, orderBy: { name: "asc" } });
  res.json({ titles });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  titleId: z.string(),
  organizationId: z.string().nullable(),
});

// POST /api/users — Manager creates own team; Super Admin creates anyone (Section 4.2 hierarchy)
router.post("/", requireCapability("manageUsers"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  if (req.user!.titleName !== "Super Admin" && data.organizationId !== req.user!.organizationId) {
    return res.status(403).json({ error: "You can only create users within your own organization" });
  }

  const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
      titleId: data.titleId,
      organizationId: data.organizationId,
      mustChangePassword: true,
    },
  });

  // Returned once so the creator can share it — never retrievable again
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email }, temporaryPassword: tempPassword });
});

const deactivateSchema = z.object({ active: z.boolean() });

// PATCH /api/users/:id/active
router.patch("/:id/active", requireCapability("manageUsers"), async (req, res) => {
  const parsed = deactivateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "User not found" });
  if (req.user!.titleName !== "Super Admin" && target.organizationId !== req.user!.organizationId) {
    return res.status(403).json({ error: "Not authorized for this organization's users" });
  }

  await prisma.user.update({ where: { id: target.id }, data: { active: parsed.data.active } });
  res.json({ success: true });
});

export default router;
