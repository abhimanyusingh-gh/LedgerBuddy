/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useInvoiceTableState, SORT_DIRECTION } from "@/hooks/useInvoiceTableState";
import type { Invoice } from "@/types";

function makeInvoice(overrides: Pick<Invoice, "_id" | "status">): Invoice {
  return { ...overrides } as Invoice;
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
      result.current.toggleSelectAllVisible(["off-page", "a"], false);
    });
    expect(result.current.selectedIds.sort()).toEqual(["a", "off-page"]);

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
      result.current.toggleSelectAllVisible(["a", "b", "c"], false);
    });

    act(() => {
      result.current.removeFromSelection(["b"]);
    });
    expect(result.current.selectedIds.sort()).toEqual(["a", "c"]);

    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selectedIds).toEqual([]);
  });

  it("risk signals are expanded by default and toggle between expanded/collapsed", () => {
    const { result } = renderHook(() => useInvoiceTableState());

    expect(result.current.isRiskSignalsExpanded("inv-1")).toBe(true);

    act(() => {
      result.current.toggleRiskSignalsExpanded("inv-1");
    });
    expect(result.current.isRiskSignalsExpanded("inv-1")).toBe(false);
    expect(result.current.isRiskSignalsExpanded("inv-2")).toBe(true);

    act(() => {
      result.current.toggleRiskSignalsExpanded("inv-1");
    });
    expect(result.current.isRiskSignalsExpanded("inv-1")).toBe(true);
  });

  it("setRiskSignalsExpanded writes the explicit expanded/collapsed state", () => {
    const { result } = renderHook(() => useInvoiceTableState());

    act(() => {
      result.current.setRiskSignalsExpanded("inv-1", false);
    });
    expect(result.current.isRiskSignalsExpanded("inv-1")).toBe(false);

    act(() => {
      result.current.setRiskSignalsExpanded("inv-1", true);
    });
    expect(result.current.isRiskSignalsExpanded("inv-1")).toBe(true);
  });

  it("reconcileWithLoaded drops selected ids whose loaded invoice is no longer selectable", () => {
    const { result } = renderHook(() => useInvoiceTableState());

    act(() => {
      result.current.toggleSelectAllVisible(["a", "b", "off-page"], false);
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
