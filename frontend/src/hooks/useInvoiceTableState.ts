import { useCallback, useMemo, useState } from "react";
import type { Invoice } from "@/types";
import {
  isInvoiceSelectable,
  mergeSelectedIds,
  removeSelectedIds
} from "@/lib/common/selection";

export const SORT_DIRECTION = {
  ASC: "asc",
  DESC: "desc"
} as const;

type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];

const STORAGE_KEY = {
  SORT_COLUMN: "ledgerbuddy:sort-col",
  SORT_DIRECTION: "ledgerbuddy:sort-dir"
} as const;

interface UseInvoiceTableStateOptions {
  initialPageSize?: number;
}

interface UseInvoiceTableStateResult {
  currentPage: number;
  pageSize: number;
  totalInvoices: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: React.Dispatch<React.SetStateAction<number>>;
  setTotalInvoices: React.Dispatch<React.SetStateAction<number>>;

  sortColumn: string | null;
  sortDirection: SortDirection;
  setSortColumn: (column: string) => void;
  setSortDirection: (value: SortDirection | ((prev: SortDirection) => SortDirection)) => void;

  selectedIds: string[];
  toggleSelection: (invoice: Invoice) => void;
  toggleSelectAllVisible: (selectableVisibleIds: string[], areAllSelected: boolean) => void;
  clearSelection: () => void;
  removeFromSelection: (ids: string[]) => void;
  reconcileWithLoaded: (items: Invoice[]) => void;

  isRiskSignalsExpanded: (invoiceId: string) => boolean;
  toggleRiskSignalsExpanded: (invoiceId: string) => void;
  setRiskSignalsExpanded: (invoiceId: string, value: boolean) => void;
}

function readStoredSortDirection(): SortDirection {
  return localStorage.getItem(STORAGE_KEY.SORT_DIRECTION) === SORT_DIRECTION.DESC
    ? SORT_DIRECTION.DESC
    : SORT_DIRECTION.ASC;
}

export function useInvoiceTableState(
  options: UseInvoiceTableStateOptions = {}
): UseInvoiceTableStateResult {
  const { initialPageSize = 20 } = options;

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [totalInvoices, setTotalInvoices] = useState(0);

  const [sortColumn, setSortColumnRaw] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY.SORT_COLUMN)
  );
  const [sortDirection, setSortDirectionRaw] = useState<SortDirection>(readStoredSortDirection);

  const setSortColumn = useCallback((column: string) => {
    setSortColumnRaw(column);
    localStorage.setItem(STORAGE_KEY.SORT_COLUMN, column);
  }, []);

  const setSortDirection = useCallback(
    (value: SortDirection | ((prev: SortDirection) => SortDirection)) => {
      setSortDirectionRaw((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        localStorage.setItem(STORAGE_KEY.SORT_DIRECTION, next);
        return next;
      });
    },
    []
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [collapsedRiskRows, setCollapsedRiskRows] = useState<Record<string, true>>({});

  const isRiskSignalsExpanded = useCallback(
    (invoiceId: string) => collapsedRiskRows[invoiceId] !== true,
    [collapsedRiskRows]
  );

  const toggleRiskSignalsExpanded = useCallback((invoiceId: string) => {
    setCollapsedRiskRows((current) => {
      const next = { ...current };
      if (next[invoiceId]) {
        delete next[invoiceId];
      } else {
        next[invoiceId] = true;
      }
      return next;
    });
  }, []);

  const setRiskSignalsExpanded = useCallback((invoiceId: string, value: boolean) => {
    setCollapsedRiskRows((current) => {
      if (value) {
        if (!current[invoiceId]) return current;
        const next = { ...current };
        delete next[invoiceId];
        return next;
      }
      if (current[invoiceId]) return current;
      return { ...current, [invoiceId]: true };
    });
  }, []);

  const toggleSelection = useCallback((invoice: Invoice) => {
    if (!isInvoiceSelectable(invoice)) {
      return;
    }
    const id = invoice._id;
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((currentId) => currentId !== id) : [...current, id]
    );
  }, []);

  const toggleSelectAllVisible = useCallback(
    (selectableVisibleIds: string[], areAllSelected: boolean) => {
      if (selectableVisibleIds.length === 0) {
        return;
      }
      const visibleIdSet = new Set(selectableVisibleIds);
      setSelectedIds((current) => {
        if (areAllSelected) {
          return current.filter((selectedId) => !visibleIdSet.has(selectedId));
        }
        return Array.from(new Set([...current, ...selectableVisibleIds]));
      });
    },
    []
  );

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const removeFromSelection = useCallback((ids: string[]) => {
    setSelectedIds((current) => removeSelectedIds(current, ids));
  }, []);

  const reconcileWithLoaded = useCallback((items: Invoice[]) => {
    setSelectedIds((current) => mergeSelectedIds(current, items));
  }, []);

  return useMemo(
    () => ({
      currentPage,
      pageSize,
      totalInvoices,
      setCurrentPage,
      setPageSize,
      setTotalInvoices,
      sortColumn,
      sortDirection,
      setSortColumn,
      setSortDirection,
      selectedIds,
      toggleSelection,
      toggleSelectAllVisible,
      clearSelection,
      removeFromSelection,
      reconcileWithLoaded,
      isRiskSignalsExpanded,
      toggleRiskSignalsExpanded,
      setRiskSignalsExpanded
    }),
    [
      currentPage,
      pageSize,
      totalInvoices,
      sortColumn,
      sortDirection,
      setSortColumn,
      setSortDirection,
      selectedIds,
      toggleSelection,
      toggleSelectAllVisible,
      clearSelection,
      removeFromSelection,
      reconcileWithLoaded,
      isRiskSignalsExpanded,
      toggleRiskSignalsExpanded,
      setRiskSignalsExpanded
    ]
  );
}
