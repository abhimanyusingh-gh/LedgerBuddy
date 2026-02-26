import { useState } from "react";
import type { ExtractedFieldRow } from "../extractedFields";

interface ExtractedFieldsTableProps {
  rows: ExtractedFieldRow[];
  cropUrlByField?: Partial<Record<ExtractedFieldRow["fieldKey"], string>>;
}

interface CropPreviewState {
  label: string;
  url: string;
}

export function ExtractedFieldsTable({ rows, cropUrlByField }: ExtractedFieldsTableProps) {
  const [cropPreview, setCropPreview] = useState<CropPreviewState | null>(null);

  return (
    <>
      <table className="mapping-table extracted-table">
        <thead>
          <tr>
            <th>Detected Label</th>
            <th>Detected Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cropUrl = cropUrlByField?.[row.fieldKey];
            return (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>
                  <div className="field-value-cell">
                    <span>{row.value}</span>
                    {cropUrl ? (
                      <button
                        type="button"
                        className="field-crop-button"
                        aria-label={`Inspect extracted source crop for ${row.label}`}
                        title={`Inspect extracted source crop for ${row.label}`}
                        onClick={() => setCropPreview({ label: row.label, url: cropUrl })}
                      >
                        <svg
                          className="field-crop-icon"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                        >
                          <path
                            d="M2 12C4.4 7.8 8 5.5 12 5.5C16 5.5 19.6 7.8 22 12C19.6 16.2 16 18.5 12 18.5C8 18.5 4.4 16.2 2 12Z"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                          <circle cx="12" cy="12" r="3.1" fill="currentColor" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {cropPreview ? (
        <div className="crop-preview-overlay" role="presentation" onClick={() => setCropPreview(null)}>
          <section
            className="crop-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Cropped source for ${cropPreview.label}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crop-preview-header">
              <h4>{cropPreview.label} Source Crop</h4>
              <button type="button" onClick={() => setCropPreview(null)}>
                Close
              </button>
            </div>
            <img src={cropPreview.url} alt={`Cropped source for ${cropPreview.label}`} loading="lazy" />
          </section>
        </div>
      ) : null}
    </>
  );
}
