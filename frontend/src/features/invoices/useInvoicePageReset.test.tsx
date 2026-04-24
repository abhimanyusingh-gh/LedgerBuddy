/**
 * @jest-environment jsdom
 */
import { useEffect, useRef } from "react";
import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useInvoiceTableState } from "@/hooks/useInvoiceTableState";
import { useInvoiceFilters } from "@/hooks/useInvoiceFilters";

type Harness = {
  currentPage: number;
  setPageSize: (value: number) => void;
  setStatusFilter: (value: "ALL" | "APPROVED") => void;
  setCurrentPage: (value: number) => void;
};

const harnessRef: { current: Harness | null } = { current: null };

function InvoiceViewHarness() {
  const { currentPage, setCurrentPage, pageSize, setPageSize } = useInvoiceTableState({
    initialPageSize: 20
  });
  const { statusFilter, setStatusFilter, invoiceDateFrom, invoiceDateTo, approvedByFilter } =
    useInvoiceFilters();

  const prevFiltersRef = useRef({
    statusFilter,
    invoiceDateFrom,
    invoiceDateTo,
    pageSize,
    approvedByFilter
  });

  useEffect(() => {
    const prev = prevFiltersRef.current;
    const filtersChanged =
      prev.statusFilter !== statusFilter ||
      prev.invoiceDateFrom !== invoiceDateFrom ||
      prev.invoiceDateTo !== invoiceDateTo ||
      prev.pageSize !== pageSize ||
      prev.approvedByFilter !== approvedByFilter;
    prevFiltersRef.current = {
      statusFilter,
      invoiceDateFrom,
      invoiceDateTo,
      pageSize,
      approvedByFilter
    };
    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [statusFilter, invoiceDateFrom, invoiceDateTo, pageSize, approvedByFilter, currentPage]);

  harnessRef.current = {
    currentPage,
    setPageSize,
    setStatusFilter: setStatusFilter as (value: "ALL" | "APPROVED") => void,
    setCurrentPage
  };

  return <div data-testid="current-page">{currentPage}</div>;
}

beforeEach(() => {
  harnessRef.current = null;
  localStorage.clear();
});

describe("InvoiceView cross-hook page-reset coupling", () => {
  it("resets currentPage to 1 when pageSize changes", () => {
    const { getByTestId } = render(<InvoiceViewHarness />);

    act(() => {
      harnessRef.current!.setCurrentPage(2);
    });
    expect(getByTestId("current-page").textContent).toBe("2");

    act(() => {
      harnessRef.current!.setPageSize(50);
    });
    expect(getByTestId("current-page").textContent).toBe("1");
  });

  it("resets currentPage to 1 when statusFilter changes", () => {
    const { getByTestId } = render(<InvoiceViewHarness />);

    act(() => {
      harnessRef.current!.setCurrentPage(3);
    });
    expect(getByTestId("current-page").textContent).toBe("3");

    act(() => {
      harnessRef.current!.setStatusFilter("APPROVED");
    });
    expect(getByTestId("current-page").textContent).toBe("1");
  });
});
