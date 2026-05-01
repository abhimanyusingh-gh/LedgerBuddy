import { apiClient } from "@/api/client";
import { complianceUrls } from "@/api/urls/complianceUrls";
import {
  VENDOR_SORT_DIRECTION,
  VENDOR_SORT_FIELD,
  type Section197CertInput,
  type VendorDetail,
  type VendorId,
  type VendorListResponse,
  type VendorMergeResult,
  type VendorSortDirection,
  type VendorSortField,
  type VendorStatus
} from "@/types/vendor";

export interface VendorListItem {
  _id: string;
  name: string;
  pan: string | null;
  gstin: string | null;
  msme: { classification: string; agreedPaymentDays: number | null } | null;
  invoiceCount: number;
  lastInvoiceDate: string;
}

export async function fetchVendors(params: { hasMsme?: boolean; page?: number; limit?: number }): Promise<{ items: VendorListItem[]; page: number; limit: number; total: number }> {
  const response = await apiClient.get<{ items: VendorListItem[]; page: number; limit: number; total: number }>(complianceUrls.vendorsList(), {
    params: {
      hasMsme: params.hasMsme ? "true" : undefined,
      page: params.page ?? 1,
      limit: params.limit ?? 50
    }
  });
  return response.data;
}

export async function updateVendorMsme(id: string, agreedPaymentDays: number | null): Promise<unknown> {
  return (await apiClient.patch(complianceUrls.vendorUpdate(id), { msme: { agreedPaymentDays } })).data;
}

interface FetchVendorListParams {
  search?: string;
  status?: VendorStatus | null;
  hasMsme?: boolean | null;
  hasSection197Cert?: boolean | null;
  sortField?: VendorSortField;
  sortDirection?: VendorSortDirection;
  page?: number;
  limit?: number;
}

const TRI_BOOL_PARAM = {
  TRUE: "true",
  FALSE: "false"
} as const;

function triBool(value: boolean | null | undefined): string | undefined {
  if (value === true) return TRI_BOOL_PARAM.TRUE;
  if (value === false) return TRI_BOOL_PARAM.FALSE;
  return undefined;
}

export async function fetchVendorDetail(id: VendorId): Promise<VendorDetail> {
  const response = await apiClient.get<VendorDetail>(complianceUrls.vendorById(id));
  return response.data;
}

export async function uploadVendorSection197Cert(id: VendorId, payload: Section197CertInput): Promise<VendorDetail> {
  const response = await apiClient.post<VendorDetail>(complianceUrls.vendorSection197Cert(id), payload);
  return response.data;
}

export async function mergeVendor(targetId: VendorId, sourceVendorId: VendorId): Promise<VendorMergeResult> {
  const response = await apiClient.post<VendorMergeResult>(complianceUrls.vendorMerge(targetId), { sourceVendorId });
  return response.data;
}

export async function fetchVendorList(params: FetchVendorListParams): Promise<VendorListResponse> {
  const response = await apiClient.get<VendorListResponse>(complianceUrls.vendorsList(), {
    params: {
      search: params.search?.trim() ? params.search.trim() : undefined,
      status: params.status ?? undefined,
      hasMsme: triBool(params.hasMsme),
      hasSection197Cert: triBool(params.hasSection197Cert),
      sortField: params.sortField ?? VENDOR_SORT_FIELD.LAST_INVOICE_DATE,
      sortDirection: params.sortDirection ?? VENDOR_SORT_DIRECTION.DESC,
      page: params.page ?? 1,
      limit: params.limit ?? 50
    }
  });
  const data = response.data;
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    page: typeof data?.page === "number" ? data.page : 1,
    limit: typeof data?.limit === "number" ? data.limit : 50,
    total: typeof data?.total === "number" ? data.total : 0
  };
}
