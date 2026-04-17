import { useCallback, useEffect, useState } from "react";
import { fetchComplianceConfig, saveComplianceConfig } from "@/api/admin";
import { getUserFacingErrorMessage } from "@/lib/common/apiError";

interface WeightFields {
  reconciliationWeightExactAmount: number;
  reconciliationWeightCloseAmount: number;
  reconciliationWeightInvoiceNumber: number;
  reconciliationWeightVendorName: number;
  reconciliationWeightDateProximity: number;
}

const DEFAULTS: WeightFields = {
  reconciliationWeightExactAmount: 50,
  reconciliationWeightCloseAmount: 10,
  reconciliationWeightInvoiceNumber: 30,
  reconciliationWeightVendorName: 20,
  reconciliationWeightDateProximity: 10
};

const FIELD_META: Array<{ key: keyof WeightFields; label: string; description: string }> = [
  { key: "reconciliationWeightExactAmount", label: "Exact Amount Match", description: "Weight when the bank debit matches the invoice net payable to the penny." },
  { key: "reconciliationWeightCloseAmount", label: "Close Amount Match", description: "Weight when the amounts are within tolerance but not exact." },
  { key: "reconciliationWeightInvoiceNumber", label: "Invoice Number Match", description: "Weight when the invoice number appears in the bank description." },
  { key: "reconciliationWeightVendorName", label: "Vendor Name Match", description: "Weight when vendor name words overlap with the bank description." },
  { key: "reconciliationWeightDateProximity", label: "Date Proximity", description: "Weight for transaction date being close to invoice/approval/due dates." }
];

const MAX_BUDGET = 300;

function computeTotalBudget(fields: WeightFields): number {
  return (
    fields.reconciliationWeightExactAmount +
    fields.reconciliationWeightCloseAmount +
    fields.reconciliationWeightInvoiceNumber +
    fields.reconciliationWeightVendorName +
    fields.reconciliationWeightDateProximity
  );
}

export function ReconciliationWeightsSection() {
  const [fields, setFields] = useState<WeightFields>({ ...DEFAULTS });
  const [savedFields, setSavedFields] = useState<string>(JSON.stringify(DEFAULTS));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const dirty = JSON.stringify(fields) !== savedFields;
  const totalBudget = computeTotalBudget(fields);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const config = await fetchComplianceConfig();
      const loaded: WeightFields = {
        reconciliationWeightExactAmount: config.reconciliationWeightExactAmount ?? DEFAULTS.reconciliationWeightExactAmount,
        reconciliationWeightCloseAmount: config.reconciliationWeightCloseAmount ?? DEFAULTS.reconciliationWeightCloseAmount,
        reconciliationWeightInvoiceNumber: config.reconciliationWeightInvoiceNumber ?? DEFAULTS.reconciliationWeightInvoiceNumber,
        reconciliationWeightVendorName: config.reconciliationWeightVendorName ?? DEFAULTS.reconciliationWeightVendorName,
        reconciliationWeightDateProximity: config.reconciliationWeightDateProximity ?? DEFAULTS.reconciliationWeightDateProximity
      };
      setFields(loaded);
      setSavedFields(JSON.stringify(loaded));
    } catch (err) {
      setLoadError(getUserFacingErrorMessage(err, "Failed to load reconciliation weights."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      const updated = await saveComplianceConfig(fields);
      const saved: WeightFields = {
        reconciliationWeightExactAmount: updated.reconciliationWeightExactAmount ?? DEFAULTS.reconciliationWeightExactAmount,
        reconciliationWeightCloseAmount: updated.reconciliationWeightCloseAmount ?? DEFAULTS.reconciliationWeightCloseAmount,
        reconciliationWeightInvoiceNumber: updated.reconciliationWeightInvoiceNumber ?? DEFAULTS.reconciliationWeightInvoiceNumber,
        reconciliationWeightVendorName: updated.reconciliationWeightVendorName ?? DEFAULTS.reconciliationWeightVendorName,
        reconciliationWeightDateProximity: updated.reconciliationWeightDateProximity ?? DEFAULTS.reconciliationWeightDateProximity
      };
      setFields(saved);
      setSavedFields(JSON.stringify(saved));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(getUserFacingErrorMessage(err, "Failed to save reconciliation weights."));
    } finally {
      setSaving(false);
    }
  }, [fields]);

  const handleFieldChange = useCallback((key: keyof WeightFields, raw: string) => {
    const parsed = parseInt(raw, 10);
    const clamped = isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed));
    setFields(prev => ({ ...prev, [key]: clamped }));
  }, []);

  if (loading) {
    return (
      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <p style={{ fontSize: "0.875rem", color: "var(--ink-soft, #666)" }}>Loading reconciliation weights...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.875rem" }}>{loadError}</p>
        <button type="button" className="app-button app-button-secondary" onClick={loadConfig}>Retry</button>
      </div>
    );
  }

  return (
    <div className="editor-card" style={{ marginTop: "1.5rem" }}>
      <div className="editor-header">
        <h3>Reconciliation Scoring Weights</h3>
      </div>

      <p style={{ fontSize: "0.8rem", color: "var(--ink-soft, #666)", marginTop: "0.5rem", marginBottom: "1rem" }}>
        Control how bank transactions are matched to invoices. Each weight determines the score contribution for that signal.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {FIELD_META.map(({ key, label, description }) => (
          <label key={key} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--ink-soft, #666)" }}>{description}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={fields[key]}
              onChange={e => handleFieldChange(key, e.target.value)}
              disabled={saving}
              aria-label={label}
              style={{ width: "5rem", fontSize: "0.875rem", marginTop: "0.25rem" }}
            />
          </label>
        ))}
      </div>

      <p
        style={{
          marginTop: "1rem",
          fontSize: "0.85rem",
          fontWeight: 500,
          color: totalBudget > MAX_BUDGET ? "var(--danger, #ef4444)" : "var(--ink-soft, #666)"
        }}
        data-testid="weight-budget"
      >
        Total weight budget: {totalBudget}/{MAX_BUDGET}
      </p>

      {saveError ? (
        <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.85rem", marginTop: "0.5rem" }} role="alert">{saveError}</p>
      ) : null}
      {saveSuccess ? (
        <p style={{ color: "var(--chart-emerald, #10b981)", fontSize: "0.85rem", marginTop: "0.5rem" }}>Reconciliation weights saved.</p>
      ) : null}

      {dirty ? (
        <div style={{ marginTop: "1rem" }}>
          <button type="button" className="app-button app-button-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Weights"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
