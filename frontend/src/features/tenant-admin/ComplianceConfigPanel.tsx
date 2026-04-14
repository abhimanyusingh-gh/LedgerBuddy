import { useCallback, useEffect, useState } from "react";
import {
  fetchComplianceConfig,
  saveComplianceConfig,
  fetchDefaultTdsSections,
  fetchAvailableRiskSignals
} from "@/api/admin";
import { getUserFacingErrorMessage } from "@/lib/common/apiError";
import type { TdsRateEntry, TenantComplianceConfig, RiskSignalDefinition } from "@/types";

const PAN_LEVEL_OPTIONS: Array<{ value: TenantComplianceConfig["panValidationLevel"]; label: string }> = [
  { value: "format", label: "Format only" },
  { value: "format_and_checksum", label: "Format + Checksum" }
];

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.?0+$/, "");
}

function percentToBps(pct: string): number {
  const val = parseFloat(pct);
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

function formatThreshold(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function parseThreshold(display: string): number {
  const cleaned = display.replace(/,/g, "").trim();
  const val = parseFloat(cleaned);
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

interface ComplianceConfigPanelProps {
  canConfigureCompliance: boolean;
}

export function ComplianceConfigPanel({ canConfigureCompliance }: ComplianceConfigPanelProps) {
  const [config, setConfig] = useState<TenantComplianceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tdsEnabled, setTdsEnabled] = useState(false);
  const [tdsRates, setTdsRates] = useState<TdsRateEntry[]>([]);
  const [tdsSaving, setTdsSaving] = useState(false);
  const [tdsError, setTdsError] = useState<string | null>(null);
  const [tdsSuccess, setTdsSuccess] = useState(false);

  const [panEnabled, setPanEnabled] = useState(false);
  const [panLevel, setPanLevel] = useState<TenantComplianceConfig["panValidationLevel"]>("disabled");
  const [panSaving, setPanSaving] = useState(false);
  const [panError, setPanError] = useState<string | null>(null);
  const [panSuccess, setPanSuccess] = useState(false);

  const [riskEnabled, setRiskEnabled] = useState(false);
  const [activeSignals, setActiveSignals] = useState<string[]>([]);
  const [availableSignals, setAvailableSignals] = useState<RiskSignalDefinition[]>([]);
  const [riskSaving, setRiskSaving] = useState(false);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskSuccess, setRiskSuccess] = useState(false);

  const [defaultTdsSections, setDefaultTdsSections] = useState<TdsRateEntry[]>([]);

  const [savedTdsEnabled, setSavedTdsEnabled] = useState(false);
  const [savedTdsRates, setSavedTdsRates] = useState<string>("");
  const [savedPanEnabled, setSavedPanEnabled] = useState(false);
  const [savedPanLevel, setSavedPanLevel] = useState<string>("disabled");
  const [savedRiskEnabled, setSavedRiskEnabled] = useState(false);
  const [savedActiveSignals, setSavedActiveSignals] = useState<string>("");

  const tdsDirty = tdsEnabled !== savedTdsEnabled || JSON.stringify(tdsRates) !== savedTdsRates;
  const panDirty = panEnabled !== savedPanEnabled || panLevel !== savedPanLevel;
  const riskDirty = riskEnabled !== savedRiskEnabled || JSON.stringify(activeSignals) !== savedActiveSignals;

  const [addingSection, setAddingSection] = useState(false);
  const [newSection, setNewSection] = useState<TdsRateEntry>({
    section: "", description: "", rateIndividual: 0, rateCompany: 0, rateNoPan: 2000, threshold: 0, active: true
  });

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [configData, defaults, signals] = await Promise.all([
        fetchComplianceConfig(),
        fetchDefaultTdsSections(),
        fetchAvailableRiskSignals()
      ]);

      setConfig(configData);
      setTdsEnabled(configData.tdsEnabled ?? false);
      setTdsRates(configData.tdsRates?.length > 0 ? configData.tdsRates : defaults);
      setPanEnabled(configData.panValidationEnabled ?? false);
      setPanLevel(configData.panValidationLevel ?? "disabled");
      setRiskEnabled(configData.riskSignalsEnabled ?? false);
      setActiveSignals(configData.activeRiskSignals?.length > 0 ? configData.activeRiskSignals : signals.map((s) => s.code));
      setAvailableSignals(signals);
      setDefaultTdsSections(defaults);

      const effectiveRates = configData.tdsRates?.length > 0 ? configData.tdsRates : defaults;
      const effectiveSignals = configData.activeRiskSignals?.length > 0 ? configData.activeRiskSignals : signals.map((s) => s.code);
      setSavedTdsEnabled(configData.tdsEnabled ?? false);
      setSavedTdsRates(JSON.stringify(effectiveRates));
      setSavedPanEnabled(configData.panValidationEnabled ?? false);
      setSavedPanLevel(configData.panValidationLevel ?? "disabled");
      setSavedRiskEnabled(configData.riskSignalsEnabled ?? false);
      setSavedActiveSignals(JSON.stringify(effectiveSignals));
    } catch (err) {
      setLoadError(getUserFacingErrorMessage(err, "Failed to load compliance configuration."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSaveTds = useCallback(async () => {
    setTdsError(null);
    setTdsSuccess(false);
    setTdsSaving(true);
    try {
      const updated = await saveComplianceConfig({ tdsEnabled, tdsRates });
      setConfig(updated);
      setTdsRates(updated.tdsRates);
      setSavedTdsEnabled(tdsEnabled);
      setSavedTdsRates(JSON.stringify(updated.tdsRates));
      setTdsSuccess(true);
      setTimeout(() => setTdsSuccess(false), 3000);
    } catch (err) {
      setTdsError(getUserFacingErrorMessage(err, "Failed to save TDS configuration."));
    } finally {
      setTdsSaving(false);
    }
  }, [tdsEnabled, tdsRates]);

  const handleSavePan = useCallback(async () => {
    setPanError(null);
    setPanSuccess(false);
    setPanSaving(true);
    try {
      const effectiveLevel = panEnabled ? panLevel : "disabled";
      const updated = await saveComplianceConfig({
        panValidationEnabled: panEnabled,
        panValidationLevel: effectiveLevel
      });
      setConfig(updated);
      setSavedPanEnabled(panEnabled);
      setSavedPanLevel(effectiveLevel);
      setPanSuccess(true);
      setTimeout(() => setPanSuccess(false), 3000);
    } catch (err) {
      setPanError(getUserFacingErrorMessage(err, "Failed to save PAN validation settings."));
    } finally {
      setPanSaving(false);
    }
  }, [panEnabled, panLevel]);

  const handleSaveRisk = useCallback(async () => {
    setRiskError(null);
    setRiskSuccess(false);
    setRiskSaving(true);
    try {
      const updated = await saveComplianceConfig({
        riskSignalsEnabled: riskEnabled,
        activeRiskSignals: activeSignals
      });
      setConfig(updated);
      setSavedRiskEnabled(riskEnabled);
      setSavedActiveSignals(JSON.stringify(activeSignals));
      setRiskSuccess(true);
      setTimeout(() => setRiskSuccess(false), 3000);
    } catch (err) {
      setRiskError(getUserFacingErrorMessage(err, "Failed to save risk signal settings."));
    } finally {
      setRiskSaving(false);
    }
  }, [riskEnabled, activeSignals]);

  const updateTdsRate = useCallback((index: number, field: keyof TdsRateEntry, value: unknown) => {
    setTdsRates((prev) => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }, []);

  const removeTdsRate = useCallback((index: number) => {
    setTdsRates((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddSection = useCallback(() => {
    if (!newSection.section.trim() || !newSection.description.trim()) return;
    setTdsRates((prev) => [...prev, { ...newSection }]);
    setNewSection({ section: "", description: "", rateIndividual: 0, rateCompany: 0, rateNoPan: 2000, threshold: 0, active: true });
    setAddingSection(false);
  }, [newSection]);

  const resetToDefaults = useCallback(() => {
    setTdsRates([...defaultTdsSections]);
  }, [defaultTdsSections]);

  const toggleSignal = useCallback((code: string) => {
    setActiveSignals((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }, []);

  if (!canConfigureCompliance) return null;

  if (loading) {
    return (
      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <p style={{ fontSize: "0.875rem", color: "var(--ink-soft, #666)" }}>Loading compliance configuration...</p>
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
    <>
      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <div className="editor-header">
          <h3>TDS Configuration</h3>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem", marginBottom: "0.5rem" }}>
          <label className="toggle-switch">
            <input type="checkbox" checked={tdsEnabled} onChange={(e) => setTdsEnabled(e.target.checked)} disabled={tdsSaving} />
            <span className="toggle-track" />
          </label>
          <span style={{ fontSize: "0.875rem" }}>TDS Calculation Enabled</span>
        </div>

        {tdsEnabled ? (
          <>
            <div className="list-scroll" style={{ marginTop: "0.75rem" }}>
              <table>
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>Description</th>
                    <th>Rate (Individual)</th>
                    <th>Rate (Company)</th>
                    <th>Rate (No PAN)</th>
                    <th>Threshold (INR)</th>
                    <th>Active</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tdsRates.map((rate, idx) => (
                    <tr key={rate.section + idx}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{rate.section}</td>
                      <td>
                        <input
                          type="text"
                          value={rate.description}
                          onChange={(e) => updateTdsRate(idx, "description", e.target.value)}
                          disabled={tdsSaving}
                          style={{ width: "100%", minWidth: "8rem", fontSize: "0.85rem" }}
                        />
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={bpsToPercent(rate.rateIndividual)}
                            onChange={(e) => updateTdsRate(idx, "rateIndividual", percentToBps(e.target.value))}
                            disabled={tdsSaving}
                            style={{ width: "4.5rem", fontSize: "0.85rem" }}
                          />
                          <span style={{ color: "var(--ink-soft, #666)", fontSize: "0.8rem" }}>%</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={bpsToPercent(rate.rateCompany)}
                            onChange={(e) => updateTdsRate(idx, "rateCompany", percentToBps(e.target.value))}
                            disabled={tdsSaving}
                            style={{ width: "4.5rem", fontSize: "0.85rem" }}
                          />
                          <span style={{ color: "var(--ink-soft, #666)", fontSize: "0.8rem" }}>%</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={bpsToPercent(rate.rateNoPan)}
                            onChange={(e) => updateTdsRate(idx, "rateNoPan", percentToBps(e.target.value))}
                            disabled={tdsSaving}
                            style={{ width: "4.5rem", fontSize: "0.85rem" }}
                          />
                          <span style={{ color: "var(--ink-soft, #666)", fontSize: "0.8rem" }}>%</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <span style={{ color: "var(--ink-soft, #666)", fontSize: "0.8rem" }}>INR</span>
                          <input
                            type="text"
                            value={formatThreshold(rate.threshold)}
                            onChange={(e) => updateTdsRate(idx, "threshold", parseThreshold(e.target.value))}
                            disabled={tdsSaving}
                            style={{ width: "7rem", fontSize: "0.85rem", textAlign: "right" }}
                          />
                        </div>
                      </td>
                      <td>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={rate.active}
                            onChange={(e) => updateTdsRate(idx, "active", e.target.checked)}
                            disabled={tdsSaving}
                          />
                          <span className="toggle-track" />
                        </label>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="app-button app-button-secondary app-button-sm"
                          onClick={() => removeTdsRate(idx)}
                          disabled={tdsSaving}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {addingSection ? (
              <div style={{ marginTop: "0.75rem", padding: "0.75rem", border: "1px solid var(--border, #e5e7eb)", borderRadius: "0.375rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.5rem" }}>
                  <label style={{ fontSize: "0.85rem" }}>
                    Section
                    <input
                      type="text"
                      value={newSection.section}
                      onChange={(e) => setNewSection((p) => ({ ...p, section: e.target.value.toUpperCase() }))}
                      placeholder="e.g. 194K"
                      style={{ width: "100%", fontSize: "0.85rem", marginTop: "0.25rem" }}
                    />
                  </label>
                  <label style={{ fontSize: "0.85rem" }}>
                    Description
                    <input
                      type="text"
                      value={newSection.description}
                      onChange={(e) => setNewSection((p) => ({ ...p, description: e.target.value }))}
                      placeholder="e.g. Payment type"
                      style={{ width: "100%", fontSize: "0.85rem", marginTop: "0.25rem" }}
                    />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <label style={{ fontSize: "0.85rem" }}>
                    Rate Individual (%)
                    <input
                      type="number" min="0" max="100" step="0.01"
                      value={bpsToPercent(newSection.rateIndividual)}
                      onChange={(e) => setNewSection((p) => ({ ...p, rateIndividual: percentToBps(e.target.value) }))}
                      style={{ width: "100%", fontSize: "0.85rem", marginTop: "0.25rem" }}
                    />
                  </label>
                  <label style={{ fontSize: "0.85rem" }}>
                    Rate Company (%)
                    <input
                      type="number" min="0" max="100" step="0.01"
                      value={bpsToPercent(newSection.rateCompany)}
                      onChange={(e) => setNewSection((p) => ({ ...p, rateCompany: percentToBps(e.target.value) }))}
                      style={{ width: "100%", fontSize: "0.85rem", marginTop: "0.25rem" }}
                    />
                  </label>
                  <label style={{ fontSize: "0.85rem" }}>
                    Rate No PAN (%)
                    <input
                      type="number" min="0" max="100" step="0.01"
                      value={bpsToPercent(newSection.rateNoPan)}
                      onChange={(e) => setNewSection((p) => ({ ...p, rateNoPan: percentToBps(e.target.value) }))}
                      style={{ width: "100%", fontSize: "0.85rem", marginTop: "0.25rem" }}
                    />
                  </label>
                  <label style={{ fontSize: "0.85rem" }}>
                    Threshold (INR)
                    <input
                      type="text"
                      value={formatThreshold(newSection.threshold)}
                      onChange={(e) => setNewSection((p) => ({ ...p, threshold: parseThreshold(e.target.value) }))}
                      style={{ width: "100%", fontSize: "0.85rem", marginTop: "0.25rem" }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button type="button" className="app-button app-button-primary app-button-sm" onClick={handleAddSection}>
                    Add
                  </button>
                  <button type="button" className="app-button app-button-secondary app-button-sm" onClick={() => setAddingSection(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button
                type="button"
                className="app-button app-button-secondary app-button-sm"
                onClick={() => setAddingSection(true)}
                disabled={tdsSaving || addingSection}
              >
                Add Section
              </button>
              <button
                type="button"
                className="app-button app-button-secondary app-button-sm"
                onClick={resetToDefaults}
                disabled={tdsSaving}
              >
                Reset to Defaults
              </button>
            </div>
          </>
        ) : null}

        {tdsError ? (
          <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{tdsError}</p>
        ) : null}
        {tdsSuccess ? (
          <p style={{ color: "var(--chart-emerald, #10b981)", fontSize: "0.85rem", marginTop: "0.5rem" }}>TDS configuration saved.</p>
        ) : null}

        {tdsDirty ? (
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="app-button app-button-primary" onClick={handleSaveTds} disabled={tdsSaving}>
              {tdsSaving ? "Saving..." : "Save TDS Config"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <div className="editor-header">
          <h3>PAN Validation</h3>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem", marginBottom: "0.5rem" }}>
          <label className="toggle-switch">
            <input type="checkbox" checked={panEnabled} onChange={(e) => setPanEnabled(e.target.checked)} disabled={panSaving} />
            <span className="toggle-track" />
          </label>
          <span style={{ fontSize: "0.875rem" }}>PAN Validation Enabled</span>
        </div>

        {panEnabled ? (
          <div style={{ marginTop: "0.5rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Validation Level
              <select
                value={panLevel}
                onChange={(e) => setPanLevel(e.target.value as TenantComplianceConfig["panValidationLevel"])}
                disabled={panSaving}
                style={{ width: "14rem" }}
              >
                {PAN_LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {panError ? (
          <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{panError}</p>
        ) : null}
        {panSuccess ? (
          <p style={{ color: "var(--chart-emerald, #10b981)", fontSize: "0.85rem", marginTop: "0.5rem" }}>PAN validation settings saved.</p>
        ) : null}

        {panDirty ? (
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="app-button app-button-primary" onClick={handleSavePan} disabled={panSaving}>
              {panSaving ? "Saving..." : "Save PAN Settings"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <div className="editor-header">
          <h3>Risk Signals</h3>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem", marginBottom: "0.5rem" }}>
          <label className="toggle-switch">
            <input type="checkbox" checked={riskEnabled} onChange={(e) => setRiskEnabled(e.target.checked)} disabled={riskSaving} />
            <span className="toggle-track" />
          </label>
          <span style={{ fontSize: "0.875rem" }}>Risk Signal Evaluation Enabled</span>
        </div>

        {riskEnabled ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
            {availableSignals.map((signal) => (
              <label
                key={signal.code}
                style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={activeSignals.includes(signal.code)}
                  onChange={() => toggleSignal(signal.code)}
                  disabled={riskSaving}
                  style={{ marginTop: "0.15rem" }}
                />
                <span>
                  <span style={{ fontWeight: 500 }}>{signal.code.replace(/_/g, " ")}</span>
                  <span style={{ display: "block", fontSize: "0.8rem", color: "var(--ink-soft, #666)" }}>
                    {signal.description}
                    <span style={{
                      marginLeft: "0.5rem",
                      padding: "0.1rem 0.3rem",
                      borderRadius: "0.25rem",
                      fontSize: "0.7rem",
                      background: "var(--surface-alt, #f3f4f6)",
                      color: "var(--ink-soft, #888)"
                    }}>
                      {signal.category}
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        {riskError ? (
          <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{riskError}</p>
        ) : null}
        {riskSuccess ? (
          <p style={{ color: "var(--chart-emerald, #10b981)", fontSize: "0.85rem", marginTop: "0.5rem" }}>Risk signal settings saved.</p>
        ) : null}

        {riskDirty ? (
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="app-button app-button-primary" onClick={handleSaveRisk} disabled={riskSaving}>
              {riskSaving ? "Saving..." : "Save Risk Signal Settings"}
            </button>
          </div>
        ) : null}
      </div>

      {config?.updatedBy ? (
        <p style={{ fontSize: "0.8rem", color: "var(--ink-soft, #666)", marginTop: "0.75rem" }}>
          Last updated by {config.updatedBy}
          {config.updatedAt ? ` on ${new Date(config.updatedAt).toLocaleString("en-IN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
        </p>
      ) : null}
    </>
  );
}
