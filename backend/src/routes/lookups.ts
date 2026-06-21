import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

router.get("/organizations", async (req, res) => {
  const orgs = await prisma.organization.findMany({ orderBy: { name: "asc" } });
  res.json({ organizations: orgs });
});

router.get("/areas", async (req, res) => {
  const user = req.user!;
  const where = user.dataScope === "ALL_ORGS" ? {} : { organizationId: user.organizationId ?? "__none__" };
  const areas = await prisma.area.findMany({ where, include: { organization: true }, orderBy: { locnCode: "asc" } });
  res.json({ areas: areas.map((a) => ({ id: a.id, name: a.name, locnCode: a.locnCode, organization: a.organization.name })) });
});

router.get("/equipment", async (req, res) => {
  const user = req.user!;
  const where = user.dataScope === "ALL_ORGS" ? {} : { area: { organizationId: user.organizationId ?? "__none__" } };
  const equipment = await prisma.equipment.findMany({ where, include: { area: true }, orderBy: { equipmentIdCode: "asc" } });
  res.json({
    equipment: equipment.map((e) => ({ id: e.id, code: e.equipmentIdCode, name: e.assetName, area: e.area?.name ?? null })),
  });
});

router.get("/lubricant-types", async (req, res) => {
  const types = await prisma.lubricantType.findMany({ orderBy: { name: "asc" } });
  res.json({ lubricantTypes: types });
});

// GET /api/lookups/technicians — for the route-assignment picker. Deliberately NOT gated behind
// the Settings screen: an Engineer with manageRoutes capability needs this without full user-admin access.
router.get("/technicians", async (req, res) => {
  const user = req.user!;
  const where: any = { title: { name: { contains: "Technician" } } };
  if (user.dataScope !== "ALL_ORGS") where.organizationId = user.organizationId ?? "__none__";
  const technicians = await prisma.user.findMany({ where, orderBy: { name: "asc" } });
  res.json({ technicians: technicians.map((t) => ({ id: t.id, name: t.name })) });
});

export default router;
