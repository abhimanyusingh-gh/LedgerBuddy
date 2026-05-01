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

export interface VendorSection197Cert {
  certificateNumber: string;
  validFrom: string;
  validTo: string;
  maxAmountMinor: number;
  applicableRateBps: number;
}

export interface VendorMsmeDetail {
  udyamNumber: string | null;
  classification: string | null;
  verifiedAt: string | null;
  agreedPaymentDays: number | null;
}

export interface VendorDetail {
  _id: VendorId;
  vendorFingerprint: string;
  name: string;
  pan: string | null;
  gstin: string | null;
  vendorStatus: VendorStatus;
  defaultGlCode: string | null;
  defaultTdsSection: string | null;
  tallyLedgerName: string | null;
  tallyLedgerGroup: string | null;
  stateCode: string | null;
  stateName: string | null;
  msme: VendorMsmeDetail | null;
  lowerDeductionCert: VendorSection197Cert | null;
  invoiceCount: number;
  lastInvoiceDate: string | null;
}

export const VENDOR_DETAIL_SUB_TAB = {
  INVOICES: "invoices",
  TDS: "tds",
  CERT197: "cert197"
} as const;

export type VendorDetailSubTab = (typeof VENDOR_DETAIL_SUB_TAB)[keyof typeof VENDOR_DETAIL_SUB_TAB];

export const VENDOR_DETAIL_SUB_TABS: readonly VendorDetailSubTab[] = Object.values(VENDOR_DETAIL_SUB_TAB);

export interface Section197CertInput {
  certificateNumber: string;
  validFrom: string;
  validTo: string;
  maxAmountMinor: number;
  applicableRateBps: number;
}

export interface VendorMergeResult {
  targetVendorId: VendorId;
  sourceVendorId: VendorId;
  ledgersConsolidated: number;
  invoicesRepointed: number;
}
