import { useState, useEffect, useCallback } from "react";
import { fetchVendors, updateVendorMsme, type VendorListItem } from "@/api/vendors";
import { EmptyState } from "@/components/common/EmptyState";

const MSME_STATUTORY_MAX_DAYS = 45;

function computeDeadlineStatus(invoiceDate: string, effectiveDays: number): { label: string; color: string } | null {
  const invDate = new Date(invoiceDate);
  if (isNaN(invDate.getTime())) return null;
  const deadline = new Date(invDate.getTime() + effectiveDays * 86400000);
  const now = new Date();
  const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / 86400000);
  if (daysRemaining < 0) {
    return { label: `${Math.abs(daysRemaining)} days overdue`, color: "var(--warn, #ef4444)" };
  }
  if (daysRemaining <= 10) {
    return { label: `${daysRemaining} days remaining`, color: "var(--warn, #f59e0b)" };
  }
  return { label: `${daysRemaining} days remaining`, color: "var(--status-approved, #22c55e)" };
}

export function VendorMsmeSection() {
  const [vendors, setVendors] = useState<VendorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVendors = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchVendors({ hasMsme: true });
      setVendors(data.items);
    } catch {
      setError("Failed to load MSME vendors.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadVendors(); }, [loadVendors]);

  function startEdit(vendor: VendorListItem) {
    setEditingId(vendor._id);
    setEditValue(vendor.msme?.agreedPaymentDays != null ? String(vendor.msme.agreedPaymentDays) : "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setError(null);
  }

  async function saveEdit(vendorId: string) {
    const days = editValue.trim() === "" ? null : Number(editValue);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
      setError("Payment days must be a whole number between 1 and 365.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await updateVendorMsme(vendorId, days);
      setEditingId(null);
      setEditValue("");
      await loadVendors();
    } catch {
      setError("Failed to update payment terms.");
    } finally {
      setSaving(false);
    }
  }

  const msmeVendors = vendors.filter(
    (v) => v.msme?.classification === "micro" || v.msme?.classification === "small" || v.msme?.classification === "medium"
  );

  return (
    <div className="editor-card" style={{ marginTop: "1.5rem" }}>
      <h3 style={{ marginBottom: "0.75rem" }}>MSME Vendor Payment Terms</h3>
      {loading ? <p className="muted">Loading...</p> : null}

      {!loading && msmeVendors.length === 0 ? (
        <EmptyState
          icon="storefront"
          heading="No MSME vendors"
          description="MSME payment terms will appear here once vendors with Udyam registration are detected."
        />
      ) : null}

      {!loading && msmeVendors.length > 0 ? (
        <>
          <div className="list-scroll" style={{ maxHeight: "300px" }}>
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Classification</th>
                  <th>Agreed Days</th>
                  <th>Deadline</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {msmeVendors.map((v) => {
                  const isEditing = editingId === v._id;
                  const effectiveDays = Math.min(v.msme?.agreedPaymentDays ?? MSME_STATUTORY_MAX_DAYS, MSME_STATUTORY_MAX_DAYS);
                  const deadline = v.lastInvoiceDate ? computeDeadlineStatus(v.lastInvoiceDate, effectiveDays) : null;
                  const exceedsCap = (v.msme?.agreedPaymentDays ?? 0) > MSME_STATUTORY_MAX_DAYS;

                  return (
                    <tr key={v._id}>
                      <td>{v.name}</td>
                      <td style={{ textTransform: "capitalize" }}>{v.msme?.classification ?? "-"}</td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min={1}
                            max={365}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveEdit(v._id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            disabled={saving}
                            autoFocus
                            style={{ width: "4rem", fontSize: "0.82rem" }}
                          />
                        ) : (
                          <span>
                            {v.msme?.agreedPaymentDays != null ? v.msme.agreedPaymentDays : "-"}
                            {exceedsCap ? (
                              <span style={{ fontSize: "0.72rem", color: "var(--warn, #f59e0b)", marginLeft: "0.3rem" }}>
                                (capped at 45)
                              </span>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td>
                        {deadline ? (
                          <span style={{ fontSize: "0.82rem", fontWeight: deadline.label.includes("overdue") ? 700 : 400, color: deadline.color }}>
                            {deadline.label}
                          </span>
                        ) : "-"}
                      </td>
                      <td>
                        {isEditing ? (
                          <span style={{ display: "flex", gap: "0.3rem" }}>
                            <button type="button" className="app-button app-button-primary" style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem" }} onClick={() => void saveEdit(v._id)} disabled={saving}>
                              Save
                            </button>
                            <button type="button" className="app-button app-button-secondary" style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem" }} onClick={cancelEdit} disabled={saving}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="app-button app-button-secondary" style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem" }} onClick={() => startEdit(v)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--ink-soft, #666)", marginTop: "0.5rem" }}>
            Statutory limit: 45 days (MSMED Act). Agreed terms cannot exceed this.
          </p>
          {error ? <span style={{ color: "var(--warn)", fontSize: "0.82rem" }}>{error}</span> : null}
        </>
      ) : null}
    </div>
  );
}
