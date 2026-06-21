import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, authenticate } from "../middleware/auth";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  isMobile: z.boolean().optional(),
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
  const { email, password, isMobile } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { title: true, organization: true },
  });
  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken(user.id, !!isMobile);
  res.json({
    token,
    mustChangePassword: user.mustChangePassword,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      title: user.title?.name ?? null,
      organization: user.organization?.name ?? null,
      languagePref: user.languagePref,
      themePref: user.themePref,
    },
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

// POST /api/auth/change-password
router.post("/change-password", authenticate, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  const newHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, mustChangePassword: false },
  });
  res.json({ success: true });
});

// GET /api/auth/me
router.get("/me", authenticate, async (req, res) => {
  res.json({ user: req.user });
});

export default router;
