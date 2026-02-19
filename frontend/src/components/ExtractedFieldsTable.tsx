import type { ExtractedFieldRow } from "../extractedFields";

interface ExtractedFieldsTableProps {
  rows: ExtractedFieldRow[];
}

export function ExtractedFieldsTable({ rows }: ExtractedFieldsTableProps) {
  return (
    <table className="mapping-table extracted-table">
      <thead>
        <tr>
          <th>Detected Label</th>
          <th>Detected Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
