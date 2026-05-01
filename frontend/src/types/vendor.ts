export const VENDOR_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  BLOCKED: "blocked",
  MERGED: "merged"
} as const;

export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];

export const VENDOR_STATUSES: readonly VendorStatus[] = Object.values(VENDOR_STATUS);

export const VENDOR_SORT_FIELD = {
  NAME: "name",
  LAST_INVOICE_DATE: "lastInvoiceDate",
  FYTD_SPEND: "fytdSpendMinor",
  FYTD_TDS: "fytdTdsMinor"
} as const;

export type VendorSortField = (typeof VENDOR_SORT_FIELD)[keyof typeof VENDOR_SORT_FIELD];

export const VENDOR_SORT_FIELDS: readonly VendorSortField[] = Object.values(VENDOR_SORT_FIELD);

export const VENDOR_SORT_DIRECTION = {
  ASC: "asc",
  DESC: "desc"
} as const;

export type VendorSortDirection = (typeof VENDOR_SORT_DIRECTION)[keyof typeof VENDOR_SORT_DIRECTION];

export const VENDOR_PAGE_SIZE = {
  TWENTY_FIVE: 25,
  FIFTY: 50,
  HUNDRED: 100
} as const;

export type VendorPageSize = (typeof VENDOR_PAGE_SIZE)[keyof typeof VENDOR_PAGE_SIZE];

export const VENDOR_PAGE_SIZES: readonly VendorPageSize[] = Object.values(VENDOR_PAGE_SIZE);

export type VendorId = string & { readonly __brand: "VendorId" };

export interface VendorListMsmeSummary {
  classification: string;
  agreedPaymentDays: number | null;
}

export interface VendorListSection197Summary {
  certificateNumber: string;
  validFrom: string;
  validTo: string;
}

export interface VendorListItemSummary {
  _id: VendorId;
  name: string;
  pan: string | null;
  gstin: string | null;
  vendorStatus: VendorStatus;
  msme: VendorListMsmeSummary | null;
  section197Cert: VendorListSection197Summary | null;
  invoiceCount: number;
  lastInvoiceDate: string | null;
  fytdSpendMinor: number | null;
  fytdTdsMinor: number | null;
}

export interface VendorListResponse {
  items: VendorListItemSummary[];
  page: number;
  limit: number;
  total: number;
}
