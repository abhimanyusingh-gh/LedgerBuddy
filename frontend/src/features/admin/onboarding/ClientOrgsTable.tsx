import { useMemo } from "react";
import { Badge, Button } from "@/components/ds";
import type { ClientOrganization } from "@/api/clientOrgs";

interface ClientOrgsTableProps {
  items: ClientOrganization[];
  searchTerm: string;
  activeClientOrgId: string | null;
  onEdit: (clientOrg: ClientOrganization) => void;
  onArchive: (clientOrg: ClientOrganization) => void;
  onSelect: (clientOrg: ClientOrganization) => void;
}

function matchesSearch(item: ClientOrganization, term: string): boolean {
  if (term.length === 0) return true;
  const haystack = `${item.companyName} ${item.gstin}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export function ClientOrgsTable({
  items,
  searchTerm,
  activeClientOrgId,
  onEdit,
  onArchive,
  onSelect
}: ClientOrgsTableProps) {
  const visible = useMemo(() => {
    return items
      .filter((item) => matchesSearch(item, searchTerm))
      .slice()
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [items, searchTerm]);

  if (visible.length === 0) {
    return (
      <div className="client-orgs-state" data-testid="client-orgs-table-empty-search">
        <p>No client organizations match &ldquo;{searchTerm}&rdquo;.</p>
      </div>
    );
  }

  return (
    <table
      className="client-orgs-table"
      data-testid="client-orgs-table"
      aria-label="Client organizations"
    >
      <thead>
        <tr>
          <th scope="col" aria-sort="ascending">
            Company name
          </th>
          <th scope="col">GSTIN</th>
          <th scope="col">State</th>
          <th scope="col">F12 verified</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {visible.map((item) => {
          const isActive = item._id === activeClientOrgId;
          return (
            <tr key={item._id} data-testid="client-orgs-table-row" data-active={isActive ? "true" : undefined}>
              <td>
                <span className="client-orgs-table-company">
                  <strong>{item.companyName}</strong>
                  {isActive ? (
                    <Badge tone="success" size="sm">
                      Active
                    </Badge>
                  ) : null}
                </span>
              </td>
              <td>
                <code className="client-orgs-table-gstin">{item.gstin}</code>
              </td>
              <td>
                {item.stateName ?? (
                  <span className="client-orgs-table-placeholder" aria-hidden="true">
                    —
                  </span>
                )}
              </td>
              <td>
                {item.f12OverwriteByGuidVerified ? (
                  <Badge tone="success" size="sm">
                    Verified
                  </Badge>
                ) : (
                  <Badge tone="warning" size="sm">
                    Pending
                  </Badge>
                )}
              </td>
              <td>
                <div className="client-orgs-table-actions">
                  {isActive ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelect(item)}
                      data-testid="client-orgs-table-select"
                    >
                      Select
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onEdit(item)}
                    data-testid="client-orgs-table-edit"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onArchive(item)}
                    data-testid="client-orgs-table-archive"
                  >
                    Archive
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
