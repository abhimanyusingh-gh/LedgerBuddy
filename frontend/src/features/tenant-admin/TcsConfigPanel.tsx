import { useCallback, useEffect, useState } from "react";
import { fetchTcsConfig, fetchTcsHistory, updateTcsConfig, updateTcsModifyRoles } from "@/api/tcsConfig";
import type { TcsConfig, TcsRateChange } from "@/types";
import { TENANT_ROLE_OPTIONS } from "@/types";
import { getUserFacingErrorMessage } from "@/lib/common/apiError";

const ALL_MODIFIABLE_ROLES = [...new Set(["TENANT_ADMIN", ...TENANT_ROLE_OPTIONS.map((o) => o.value)])];

function formatDate(isoString: string): string {
  if (!isoString) return "-";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(isoString: string): string {
  if (!isoString) return "-";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString("en-IN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface TcsConfigPanelProps {
  canConfigureCompliance: boolean;
}

export function TcsConfigPanel({ canConfigureCompliance }: TcsConfigPanelProps) {
  const [config, setConfig] = useState<TcsConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [rateInput, setRateInput] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState("");

  const [savedEnabled, setSavedEnabled] = useState(false);
  const [savedRateInput, setSavedRateInput] = useState("");
  const [savedEffectiveFrom, setSavedEffectiveFrom] = useState("");

  const [history, setHistory] = useState<TcsRateChange[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLimit] = useState(20);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [selectedModifyRoles, setSelectedModifyRoles] = useState<string[]>([]);
  const [savedModifyRoles, setSavedModifyRoles] = useState<string[]>([]);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesSuccess, setRolesSuccess] = useState(false);

  const dirty = enabled !== savedEnabled || rateInput !== savedRateInput || effectiveFrom !== savedEffectiveFrom;
  const rolesDirty = selectedModifyRoles.length !== savedModifyRoles.length || [...selectedModifyRoles].sort().join(",") !== [...savedModifyRoles].sort().join(",");

  const loadConfig = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await fetchTcsConfig();
      setConfig(data);
      setRateInput(String(data.ratePercent));
      setEffectiveFrom(data.effectiveFrom ?? "");
      setEnabled(data.enabled);
      const loadedRoles = data.tcsModifyRoles ?? [];
      setSelectedModifyRoles(loadedRoles);
      setSavedModifyRoles(loadedRoles);
      setSavedEnabled(data.enabled);
      setSavedRateInput(String(data.ratePercent));
      setSavedEffectiveFrom(data.effectiveFrom ?? "");
    } catch (err) {
      setLoadError(getUserFacingErrorMessage(err, "Failed to load TCS configuration."));
    }
  }, []);

  const loadHistory = useCallback(async (page: number) => {
    setHistoryLoading(true);
    try {
      const result = await fetchTcsHistory(page);
      setHistory(result.items);
      setHistoryTotal(result.total);
    } catch {
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    loadHistory(historyPage);
  }, [loadHistory, historyPage]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(false);
    const rate = parseFloat(rateInput);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      setSaveError("Rate must be a number between 0 and 100.");
      return;
    }
    if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      setSaveError("Effective from must be a valid date.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateTcsConfig({ ratePercent: rate, effectiveFrom, enabled, reason: reason.trim() || undefined });
      setConfig(updated);
      setRateInput(String(updated.ratePercent));
      setEffectiveFrom(updated.effectiveFrom);
      setEnabled(updated.enabled);
      setReason("");
      setSavedEnabled(updated.enabled);
      setSavedRateInput(String(updated.ratePercent));
      setSavedEffectiveFrom(updated.effectiveFrom);
      setSaveSuccess(true);
      await loadHistory(1);
      setHistoryPage(1);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(getUserFacingErrorMessage(err, "Failed to save TCS configuration."));
    } finally {
      setSaving(false);
    }
  }, [rateInput, effectiveFrom, enabled, reason, loadHistory]);

  const handleSaveRoles = useCallback(async () => {
    setRolesError(null);
    setRolesSuccess(false);
    setRolesSaving(true);
    try {
      const updated = await updateTcsModifyRoles(selectedModifyRoles);
      setConfig(updated);
      const updatedRoles = updated.tcsModifyRoles ?? [];
      setSelectedModifyRoles(updatedRoles);
      setSavedModifyRoles(updatedRoles);
      setRolesSuccess(true);
      setTimeout(() => setRolesSuccess(false), 3000);
    } catch (err) {
      setRolesError(getUserFacingErrorMessage(err, "Failed to save access roles."));
    } finally {
      setRolesSaving(false);
    }
  }, [selectedModifyRoles]);

  const toggleRole = useCallback((role: string) => {
    setSelectedModifyRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }, []);

  if (loadError) {
    return (
      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.875rem" }}>{loadError}</p>
        <button type="button" className="app-button app-button-secondary" onClick={loadConfig}>
          Retry
        </button>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(historyTotal / historyLimit));

  return (
    <>
      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <div className="editor-header">
          <h3>TCS Configuration</h3>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem", marginBottom: "0.5rem" }}>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={saving}
            />
            <span className="toggle-track" />
          </label>
          <span style={{ fontSize: "0.875rem" }}>TCS Enabled</span>
        </div>

        {enabled ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
                TCS Rate (%)
                <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    disabled={saving}
                    style={{ width: "7rem" }}
                  />
                  <span style={{ color: "var(--ink-soft, #666)" }}>%</span>
                </div>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
                Effective From
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  disabled={saving}
                  style={{ width: "12rem" }}
                />
              </label>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem", marginTop: "0.75rem" }}>
              Reason for change (optional)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={saving}
                rows={2}
                placeholder="e.g. Finance Act 2025 amendment"
                style={{ resize: "vertical", fontFamily: "inherit", fontSize: "0.875rem", padding: "0.375rem 0.5rem" }}
              />
            </label>
          </>
        ) : null}

        {config?.updatedBy ? (
          <p style={{ fontSize: "0.8rem", color: "var(--ink-soft, #666)", marginTop: "0.5rem" }}>
            Last updated by {config.updatedBy} on {formatDateTime(config.updatedAt)}
          </p>
        ) : null}

        {saveError ? (
          <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{saveError}</p>
        ) : null}
        {saveSuccess ? (
          <p style={{ color: "var(--chart-emerald, #10b981)", fontSize: "0.85rem", marginTop: "0.5rem" }}>TCS configuration saved.</p>
        ) : null}

        {dirty ? (
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="app-button app-button-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save TCS Config"}
            </button>
          </div>
        ) : null}
      </div>

      {canConfigureCompliance ? (
        <div className="editor-card" style={{ marginTop: "1.5rem" }}>
          <div className="editor-header">
            <h3>TCS Modify Access</h3>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-soft, #666)", marginTop: "0.25rem", whiteSpace: "normal", overflowWrap: "break-word" }}>
            Select which roles are permitted to change the TCS rate and effective date.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
            {ALL_MODIFIABLE_ROLES.map((role) => {
              const label = role === "TENANT_ADMIN"
                ? "Tenant Admin"
                : TENANT_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
              return (
                <label key={role} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedModifyRoles.includes(role)}
                    onChange={() => toggleRole(role)}
                    disabled={rolesSaving}
                  />
                  {label}
                </label>
              );
            })}
          </div>

          {rolesError ? (
            <p style={{ color: "var(--danger, #ef4444)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{rolesError}</p>
          ) : null}
          {rolesSuccess ? (
            <p style={{ color: "var(--chart-emerald, #10b981)", fontSize: "0.85rem", marginTop: "0.5rem" }}>Access roles saved.</p>
          ) : null}

          {rolesDirty ? (
            <div style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="app-button app-button-primary"
                onClick={handleSaveRoles}
                disabled={rolesSaving}
              >
                {rolesSaving ? "Saving…" : "Save Access Roles"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="editor-card" style={{ marginTop: "1.5rem" }}>
        <div className="editor-header">
          <h3>Rate Change History</h3>
        </div>

        {historyLoading ? (
          <p style={{ fontSize: "0.875rem", color: "var(--ink-soft, #666)", marginTop: "0.5rem" }}>Loading…</p>
        ) : history.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--ink-soft, #666)", marginTop: "0.5rem" }}>No rate changes recorded yet.</p>
        ) : (
          <div className="list-scroll" style={{ marginTop: "0.75rem" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Previous Rate</th>
                  <th>New Rate</th>
                  <th>Effective From</th>
                  <th>Changed By</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, idx) => (
                  <tr key={idx}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(entry.changedAt)}</td>
                    <td>{entry.previousRate}%</td>
                    <td>{entry.newRate}%</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDate(entry.effectiveFrom)}</td>
                    <td>{entry.changedByName || entry.changedBy}</td>
                    <td style={{ color: "var(--ink-soft, #666)" }}>{entry.reason ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem", fontSize: "0.875rem" }}>
            <button
              type="button"
              className="app-button app-button-secondary app-button-sm"
              onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
              disabled={historyPage === 1 || historyLoading}
            >
              Previous
            </button>
            <span>Page {historyPage} of {totalPages}</span>
            <button
              type="button"
              className="app-button app-button-secondary app-button-sm"
              onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
              disabled={historyPage === totalPages || historyLoading}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
