import type { TallyMappingRow } from "../tallyMapping";

interface TallyMappingTableProps {
  rows: TallyMappingRow[];
}

export function TallyMappingTable({ rows }: TallyMappingTableProps) {
  return (
    <table className="mapping-table">
      <thead>
        <tr>
          <th>Detected Label</th>
          <th>Detected Value</th>
          <th>Tally Field</th>
          <th>Mapped Export Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.label}:${row.tallyField}`}>
            <td>{row.label}</td>
            <td>{row.detectedValue}</td>
            <td>{row.tallyField}</td>
            <td>{row.mappedValue}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
