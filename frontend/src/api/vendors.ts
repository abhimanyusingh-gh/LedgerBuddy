import { apiClient } from "@/api/client";
import { complianceUrls } from "@/api/urls/complianceUrls";

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
