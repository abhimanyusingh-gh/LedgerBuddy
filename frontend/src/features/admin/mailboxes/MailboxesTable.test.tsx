/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MailboxesTable } from "@/features/admin/mailboxes/MailboxesTable";
import type { MailboxAssignment } from "@/api/mailboxAssignments";

const ORGS = [
  { id: "org-1", companyName: "Sharma Textiles" },
  { id: "org-2", companyName: "Bose Steel" },
  { id: "org-3", companyName: "Acme Industries" },
  { id: "org-4", companyName: "Crown Mills" },
  { id: "org-5", companyName: "Delta Logistics" }
];

function buildAssignment(overrides: Partial<MailboxAssignment> & { _id: string }): MailboxAssignment {
  return {
    integrationId: `int-${overrides._id}`,
    email: `${overrides._id}@example.com`,
    clientOrgIds: ["org-1"],
    assignedTo: "all",
    status: "CONNECTED",
    lastSyncedAt: null,
    pollingConfig: null,
    createdAt: null,
    updatedAt: null,
    ...overrides
  };
}

describe("features/admin/mailboxes/MailboxesTable", () => {
  it("sorts rows ascending by email", () => {
    render(
      <MailboxesTable
        items={[
          buildAssignment({ _id: "a-2", email: "zeta@firm.com" }),
          buildAssignment({ _id: "a-1", email: "alpha@firm.com" })
        ]}
        clientOrgs={ORGS}
        ingestionCounts={{}}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    const rows = screen.getAllByTestId("mailboxes-table-row");
    expect(rows[0]).toHaveTextContent("alpha@firm.com");
    expect(rows[1]).toHaveTextContent("zeta@firm.com");
  });

  it("renders the first 3 chips and a +N more overflow badge", () => {
    render(
      <MailboxesTable
        items={[
          buildAssignment({
            _id: "a-1",
            clientOrgIds: ["org-1", "org-2", "org-3", "org-4", "org-5"]
          })
        ]}
        clientOrgs={ORGS}
        ingestionCounts={{}}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    const chipsCell = screen.getByTestId("mailboxes-table-chips-a-1");
    expect(chipsCell).toHaveTextContent("Sharma Textiles");
    expect(chipsCell).toHaveTextContent("Bose Steel");
    expect(chipsCell).toHaveTextContent("Acme Industries");
    const overflow = screen.getByTestId("mailboxes-table-chips-overflow-a-1");
    expect(overflow).toHaveTextContent("+2 more");
    expect(overflow).toHaveAttribute("title", "Crown Mills, Delta Logistics");
  });

  it("does not render the overflow badge when chip count is at or under the limit", () => {
    render(
      <MailboxesTable
        items={[buildAssignment({ _id: "a-1", clientOrgIds: ["org-1", "org-2"] })]}
        clientOrgs={ORGS}
        ingestionCounts={{}}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.queryByTestId("mailboxes-table-chips-overflow-a-1")).not.toBeInTheDocument();
  });

  it("falls back to the raw id when the org is no longer in the tenant list", () => {
    render(
      <MailboxesTable
        items={[buildAssignment({ _id: "a-1", clientOrgIds: ["org-99"] })]}
        clientOrgs={ORGS}
        ingestionCounts={{}}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByTestId("mailboxes-table-chips-a-1")).toHaveTextContent("org-99");
  });

  it("renders the ingestion count when provided and an em-dash placeholder otherwise", () => {
    render(
      <MailboxesTable
        items={[
          buildAssignment({ _id: "a-1" }),
          buildAssignment({ _id: "a-2", email: "b@firm.com" })
        ]}
        clientOrgs={ORGS}
        ingestionCounts={{ "a-1": 17 }}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByTestId("mailboxes-table-count-a-1")).toHaveTextContent("17");
    expect(screen.getByTestId("mailboxes-table-count-pending-a-2")).toBeInTheDocument();
  });

  it("invokes the onEdit / onDelete callbacks with the row's assignment", () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    render(
      <MailboxesTable
        items={[buildAssignment({ _id: "a-1" })]}
        clientOrgs={ORGS}
        ingestionCounts={{}}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByTestId("mailboxes-table-edit-a-1"));
    fireEvent.click(screen.getByTestId("mailboxes-table-delete-a-1"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ _id: "a-1" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ _id: "a-1" }));
  });

  it("renders a View recent button + clickable count when onViewRecent is supplied", () => {
    const onViewRecent = jest.fn();
    render(
      <MailboxesTable
        items={[buildAssignment({ _id: "a-1" })]}
        clientOrgs={ORGS}
        ingestionCounts={{ "a-1": 7 }}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onViewRecent={onViewRecent}
      />
    );
    fireEvent.click(screen.getByTestId("mailboxes-table-view-recent-a-1"));
    expect(onViewRecent).toHaveBeenCalledWith(expect.objectContaining({ _id: "a-1" }));

    onViewRecent.mockClear();
    fireEvent.click(screen.getByTestId("mailboxes-table-count-a-1"));
    expect(onViewRecent).toHaveBeenCalledWith(expect.objectContaining({ _id: "a-1" }));
  });

  it("omits the View recent button when onViewRecent is not supplied", () => {
    render(
      <MailboxesTable
        items={[buildAssignment({ _id: "a-1" })]}
        clientOrgs={ORGS}
        ingestionCounts={{ "a-1": 3 }}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.queryByTestId("mailboxes-table-view-recent-a-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("mailboxes-table-count-a-1").tagName.toLowerCase()).toBe("span");
  });
});
