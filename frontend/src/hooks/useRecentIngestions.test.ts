/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import {
  recentIngestionsQueryKey,
  useRecentIngestionCounts,
  useRecentIngestions
} from "@/hooks/useRecentIngestions";

jest.mock("@/api/mailboxAssignments", () => ({
  fetchMailboxRecentIngestions: jest.fn()
}));

const { fetchMailboxRecentIngestions } = jest.requireMock("@/api/mailboxAssignments") as {
  fetchMailboxRecentIngestions: jest.Mock;
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("hooks/useRecentIngestions", () => {
  it("recentIngestionsQueryKey is stable and includes assignmentId/days/limit", () => {
    expect(recentIngestionsQueryKey("a-1", 30, 50)).toEqual([
      "mailboxRecentIngestions",
      "a-1",
      30,
      50
    ]);
    expect(recentIngestionsQueryKey("a-1", 30)).toEqual([
      "mailboxRecentIngestions",
      "a-1",
      30,
      null
    ]);
  });

  it("useRecentIngestions fetches with the supplied params and returns data", async () => {
    fetchMailboxRecentIngestions.mockResolvedValueOnce({
      items: [{ _id: "inv-1" }],
      total: 1,
      periodDays: 30,
      truncatedAt: 50
    });
    const { result } = renderHook(
      () => useRecentIngestions({ assignmentId: "a-1", days: 30, limit: 50 }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMailboxRecentIngestions).toHaveBeenCalledWith("a-1", { days: 30, limit: 50 });
    expect(result.current.data?.total).toBe(1);
  });

  it("useRecentIngestions is disabled when enabled=false (no fetch)", async () => {
    renderHook(
      () => useRecentIngestions({ assignmentId: "a-1", days: 30, enabled: false }),
      { wrapper: makeWrapper() }
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMailboxRecentIngestions).not.toHaveBeenCalled();
  });

  it("useRecentIngestionCounts fans out one query per id with limit=1 and surfaces totals", async () => {
    fetchMailboxRecentIngestions.mockImplementation((id: string) =>
      Promise.resolve({
        items: [],
        total: id === "a-1" ? 12 : 4,
        periodDays: 30,
        truncatedAt: 1
      })
    );
    const { result } = renderHook(
      () => useRecentIngestionCounts({ assignmentIds: ["a-1", "a-2"], days: 30 }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => {
      expect(result.current.countsById["a-1"]).toBe(12);
      expect(result.current.countsById["a-2"]).toBe(4);
    });
    expect(fetchMailboxRecentIngestions).toHaveBeenCalledWith("a-1", { days: 30, limit: 1 });
    expect(fetchMailboxRecentIngestions).toHaveBeenCalledWith("a-2", { days: 30, limit: 1 });
  });

  it("useRecentIngestionCounts handles the empty-id list without firing requests", () => {
    const { result } = renderHook(
      () => useRecentIngestionCounts({ assignmentIds: [], days: 30 }),
      { wrapper: makeWrapper() }
    );
    expect(fetchMailboxRecentIngestions).not.toHaveBeenCalled();
    expect(result.current.countsById).toEqual({});
  });
});
