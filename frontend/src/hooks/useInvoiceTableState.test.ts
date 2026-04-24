/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useInvoiceTableState, SORT_DIRECTION } from "@/hooks/useInvoiceTableState";
import type { Invoice } from "@/types";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    _id: "inv-1",
    tenantId: "t-1",
    status: "PARSED",
    attachmentName: "file.pdf",
    receivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    parsed: {},
    ...overrides
  } as Invoice;
}

beforeEach(() => {
  localStorage.clear();
});

describe("useInvoiceTableState", () => {
  it("initialises pagination defaults and respects initialPageSize", () => {
    const { result } = renderHook(() => useInvoiceTableState({ initialPageSize: 50 }));
    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.totalInvoices).toBe(0);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.sortColumn).toBeNull();
    expect(result.current.sortDirection).toBe(SORT_DIRECTION.ASC);
  });

  it("persists sort column and direction to localStorage", () => {
    const { result } = renderHook(() => useInvoiceTableState());

    act(() => {
      result.current.setSortColumn("total");
    });
    expect(localStorage.getItem("ledgerbuddy:sort-col")).toBe("total");
    expect(result.current.sortColumn).toBe("total");

    act(() => {
      result.current.setSortDirection((prev) =>
        prev === SORT_DIRECTION.ASC ? SORT_DIRECTION.DESC : SORT_DIRECTION.ASC
      );
    });
    expect(localStorage.getItem("ledgerbuddy:sort-dir")).toBe(SORT_DIRECTION.DESC);
    expect(result.current.sortDirection).toBe(SORT_DIRECTION.DESC);
  });

  it("rehydrates sort state from localStorage on mount", () => {
    localStorage.setItem("ledgerbuddy:sort-col", "invoiceDate");
    localStorage.setItem("ledgerbuddy:sort-dir", "desc");

    const { result } = renderHook(() => useInvoiceTableState());

    expect(result.current.sortColumn).toBe("invoiceDate");
    expect(result.current.sortDirection).toBe(SORT_DIRECTION.DESC);
  });

  it("toggles selection for selectable invoices and ignores non-selectable ones", () => {
    const { result } = renderHook(() => useInvoiceTableState());
    const selectable = makeInvoice({ _id: "a", status: "PARSED" });
    const nonSelectable = makeInvoice({ _id: "b", status: "PENDING" });

    act(() => {
      result.current.toggleSelection(selectable);
    });
    expect(result.current.selectedIds).toEqual(["a"]);

    act(() => {
      result.current.toggleSelection(nonSelectable);
    });
    expect(result.current.selectedIds).toEqual(["a"]);

    act(() => {
      result.current.toggleSelection(selectable);
    });
    expect(result.current.selectedIds).toEqual([]);
  });

  it("toggleSelectAllVisible adds all visible when none are selected and clears them when all are", () => {
    const { result } = renderHook(() => useInvoiceTableState());
    const visible = ["a", "b", "c"];

    act(() => {
      result.current.toggleSelectAllVisible(visible, false);
    });
    expect(result.current.selectedIds).toEqual(expect.arrayContaining(visible));
    expect(result.current.selectedIds).toHaveLength(3);

    act(() => {
      result.current.toggleSelectAllVisible(visible, true);
    });
    expect(result.current.selectedIds).toEqual([]);
  });

  it("toggleSelectAllVisible preserves off-page selections when clearing visible", () => {
    const { result } = renderHook(() => useInvoiceTableState());

    act(() => {
      result.current.setSelectedIds(["off-page", "a"]);
    });

    act(() => {
      result.current.toggleSelectAllVisible(["a", "b"], false);
    });
    expect(result.current.selectedIds.sort()).toEqual(["a", "b", "off-page"].sort());

    act(() => {
      result.current.toggleSelectAllVisible(["a", "b"], true);
    });
    expect(result.current.selectedIds).toEqual(["off-page"]);
  });

  it("clearSelection and removeFromSelection behave as expected", () => {
    const { result } = renderHook(() => useInvoiceTableState());

    act(() => {
      result.current.setSelectedIds(["a", "b", "c"]);
    });

    act(() => {
      result.current.removeFromSelection(["b"]);
    });
    expect(result.current.selectedIds).toEqual(["a", "c"]);

    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selectedIds).toEqual([]);
  });

  it("reconcileWithLoaded drops selected ids whose loaded invoice is no longer selectable", () => {
    const { result } = renderHook(() => useInvoiceTableState());

    act(() => {
      result.current.setSelectedIds(["a", "b", "off-page"]);
    });

    act(() => {
      result.current.reconcileWithLoaded([
        makeInvoice({ _id: "a", status: "PARSED" }),
        makeInvoice({ _id: "b", status: "PENDING" })
      ]);
    });

    expect(result.current.selectedIds.sort()).toEqual(["a", "off-page"]);
  });
});
