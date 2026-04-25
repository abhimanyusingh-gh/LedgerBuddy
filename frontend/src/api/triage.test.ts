/**
 * @jest-environment jsdom
 */
import {
  TRIAGE_QUEUE_QUERY_KEY,
  assignClientOrg,
  fetchTriageInvoices,
  rejectInvoice
} from "@/api/triage";
import { TRIAGE_REJECT_REASON } from "@/features/triage/triageReasons";

jest.mock("@/api/client", () => {
  const get = jest.fn();
  const patch = jest.fn();
  return {
    apiClient: { get, patch }
  };
});

const { apiClient } = jest.requireMock("@/api/client") as {
  apiClient: { get: jest.Mock; patch: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("api/triage", () => {
  it("uses the canonical query key", () => {
    expect(TRIAGE_QUEUE_QUERY_KEY).toEqual(["triageQueue"]);
  });

  describe("fetchTriageInvoices", () => {
    it("requests /invoices/triage with status=PENDING_TRIAGE and returns the response items + total", async () => {
      apiClient.get.mockResolvedValueOnce({
        data: {
          items: [
            {
              _id: "inv-1",
              tenantId: "t-1",
              invoiceNumber: "INV-001",
              vendorName: "Acme",
              vendorGstin: null,
              customerName: null,
              customerGstin: null,
              totalAmountMinor: 12500,
              currency: "INR",
              sourceMailbox: "ap@firm.in",
              receivedAt: "2026-04-25T10:00:00Z",
              status: "PENDING_TRIAGE"
            }
          ],
          total: 1
        }
      });
      const result = await fetchTriageInvoices();
      expect(apiClient.get).toHaveBeenCalledWith("/invoices/triage", {
        params: { status: "PENDING_TRIAGE" }
      });
      expect(result.total).toBe(1);
      expect(result.items[0]._id).toBe("inv-1");
    });

    it("returns empty list when the response shape is malformed", async () => {
      apiClient.get.mockResolvedValueOnce({ data: {} });
      const result = await fetchTriageInvoices();
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("propagates network errors", async () => {
      apiClient.get.mockRejectedValueOnce(new Error("offline"));
      await expect(fetchTriageInvoices()).rejects.toThrow("offline");
    });
  });

  describe("assignClientOrg", () => {
    it("PATCHes /invoices/:id/assign-client-org with the clientOrgId", async () => {
      apiClient.patch.mockResolvedValueOnce({ data: { ok: true } });
      const result = await assignClientOrg("inv-1", "org-9");
      expect(apiClient.patch).toHaveBeenCalledWith(
        "/invoices/inv-1/assign-client-org",
        { clientOrgId: "org-9" }
      );
      expect(result).toEqual({ ok: true });
    });

    it("URL-encodes invoice ids with reserved chars", async () => {
      apiClient.patch.mockResolvedValueOnce({ data: { ok: true } });
      await assignClientOrg("inv 1/2", "org-9");
      expect(apiClient.patch).toHaveBeenCalledWith(
        "/invoices/inv%201%2F2/assign-client-org",
        { clientOrgId: "org-9" }
      );
    });
  });

  describe("rejectInvoice", () => {
    it("PATCHes /invoices/:id/reject with the structured payload (reasonCode only)", async () => {
      apiClient.patch.mockResolvedValueOnce({ data: { ok: true } });
      const result = await rejectInvoice("inv-1", { reasonCode: TRIAGE_REJECT_REASON.Spam });
      expect(apiClient.patch).toHaveBeenCalledWith("/invoices/inv-1/reject", {
        reasonCode: "spam"
      });
      expect(result).toEqual({ ok: true });
    });

    it("PATCHes /invoices/:id/reject with the structured payload (reasonCode + notes)", async () => {
      apiClient.patch.mockResolvedValueOnce({ data: { ok: true } });
      await rejectInvoice("inv-1", {
        reasonCode: TRIAGE_REJECT_REASON.WrongVendor,
        notes: "Sent to wrong AP"
      });
      expect(apiClient.patch).toHaveBeenCalledWith("/invoices/inv-1/reject", {
        reasonCode: "wrong_vendor",
        notes: "Sent to wrong AP"
      });
    });
  });
});
