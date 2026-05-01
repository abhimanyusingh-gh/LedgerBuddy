import {
  VENDOR_PAGE_SIZE,
  VENDOR_PAGE_SIZES,
  VENDOR_SORT_DIRECTION,
  VENDOR_SORT_FIELD,
  VENDOR_SORT_FIELDS,
  VENDOR_STATUS,
  VENDOR_STATUSES,
  type VendorPageSize,
  type VendorSortDirection,
  type VendorSortField,
  type VendorStatus
} from "@/types/vendor";
import { STANDALONE_HASH_PATH } from "@/features/workspace/tabHashConfig";

export interface VendorListHashState {
  search: string;
  status: VendorStatus | null;
  hasMsme: boolean | null;
  hasSection197Cert: boolean | null;
  sortField: VendorSortField;
  sortDirection: VendorSortDirection;
  page: number;
  pageSize: VendorPageSize;
}

export const VENDOR_LIST_DEFAULT_STATE: VendorListHashState = {
  search: "",
  status: null,
  hasMsme: null,
  hasSection197Cert: null,
  sortField: VENDOR_SORT_FIELD.LAST_INVOICE_DATE,
  sortDirection: VENDOR_SORT_DIRECTION.DESC,
  page: 1,
  pageSize: VENDOR_PAGE_SIZE.FIFTY
};

const HASH_PARAM = {
  Q: "q",
  STATUS: "status",
  MSME: "msme",
  CERT197: "cert197",
  SORT: "sort",
  DIR: "dir",
  PAGE: "page",
  SIZE: "size"
} as const;

const TRI_BOOL = {
  YES: "yes",
  NO: "no"
} as const;

function parseTriBool(raw: string | null): boolean | null {
  if (raw === TRI_BOOL.YES) return true;
  if (raw === TRI_BOOL.NO) return false;
  return null;
}

function triBoolToParam(value: boolean | null): string | null {
  if (value === true) return TRI_BOOL.YES;
  if (value === false) return TRI_BOOL.NO;
  return null;
}

function parseStatus(raw: string | null): VendorStatus | null {
  if (!raw) return null;
  return (VENDOR_STATUSES as readonly string[]).includes(raw) ? (raw as VendorStatus) : null;
}

function parseSortField(raw: string | null): VendorSortField {
  if (raw && (VENDOR_SORT_FIELDS as readonly string[]).includes(raw)) {
    return raw as VendorSortField;
  }
  return VENDOR_LIST_DEFAULT_STATE.sortField;
}

function parseSortDirection(raw: string | null): VendorSortDirection {
  if (raw === VENDOR_SORT_DIRECTION.ASC || raw === VENDOR_SORT_DIRECTION.DESC) return raw;
  return VENDOR_LIST_DEFAULT_STATE.sortDirection;
}

function parsePage(raw: string | null): number {
  if (!raw) return VENDOR_LIST_DEFAULT_STATE.page;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return VENDOR_LIST_DEFAULT_STATE.page;
  return n;
}

function parsePageSize(raw: string | null): VendorPageSize {
  if (!raw) return VENDOR_LIST_DEFAULT_STATE.pageSize;
  const n = Number(raw);
  if ((VENDOR_PAGE_SIZES as readonly number[]).includes(n)) return n as VendorPageSize;
  return VENDOR_LIST_DEFAULT_STATE.pageSize;
}

function vendorListHashSearchString(hash: string): string {
  const base = STANDALONE_HASH_PATH.vendors;
  if (hash === base) return "";
  if (hash.startsWith(`${base}?`)) return hash.slice(base.length + 1);
  return "";
}

export function parseVendorListHash(hash: string): VendorListHashState {
  const search = vendorListHashSearchString(hash);
  const params = new URLSearchParams(search);
  return {
    search: params.get(HASH_PARAM.Q) ?? "",
    status: parseStatus(params.get(HASH_PARAM.STATUS)),
    hasMsme: parseTriBool(params.get(HASH_PARAM.MSME)),
    hasSection197Cert: parseTriBool(params.get(HASH_PARAM.CERT197)),
    sortField: parseSortField(params.get(HASH_PARAM.SORT)),
    sortDirection: parseSortDirection(params.get(HASH_PARAM.DIR)),
    page: parsePage(params.get(HASH_PARAM.PAGE)),
    pageSize: parsePageSize(params.get(HASH_PARAM.SIZE))
  };
}

export function buildVendorListHash(state: VendorListHashState): string {
  const base = STANDALONE_HASH_PATH.vendors;
  const params = new URLSearchParams();
  if (state.search.trim()) params.set(HASH_PARAM.Q, state.search.trim());
  if (state.status) params.set(HASH_PARAM.STATUS, state.status);
  const msme = triBoolToParam(state.hasMsme);
  if (msme !== null) params.set(HASH_PARAM.MSME, msme);
  const cert197 = triBoolToParam(state.hasSection197Cert);
  if (cert197 !== null) params.set(HASH_PARAM.CERT197, cert197);
  if (state.sortField !== VENDOR_LIST_DEFAULT_STATE.sortField) {
    params.set(HASH_PARAM.SORT, state.sortField);
  }
  if (state.sortDirection !== VENDOR_LIST_DEFAULT_STATE.sortDirection) {
    params.set(HASH_PARAM.DIR, state.sortDirection);
  }
  if (state.page !== VENDOR_LIST_DEFAULT_STATE.page) {
    params.set(HASH_PARAM.PAGE, String(state.page));
  }
  if (state.pageSize !== VENDOR_LIST_DEFAULT_STATE.pageSize) {
    params.set(HASH_PARAM.SIZE, String(state.pageSize));
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
