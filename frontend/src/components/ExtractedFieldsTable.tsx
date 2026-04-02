import { useState } from "react";
import type { ExtractedFieldRow } from "../extractedFields";
import { formatOcrConfidenceLabel } from "../extractedFields";
import { getConfidenceTone } from "../confidence";

interface ExtractedFieldsTableProps {
  rows: ExtractedFieldRow[];
  cropUrlByField?: Partial<Record<ExtractedFieldRow["fieldKey"], string>>;
  editable?: boolean;
  onSaveField?: (fieldKey: string, value: string) => Promise<void>;
}

export function ExtractedFieldsTable({ rows, cropUrlByField, editable, onSaveField }: ExtractedFieldsTableProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [failedCrops, setFailedCrops] = useState<Set<string>>(new Set());

  function startEditing(row: ExtractedFieldRow) {
    if (!editable || row.fieldKey === "notes") return;
    setEditingField(row.fieldKey);
    setEditValue(row.rawValue ?? row.value === "-" ? "" : row.rawValue ?? row.value);
  }

  async function confirmEdit() {
    if (!editingField || !onSaveField) return;
    try {
      setSaving(true);
      await onSaveField(editingField, editValue);
    } finally {
      setSaving(false);
      setEditingField(null);
      setEditValue("");
    }
  }

  function cancelEdit() {
    setEditingField(null);
    setEditValue("");
  }

  return (
    <div className="extracted-fields-table-wrap">
      <table className="mapping-table extracted-fields-table">
        <thead>
          <tr>
            <th scope="col">Detected Label</th>
            <th scope="col">Detected Value</th>
            <th scope="col">Source</th>
            <th scope="col">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cropUrl = cropUrlByField?.[row.fieldKey];
            const isEditing = editingField === row.fieldKey;
            const canEdit = editable && row.fieldKey !== "notes" && !!onSaveField;
            const cropFailed = failedCrops.has(row.fieldKey);
            return (
              <tr key={row.label}>
                <td>
                  <div className="table-cell-scroll">{row.label}</div>
                </td>
                <td>
                  {isEditing ? (
                    <div className="extracted-value-cell">
                      <input
                        className="extracted-value-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void confirmEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                        disabled={saving}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="field-save-button"
                        aria-label={`Save ${row.label}`}
                        disabled={saving}
                        onClick={() => void confirmEdit()}
                      >
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="table-cell-scroll">
                      <span
                        className="extracted-value-display"
                        data-editable={canEdit || undefined}
                        onClick={canEdit ? () => startEditing(row) : undefined}
                        role={canEdit ? "button" : undefined}
                        tabIndex={canEdit ? 0 : undefined}
                        onKeyDown={canEdit ? (e) => { if (e.key === "Enter") startEditing(row); } : undefined}
                      >
                        {row.value}
                      </span>
                    </div>
                  )}
                </td>
                <td>
                  {cropUrl && !cropFailed ? (
                    <div className="field-crop-inline">
                      <img
                        src={cropUrl}
                        alt={`Source crop for ${row.label}`}
                        loading="lazy"
                        className="field-crop-thumbnail"
                        onError={() => setFailedCrops((prev) => new Set(prev).add(row.fieldKey))}
                      />
                    </div>
                  ) : (
                    <div className="table-cell-scroll">
                      <span className="muted">{cropFailed ? "unavailable" : "-"}</span>
                    </div>
                  )}
                </td>
                <td>
                  <div className="table-cell-scroll">
                    {row.confidence !== undefined ? (
                      <span className={`field-confidence-badge field-confidence-${getConfidenceTone(row.confidence > 1 ? row.confidence : row.confidence * 100)}`}>
                        {formatOcrConfidenceLabel(row.confidence)}
                      </span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
