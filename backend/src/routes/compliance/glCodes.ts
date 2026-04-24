import { Router } from "express";
import multer from "multer";
import { GlCodeMasterModel } from "@/models/compliance/GlCodeMaster.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireActiveClientOrg } from "@/auth/activeClientOrg.js";
import { requireCap } from "@/auth/requireCapability.js";

const MAX_CSV_FILE_SIZE = 1024 * 1024;
const MAX_CSV_ROWS = 5000;

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_FILE_SIZE, files: 1 }
});

interface CsvImportRow {
  code: string;
  name: string;
  category?: string;
  tdsSection?: string;
  costCenter?: string;
}

interface CsvImportError {
  row: number;
  message: string;
}

function parseCsvContent(raw: string): { rows: CsvImportRow[]; errors: CsvImportError[] } {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows: CsvImportRow[] = [];
  const errors: CsvImportError[] = [];

  if (lines.length === 0 || !lines[0].trim()) {
    return { rows, errors };
  }

  const headerLine = lines[0].trim().toLowerCase();
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
  const codeIdx = headers.indexOf("code");
  const nameIdx = headers.indexOf("name");
  const categoryIdx = headers.indexOf("category");
  const tdsIdx = headers.findIndex((h) => h === "tdssection" || h === "tds_section" || h === "tds section");
  const costIdx = headers.findIndex((h) => h === "costcenter" || h === "cost_center" || h === "cost center");

  if (codeIdx === -1 || nameIdx === -1) {
    errors.push({ row: 1, message: "CSV must have 'code' and 'name' columns in the header." });
    return { rows, errors };
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = splitCsvLine(line);
    const code = (fields[codeIdx] ?? "").trim();
    const name = (fields[nameIdx] ?? "").trim();

    if (!code || !name) {
      errors.push({ row: i + 1, message: `Missing required field: ${!code ? "code" : "name"}.` });
      continue;
    }

    rows.push({
      code,
      name,
      category: categoryIdx >= 0 ? (fields[categoryIdx] ?? "").trim() || undefined : undefined,
      tdsSection: tdsIdx >= 0 ? (fields[tdsIdx] ?? "").trim() || undefined : undefined,
      costCenter: costIdx >= 0 ? (fields[costIdx] ?? "").trim() || undefined : undefined
    });
  }

  return { rows, errors };
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

export function createGlCodesRouter() {
  const router = Router();
  router.use(requireAuth);
  router.use(requireActiveClientOrg);

  router.get("/admin/gl-codes", async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const query: Record<string, unknown> = { tenantId, clientOrgId: req.activeClientOrgId };

      if (typeof req.query.category === "string") query.category = req.query.category;
      if (req.query.active === "true") query.isActive = true;
      if (req.query.active === "false") query.isActive = false;

      if (typeof req.query.search === "string" && req.query.search.trim()) {
        const search = req.query.search.trim();
        query.$or = [
          { code: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } }
        ];
      }

      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        GlCodeMasterModel.find(query).sort({ code: 1 }).skip(skip).limit(limit).lean(),
        GlCodeMasterModel.countDocuments(query)
      ]);

      res.json({ items, page, limit, total });
    } catch (error) { next(error); }
  });

  router.post("/admin/gl-codes", requireCap("canConfigureGlCodes"), async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const { code, name, category, linkedTdsSection, parentCode } = req.body ?? {};

      if (!code?.trim() || !name?.trim()) {
        res.status(400).json({ message: "Code and name are required." });
        return;
      }

      const existing = await GlCodeMasterModel.findOne({ tenantId, clientOrgId: req.activeClientOrgId, code: code.trim() });
      if (existing) {
        res.status(409).json({ message: `GL code "${code.trim()}" already exists.` });
        return;
      }

      const doc = await GlCodeMasterModel.create({
        tenantId,
        clientOrgId: req.activeClientOrgId,
        code: code.trim(),
        name: name.trim(),
        category: category?.trim() ?? "Other",
        linkedTdsSection: linkedTdsSection?.trim() || null,
        parentCode: parentCode?.trim() || null
      });

      res.status(201).json(doc.toObject());
    } catch (error) { next(error); }
  });

  router.put("/admin/gl-codes/:code", requireCap("canConfigureGlCodes"), async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const update: Record<string, unknown> = {};
      if (typeof req.body.name === "string") update.name = req.body.name.trim();
      if (typeof req.body.category === "string") update.category = req.body.category.trim();
      if (req.body.linkedTdsSection !== undefined) update.linkedTdsSection = req.body.linkedTdsSection?.trim() || null;
      if (req.body.parentCode !== undefined) update.parentCode = req.body.parentCode?.trim() || null;
      if (typeof req.body.isActive === "boolean") update.isActive = req.body.isActive;

      const doc = await GlCodeMasterModel.findOneAndUpdate(
        { tenantId, clientOrgId: req.activeClientOrgId, code: req.params.code },
        { $set: update },
        { new: true }
      );

      if (!doc) { res.status(404).json({ message: "GL code not found." }); return; }
      res.json(doc.toObject());
    } catch (error) { next(error); }
  });

  router.delete("/admin/gl-codes/:code", requireCap("canConfigureGlCodes"), async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const doc = await GlCodeMasterModel.findOneAndUpdate(
        { tenantId, clientOrgId: req.activeClientOrgId, code: req.params.code },
        { $set: { isActive: false } },
        { new: true }
      );
      if (!doc) { res.status(404).json({ message: "GL code not found." }); return; }
      res.json(doc.toObject());
    } catch (error) { next(error); }
  });

  router.post("/admin/gl-codes/import-csv", requireCap("canConfigureGlCodes"), (req, res, next) => {
    (csvUpload.single("file") as unknown as import("express").RequestHandler)(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ message: "CSV file exceeds the 1 MB size limit." });
        return;
      }
      if (error) { next(error); return; }
      next();
    });
  }, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const file = req.file;

      if (!file || !file.buffer.length) {
        res.status(400).json({ message: "No CSV file provided or file is empty." });
        return;
      }

      const content = file.buffer.toString("utf-8");
      const { rows, errors } = parseCsvContent(content);

      if (rows.length === 0 && errors.length === 0) {
        res.status(400).json({ message: "CSV file is empty or contains only headers." });
        return;
      }

      if (rows.length > MAX_CSV_ROWS) {
        res.status(400).json({ message: `CSV exceeds the maximum of ${MAX_CSV_ROWS} rows. Found ${rows.length} data rows.` });
        return;
      }

      const existingCodes = new Set(
        (await GlCodeMasterModel.find({ tenantId, clientOrgId: req.activeClientOrgId }, { code: 1 }).lean()).map((d) => d.code)
      );

      let imported = 0;
      let skipped = 0;
      const seenInBatch = new Set<string>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        if (existingCodes.has(row.code) || seenInBatch.has(row.code)) {
          skipped++;
          continue;
        }

        try {
          await GlCodeMasterModel.create({
            tenantId,
            clientOrgId: req.activeClientOrgId,
            code: row.code,
            name: row.name,
            category: row.category || "Other",
            linkedTdsSection: row.tdsSection || null,
            parentCode: null
          });
          imported++;
          seenInBatch.add(row.code);
        } catch (err: unknown) {
          if (typeof err === "object" && err !== null && "code" in err && (err as { code?: number }).code === 11000) {
            skipped++;
          } else {
            errors.push({ row: i + 2, message: `Database error for code "${row.code}".` });
          }
        }
      }

      res.json({ imported, skipped, errors });
    } catch (error) { next(error); }
  });

  return router;
}

export { parseCsvContent, MAX_CSV_ROWS };
