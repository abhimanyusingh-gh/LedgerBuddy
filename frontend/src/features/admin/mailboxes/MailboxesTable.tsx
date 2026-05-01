import { useMemo } from "react";
import { Badge, Button } from "@/components/ds";
import type { MailboxAssignment } from "@/api/mailboxAssignments";
import type { ClientOrgOption } from "@/components/workspace/HierarchyBadges";

const VISIBLE_CHIP_LIMIT = 3;

interface MailboxesTableProps {
  items: MailboxAssignment[];
  clientOrgs: ClientOrgOption[] | undefined;
  ingestionCounts: Record<string, number | null | undefined>;
  onEdit: (assignment: MailboxAssignment) => void;
  onDelete: (assignment: MailboxAssignment) => void;
  onViewRecent?: (assignment: MailboxAssignment) => void;
  onRetryCount?: (assignmentId: string) => void;
}

interface ClientOrgChipsResult {
  visible: { id: string; label: string }[];
  overflow: number;
  hiddenLabels: string[];
}

function clientOrgChips(
  ids: string[],
  orgsById: Map<string, ClientOrgOption>
): ClientOrgChipsResult {
  const labelled = ids.map((id) => ({ id, label: orgsById.get(id)?.companyName ?? id }));
  if (labelled.length <= VISIBLE_CHIP_LIMIT) {
    return { visible: labelled, overflow: 0, hiddenLabels: [] };
  }
  const hidden = labelled.slice(VISIBLE_CHIP_LIMIT);
  return {
    visible: labelled.slice(0, VISIBLE_CHIP_LIMIT),
    overflow: hidden.length,
    hiddenLabels: hidden.map((chip) => chip.label)
  };
}

export function MailboxesTable({
  items,
  clientOrgs,
  ingestionCounts,
  onEdit,
  onDelete,
  onViewRecent,
  onRetryCount
}: MailboxesTableProps) {
  const orgsById = useMemo(() => {
    const map = new Map<string, ClientOrgOption>();
    for (const org of clientOrgs ?? []) {
      map.set(org.id, org);
    }
    return map;
  }, [clientOrgs]);

  const sorted = useMemo(() => {
    return items.slice().sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  }, [items]);

  return (
    <table className="mailboxes-table" data-testid="mailboxes-table" aria-label="Mailbox assignments">
      <thead>
        <tr>
          <th scope="col">Mailbox</th>
          <th scope="col">Mapped client orgs</th>
          <th scope="col">Ingested (30d)</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((item) => {
          const { visible, overflow, hiddenLabels } = clientOrgChips(item.clientOrgIds, orgsById);
          const ingestionCount = ingestionCounts[item._id];
          return (
            <tr key={item._id} data-testid="mailboxes-table-row">
              <td>
                <strong className="mailboxes-table-email lb-mono">
                  {item.email ?? "(unknown mailbox)"}
                </strong>
              </td>
              <td>
                <div
                  className="mailboxes-table-chips"
                  data-testid={`mailboxes-table-chips-${item._id}`}
                >
                  {visible.map((chip) => (
                    <Badge key={chip.id} tone="neutral" size="sm">
                      {chip.label}
                    </Badge>
                  ))}
                  {overflow > 0 ? (
                    <span
                      data-testid={`mailboxes-table-chips-overflow-${item._id}`}
                      title={hiddenLabels.join(", ")}
                    >
                      <Badge tone="info" size="sm">
                        +{overflow} more
                      </Badge>
                    </span>
                  ) : null}
                </div>
              </td>
              <td>
                {typeof ingestionCount === "number" ? (
                  onViewRecent ? (
                    <button
                      type="button"
                      className="mailboxes-table-count-link lb-num"
                      onClick={() => onViewRecent(item)}
                      data-testid={`mailboxes-table-count-${item._id}`}
                    >
                      {ingestionCount}
                    </button>
                  ) : (
                    <span className="lb-num" data-testid={`mailboxes-table-count-${item._id}`}>
                      {ingestionCount}
                    </span>
                  )
                ) : ingestionCount === null ? (
                  onRetryCount ? (
                    <button
                      type="button"
                      className="mailboxes-table-count-link"
                      title="Failed to load count — click to retry"
                      onClick={() => onRetryCount(item._id)}
                      data-testid={`mailboxes-table-count-error-${item._id}`}
                    >
                      ?
                    </button>
                  ) : (
                    <span
                      title="Failed to load count"
                      data-testid={`mailboxes-table-count-error-${item._id}`}
                    >
                      ?
                    </span>
                  )
                ) : (
                  <span aria-hidden="true" data-testid={`mailboxes-table-count-pending-${item._id}`}>
                    —
                  </span>
                )}
              </td>
              <td>
                <div className="mailboxes-table-actions">
                  {onViewRecent ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onViewRecent(item)}
                      data-testid={`mailboxes-table-view-recent-${item._id}`}
                    >
                      View recent
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onEdit(item)}
                    data-testid={`mailboxes-table-edit-${item._id}`}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(item)}
                    data-testid={`mailboxes-table-delete-${item._id}`}
                  >
                    Delete
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
