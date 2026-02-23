import { getConfidenceLabel, getConfidenceTone, shouldAutoSelectInvoice } from "./confidence.ts";
import type { Invoice } from "./types.ts";

const baseInvoice: Invoice = {
  _id: "1",
  tenantId: "tenant-a",
  workloadTier: "standard",
  sourceType: "email",
  sourceKey: "inbox",
  sourceDocumentId: "10",
  attachmentName: "inv.pdf",
  mimeType: "application/pdf",
  receivedAt: "2026-02-19T00:00:00.000Z",
  confidenceScore: 0,
  confidenceTone: "red",
  autoSelectForApproval: false,
  riskFlags: [],
  riskMessages: [],
  status: "PARSED",
  processingIssues: [],
  createdAt: "2026-02-19T00:00:00.000Z",
  updatedAt: "2026-02-19T00:00:00.000Z"
};

describe("confidence ui helpers", () => {
  it("maps score bands to red/yellow/green", () => {
    expect(getConfidenceTone(69)).toBe("red");
    expect(getConfidenceTone(80)).toBe("yellow");
    expect(getConfidenceTone(91)).toBe("green");
  });

  it("formats confidence labels", () => {
    expect(getConfidenceLabel(95.2)).toBe("95%");
    expect(getConfidenceLabel(102)).toBe("100%");
    expect(getConfidenceLabel(-1)).toBe("0%");
  });

  it("auto-selects only eligible high confidence invoices", () => {
    const eligible: Invoice = {
      ...baseInvoice,
      autoSelectForApproval: true,
      confidenceScore: 95,
      status: "PARSED"
    };

    const ineligibleStatus: Invoice = {
      ...baseInvoice,
      autoSelectForApproval: true,
      confidenceScore: 95,
      status: "FAILED_PARSE"
    };

    expect(shouldAutoSelectInvoice(eligible)).toBe(true);
    expect(shouldAutoSelectInvoice(ineligibleStatus)).toBe(false);
  });
});
