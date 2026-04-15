import { useState, type CSSProperties } from "react";
import type { ExtractedFieldRow } from "@/lib/invoice/extractedFields";
import { formatOcrConfidenceLabel } from "@/lib/invoice/extractedFields";
import { getConfidenceTone } from "@/lib/invoice/confidence";
import type { CropSource } from "@/lib/invoice/invoiceView";

const BBOX_CROP_HEIGHT = 28;

function BboxCrop({
  pageImageUrl,
  bboxNormalized,
  alt,
  onError
}: {
  pageImageUrl: string;
  bboxNormalized: [number, number, number, number];
  alt: string;
  onError: () => void;
}) {
  const [x1, y1, x2, y2] = bboxNormalized;
  const bboxW = x2 - x1;
  const bboxH = y2 - y1;
  if (bboxW <= 0 || bboxH <= 0) return null;

  const cropHeight = BBOX_CROP_HEIGHT;
  const cropWidth = Math.round(cropHeight * (bboxW / bboxH));
  const cappedWidth = Math.min(cropWidth, 200);

  const containerStyle: CSSProperties = {
    width: `${cappedWidth}px`,
    height: `${cropHeight}px`,
    overflow: "hidden",
    position: "relative",
    borderRadius: "0.2rem",
    border: "1px solid rgba(16, 32, 25, 0.12)",
    background: "#faf9f6"
  };

  const imgStyle: CSSProperties = {
    position: "absolute",
    width: `${100 / bboxW}%`,
    height: `${100 / bboxH}%`,
    left: `${-(x1 / bboxW) * 100}%`,
    top: `${-(y1 / bboxH) * 100}%`,
    maxWidth: "none"
  };

  return (
    <div className="field-crop-inline" style={{ maxHeight: `${cropHeight}px` }}>
      <div style={containerStyle}>
        <img src={pageImageUrl} alt={alt} loading="lazy" style={imgStyle} onError={onError} />
      </div>
    </div>
  );
}

function toIsoDateString(value: string): string {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
}

interface ExtractedFieldsTableProps {
  rows: ExtractedFieldRow[];
  cropUrlByField?: Partial<Record<ExtractedFieldRow["fieldKey"], CropSource>>;
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
    const raw = row.rawValue != null ? row.rawValue : row.value === "-" ? "" : row.value;
    const isDateField = row.fieldKey === "invoiceDate" || row.fieldKey === "dueDate";
    setEditValue(isDateField ? toIsoDateString(raw) : raw);
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
            const cropSource = cropUrlByField?.[row.fieldKey];
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
                        type={row.fieldKey === "invoiceDate" || row.fieldKey === "dueDate" ? "date" : "text"}
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
                      <span className="extracted-value-display">
                        {row.value}
                      </span>
                      {canEdit && (
                        <button type="button" className="row-action-button field-edit-button" title={`Edit ${row.label}`} onClick={() => startEditing(row)}>
                          <span className="material-symbols-outlined">edit</span>
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  {cropSource && !cropFailed ? (
                    cropSource.type === "url" ? (
                      <div className="field-crop-inline">
                        <img
                          src={cropSource.url}
                          alt={`Source crop for ${row.label}`}
                          loading="lazy"
                          className="field-crop-thumbnail"
                          onError={() => setFailedCrops((prev) => new Set(prev).add(row.fieldKey))}
                        />
                      </div>
                    ) : (
                      <BboxCrop
                        pageImageUrl={cropSource.pageImageUrl}
                        bboxNormalized={cropSource.bboxNormalized}
                        alt={`Source crop for ${row.label}`}
                        onError={() => setFailedCrops((prev) => new Set(prev).add(row.fieldKey))}
                      />
                    )
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
