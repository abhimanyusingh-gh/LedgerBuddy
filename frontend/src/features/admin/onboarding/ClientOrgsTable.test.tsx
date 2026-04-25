/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ClientOrgsTable } from "@/features/admin/onboarding/ClientOrgsTable";
import type { ClientOrganization } from "@/api/clientOrgs";

function buildOrg(overrides: Partial<ClientOrganization> & { _id: string; gstin: string }): ClientOrganization {
  return {
    tenantId: "tenant-1",
    companyName: `Co-${overrides._id}`,
    f12OverwriteByGuidVerified: false,
    detectedVersion: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides
  };
}

describe("features/admin/onboarding/ClientOrgsTable", () => {
  const items = [
    buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Textiles", stateName: "Karnataka" }),
    buildOrg({ _id: "org-2", gstin: "07AABCC1234D1ZA", companyName: "Bose Steel", f12OverwriteByGuidVerified: true })
  ];

  it("sorts visible rows by companyName ascending", () => {
    render(
      <ClientOrgsTable
        items={items}
        searchTerm=""
        activeClientOrgId={null}
        onEdit={jest.fn()}
        onArchive={jest.fn()}
        onSelect={jest.fn()}
      />
    );
    const rows = screen.getAllByTestId("client-orgs-table-row");
    expect(rows[0]).toHaveTextContent("Bose Steel");
    expect(rows[1]).toHaveTextContent("Sharma Textiles");
  });

  it("filters rows by search term across companyName and gstin", () => {
    render(
      <ClientOrgsTable
        items={items}
        searchTerm="29abc"
        activeClientOrgId={null}
        onEdit={jest.fn()}
        onArchive={jest.fn()}
        onSelect={jest.fn()}
      />
    );
    const rows = screen.getAllByTestId("client-orgs-table-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Sharma Textiles");
  });

  it("renders the empty-search state when no rows match", () => {
    render(
      <ClientOrgsTable
        items={items}
        searchTerm="nope"
        activeClientOrgId={null}
        onEdit={jest.fn()}
        onArchive={jest.fn()}
        onSelect={jest.fn()}
      />
    );
    expect(screen.getByTestId("client-orgs-table-empty-search")).toBeInTheDocument();
    expect(screen.queryByTestId("client-orgs-table")).not.toBeInTheDocument();
  });

  it("hides the Select button on the active row and surfaces the active badge", () => {
    render(
      <ClientOrgsTable
        items={items}
        searchTerm=""
        activeClientOrgId="org-2"
        onEdit={jest.fn()}
        onArchive={jest.fn()}
        onSelect={jest.fn()}
      />
    );
    const activeRow = screen.getByText("Bose Steel").closest("tr");
    expect(activeRow).toHaveAttribute("data-active", "true");
    expect(screen.getAllByTestId("client-orgs-table-select")).toHaveLength(1);
  });

  it("invokes the row callbacks for edit, archive, and select", () => {
    const onEdit = jest.fn();
    const onArchive = jest.fn();
    const onSelect = jest.fn();
    render(
      <ClientOrgsTable
        items={items}
        searchTerm="bose"
        activeClientOrgId={null}
        onEdit={onEdit}
        onArchive={onArchive}
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByTestId("client-orgs-table-select"));
    fireEvent.click(screen.getByTestId("client-orgs-table-edit"));
    fireEvent.click(screen.getByTestId("client-orgs-table-archive"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ _id: "org-2" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ _id: "org-2" }));
    expect(onArchive).toHaveBeenCalledWith(expect.objectContaining({ _id: "org-2" }));
  });
});
