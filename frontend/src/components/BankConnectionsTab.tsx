import { useState } from "react";
import type { BankAccount, TenantMailbox } from "../types";
import { EmptyState } from "./EmptyState";

interface BankConnectionsTabProps {
  mailboxes: TenantMailbox[];
  tenantUsers: Array<{ userId: string; email: string; role: "TENANT_ADMIN" | "MEMBER"; enabled: boolean }>;
  onAddGmailInbox: () => void;
  onAssignMailboxUser: (integrationId: string, userId: string) => void;
  onRemoveMailboxAssignment: (integrationId: string, userId: string) => void;
  onRemoveMailbox: (integrationId: string) => void;
  bankAccounts: BankAccount[];
  onAddBankAccount: (aaAddress: string, displayName: string) => void;
  onRefreshBankBalance: (id: string) => void;
  onRevokeBankAccount: (id: string) => void;
}

function fmtInr(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function BankStatusBadge({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "bank-status-badge bank-status-active"
      : status === "pending_consent"
        ? "bank-status-badge bank-status-pending"
        : "bank-status-badge bank-status-error";
  return <span className={cls}>{status.replace("_", " ")}</span>;
}

export function BankConnectionsTab({
  mailboxes,
  tenantUsers,
  onAddGmailInbox,
  onAssignMailboxUser,
  onRemoveMailboxAssignment,
  onRemoveMailbox,
  bankAccounts,
  onAddBankAccount,
  onRefreshBankBalance,
  onRevokeBankAccount
}: BankConnectionsTabProps) {
  const [aaAddress, setAaAddress] = useState("");
  const [displayName, setDisplayName] = useState("");

  function handleAddBank() {
    if (!aaAddress.trim()) return;
    onAddBankAccount(aaAddress.trim(), displayName.trim());
    setAaAddress("");
    setDisplayName("");
  }

  return (
    <div className="bank-connections">
      <div className="editor-card">
        <div className="editor-header">
          <h3>Email Inboxes</h3>
          <button type="button" className="app-button app-button-secondary" onClick={onAddGmailInbox}>
            Add Gmail Inbox
          </button>
        </div>
        {mailboxes.length === 0 ? (
          <EmptyState icon="mail" heading="No inboxes connected" description="Connect a Gmail inbox to automatically receive and process invoices." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
            {mailboxes.map((mailbox) => (
              <div key={mailbox._id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{mailbox.emailAddress ?? "(unknown)"}</span>
                  <span className={`bank-status-badge ${mailbox.status === "connected" ? "bank-status-active" : "bank-status-error"}`}>
                    {mailbox.status}
                  </span>
                  {mailbox.lastSyncedAt ? (
                    <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                      Last synced: {new Date(mailbox.lastSyncedAt).toLocaleString()}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="app-button app-button-danger"
                    style={{ marginLeft: "auto", fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
                    onClick={() => onRemoveMailbox(mailbox._id)}
                  >
                    Remove inbox
                  </button>
                </div>
                <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.82rem", color: "var(--ink-soft)" }}>
                    Assigned to:{" "}
                    {mailbox.assignments === "all" ? (
                      <strong>All users</strong>
                    ) : mailbox.assignments.length === 0 ? (
                      <em>No one</em>
                    ) : (
                      mailbox.assignments.map((a) => (
                        <span key={a.userId} style={{ marginRight: "0.4rem" }}>
                          {a.email}
                          <button
                            type="button"
                            className="app-button app-button-secondary"
                            style={{ fontSize: "0.72rem", padding: "0.1rem 0.4rem", marginLeft: "0.25rem" }}
                            onClick={() => onRemoveMailboxAssignment(mailbox._id, a.userId)}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </span>
                  {mailbox.assignments !== "all" && (
                    <select
                      style={{ fontSize: "0.82rem" }}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) onAssignMailboxUser(mailbox._id, e.target.value);
                        e.target.value = "";
                      }}
                    >
                      <option value="" disabled>Add user…</option>
                      {tenantUsers
                        .filter((u) => {
                          const assigned = mailbox.assignments as Array<{ userId: string }>;
                          return !assigned.some((a) => a.userId === u.userId);
                        })
                        .map((u) => (
                          <option key={u.userId} value={u.userId}>{u.email}</option>
                        ))}
                    </select>
                  )}
                  {mailbox.assignments === "all" && (
                    <button
                      type="button"
                      className="app-button app-button-secondary"
                      style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
                      onClick={() => onRemoveMailboxAssignment(mailbox._id, "all")}
                    >
                      Restrict to specific users
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="editor-card">
        <div className="editor-header">
          <h3>Bank Accounts</h3>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <input
            value={aaAddress}
            onChange={(e) => setAaAddress(e.target.value)}
            placeholder="AA address (e.g. user@bankaa)"
            style={{ flex: "1 1 200px" }}
          />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            style={{ flex: "1 1 160px" }}
          />
          <button
            type="button"
            className="app-button app-button-secondary"
            disabled={!aaAddress.trim()}
            onClick={handleAddBank}
          >
            Add bank account
          </button>
        </div>

        {bankAccounts.length === 0 ? (
          <EmptyState icon="account_balance" heading="No bank accounts connected" description="Link a bank account via Account Aggregator to view balances." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {bankAccounts.map((account) => (
              <div key={account._id} className="bank-account-card">
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{account.displayName ?? account.aaAddress}</span>
                    {account.bankName ? <span className="bank-account-meta">{account.bankName}</span> : null}
                    {account.maskedAccNumber ? <span className="bank-account-meta">{account.maskedAccNumber}</span> : null}
                    <BankStatusBadge status={account.status} />
                  </div>
                  {account.balanceMinor != null ? (
                    <div style={{ marginTop: "0.25rem" }}>
                      <span className="bank-account-balance">{fmtInr(account.balanceMinor)}</span>
                      {account.balanceFetchedAt ? (
                        <span className="bank-account-meta" style={{ marginLeft: "0.5rem" }}>
                          as of {new Date(account.balanceFetchedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {account.lastErrorReason ? (
                    <div className="bank-account-meta" style={{ color: "#991b1b", marginTop: "0.2rem" }}>
                      {account.lastErrorReason}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  <button
                    type="button"
                    className="app-button app-button-secondary"
                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
                    onClick={() => onRefreshBankBalance(account._id)}
                    disabled={account.status !== "active"}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-danger"
                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
                    onClick={() => onRevokeBankAccount(account._id)}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
