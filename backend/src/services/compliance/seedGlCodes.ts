import { GlCodeMasterModel } from "../../models/compliance/GlCodeMaster.js";
import { logger } from "../../utils/logger.js";

interface DefaultGlCode {
  code: string;
  name: string;
  category: string;
  linkedTdsSection: string | null;
}

const DEFAULT_GL_CODES: DefaultGlCode[] = [
  { code: "4001", name: "Professional Services", category: "Professional Services", linkedTdsSection: "194J" },
  { code: "4002", name: "Contractor Payments", category: "Contractor Services", linkedTdsSection: "194C" },
  { code: "4003", name: "Commission & Brokerage", category: "Commission", linkedTdsSection: "194H" },
  { code: "4004", name: "Rent - Land & Building", category: "Rent", linkedTdsSection: "194I(b)" },
  { code: "4005", name: "Rent - Plant & Machinery", category: "Rent", linkedTdsSection: "194I(a)" },
  { code: "4006", name: "Interest on Borrowings", category: "Interest", linkedTdsSection: "194A" },
  { code: "4007", name: "Purchase of Goods", category: "Raw Materials", linkedTdsSection: "194Q" },
  { code: "4008", name: "Software & SaaS", category: "Software Subscription", linkedTdsSection: "194J" },
  { code: "4009", name: "Office Supplies", category: "Office Expenses", linkedTdsSection: null },
  { code: "4010", name: "Utilities", category: "Utilities", linkedTdsSection: null },
  { code: "4011", name: "Travel & Conveyance", category: "Travel", linkedTdsSection: null },
  { code: "4012", name: "Repairs & Maintenance", category: "Repairs & Maintenance", linkedTdsSection: "194C" },
  { code: "4013", name: "Insurance Premium", category: "Insurance", linkedTdsSection: null },
  { code: "4014", name: "Advertising & Marketing", category: "Marketing", linkedTdsSection: "194C" },
  { code: "4015", name: "Legal Fees", category: "Professional Services", linkedTdsSection: "194J" },
  { code: "4016", name: "Audit Fees", category: "Professional Services", linkedTdsSection: "194J" },
  { code: "4017", name: "Printing & Stationery", category: "Office Expenses", linkedTdsSection: null },
  { code: "4018", name: "Courier & Postage", category: "Office Expenses", linkedTdsSection: null },
  { code: "4019", name: "Bank Charges", category: "Bank Charges", linkedTdsSection: null },
  { code: "4020", name: "Miscellaneous Expenses", category: "Other", linkedTdsSection: null }
];

export async function seedDefaultGlCodes(tenantId: string): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  const existingCodes = new Set(
    (await GlCodeMasterModel.find({ tenantId }, { code: 1 }).lean()).map((d) => d.code)
  );

  for (const gl of DEFAULT_GL_CODES) {
    if (existingCodes.has(gl.code)) {
      skipped++;
      continue;
    }

    try {
      await GlCodeMasterModel.create({
        tenantId,
        code: gl.code,
        name: gl.name,
        category: gl.category,
        linkedTdsSection: gl.linkedTdsSection,
        isActive: true
      });
      created++;
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err && (err as { code?: number }).code === 11000) {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  logger.info("gl.seed.complete", { tenantId, created, skipped });
  return { created, skipped };
}

export { DEFAULT_GL_CODES };
