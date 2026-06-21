import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import pdfParse from "pdf-parse";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireScreen } from "../middleware/permissions";
import { notify } from "../lib/notify";
import { OIL_SAMPLE_PARAMETERS, statusFromValue } from "../lib/oilSampleParams";

const router = Router();
router.use(authenticate, requireScreen("oil_sample_center"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// GET /api/oil-samples?equipmentId=  — equipment search/selector (reference screenshot)
router.get("/", async (req, res) => {
  const { equipmentId, lpId } = req.query as Record<string, string>;
  if (!equipmentId && !lpId) return res.status(400).json({ error: "equipmentId or lpId is required" });

  const where: any = {};
  if (lpId) where.lpId = lpId;
  else where.lp = { equipmentId };

  const samples = await prisma.oilSample.findMany({
    where,
    include: { lp: { include: { equipment: true } } },
    orderBy: { sampledDate: "desc" },
  });

  res.json({
    samples: samples.map((s) => ({
      id: s.id,
      lpIdCode: s.lp.lpIdCode,
      equipment: s.lp.equipment.assetName,
      sampledDate: s.sampledDate,
      reportStatus: s.reportStatus,
      sampleIdLab: s.sampleIdLab,
    })),
  });
});

// GET /api/oil-samples/:id — full detail (account/sample/equipment panels + parameter table)
router.get("/:id", async (req, res) => {
  const sample = await prisma.oilSample.findUnique({
    where: { id: req.params.id },
    include: {
      lp: { include: { equipment: { include: { area: { include: { organization: true } } } }, lubricantType: true } },
      parameters: true,
      uploadedBy: true,
    },
  });
  if (!sample) return res.status(404).json({ error: "Oil sample not found" });

  const grouped: Record<string, any[]> = {};
  for (const p of sample.parameters) {
    grouped[p.paramGroup] = grouped[p.paramGroup] || [];
    grouped[p.paramGroup].push({ key: p.paramKey, label: p.paramLabel, unit: p.unit, value: p.value, status: p.status });
  }

  res.json({
    id: sample.id,
    sampleIdLab: sample.sampleIdLab,
    sampledDate: sample.sampledDate,
    reportStatus: sample.reportStatus,
    recommendationsText: sample.recommendationsText,
    uploadedBy: sample.uploadedBy?.name ?? null,
    uploadedAt: sample.uploadedAt,
    lp: { id: sample.lp.id, lpIdCode: sample.lp.lpIdCode, pointDescription: sample.lp.pointDescription },
    equipment: {
      id: sample.lp.equipment.id,
      code: sample.lp.equipment.equipmentIdCode,
      name: sample.lp.equipment.assetName,
      area: sample.lp.equipment.area?.name ?? null,
      contractor: sample.lp.equipment.area?.organization?.name ?? null,
    },
    lubricant: sample.lp.lubricantType?.name ?? null,
    parameterGroups: grouped,
  });
});

// GET /api/oil-samples/trend/:lpId?param=Fe  — trend chart data (last N samples for one LP)
router.get("/trend/:lpId", async (req, res) => {
  const param = req.query.param as string;
  const samples = await prisma.oilSample.findMany({
    where: { lpId: req.params.lpId },
    include: { parameters: param ? { where: { paramKey: param } } : true },
    orderBy: { sampledDate: "asc" },
    take: 20,
  });
  res.json({
    points: samples.map((s) => ({
      sampledDate: s.sampledDate,
      values: s.parameters.map((p) => ({ key: p.paramKey, value: p.value, status: p.status })),
    })),
  });
});

const paramInput = z.object({
  key: z.string(),
  value: z.number().nullable(),
  status: z.enum(["NORMAL", "CAUTION", "ALERT"]).optional(),
});

const manualEntrySchema = z.object({
  lpId: z.string(),
  sampleIdLab: z.string(),
  sampledDate: z.string(),
  recommendationsText: z.string().nullable().optional(),
  parameters: z.array(paramInput),
  sourcePdfUrl: z.string().nullable().optional(),
});

function worstStatus(params: { status?: string }[]): "NORMAL" | "CAUTION" | "ALERT" {
  if (params.some((p) => p.status === "ALERT")) return "ALERT";
  if (params.some((p) => p.status === "CAUTION")) return "CAUTION";
  return "NORMAL";
}

// POST /api/oil-samples — manual entry, and the final "confirm & save" step after PDF review
router.post("/", async (req, res) => {
  const parsed = manualEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const existing = await prisma.oilSample.findUnique({ where: { sampleIdLab: data.sampleIdLab } });
  if (existing) return res.status(409).json({ error: `Sample ID ${data.sampleIdLab} has already been imported` });

  const lp = await prisma.lubricationPoint.findUnique({ where: { id: data.lpId }, include: { equipment: { include: { area: true } } } });
  if (!lp) return res.status(404).json({ error: "Lubrication point not found" });

  const resolved = data.parameters.map((p) => ({
    ...p,
    status: p.status ?? statusFromValue(p.key, p.value),
  }));

  const sample = await prisma.oilSample.create({
    data: {
      lpId: data.lpId,
      sampleIdLab: data.sampleIdLab,
      sampledDate: new Date(data.sampledDate),
      reportStatus: worstStatus(resolved),
      recommendationsText: data.recommendationsText,
      sourcePdfUrl: data.sourcePdfUrl,
      uploadedById: req.user!.id,
      parameters: {
        create: resolved.map((p) => {
          const def = OIL_SAMPLE_PARAMETERS.find((d) => d.key === p.key);
          return {
            paramGroup: def?.group ?? "physical",
            paramKey: p.key,
            paramLabel: def?.label ?? p.key,
            unit: def?.unit ?? null,
            value: p.value,
            status: p.status,
          };
        }),
      },
    },
  });

  await prisma.lubricationPoint.update({ where: { id: lp.id }, data: { oaLastSampleDate: new Date(data.sampledDate) } });

  res.status(201).json({ sample });
});

// ── PDF batch extraction (Section 12.7.1) ──────────────────────────────────

interface ExtractedSample {
  fileName: string;
  matchedEquipmentCode: string | null;
  matchedLpId: string | null;
  sampleIdLab: string | null;
  sampledDate: string | null;
  parameters: { key: string; value: number | null; status: string }[];
  isDuplicate: boolean;
  rawTextPreview: string;
  warning?: string;
}

/** Best-effort text-extraction parser for common lab report formats. PDFs
 * are scanned text first; if too little text comes back (a scanned image
 * with no text layer), this v1 flags it for manual entry rather than
 * guessing via OCR. A future iteration can plug in an OCR engine (e.g.
 * tesseract.js) behind the same interface once real sample reports from
 * ACC's lab are available to calibrate the parser against. */
async function parseLabReportPdf(buffer: Buffer, fileName: string): Promise<ExtractedSample> {
  const result: ExtractedSample = {
    fileName,
    matchedEquipmentCode: null,
    matchedLpId: null,
    sampleIdLab: null,
    sampledDate: null,
    parameters: [],
    isDuplicate: false,
    rawTextPreview: "",
  };

  let text = "";
  try {
    const parsed = await pdfParse(buffer);
    text = parsed.text || "";
  } catch (e) {
    result.warning = "Could not extract text from this PDF.";
    return result;
  }
  result.rawTextPreview = text.slice(0, 500);

  if (text.trim().length < 50) {
    result.warning = "Little or no extractable text found — this looks like a scanned image without a text layer. Please enter this sample manually.";
    return result;
  }

  const unitMatch = text.match(/Unit\s*ID[:\s]+([A-Za-z0-9.\-]+)/i);
  if (unitMatch) result.matchedEquipmentCode = unitMatch[1].trim();

  const sampleIdMatch = text.match(/Sample\s*(?:ID|No\.?)[:\s]+([A-Za-z0-9\-]+)/i);
  if (sampleIdMatch) result.sampleIdLab = sampleIdMatch[1].trim();

  const dateMatch = text.match(/(?:Sample\s*Date|Date\s*Sampled)[:\s]+(\d{1,2}[\/\-][A-Za-z0-9]{1,4}[\/\-]\d{2,4})/i);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d.getTime())) result.sampledDate = d.toISOString().slice(0, 10);
  }

  for (const def of OIL_SAMPLE_PARAMETERS) {
    const re = new RegExp(`\\b${def.key}\\b[:\\s]+([0-9]+\\.?[0-9]*)`, "i");
    const m = text.match(re);
    if (m) {
      const value = parseFloat(m[1]);
      result.parameters.push({ key: def.key, value, status: statusFromValue(def.key, value) });
    }
  }

  if (result.matchedEquipmentCode) {
    const equipment = await prisma.equipment.findUnique({ where: { equipmentIdCode: result.matchedEquipmentCode } });
    if (equipment) {
      const lp = await prisma.lubricationPoint.findFirst({ where: { equipmentId: equipment.id, oaRequired: true } });
      result.matchedLpId = lp?.id ?? null;
      if (!lp) result.warning = (result.warning ? result.warning + " " : "") + "Equipment matched but no oil-analysis lubrication point found for it — select manually.";
    } else {
      result.warning = (result.warning ? result.warning + " " : "") + `No equipment found matching Unit ID "${result.matchedEquipmentCode}".`;
    }
  } else {
    result.warning = (result.warning ? result.warning + " " : "") + "Could not find a Unit ID in the document — select the equipment manually.";
  }

  if (result.sampleIdLab) {
    const existing = await prisma.oilSample.findUnique({ where: { sampleIdLab: result.sampleIdLab } });
    result.isDuplicate = !!existing;
  }

  return result;
}

// POST /api/oil-samples/extract-pdf  — batch upload, returns extraction results for human review (NOT saved yet)
router.post("/extract-pdf", upload.array("files", 20), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

  const results: ExtractedSample[] = [];
  for (const file of files) {
    try {
      const extracted = await parseLabReportPdf(file.buffer, file.originalname);
      results.push(extracted);
    } catch (e) {
      await notify({
        typeName: "PDF Extraction Failure",
        organizationId: req.user!.organizationId,
        message: `Failed to process "${file.originalname}" — please re-upload or enter manually.`,
        extraUserIds: [req.user!.id],
      });
      results.push({
        fileName: file.originalname,
        matchedEquipmentCode: null,
        matchedLpId: null,
        sampleIdLab: null,
        sampledDate: null,
        parameters: [],
        isDuplicate: false,
        rawTextPreview: "",
        warning: "Processing failed for this file.",
      });
    }
  }

  const duplicateCount = results.filter((r) => r.isDuplicate).length;
  res.json({
    results,
    duplicatesSkipped: duplicateCount,
    summary: duplicateCount > 0 ? `${duplicateCount} duplicate sample(s) skipped (already imported).` : undefined,
  });
});

export default router;
