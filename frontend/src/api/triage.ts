import { apiClient } from "@/api/client";
import { triageUrls } from "@/api/urls/triageUrls";
import type { TriageRejectPayload } from "@/features/triage/triageReasons";

export const TRIAGE_QUEUE_QUERY_KEY = ["triageQueue"] as const;

export interface TriageInvoice {
  _id: string;
  tenantId: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  vendorGstin: string | null;
  customerName: string | null;
  customerGstin: string | null;
  totalAmountMinor: number | null;
  currency: string | null;
  sourceMailbox: string | null;
  receivedAt: string;
  status: "PENDING_TRIAGE";
}

export interface TriageListResponse {
  items: TriageInvoice[];
  total: number;
}

export async function fetchTriageInvoices(): Promise<TriageListResponse> {
  const response = await apiClient.get<TriageListResponse>(triageUrls.triageList(), {
    params: { status: "PENDING_TRIAGE" }
  });
  const data = response.data;
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total: typeof data?.total === "number" ? data.total : 0
  };
}

export async function assignClientOrg(
  invoiceId: string,
  clientOrgId: string
): Promise<{ ok: true }> {
  return (
    await apiClient.patch<{ ok: true }>(
      triageUrls.assignClientOrg(invoiceId),
      { clientOrgId }
    )
  ).data;
}

export async function rejectInvoice(
  invoiceId: string,
  payload: TriageRejectPayload
): Promise<{ ok: true }> {
  return (
    await apiClient.patch<{ ok: true }>(
      triageUrls.reject(invoiceId),
      payload
    )
  ).data;
}
