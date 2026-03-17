import type { Invoice } from "./types.ts";
import {
  getAvailableRowActions,
  isInvoiceApprovable,
  isInvoiceExportable,
  isInvoiceRetryable,
  isInvoiceSelectable,
  mergeSelectedIds,
  removeSelectedIds
} from "./selection.ts";

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

describe("selection helpers", () => {
  it("marks exported and pending invoices as non-selectable", () => {
    expect(isInvoiceSelectable({ ...baseInvoice, status: "EXPORTED" })).toBe(false);
    expect(isInvoiceSelectable({ ...baseInvoice, status: "PENDING" })).toBe(false);
    expect(isInvoiceSelectable({ ...baseInvoice, status: "APPROVED" })).toBe(true);
    expect(isInvoiceSelectable({ ...baseInvoice, status: "PARSED" })).toBe(true);
  });

  it("marks exported invoices as non-retryable", () => {
    expect(isInvoiceRetryable({ ...baseInvoice, status: "EXPORTED" })).toBe(false);
    expect(isInvoiceRetryable({ ...baseInvoice, status: "PARSED" })).toBe(true);
    expect(isInvoiceRetryable({ ...baseInvoice, status: "PENDING" })).toBe(true);
    expect(isInvoiceRetryable({ ...baseInvoice, status: "APPROVED" })).toBe(true);
  });

  it("marks only review states as approvable", () => {
    expect(isInvoiceApprovable({ ...baseInvoice, status: "PARSED" })).toBe(true);
    expect(isInvoiceApprovable({ ...baseInvoice, status: "NEEDS_REVIEW" })).toBe(true);
    expect(isInvoiceApprovable({ ...baseInvoice, status: "FAILED_PARSE" })).toBe(true);
    expect(isInvoiceApprovable({ ...baseInvoice, status: "FAILED_OCR" })).toBe(false);
    expect(isInvoiceApprovable({ ...baseInvoice, status: "APPROVED" })).toBe(false);
  });

  it("marks only approved invoices as exportable", () => {
    expect(isInvoiceExportable({ ...baseInvoice, status: "APPROVED" })).toBe(true);
    expect(isInvoiceExportable({ ...baseInvoice, status: "NEEDS_REVIEW" })).toBe(false);
  });

  it("keeps previously selected ids even if current filter does not include them", () => {
    const selectedIds = ["approved-1"];
    const currentItems: Invoice[] = [
      {
        ...baseInvoice,
        _id: "parsed-1",
        autoSelectForApproval: false,
        status: "PARSED"
      }
    ];

    expect(mergeSelectedIds(selectedIds, currentItems)).toEqual(["approved-1"]);
  });

  it("preserves persisted ids without auto-selecting new ones", () => {
    const selectedIds = ["approved-1", "parsed-1"];
    const currentItems: Invoice[] = [
      {
        ...baseInvoice,
        _id: "parsed-1",
        autoSelectForApproval: true,
        status: "PARSED"
      },
      {
        ...baseInvoice,
        _id: "review-1",
        autoSelectForApproval: true,
        status: "NEEDS_REVIEW"
      }
    ];

    expect(mergeSelectedIds(selectedIds, currentItems)).toEqual(["approved-1", "parsed-1"]);
  });

  it("removes visible exported ids from selected set", () => {
    const selectedIds = ["exported-1", "approved-1"];
    const currentItems: Invoice[] = [
      {
        ...baseInvoice,
        _id: "exported-1",
        status: "EXPORTED"
      }
    ];

    expect(mergeSelectedIds(selectedIds, currentItems)).toEqual(["approved-1"]);
  });

  it("drops selected ids after successful export", () => {
    expect(removeSelectedIds(["a", "b", "c"], ["b", "x"])).toEqual(["a", "c"]);
  });

  it("keeps selected ids unchanged when there is nothing to remove", () => {
    expect(removeSelectedIds(["a", "b"], [])).toEqual(["a", "b"]);
  });

  describe("getAvailableRowActions", () => {
    it.each<[string, string[]]>([
      ["PENDING", ["delete"]],
      ["PARSED", ["approve", "reingest", "delete"]],
      ["NEEDS_REVIEW", ["approve", "reingest", "delete"]],
      ["FAILED_PARSE", ["approve", "reingest", "delete"]],
      ["FAILED_OCR", ["reingest", "delete"]],
      ["APPROVED", ["reingest", "delete"]],
      ["EXPORTED", []]
    ])("returns %s → %j", (status, expected) => {
      expect(getAvailableRowActions({ ...baseInvoice, status: status as any })).toEqual(expected);
    });
  });
});
