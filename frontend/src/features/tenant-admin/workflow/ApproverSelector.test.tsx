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
  approverType: "any_member" as const,
  tenantUsers,
  onApproverTypeChange: jest.fn(),
  onApproverRoleChange: jest.fn(),
  onApproverUserIdsChange: jest.fn(),
  onApproverPersonaChange: jest.fn(),
  onApproverCapabilityChange: jest.fn(),
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
    render(<ApproverSelector {...baseProps} approverType="any_member" />);

    expect(screen.queryByLabelText("Role:")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Users:")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Persona:")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Capability:")).not.toBeInTheDocument();
  });

  it("shows role dropdown for role type", () => {
    render(<ApproverSelector {...baseProps} approverType="role" approverRole="ca" />);

    const roleSelect = screen.getByLabelText("Role:") as HTMLSelectElement;
    expect(roleSelect.value).toBe("ca");
    const options = Array.from(roleSelect.options).map((o) => o.value);
    expect(options).toContain("TENANT_ADMIN");
    expect(options).toContain("ca");
    expect(options).toContain("senior_accountant");
  });

  it("shows user multi-select for specific_users type", () => {
    render(<ApproverSelector {...baseProps} approverType="specific_users" approverUserIds={["u1"]} />);

    const usersSelect = screen.getByLabelText("Users:") as HTMLSelectElement;
    expect(usersSelect.multiple).toBe(true);
    const options = Array.from(usersSelect.options).map((o) => o.value);
    expect(options).toEqual(["u1", "u2"]);
  });

  it("shows persona dropdown for persona type", () => {
    render(<ApproverSelector {...baseProps} approverType="persona" approverPersona="ca" />);

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
    render(<ApproverSelector {...baseProps} approverType="capability" approverCapability="canSignOffCompliance" />);

    const capSelect = screen.getByLabelText("Capability:") as HTMLSelectElement;
    expect(capSelect.value).toBe("canSignOffCompliance");
    const options = Array.from(capSelect.options).map((o) => o.value);
    expect(options).toContain("canApproveInvoices");
    expect(options).toContain("canSignOffCompliance");
    expect(options).toContain("canExportToTally");
    expect(options).toContain("canConfigureWorkflow");
  });

  it("calls onApproverTypeChange when changing the type", () => {
    const onApproverTypeChange = jest.fn();
    render(<ApproverSelector {...baseProps} onApproverTypeChange={onApproverTypeChange} />);

    const select = screen.getByLabelText("Approver:");
    fireEvent.change(select, { target: { value: "persona" } });
    expect(onApproverTypeChange).toHaveBeenCalledWith("persona");
  });

  it("calls onApproverPersonaChange when changing persona", () => {
    const onApproverPersonaChange = jest.fn();
    render(
      <ApproverSelector
        {...baseProps}
        approverType="persona"
        onApproverPersonaChange={onApproverPersonaChange}
      />
    );

    const select = screen.getByLabelText("Persona:");
    fireEvent.change(select, { target: { value: "tax_specialist" } });
    expect(onApproverPersonaChange).toHaveBeenCalledWith("tax_specialist");
  });

  it("calls onApproverCapabilityChange when changing capability", () => {
    const onApproverCapabilityChange = jest.fn();
    render(
      <ApproverSelector
        {...baseProps}
        approverType="capability"
        onApproverCapabilityChange={onApproverCapabilityChange}
      />
    );

    const select = screen.getByLabelText("Capability:");
    fireEvent.change(select, { target: { value: "canExportToTally" } });
    expect(onApproverCapabilityChange).toHaveBeenCalledWith("canExportToTally");
  });

  it("calls onApproverRoleChange when changing role", () => {
    const onApproverRoleChange = jest.fn();
    render(
      <ApproverSelector
        {...baseProps}
        approverType="role"
        onApproverRoleChange={onApproverRoleChange}
      />
    );

    const select = screen.getByLabelText("Role:");
    fireEvent.change(select, { target: { value: "senior_accountant" } });
    expect(onApproverRoleChange).toHaveBeenCalledWith("senior_accountant");
  });

  it("defaults persona to ap_clerk when not provided", () => {
    render(<ApproverSelector {...baseProps} approverType="persona" />);

    const select = screen.getByLabelText("Persona:") as HTMLSelectElement;
    expect(select.value).toBe("ap_clerk");
  });

  it("defaults capability to canApproveInvoices when not provided", () => {
    render(<ApproverSelector {...baseProps} approverType="capability" />);

    const select = screen.getByLabelText("Capability:") as HTMLSelectElement;
    expect(select.value).toBe("canApproveInvoices");
  });
});
