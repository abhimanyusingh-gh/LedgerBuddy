import { useCallback, useMemo, useState } from "react";
import type { Invoice } from "@/types";
import {
  isInvoiceSelectable,
  mergeSelectedIds,
  removeSelectedIds
} from "@/lib/common/selection";
import { useUserPrefsStore, SORT_DIRECTION } from "@/stores/userPrefsStore";

export { SORT_DIRECTION };

type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];

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
}

export function useInvoiceTableState(
  options: UseInvoiceTableStateOptions = {}
): UseInvoiceTableStateResult {
  const { initialPageSize = 20 } = options;

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [totalInvoices, setTotalInvoices] = useState(0);

  const sortColumn = useUserPrefsStore((state) => state.invoiceView.sortColumn);
  const sortDirection = useUserPrefsStore((state) => state.invoiceView.sortDirection);
  const setInvoiceView = useUserPrefsStore((state) => state.setInvoiceView);

  const setSortColumn = useCallback(
    (column: string) => {
      setInvoiceView({ sortColumn: column });
    },
    [setInvoiceView]
  );

  const setSortDirection = useCallback(
    (value: SortDirection | ((prev: SortDirection) => SortDirection)) => {
      const prev = useUserPrefsStore.getState().invoiceView.sortDirection;
      const next = typeof value === "function" ? value(prev) : value;
      setInvoiceView({ sortDirection: next });
    },
    [setInvoiceView]
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
      toggleRiskSignalsExpanded
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
      toggleRiskSignalsExpanded
    ]
  );
}
