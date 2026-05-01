/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { ExportHistoryDashboard } from "@/features/exports/ExportHistoryDashboard";
import { EXPORT_BATCH_ITEM_STATUS, type ExportBatchSummary } from "@/types";

jest.mock("@/api/client", () => {
  const { buildApiClientMockModule } = require("@/test-utils/mockApiClient");
  return {
    ...buildApiClientMockModule(),
    safeNum: (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback),
    stripNulls: <T,>(value: T) => value
  };
});

import { getMockedApiClient } from "@/test-utils/mockApiClient";

const apiClient = getMockedApiClient();

function makeBatch(overrides: Partial<ExportBatchSummary> = {}): ExportBatchSummary {
  return {
    batchId: "batch-1",
    system: "tally",
    total: 2,
    successCount: 1,
    failureCount: 1,
    requestedBy: "ops@example.com",
    hasFile: true,
    createdAt: "2026-04-25T10:00:00Z",
    updatedAt: "2026-04-25T10:00:00Z",
    items: [
      {
        invoiceId: "inv-success",
        voucherType: "purchase",
        status: EXPORT_BATCH_ITEM_STATUS.SUCCESS,
        exportVersion: 0,
        guid: "guid-1"
      },
      {
        invoiceId: "inv-failure",
        voucherType: "purchase",
        status: EXPORT_BATCH_ITEM_STATUS.FAILURE,
        exportVersion: 1,
        guid: "guid-2",
        tallyResponse: { lineError: "vendor not found", lineErrorOrdinal: 2 }
      }
    ],
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("client-1");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("ExportHistoryDashboard — per-invoice items + retry button", () => {
  it("shows the Retry failures button only for batches that contain a failure item", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: {
        items: [
          makeBatch({ batchId: "batch-with-failure" }),
          makeBatch({
            batchId: "batch-all-success",
            failureCount: 0,
            successCount: 2,
            items: [
              {
                invoiceId: "inv-a",
                voucherType: "purchase",
                status: EXPORT_BATCH_ITEM_STATUS.SUCCESS,
                exportVersion: 0,
                guid: "g-a"
              }
            ]
          })
        ],
        page: 1,
        limit: 20,
        total: 2
      }
    });

    render(<ExportHistoryDashboard />);

    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    const retryButtons = screen.queryAllByRole("button", { name: /retry failures/i });
    expect(retryButtons).toHaveLength(1);
  });

  it("renders per-invoice status + lineError + lineErrorOrdinal when the row is expanded", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { items: [makeBatch()], page: 1, limit: 20, total: 1 }
    });

    render(<ExportHistoryDashboard />);

    await waitFor(() => expect(screen.getByTitle("ops@example.com")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /show batch items/i }));
    });

    const successRow = screen.getByText("inv-success").closest("li");
    const failureRow = screen.getByText("inv-failure").closest("li");
    expect(successRow).not.toBeNull();
    expect(failureRow).not.toBeNull();
    expect(successRow!).toHaveTextContent("Success");
    expect(failureRow!).toHaveTextContent("Failure");
    expect(screen.getByText(/LINEERROR #2: vendor not found/)).toBeInTheDocument();
  });

  it("posts to the retry endpoint, refetches history, and surfaces a success toast on the happy path", async () => {
    const addToast = jest.fn();
    apiClient.get
      .mockResolvedValueOnce({ data: { items: [makeBatch()], page: 1, limit: 20, total: 1 } })
      .mockResolvedValueOnce({
        data: {
          items: [
            makeBatch({
              failureCount: 0,
              successCount: 2,
              items: [
                {
                  invoiceId: "inv-success",
                  voucherType: "purchase",
                  status: EXPORT_BATCH_ITEM_STATUS.SUCCESS,
                  exportVersion: 0,
                  guid: "guid-1"
                },
                {
                  invoiceId: "inv-failure",
                  voucherType: "purchase",
                  status: EXPORT_BATCH_ITEM_STATUS.SUCCESS,
                  exportVersion: 2,
                  guid: "guid-2"
                }
              ]
            })
          ],
          page: 1,
          limit: 20,
          total: 1
        }
      });
    apiClient.post.mockResolvedValueOnce({
      data: { batchId: "batch-1", retriedCount: 1, total: 2, successCount: 2, failureCount: 0 }
    });

    render(<ExportHistoryDashboard addToast={addToast} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /retry failures/i })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry failures/i }));
    });

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/tenants/tenant-1/clientOrgs/client-1/exports/tally/batches/batch-1/retry",
      {}
    );
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(addToast).toHaveBeenCalledWith("success", expect.stringMatching(/retry submitted/i));
    await waitFor(() => expect(screen.queryByRole("button", { name: /retry failures/i })).not.toBeInTheDocument());
  });

  it("surfaces an error toast and re-enables the button when the retry request fails", async () => {
    const addToast = jest.fn();
    apiClient.get.mockResolvedValueOnce({ data: { items: [makeBatch()], page: 1, limit: 20, total: 1 } });
    apiClient.post.mockRejectedValueOnce(new Error("Network down"));

    render(<ExportHistoryDashboard addToast={addToast} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /retry failures/i })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry failures/i }));
    });

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("error", expect.any(String)));
    expect(screen.getByRole("button", { name: /retry failures/i })).not.toBeDisabled();
  });
});
