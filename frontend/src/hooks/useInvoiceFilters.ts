import { useCallback, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { STATUSES } from "@/lib/invoice/invoiceView";

export const DATE_VALIDATION_ERROR = {
  START_AFTER_END: "START_AFTER_END",
  END_TOO_FAR: "END_TOO_FAR"
} as const;

type DateValidationError = (typeof DATE_VALIDATION_ERROR)[keyof typeof DATE_VALIDATION_ERROR];

type StatusFilterValue = (typeof STATUSES)[number];

const SEARCH_DEBOUNCE_MS = 300;
const MAX_FUTURE_YEARS = 1;

interface UseInvoiceFiltersOptions {
  searchDebounceMs?: number;
}

interface UseInvoiceFiltersResult {
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  debouncedSearch: string;

  statusFilter: StatusFilterValue;
  setStatusFilter: React.Dispatch<React.SetStateAction<StatusFilterValue>>;

  invoiceDateFrom: string;
  setInvoiceDateFrom: React.Dispatch<React.SetStateAction<string>>;
  invoiceDateTo: string;
  setInvoiceDateTo: React.Dispatch<React.SetStateAction<string>>;

  approvedByFilter: string;
  setApprovedByFilter: React.Dispatch<React.SetStateAction<string>>;

  hasActiveFilters: boolean;
  clearAllFilters: () => void;
  validateDateRange: () => DateValidationError | null;
}

function computeMaxFutureDate(): string {
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + MAX_FUTURE_YEARS);
  return maxDate.toISOString().slice(0, 10);
}

export function useInvoiceFilters(
  options: UseInvoiceFiltersOptions = {}
): UseInvoiceFiltersResult {
  const { searchDebounceMs = SEARCH_DEBOUNCE_MS } = options;

  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, searchDebounceMs);

  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("ALL");
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");
  const [approvedByFilter, setApprovedByFilter] = useState("");

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    invoiceDateFrom !== "" ||
    invoiceDateTo !== "" ||
    statusFilter !== "ALL";

  const clearAllFilters = useCallback(() => {
    setSearchQuery("");
    setInvoiceDateFrom("");
    setInvoiceDateTo("");
    setStatusFilter("ALL");
  }, []);

  const validateDateRange = useCallback((): DateValidationError | null => {
    if (invoiceDateFrom && invoiceDateTo && invoiceDateFrom > invoiceDateTo) {
      return DATE_VALIDATION_ERROR.START_AFTER_END;
    }
    if (invoiceDateTo && invoiceDateTo > computeMaxFutureDate()) {
      return DATE_VALIDATION_ERROR.END_TOO_FAR;
    }
    return null;
  }, [invoiceDateFrom, invoiceDateTo]);

  return useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      debouncedSearch,
      statusFilter,
      setStatusFilter,
      invoiceDateFrom,
      setInvoiceDateFrom,
      invoiceDateTo,
      setInvoiceDateTo,
      approvedByFilter,
      setApprovedByFilter,
      hasActiveFilters,
      clearAllFilters,
      validateDateRange
    }),
    [
      searchQuery,
      debouncedSearch,
      statusFilter,
      invoiceDateFrom,
      invoiceDateTo,
      approvedByFilter,
      hasActiveFilters,
      clearAllFilters,
      validateDateRange
    ]
  );
}
