/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ApproverSelector } from "./ApproverSelector";

const tenantUsers = [
  { userId: "u1", email: "alice@example.com" },
  { userId: "u2", email: "bob@example.com" },
];

const baseProps = {
  approver: { approverType: "any_member" as const },
  tenantUsers,
  onApproverChange: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

describe("ApproverSelector", () => {
  it("shows all 5 approver types in the dropdown", () => {
    render(<ApproverSelector {...baseProps} />);

    const select = screen.getByLabelText("Approver:") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["any_member", "role", "specific_users", "persona", "capability"]);
  });

  it("shows no sub-selector for any_member", () => {
    render(<ApproverSelector {...baseProps} />);

    expect(screen.queryByLabelText("Role:")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Users:")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Persona:")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Capability:")).not.toBeInTheDocument();
  });

  it("shows role dropdown for role type", () => {
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "role", approverRole: "ca" }}
      />
    );

    const roleSelect = screen.getByLabelText("Role:") as HTMLSelectElement;
    expect(roleSelect.value).toBe("ca");
    const options = Array.from(roleSelect.options).map((o) => o.value);
    expect(options).toContain("TENANT_ADMIN");
    expect(options).toContain("ca");
    expect(options).toContain("senior_accountant");
  });

  it("shows user multi-select for specific_users type", () => {
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "specific_users", approverUserIds: ["u1"] }}
      />
    );

    const usersSelect = screen.getByLabelText("Users:") as HTMLSelectElement;
    expect(usersSelect.multiple).toBe(true);
    const options = Array.from(usersSelect.options).map((o) => o.value);
    expect(options).toEqual(["u1", "u2"]);
  });

  it("shows persona dropdown for persona type", () => {
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "persona", approverPersona: "ca" }}
      />
    );

    const personaSelect = screen.getByLabelText("Persona:") as HTMLSelectElement;
    expect(personaSelect.value).toBe("ca");
    const options = Array.from(personaSelect.options).map((o) => o.value);
    expect(options).toContain("ap_clerk");
    expect(options).toContain("senior_accountant");
    expect(options).toContain("ca");
    expect(options).toContain("tax_specialist");
    expect(options).toContain("firm_partner");
    expect(options).toContain("ops_admin");
    expect(options).toContain("audit_clerk");
  });

  it("shows capability dropdown for capability type", () => {
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "capability", approverCapability: "canSignOffCompliance" }}
      />
    );

    const capSelect = screen.getByLabelText("Capability:") as HTMLSelectElement;
    expect(capSelect.value).toBe("canSignOffCompliance");
    const options = Array.from(capSelect.options).map((o) => o.value);
    expect(options).toContain("canApproveInvoices");
    expect(options).toContain("canSignOffCompliance");
    expect(options).toContain("canExportToTally");
    expect(options).toContain("canConfigureWorkflow");
  });

  it("calls onApproverChange with updated approverType when changing the type", () => {
    const onApproverChange = jest.fn();
    render(<ApproverSelector {...baseProps} onApproverChange={onApproverChange} />);

    const select = screen.getByLabelText("Approver:");
    fireEvent.change(select, { target: { value: "persona" } });
    expect(onApproverChange).toHaveBeenCalledWith(
      expect.objectContaining({ approverType: "persona" })
    );
  });

  it("calls onApproverChange with updated persona when changing persona", () => {
    const onApproverChange = jest.fn();
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "persona" }}
        onApproverChange={onApproverChange}
      />
    );

    const select = screen.getByLabelText("Persona:");
    fireEvent.change(select, { target: { value: "tax_specialist" } });
    expect(onApproverChange).toHaveBeenCalledWith(
      expect.objectContaining({ approverType: "persona", approverPersona: "tax_specialist" })
    );
  });

  it("calls onApproverChange with updated capability when changing capability", () => {
    const onApproverChange = jest.fn();
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "capability" }}
        onApproverChange={onApproverChange}
      />
    );

    const select = screen.getByLabelText("Capability:");
    fireEvent.change(select, { target: { value: "canExportToTally" } });
    expect(onApproverChange).toHaveBeenCalledWith(
      expect.objectContaining({ approverType: "capability", approverCapability: "canExportToTally" })
    );
  });

  it("calls onApproverChange with updated role when changing role", () => {
    const onApproverChange = jest.fn();
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "role" }}
        onApproverChange={onApproverChange}
      />
    );

    const select = screen.getByLabelText("Role:");
    fireEvent.change(select, { target: { value: "senior_accountant" } });
    expect(onApproverChange).toHaveBeenCalledWith(
      expect.objectContaining({ approverType: "role", approverRole: "senior_accountant" })
    );
  });

  it("defaults persona to ap_clerk when not provided", () => {
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "persona" }}
      />
    );

    const select = screen.getByLabelText("Persona:") as HTMLSelectElement;
    expect(select.value).toBe("ap_clerk");
  });

  it("defaults capability to canApproveInvoices when not provided", () => {
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "capability" }}
      />
    );

    const select = screen.getByLabelText("Capability:") as HTMLSelectElement;
    expect(select.value).toBe("canApproveInvoices");
  });
});
