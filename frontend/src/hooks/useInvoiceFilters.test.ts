/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useInvoiceFilters, DATE_VALIDATION_ERROR } from "@/hooks/useInvoiceFilters";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useInvoiceFilters", () => {
  it("initialises defaults", () => {
    const { result } = renderHook(() => useInvoiceFilters());
    expect(result.current.searchQuery).toBe("");
    expect(result.current.debouncedSearch).toBe("");
    expect(result.current.statusFilter).toBe("ALL");
    expect(result.current.invoiceDateFrom).toBe("");
    expect(result.current.invoiceDateTo).toBe("");
    expect(result.current.approvedByFilter).toBe("");
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it("debounces the search query", () => {
    const { result } = renderHook(() => useInvoiceFilters({ searchDebounceMs: 300 }));

    act(() => {
      result.current.setSearchQuery("acme");
    });

    expect(result.current.searchQuery).toBe("acme");
    expect(result.current.debouncedSearch).toBe("");

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(result.current.debouncedSearch).toBe("");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.debouncedSearch).toBe("acme");
  });

  it("hasActiveFilters reflects any non-default filter", () => {
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => {
      result.current.setStatusFilter("APPROVED");
    });
    expect(result.current.hasActiveFilters).toBe(true);

    act(() => {
      result.current.setStatusFilter("ALL");
    });
    expect(result.current.hasActiveFilters).toBe(false);

    act(() => {
      result.current.setInvoiceDateFrom("2026-01-01");
    });
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it("hasActiveFilters ignores a whitespace-only search query", () => {
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => {
      result.current.setSearchQuery("   ");
    });

    expect(result.current.hasActiveFilters).toBe(false);
  });

  it("hasActiveFilters ignores approvedByFilter (kept separate from the clear-all bar)", () => {
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => {
      result.current.setApprovedByFilter("user@example.com");
    });

    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.approvedByFilter).toBe("user@example.com");
  });

  it("clearAllFilters resets the filters exposed by the toolbar clear button", () => {
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => {
      result.current.setSearchQuery("acme");
      result.current.setStatusFilter("FAILED");
      result.current.setInvoiceDateFrom("2026-01-01");
      result.current.setInvoiceDateTo("2026-02-01");
      result.current.setApprovedByFilter("user@example.com");
    });

    act(() => {
      result.current.clearAllFilters();
    });

    expect(result.current.searchQuery).toBe("");
    expect(result.current.statusFilter).toBe("ALL");
    expect(result.current.invoiceDateFrom).toBe("");
    expect(result.current.invoiceDateTo).toBe("");
    expect(result.current.approvedByFilter).toBe("user@example.com");
  });

  it("validateDateRange flags start > end", () => {
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => {
      result.current.setInvoiceDateFrom("2026-03-01");
      result.current.setInvoiceDateTo("2026-02-01");
    });

    expect(result.current.validateDateRange()).toBe(DATE_VALIDATION_ERROR.START_AFTER_END);
  });

  it("validateDateRange flags end more than one year in the future", () => {
    const { result } = renderHook(() => useInvoiceFilters());
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 2);
    const farFutureStr = farFuture.toISOString().slice(0, 10);

    act(() => {
      result.current.setInvoiceDateTo(farFutureStr);
    });

    expect(result.current.validateDateRange()).toBe(DATE_VALIDATION_ERROR.END_TOO_FAR);
  });

  it("validateDateRange returns null for a valid range", () => {
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => {
      result.current.setInvoiceDateFrom("2026-01-01");
      result.current.setInvoiceDateTo("2026-02-01");
    });

    expect(result.current.validateDateRange()).toBeNull();
  });
});
