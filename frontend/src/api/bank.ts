import { apiClient, getStoredSessionToken } from "@/api/client";
import { bankUrls } from "@/api/urls/bankUrls";
import type { BankAccount, BankStatementSummary } from "@/types";

export interface BankParseProgressEvent {
  type: "start" | "progress" | "complete" | "error";
  fileName?: string;
  statementId?: string;
  stage?: "ocr" | "text-extraction" | "slm-chunk" | "validation";
  chunk?: number;
  totalChunks?: number;
  transactionsSoFar?: number;
  transactionCount?: number;
  warnings?: string[];
  message?: string;
}

function sanitizeBankParseEvent(value: unknown): BankParseProgressEvent {
  const data = value as Partial<BankParseProgressEvent>;
  const validTypes = ["start", "progress", "complete", "error"] as const;
  return {
    type: validTypes.includes(data.type as typeof validTypes[number]) ? data.type! : "progress",
    fileName: typeof data.fileName === "string" ? data.fileName : undefined,
    statementId: typeof data.statementId === "string" ? data.statementId : undefined,
    stage: data.stage as BankParseProgressEvent["stage"],
    chunk: typeof data.chunk === "number" ? data.chunk : undefined,
    totalChunks: typeof data.totalChunks === "number" ? data.totalChunks : undefined,
    transactionsSoFar: typeof data.transactionsSoFar === "number" ? data.transactionsSoFar : undefined,
    transactionCount: typeof data.transactionCount === "number" ? data.transactionCount : undefined,
    warnings: Array.isArray(data.warnings) ? data.warnings : undefined,
    message: typeof data.message === "string" ? data.message : undefined
  };
}

export function subscribeBankParseSSE(
  onMessage: (event: BankParseProgressEvent) => void,
  onError?: () => void
): () => void {
  const url = `${apiClient.defaults.baseURL ?? ""}/bank-statements/parse/sse`;
  const resolved = new URL(url, window.location.origin);
  const token = getStoredSessionToken();
  if (token) resolved.searchParams.set("authToken", token);
  let disposed = false;
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (disposed) return;
    source = new EventSource(resolved.toString());
    source.onmessage = (e) => onMessage(sanitizeBankParseEvent(JSON.parse(e.data)));
    source.onerror = () => {
      if (source) {
        source.close();
        source = null;
      }
      onError?.();
      if (!disposed && reconnectTimer == null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 2000);
      }
    };
  };

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
    }
    source?.close();
  };
}

export async function fetchMailboxes(): Promise<import("@/types").TenantMailbox[]> {
  return (await apiClient.get<{ items: import("@/types").TenantMailbox[] }>("/admin/mailboxes")).data.items;
}

export async function assignMailboxUser(integrationId: string, userId: string): Promise<void> {
  await apiClient.post(`/admin/mailboxes/${integrationId}/assign`, { userId });
}

export async function removeMailboxAssignment(integrationId: string, userId: string): Promise<void> {
  await apiClient.delete(`/admin/mailboxes/${integrationId}/assign/${userId}`);
}

export async function removeMailbox(integrationId: string): Promise<void> {
  await apiClient.delete(`/admin/mailboxes/${integrationId}`);
}

export async function fetchBankAccounts(): Promise<BankAccount[]> {
  return (await apiClient.get<{ items: BankAccount[] }>(bankUrls.accountsList())).data.items;
}

export async function initiateBankConsent(aaAddress: string, displayName: string): Promise<{ _id: string; redirectUrl: string }> {
  return (await apiClient.post<{ _id: string; redirectUrl: string }>(bankUrls.accountsCreate(), { aaAddress, displayName })).data;
}

export async function revokeBankAccount(id: string): Promise<void> {
  await apiClient.delete(bankUrls.accountDelete(id));
}

export async function refreshBankBalance(id: string): Promise<void> {
  await apiClient.post(bankUrls.accountRefresh(id));
}

export interface BankStatementFilterParams {
  accountName?: string;
  periodFrom?: string;
  periodTo?: string;
  page?: number;
  limit?: number;
}

export async function fetchBankStatements(params?: BankStatementFilterParams): Promise<{
  items: BankStatementSummary[];
  total: number;
  page: number;
  limit: number;
}> {
  return (await apiClient.get<{
    items: BankStatementSummary[];
    total: number;
    page: number;
    limit: number;
  }>(bankUrls.statementsList(), { params })).data;
}

export async function uploadBankStatement(file: File, columnMapping?: Record<string, number>, gstin?: string, gstinLabel?: string): Promise<{
  statementId: string;
  transactionCount: number;
  matched: number;
  suggested: number;
  unmatched: number;
}> {
  const formData = new FormData();
  formData.append("file", file);
  if (columnMapping) formData.append("columnMapping", JSON.stringify(columnMapping));
  if (gstin) formData.append("gstin", gstin);
  if (gstinLabel) formData.append("gstinLabel", gstinLabel);
  return (await apiClient.post(bankUrls.statementUpload(), formData, {
    headers: { "Content-Type": "multipart/form-data" }
  })).data;
}

export async function fetchStatementMatches(statementId: string): Promise<{ items: import("@/types").ReconciliationMatchItem[]; summary: { totalTransactions: number; matched: number; suggested: number; unmatched: number } }> {
  return (await apiClient.get(bankUrls.statementMatches(statementId))).data;
}

export async function updateStatementGstin(statementId: string, gstin: string, label?: string): Promise<void> {
  await apiClient.put(bankUrls.statementGstin(statementId), { gstin, label });
}

export async function fetchVendorGstins(): Promise<Array<{ gstin: string; vendorName: string; label: string }>> {
  return (await apiClient.get<{ items: Array<{ gstin: string; vendorName: string; label: string }> }>(bankUrls.vendorGstins())).data.items;
}

export interface BankTransactionFilterParams {
  status?: string;
  matchStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function fetchBankTransactions(statementId: string, params?: BankTransactionFilterParams): Promise<{ items: import("@/types").BankTransactionEntry[]; total: number; page: number; limit: number }> {
  return (await apiClient.get(bankUrls.statementTransactions(statementId), { params })).data;
}

export async function reconcileStatement(statementId: string): Promise<{ matched: number; suggested: number; unmatched: number }> {
  return (await apiClient.post(bankUrls.statementReconcile(statementId))).data;
}

export async function matchTransactionToInvoice(transactionId: string, invoiceId: string): Promise<void> {
  await apiClient.post(bankUrls.transactionMatch(transactionId), { invoiceId });
}

export async function unmatchTransaction(transactionId: string): Promise<void> {
  await apiClient.delete(bankUrls.transactionMatch(transactionId));
}

export interface AccountNameOption {
  bankName: string;
  accountNumberMasked: string;
  label: string;
}

export async function fetchAccountNames(): Promise<AccountNameOption[]> {
  return (await apiClient.get<{ items: AccountNameOption[] }>(bankUrls.accountNames())).data.items;
}
