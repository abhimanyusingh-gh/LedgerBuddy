import { useCallback, useEffect, useState } from "react";
import { fetchComplianceConfig, saveComplianceConfig } from "@/api/admin";
import { getUserFacingErrorMessage } from "@/lib/common/apiError";

const WEIGHT_FIELDS = [
  {
    key: "reconciliationWeightExactAmount" as const,
    label: "Exact Amount Match",
    description: "Score when bank transaction amount exactly matches invoice net payable",
    defaultValue: 50,
  },
  {
    key: "reconciliationWeightCloseAmount" as const,
    label: "Close Amount Match",
    description: "Score when amount is within tolerance range",
    defaultValue: 10,
  },
  {
    key: "reconciliationWeightInvoiceNumber" as const,
    label: "Invoice Number Match",
    description: "Score when invoice number found in transaction description",
    defaultValue: 30,
  },
  {
    key: "reconciliationWeightVendorName" as const,
    label: "Vendor Name Match",
    description: "Score when vendor name prefix matches transaction description",
    defaultValue: 20,
  },
  {
    key: "reconciliationWeightDateProximity" as const,
    label: "Date Proximity",
    description: "Score when transaction date is within 3 days of invoice date",
    defaultValue: 10,
  },
] as const;

type WeightKey = (typeof WEIGHT_FIELDS)[number]["key"];
type WeightValues = Record<WeightKey, number>;

function defaultWeights(): WeightValues {
  const result = {} as WeightValues;
  for (const field of WEIGHT_FIELDS) {
    result[field.key] = field.defaultValue;
  }
  return result;
}

export function ReconciliationWeightsSection() {
  const [weights, setWeights] = useState<WeightValues>(defaultWeights);
  const [savedWeights, setSavedWeights] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const dirty = JSON.stringify(weights) !== savedWeights;

  const totalBudget = WEIGHT_FIELDS.reduce((sum, f) => sum + weights[f.key], 0);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const config = await fetchComplianceConfig();
      const loaded: WeightValues = defaultWeights();
      for (const field of WEIGHT_FIELDS) {
        const val = config[field.key];
        if (typeof val === "number") {
          loaded[field.key] = val;
        }
      }
      setWeights(loaded);
      setSavedWeights(JSON.stringify(loaded));
    } catch (err) {
      setLoadError(getUserFacingErrorMessage(err, "Failed to load reconciliation weights."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      const patch: Partial<WeightValues> = {};
      for (const field of WEIGHT_FIELDS) {
        patch[field.key] = weights[field.key];
      }
      const updated = await saveComplianceConfig(patch);
      const refreshed: WeightValues = defaultWeights();
      for (const field of WEIGHT_FIELDS) {
        const val = updated[field.key];
        if (typeof val === "number") {
          refreshed[field.key] = val;
        }
      }
      setWeights(refreshed);
      setSavedWeights(JSON.stringify(refreshed));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(getUserFacingErrorMessage(err, "Failed to save reconciliation weights."));
    } finally {
      setSaving(false);
    }
  }, [weights]);

  const updateWeight = useCallback((key: WeightKey, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, value)) }));
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

      <p style={{ fontSize: "0.85rem", color: "var(--ink-soft, #666)", marginTop: "0.25rem" }}>
        Configure how bank transactions are scored against invoices during reconciliation.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
        {WEIGHT_FIELDS.map((field) => (
          <div key={field.key} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <label style={{ flex: 1, fontSize: "0.875rem" }}>
              <span style={{ fontWeight: 500 }}>{field.label}</span>
              <span style={{ display: "block", fontSize: "0.8rem", color: "var(--ink-soft, #666)", marginTop: "0.125rem" }}>
                {field.description}
              </span>
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={weights[field.key]}
              onChange={(e) => updateWeight(field.key, parseInt(e.target.value, 10) || 0)}
              disabled={saving}
              style={{ width: "5rem", textAlign: "right", fontSize: "0.875rem" }}
            />
          </div>
        ))}
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--ink-soft, #666)", marginTop: "0.75rem" }}>
        Total weight budget: {totalBudget} / 300
      </p>

      {saveError ? (
        <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{saveError}</p>
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
