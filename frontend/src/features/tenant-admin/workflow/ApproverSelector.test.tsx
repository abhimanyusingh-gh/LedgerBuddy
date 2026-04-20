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

  it("calls onApproverChange with updated approverType when changing the top-level type", () => {
    const onApproverChange = jest.fn();
    render(<ApproverSelector {...baseProps} onApproverChange={onApproverChange} />);

    const select = screen.getByLabelText("Approver:");
    fireEvent.change(select, { target: { value: "persona" } });
    expect(onApproverChange).toHaveBeenCalledWith(
      expect.objectContaining({ approverType: "persona" })
    );
  });

  it.each([
    {
      type: "persona" as const,
      label: "Persona:",
      value: "tax_specialist",
      expectedKey: "approverPersona",
    },
    {
      type: "capability" as const,
      label: "Capability:",
      value: "canExportToTally",
      expectedKey: "approverCapability",
    },
    {
      type: "role" as const,
      label: "Role:",
      value: "senior_accountant",
      expectedKey: "approverRole",
    },
  ])("calls onApproverChange with updated $expectedKey when changing $type sub-selector", ({ type, label, value, expectedKey }) => {
    const onApproverChange = jest.fn();
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: type }}
        onApproverChange={onApproverChange}
      />
    );

    const select = screen.getByLabelText(label);
    fireEvent.change(select, { target: { value } });
    expect(onApproverChange).toHaveBeenCalledWith(
      expect.objectContaining({ approverType: type, [expectedKey]: value })
    );
  });

  it("calls onApproverChange when specific users are selected", () => {
    const onApproverChange = jest.fn();
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: "specific_users", approverUserIds: [] }}
        onApproverChange={onApproverChange}
      />
    );

    const select = screen.getByLabelText("Users:") as HTMLSelectElement;
    const option1 = select.options[0] as HTMLOptionElement;
    option1.selected = true;
    fireEvent.change(select);
    expect(onApproverChange).toHaveBeenCalledWith(
      expect.objectContaining({ approverUserIds: ["u1"] })
    );
  });

  it.each([
    { type: "persona" as const, label: "Persona:", expected: "ap_clerk" },
    { type: "capability" as const, label: "Capability:", expected: "canApproveInvoices" },
    { type: "role" as const, label: "Role:", expected: "TENANT_ADMIN" },
  ])("defaults $type sub-selector to $expected when not provided", ({ type, label, expected }) => {
    render(
      <ApproverSelector
        {...baseProps}
        approver={{ approverType: type }}
      />
    );

    const select = screen.getByLabelText(label) as HTMLSelectElement;
    expect(select.value).toBe(expected);
  });

  it.each([
    {
      from: { approverType: "specific_users" as const, approverUserIds: ["u1"] },
      visibleBefore: "Users:",
      to: { approverType: "any_member" as const },
      hiddenAfter: "Users:",
      visibleAfter: null as string | null,
    },
    {
      from: { approverType: "persona" as const, approverPersona: "ca" },
      visibleBefore: "Persona:",
      to: { approverType: "role" as const, approverRole: "TENANT_ADMIN" },
      hiddenAfter: "Persona:",
      visibleAfter: "Role:",
    },
  ])("hides $hiddenAfter when switching from $from.approverType to $to.approverType", ({ from, visibleBefore, to, hiddenAfter, visibleAfter }) => {
    const { rerender } = render(
      <ApproverSelector {...baseProps} approver={from} />
    );
    expect(screen.getByLabelText(visibleBefore)).toBeInTheDocument();

    rerender(<ApproverSelector {...baseProps} approver={to} />);
    expect(screen.queryByLabelText(hiddenAfter)).not.toBeInTheDocument();
    if (visibleAfter) {
      expect(screen.getByLabelText(visibleAfter)).toBeInTheDocument();
    }
  });
});
