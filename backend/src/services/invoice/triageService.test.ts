import { Types } from "mongoose";
import { describeHarness } from "@/test-utils";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { TriageService } from "@/services/invoice/triageService.js";
import { INVOICE_STATUS, TRIAGE_REJECT_REASON } from "@/types/invoice.js";

const TENANT_A = "tenant-triage-a";
const TENANT_B = "tenant-triage-b";
const GSTIN_A = "29ABCDE1234F1Z5";
const GSTIN_B = "07AABCC1234D1ZA";

interface CreateTriageInvoiceInput {
  tenantId: string;
  receivedAt?: Date;
  parsed?: Record<string, unknown>;
  sourceType?: string;
  sourceKey?: string;
  sourceDocumentId?: string;
}

async function createTriageInvoice(input: CreateTriageInvoiceInput) {
  return InvoiceModel.create({
    tenantId: input.tenantId,
    clientOrgId: undefined,
    sourceType: input.sourceType ?? "email",
    sourceKey: input.sourceKey ?? "ops@acme.test",
    sourceDocumentId: input.sourceDocumentId ?? `doc-${new Types.ObjectId().toHexString()}`,
    attachmentName: "invoice.pdf",
    mimeType: "application/pdf",
    receivedAt: input.receivedAt ?? new Date(),
    status: INVOICE_STATUS.PENDING_TRIAGE,
    parsed: input.parsed ?? {}
  });
}

describeHarness("TriageService (#179)", ({ getHarness }) => {
  let service: TriageService;

  beforeAll(async () => {
    await ClientOrganizationModel.syncIndexes();
    await InvoiceModel.syncIndexes();
    service = new TriageService();
  });

  afterEach(async () => {
    await getHarness().reset();
  });

  describe("list", () => {
    it("returns only the caller's tenant PENDING_TRIAGE invoices in the FE shape", async () => {
      const earlier = new Date("2026-01-01T00:00:00Z");
      const later = new Date("2026-01-02T00:00:00Z");
      await createTriageInvoice({
        tenantId: TENANT_A,
        receivedAt: earlier,
        sourceKey: "ops@acme.test",
        parsed: {
          invoiceNumber: "INV-1",
          vendorName: "Vendor A",
          vendorGstin: GSTIN_A,
          customerName: "Customer A",
          customerGstin: GSTIN_B,
          totalAmountMinor: 12345,
          currency: "INR"
        }
      });
      await createTriageInvoice({
        tenantId: TENANT_A,
        receivedAt: later,
        sourceKey: "billing@acme.test",
        parsed: { invoiceNumber: "INV-2" }
      });
      await createTriageInvoice({
        tenantId: TENANT_B,
        sourceKey: "leak@evil.test",
        parsed: { invoiceNumber: "LEAKED" }
      });

      const result = await service.list(TENANT_A);

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.invoiceNumber)).toEqual(["INV-1", "INV-2"]);
      const first = result.items[0]!;
      expect(first).toMatchObject({
        tenantId: TENANT_A,
        invoiceNumber: "INV-1",
        vendorName: "Vendor A",
        vendorGstin: GSTIN_A,
        customerName: "Customer A",
        customerGstin: GSTIN_B,
        totalAmountMinor: 12345,
        currency: "INR",
        sourceMailbox: "ops@acme.test",
        status: INVOICE_STATUS.PENDING_TRIAGE
      });
      expect(first.receivedAt).toBe(earlier.toISOString());
      expect(typeof first._id).toBe("string");
    });

    it("does not leak invoices from other tenants", async () => {
      await createTriageInvoice({ tenantId: TENANT_B, parsed: { invoiceNumber: "LEAKED" } });
      const result = await service.list(TENANT_A);
      expect(result).toEqual({ items: [], total: 0 });
    });

    it("excludes non-PENDING_TRIAGE invoices and reports null sourceMailbox for non-email sources", async () => {
      const org = await ClientOrganizationModel.create({
        tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME"
      });
      await InvoiceModel.create({
        tenantId: TENANT_A,
        clientOrgId: org._id,
        sourceType: "upload",
        sourceKey: "upload-key",
        sourceDocumentId: "u-1",
        attachmentName: "x.pdf",
        mimeType: "application/pdf",
        receivedAt: new Date(),
        status: INVOICE_STATUS.PARSED
      });
      await createTriageInvoice({
        tenantId: TENANT_A,
        sourceType: "upload",
        sourceKey: "upload-only",
        parsed: { invoiceNumber: "UPLOAD-TRIAGE" }
      });

      const result = await service.list(TENANT_A);
      expect(result.total).toBe(1);
      expect(result.items[0]!.sourceMailbox).toBeNull();
    });

    it("returns null fields when parsed values are missing", async () => {
      await createTriageInvoice({ tenantId: TENANT_A, parsed: {} });
      const result = await service.list(TENANT_A);
      expect(result.items[0]).toMatchObject({
        invoiceNumber: null,
        vendorName: null,
        vendorGstin: null,
        customerName: null,
        customerGstin: null,
        totalAmountMinor: null,
        currency: null
      });
    });
  });

  describe("assignClientOrg", () => {
    it("assigns clientOrgId, transitions to PARSED, and persists", async () => {
      const org = await ClientOrganizationModel.create({
        tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME"
      });
      const invoice = await createTriageInvoice({ tenantId: TENANT_A });

      await service.assignClientOrg({
        tenantId: TENANT_A,
        invoiceId: invoice._id.toString(),
        clientOrgId: org._id.toString()
      });

      const reread = await InvoiceModel.findById(invoice._id).lean();
      expect(reread?.status).toBe(INVOICE_STATUS.PARSED);
      expect(String(reread?.clientOrgId)).toBe(org._id.toString());
    });

    it("404s for cross-tenant invoice", async () => {
      const org = await ClientOrganizationModel.create({
        tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME"
      });
      const invoice = await createTriageInvoice({ tenantId: TENANT_A });
      await expect(
        service.assignClientOrg({
          tenantId: TENANT_B,
          invoiceId: invoice._id.toString(),
          clientOrgId: org._id.toString()
        })
      ).rejects.toMatchObject({ statusCode: 404, code: "triage_invoice_not_found" });
    });

    it("404s when invoiceId is not a valid ObjectId", async () => {
      await expect(
        service.assignClientOrg({
          tenantId: TENANT_A,
          invoiceId: "not-an-oid",
          clientOrgId: new Types.ObjectId().toString()
        })
      ).rejects.toMatchObject({ statusCode: 404, code: "triage_invoice_not_found" });
    });

    it("400s with assign_client_org_invalid when clientOrg belongs to another tenant", async () => {
      const otherOrg = await ClientOrganizationModel.create({
        tenantId: TENANT_B, gstin: GSTIN_A, companyName: "Other"
      });
      const invoice = await createTriageInvoice({ tenantId: TENANT_A });
      await expect(
        service.assignClientOrg({
          tenantId: TENANT_A,
          invoiceId: invoice._id.toString(),
          clientOrgId: otherOrg._id.toString()
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "assign_client_org_invalid" });
    });

    it("400s with assign_client_org_invalid when clientOrgId is empty (validated before DB round-trip)", async () => {
      await expect(
        service.assignClientOrg({
          tenantId: TENANT_A,
          invoiceId: new Types.ObjectId().toString(),
          clientOrgId: ""
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "assign_client_org_invalid" });
    });

    it("400s with assign_client_org_invalid when clientOrgId is not a valid ObjectId (validated before DB round-trip)", async () => {
      await expect(
        service.assignClientOrg({
          tenantId: TENANT_A,
          invoiceId: new Types.ObjectId().toString(),
          clientOrgId: "not-an-oid"
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "assign_client_org_invalid" });
    });

    it("409s when invoice status is not PENDING_TRIAGE", async () => {
      const org = await ClientOrganizationModel.create({
        tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME"
      });
      const invoice = await InvoiceModel.create({
        tenantId: TENANT_A,
        clientOrgId: org._id,
        sourceType: "email",
        sourceKey: "k",
        sourceDocumentId: "d",
        attachmentName: "x.pdf",
        mimeType: "application/pdf",
        receivedAt: new Date(),
        status: INVOICE_STATUS.PARSED
      });
      await expect(
        service.assignClientOrg({
          tenantId: TENANT_A,
          invoiceId: invoice._id.toString(),
          clientOrgId: org._id.toString()
        })
      ).rejects.toMatchObject({ statusCode: 409, code: "triage_invoice_wrong_status" });
    });
  });

  describe("reject", () => {
    it("transitions to REJECTED and persists rejectReason without notes", async () => {
      const invoice = await createTriageInvoice({ tenantId: TENANT_A });

      await service.reject({
        tenantId: TENANT_A,
        invoiceId: invoice._id.toString(),
        reasonCode: TRIAGE_REJECT_REASON.SPAM
      });

      const reread = await InvoiceModel.findById(invoice._id).lean();
      expect(reread?.status).toBe(INVOICE_STATUS.REJECTED);
      expect(reread?.rejectReason).toMatchObject({ code: TRIAGE_REJECT_REASON.SPAM });
      expect(reread?.rejectReason?.notes).toBeUndefined();
      expect(reread?.clientOrgId).toBeFalsy();
    });

    it("persists trimmed notes when provided", async () => {
      const invoice = await createTriageInvoice({ tenantId: TENANT_A });
      await service.reject({
        tenantId: TENANT_A,
        invoiceId: invoice._id.toString(),
        reasonCode: TRIAGE_REJECT_REASON.OTHER,
        notes: "  bogus PDF  "
      });
      const reread = await InvoiceModel.findById(invoice._id).lean();
      expect(reread?.rejectReason).toMatchObject({
        code: TRIAGE_REJECT_REASON.OTHER,
        notes: "bogus PDF"
      });
    });

    it("400s when reasonCode is not in the canonical enum", async () => {
      const invoice = await createTriageInvoice({ tenantId: TENANT_A });
      await expect(
        service.reject({
          tenantId: TENANT_A,
          invoiceId: invoice._id.toString(),
          reasonCode: "made_up_reason"
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "triage_reject_reason_invalid" });
    });

    it("400s when reasonCode is 'other' and notes are missing", async () => {
      const invoice = await createTriageInvoice({ tenantId: TENANT_A });
      await expect(
        service.reject({
          tenantId: TENANT_A,
          invoiceId: invoice._id.toString(),
          reasonCode: TRIAGE_REJECT_REASON.OTHER
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "triage_reject_notes_required" });
    });

    it("404s for cross-tenant invoice", async () => {
      const invoice = await createTriageInvoice({ tenantId: TENANT_A });
      await expect(
        service.reject({
          tenantId: TENANT_B,
          invoiceId: invoice._id.toString(),
          reasonCode: TRIAGE_REJECT_REASON.SPAM
        })
      ).rejects.toMatchObject({ statusCode: 404, code: "triage_invoice_not_found" });
    });

    it("409s when invoice status is not PENDING_TRIAGE", async () => {
      const org = await ClientOrganizationModel.create({
        tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME"
      });
      const invoice = await InvoiceModel.create({
        tenantId: TENANT_A,
        clientOrgId: org._id,
        sourceType: "email",
        sourceKey: "k",
        sourceDocumentId: "d",
        attachmentName: "x.pdf",
        mimeType: "application/pdf",
        receivedAt: new Date(),
        status: INVOICE_STATUS.PARSED
      });
      await expect(
        service.reject({
          tenantId: TENANT_A,
          invoiceId: invoice._id.toString(),
          reasonCode: TRIAGE_REJECT_REASON.SPAM
        })
      ).rejects.toMatchObject({ statusCode: 409, code: "triage_invoice_wrong_status" });
    });
  });
});
