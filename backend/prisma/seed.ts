/**
 * Seeds the database with:
 *  - 3 organizations, 61 areas, 604 equipment, 22 lubricant types
 *  - 902 lubrication points (the full legacy point register)
 *  - 1,102 historical lubrication records reconstructed from the legacy
 *    Excel's change-date log (Section 14 — "real data on day one")
 *  - 9 titles + 9 permission templates (Section 4 configurable model)
 *  - 9 demo user accounts, one per title, for evaluating the role model
 *  - 7 action types, 13 notification types + their default routing rules
 *  - 8 default settings rows
 *
 * Run with: npm run db:seed (after `npx prisma generate` + `npx prisma db push`)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const seedDir = path.join(__dirname, "seed-data");
const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(seedDir, `${name}.json`), "utf-8"));

const DEMO_PASSWORD = "Demo@12345";

async function main() {
  console.log("Seeding ACC Oil Lubrication Management System...\n");

  // 1. Organizations -------------------------------------------------------
  const organizations = load("organizations");
  for (const o of organizations) {
    await prisma.organization.create({
      data: { id: o.id, name: o.name, type: o.type === "owner" ? "OWNER" : "CONTRACTOR" },
    });
  }
  console.log(`✓ ${organizations.length} organizations`);

  // 2. Areas ----------------------------------------------------------------
  const areas = load("areas");
  for (const a of areas) {
    await prisma.area.create({
      data: { id: a.id, locnCode: a.locn_code, name: a.name, organizationId: a.organization_id },
    });
  }
  console.log(`✓ ${areas.length} areas`);

  // 3. Equipment --------------------------------------------------------------
  const equipment = load("equipment");
  for (const e of equipment) {
    await prisma.equipment.create({
      data: {
        id: e.id,
        equipmentIdCode: e.equipment_id_code,
        assetName: e.asset_name || "Unnamed Equipment",
        areaId: e.area_id,
        gearboxBrand: e.gearbox_brand,
        opTempC: e.op_temp_c,
        annualRhActual: e.annual_rh_actual,
      },
    });
  }
  console.log(`✓ ${equipment.length} equipment`);

  // 4. Lubricant types --------------------------------------------------------
  const lubricantTypes = load("lubricant_types");
  for (const lt of lubricantTypes) {
    await prisma.lubricantType.create({
      data: { id: lt.id, name: lt.name, brand: lt.brand },
    });
  }
  console.log(`✓ ${lubricantTypes.length} lubricant types`);

  // 5. Permission templates ----------------------------------------------------
  const permissionTemplates = load("permission_templates");
  const templateIdByName: Record<string, string> = {};
  for (const t of permissionTemplates) {
    const created = await prisma.permissionTemplate.create({
      data: {
        name: t.name,
        screenAccess: JSON.stringify(t.screenAccess),
        dataScope: t.dataScope,
        capabilities: JSON.stringify(t.capabilities),
      },
    });
    templateIdByName[t.name] = created.id;
  }
  console.log(`✓ ${permissionTemplates.length} permission templates`);

  // 6. Titles ------------------------------------------------------------------
  const titles = load("titles");
  for (const t of titles) {
    await prisma.title.create({
      data: {
        id: t.id,
        name: t.name,
        organizationId: t.organizationId,
        permissionTemplateId: templateIdByName[t.permissionTemplateName],
      },
    });
  }
  console.log(`✓ ${titles.length} titles`);

  // 7. Demo users ----------------------------------------------------------------
  const demoUsers = load("demo_users");
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const u of demoUsers) {
    await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        passwordHash,
        titleId: u.titleId,
        organizationId: u.organizationId,
        mustChangePassword: true,
      },
    });
  }
  console.log(`✓ ${demoUsers.length} demo users (all password: ${DEMO_PASSWORD})`);

  // 8. Lubrication points -------------------------------------------------------
  const lubricationPoints = load("lubrication_points");
  const freqTypeMap: Record<string, string> = {
    calendar: "CALENDAR",
    oil_analysis: "OIL_ANALYSIS",
    as_needed: "AS_NEEDED",
  };
  for (const p of lubricationPoints) {
    await prisma.lubricationPoint.create({
      data: {
        id: p.id,
        lpIdCode: p.lp_id_code,
        equipmentId: p.equipment_id,
        pointDescription: p.point_description || "Lubrication point",
        pointCode: p.point_code,
        position: p.position,
        standardQuantityL: p.standard_quantity_l,
        lubricantTypeId: p.lubricant_type_id,
        frequencyType: freqTypeMap[p.frequency_type] || "AS_NEEDED",
        frequencyLabel: p.frequency_label,
        frequencyIntervalDays: p.frequency_interval_days,
        ohHoursReference: p.oh_hours_reference,
        oaRequired: !!p.oa_required,
        oaIntervalDays: p.oa_interval_days,
        oaIntervalLabel: p.oa_interval_label,
        oaLastSampleDate: p.oa_last_sample_date ? new Date(p.oa_last_sample_date) : null,
        remarks: p.remarks,
      },
    });
  }
  console.log(`✓ ${lubricationPoints.length} lubrication points`);

  // 9. Historical lubrication records (legacy import) -----------------------------
  const lubricationRecords = load("lubrication_records");
  const lastChangeByLp: Record<string, string> = {};
  for (const r of lubricationRecords) {
    await prisma.lubricationRecord.create({
      data: {
        id: r.id,
        lpId: r.lp_id,
        technicianId: null,
        lubricationDate: new Date(r.lubrication_date),
        quantityUsedL: r.quantity_used_l,
        oilTypeUsedId: r.oil_type_used_id,
        runningHours: r.running_hours,
        photoUrls: JSON.stringify(r.photo_urls || []),
        remarks: r.remarks,
        status: "APPROVED",
        submittedAt: new Date(r.submitted_at),
        approvedAt: new Date(r.approved_at),
        isLegacyImport: true,
      },
    });
    if (!lastChangeByLp[r.lp_id] || r.lubrication_date > lastChangeByLp[r.lp_id]) {
      lastChangeByLp[r.lp_id] = r.lubrication_date;
    }
  }
  console.log(`✓ ${lubricationRecords.length} historical lubrication records (legacy import)`);

  // Cache lastChangeDateCache on each LP from its newest approved record
  for (const [lpId, dateStr] of Object.entries(lastChangeByLp)) {
    await prisma.lubricationPoint.update({
      where: { id: lpId },
      data: { lastChangeDateCache: new Date(dateStr) },
    });
  }
  console.log(`✓ last-change-date cache populated for ${Object.keys(lastChangeByLp).length} points`);

  // 10. Action types -------------------------------------------------------------
  const actionTypes = load("action_types");
  for (const a of actionTypes) {
    await prisma.actionType.create({
      data: { name: a.name, autoOrManual: a.autoOrManual, defaultPriority: a.defaultPriority },
    });
  }
  console.log(`✓ ${actionTypes.length} action types`);

  // 11. Notification types + default routing rules --------------------------------
  const notificationTypes = load("notification_types");
  for (const n of notificationTypes) {
    const created = await prisma.notificationType.create({
      data: { name: n.name, defaultPriority: n.defaultPriority },
    });
    await prisma.notificationRoutingRule.create({
      data: {
        notificationTypeId: created.id,
        recipientTitleNames: JSON.stringify(n.recipientTokens),
        channels: JSON.stringify(n.channels),
      },
    });
  }
  console.log(`✓ ${notificationTypes.length} notification types + routing rules`);

  // 12. Settings --------------------------------------------------------------------
  const settings = load("settings");
  for (const s of settings) {
    await prisma.setting.create({
      data: { key: s.key, value: s.value, editableByTitle: s.editableByTitle },
    });
  }
  console.log(`✓ ${settings.length} settings`);

  console.log("\nSeed complete.");
  console.log(`\nDemo login — password for ALL accounts: ${DEMO_PASSWORD}`);
  for (const u of demoUsers) {
    console.log(`  ${u.email}  ->  ${u.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
