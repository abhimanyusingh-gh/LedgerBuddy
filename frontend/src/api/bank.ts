import { apiClient } from "./client";
import type { BankAccount, BankStatementSummary } from "../types";

export async function fetchMailboxes(): Promise<import("../types").TenantMailbox[]> {
  return (await apiClient.get<{ items: import("../types").TenantMailbox[] }>("/admin/mailboxes")).data.items;
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
  return (await apiClient.get<{ items: BankAccount[] }>("/bank/accounts")).data.items;
}

export async function initiateBankConsent(aaAddress: string, displayName: string): Promise<{ _id: string; redirectUrl: string }> {
  return (await apiClient.post<{ _id: string; redirectUrl: string }>("/bank/accounts", { aaAddress, displayName })).data;
}

export async function revokeBankAccount(id: string): Promise<void> {
  await apiClient.delete(`/bank/accounts/${id}`);
}

export async function refreshBankBalance(id: string): Promise<void> {
  await apiClient.post(`/bank/accounts/${id}/refresh`);
}

export async function fetchBankStatements(): Promise<BankStatementSummary[]> {
  return (await apiClient.get<{ items: BankStatementSummary[] }>("/bank-statements")).data.items;
}

export async function uploadBankStatementCsv(file: File, columnMapping?: Record<string, number>): Promise<{
  statementId: string;
  transactionCount: number;
  matched: number;
  suggested: number;
  unmatched: number;
}> {
  const formData = new FormData();
  formData.append("file", file);
  if (columnMapping) formData.append("columnMapping", JSON.stringify(columnMapping));
  return (await apiClient.post("/bank-statements/upload-csv", formData, {
    headers: { "Content-Type": "multipart/form-data" }
  })).data;
}

async function fetchBankTransactions(statementId: string, params?: { status?: string; page?: number; limit?: number }): Promise<{ items: import("../types").BankTransactionEntry[]; total: number }> {
  return (await apiClient.get(`/bank-statements/${statementId}/transactions`, { params })).data;
}

async function reconcileStatement(statementId: string): Promise<{ matched: number; suggested: number; unmatched: number }> {
  return (await apiClient.post(`/bank-statements/${statementId}/reconcile`)).data;
}

async function matchTransactionToInvoice(transactionId: string, invoiceId: string): Promise<void> {
  await apiClient.post(`/bank-statements/transactions/${transactionId}/match`, { invoiceId });
}
