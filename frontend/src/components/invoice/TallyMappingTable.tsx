import type { TallyMappingRow } from "@/lib/invoice/tallyMapping";

interface TallyMappingTableProps {
  rows: TallyMappingRow[];
}

export function TallyMappingTable({ rows }: TallyMappingTableProps) {
  return (
    <table className="mapping-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Extracted Value</th>
          <th>Export As</th>
          <th>Value Sent</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const rowKey = `${row.label}:${row.tallyField}`;
          return (
            <tr key={rowKey}>
              <td>{row.label}</td>
              <td>{row.detectedValue}</td>
              <td>
                <span>{row.tallyFieldLabel ?? row.tallyField}</span>
                {row.hint ? (
                  <span className="field-hint-trigger" aria-label={`Info about ${row.label}`}>
                    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="field-hint-tooltip">
                      {row.hint}
                      <br />
                      <em>Tally path: {row.tallyField}</em>
                    </span>
                  </span>
                ) : null}
              </td>
              <td>{row.mappedValue}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
