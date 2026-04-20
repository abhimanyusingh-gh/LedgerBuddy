/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StepCard } from "./StepCard";
import type { WorkflowStep, TenantUser } from "@/types";

const tenantUsers: TenantUser[] = [
  { userId: "u1", email: "alice@example.com", role: "ca", enabled: true },
  { userId: "u2", email: "bob@example.com", role: "senior_accountant", enabled: true },
];

const baseStep: WorkflowStep = {
  order: 1,
  name: "Step 1",
  approverType: "any_member",
  rule: "any",
  condition: null,
};

const baseProps = {
  step: baseStep,
  stepCount: 1,
  tenantUsers,
  onUpdate: jest.fn(),
  onRemove: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

describe("StepCard", () => {
  it("renders step order", () => {
    render(<StepCard {...baseProps} />);
    expect(screen.getByText("Step 1")).toBeInTheDocument();
  });

  it("shows compliance sign-off badge for compliance_signoff type", () => {
    render(
      <StepCard
        {...baseProps}
        step={{ ...baseStep, type: "compliance_signoff" }}
      />
    );
    const header = document.querySelector(".workflow-step-card-header")!;
    expect(header.textContent).toContain("Compliance Sign-off");
  });

  it("does not show compliance sign-off badge for approval type", () => {
    render(
      <StepCard
        {...baseProps}
        step={{ ...baseStep, type: "approval" }}
      />
    );
    const header = document.querySelector(".workflow-step-card-header")!;
    expect(header.textContent).not.toContain("Compliance Sign-off");
  });

  it("shows eligible compliance users when step is compliance_signoff and users exist", () => {
    const complianceUsers = [
      { userId: "u1", role: "ca" },
      { userId: "u2", role: "senior_accountant" },
    ];
    render(
      <StepCard
        {...baseProps}
        step={{ ...baseStep, type: "compliance_signoff" }}
        complianceSignoffUsers={complianceUsers}
      />
    );

    expect(screen.getByText("Eligible compliance sign-off users:")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com (ca)")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com (senior_accountant)")).toBeInTheDocument();
  });

  it("shows warning when compliance_signoff step has no eligible users", () => {
    render(
      <StepCard
        {...baseProps}
        step={{ ...baseStep, type: "compliance_signoff" }}
        complianceSignoffUsers={[]}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No users have compliance sign-off capability."
    );
    expect(screen.getByText("Grant capability in Users section")).toBeInTheDocument();
  });

  it("does not show compliance section for non-compliance_signoff steps", () => {
    render(
      <StepCard
        {...baseProps}
        step={{ ...baseStep, type: "approval" }}
        complianceSignoffUsers={[{ userId: "u1", role: "ca" }]}
      />
    );

    expect(screen.queryByText("Eligible compliance sign-off users:")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows remove button when stepCount > 1", () => {
    render(<StepCard {...baseProps} stepCount={2} />);
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("hides remove button when stepCount is 1", () => {
    render(<StepCard {...baseProps} stepCount={1} />);
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
  });

  it("resolves userId to email for compliance users", () => {
    render(
      <StepCard
        {...baseProps}
        step={{ ...baseStep, type: "compliance_signoff" }}
        complianceSignoffUsers={[{ userId: "unknown-id", role: "ca" }]}
      />
    );

    expect(screen.getByText("unknown-id (ca)")).toBeInTheDocument();
  });

  describe("Advanced Options toggle", () => {
    it("renders the advanced options toggle button", () => {
      render(<StepCard {...baseProps} />);
      expect(screen.getByText(/Advanced options/)).toBeInTheDocument();
    });

    it("defaults to collapsed for a default step", () => {
      render(<StepCard {...baseProps} />);
      expect(screen.queryByLabelText("Step type:")).not.toBeInTheDocument();
    });

    it("expands advanced section on toggle click", () => {
      render(<StepCard {...baseProps} />);
      fireEvent.click(screen.getByText(/Advanced options/));
      expect(screen.getByLabelText("Step type:")).toBeInTheDocument();
    });

    it("collapses advanced section on second toggle click", () => {
      render(<StepCard {...baseProps} />);
      const toggle = screen.getByText(/Advanced options/);
      fireEvent.click(toggle);
      expect(screen.getByLabelText("Step type:")).toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.queryByLabelText("Step type:")).not.toBeInTheDocument();
    });

    it.each([
      ["type: compliance_signoff", { type: "compliance_signoff" as const }],
      ["type: escalation", { type: "escalation" as const }],
      ["timeoutHours set", { timeoutHours: 24 }],
      ["escalateTo set", { escalateTo: "u1" }],
    ])("auto-opens when %s", (_label, overrides) => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, ...overrides }}
        />
      );
      expect(screen.getByLabelText("Step type:")).toBeInTheDocument();
    });

    it("stays collapsed when step has default values only", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "approval", timeoutHours: null, escalateTo: null }}
        />
      );
      expect(screen.queryByLabelText("Step type:")).not.toBeInTheDocument();
    });
  });

  describe("Step type selector", () => {
    it("shows all three step types in the dropdown", () => {
      render(<StepCard {...baseProps} />);
      fireEvent.click(screen.getByText(/Advanced options/));
      const select = screen.getByLabelText("Step type:") as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toEqual(["approval", "compliance_signoff", "escalation"]);
    });

    it("calls onUpdate with new type when changed", () => {
      const onUpdate = jest.fn();
      render(<StepCard {...baseProps} onUpdate={onUpdate} />);
      fireEvent.click(screen.getByText(/Advanced options/));
      const select = screen.getByLabelText("Step type:");
      fireEvent.change(select, { target: { value: "escalation" } });
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ type: "escalation" })
      );
    });

    it("clears escalation fields when switching away from escalation", () => {
      const onUpdate = jest.fn();
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation", timeoutHours: 24, escalateTo: "u1" }}
          onUpdate={onUpdate}
        />
      );
      const select = screen.getByLabelText("Step type:");
      fireEvent.change(select, { target: { value: "approval" } });
      expect(onUpdate).toHaveBeenCalledWith({
        type: "approval",
        timeoutHours: null,
        escalateTo: null,
      });
    });
  });

  describe("Escalation fields", () => {
    it("shows timeout and escalateTo fields when type is escalation", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation" }}
        />
      );
      expect(screen.getByLabelText("Timeout (hours):")).toBeInTheDocument();
      expect(screen.getByLabelText("Escalate to:")).toBeInTheDocument();
    });

    it("does not show escalation fields when type is approval", () => {
      render(<StepCard {...baseProps} />);
      fireEvent.click(screen.getByText(/Advanced options/));
      expect(screen.queryByLabelText("Timeout (hours):")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Escalate to:")).not.toBeInTheDocument();
    });

    it("does not show escalation fields when type is compliance_signoff", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "compliance_signoff" }}
        />
      );
      expect(screen.queryByLabelText("Timeout (hours):")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Escalate to:")).not.toBeInTheDocument();
    });

    it("calls onUpdate when timeout value changes", () => {
      const onUpdate = jest.fn();
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation" }}
          onUpdate={onUpdate}
        />
      );
      const input = screen.getByLabelText("Timeout (hours):");
      fireEvent.change(input, { target: { value: "48" } });
      expect(onUpdate).toHaveBeenCalledWith({ timeoutHours: 48 });
    });

    it("calls onUpdate when escalateTo value changes", () => {
      const onUpdate = jest.fn();
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation" }}
          onUpdate={onUpdate}
        />
      );
      const select = screen.getByLabelText("Escalate to:");
      fireEvent.change(select, { target: { value: "u1" } });
      expect(onUpdate).toHaveBeenCalledWith({ escalateTo: "u1" });
    });

    it("sets escalateTo to null when empty option is selected", () => {
      const onUpdate = jest.fn();
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation", escalateTo: "u1" }}
          onUpdate={onUpdate}
        />
      );
      const select = screen.getByLabelText("Escalate to:");
      fireEvent.change(select, { target: { value: "" } });
      expect(onUpdate).toHaveBeenCalledWith({ escalateTo: null });
    });

    it("shows tenant users as escalation target options", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation" }}
        />
      );
      const select = screen.getByLabelText("Escalate to:") as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain("u1");
      expect(options).toContain("u2");
    });

    it("displays escalation badge in header when type is escalation", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation" }}
        />
      );
      const header = document.querySelector(".workflow-step-card-header")!;
      expect(header.textContent).toContain("Escalation");
    });

    it("shows helper text for escalation timeout", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation" }}
        />
      );
      expect(screen.getByText("Time before this step auto-escalates. Uses wall-clock hours.")).toBeInTheDocument();
    });

    it("shows validation warning when timeoutHours is set but escalateTo is missing", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation", timeoutHours: 24, escalateTo: null }}
        />
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Escalation target is required when a timeout is set."
      );
    });

    it("does not show validation warning when both timeoutHours and escalateTo are set", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation", timeoutHours: 24, escalateTo: "u1" }}
        />
      );
      expect(screen.queryByText("Escalation target is required when a timeout is set.")).not.toBeInTheDocument();
    });

    it("does not show validation warning when timeoutHours is not set", () => {
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation", timeoutHours: null, escalateTo: null }}
        />
      );
      expect(screen.queryByText("Escalation target is required when a timeout is set.")).not.toBeInTheDocument();
    });

    it.each([
      ["non-integer 2.5", "2.5", "reject"],
      ["below 1 (0)", "0", "reject"],
      ["above 720 (721)", "721", "reject"],
      ["empty string (clear)", "", "accept"],
    ])("timeout input validation: %s", (_label, value, behavior) => {
      const onUpdate = jest.fn();
      render(
        <StepCard
          {...baseProps}
          step={{ ...baseStep, type: "escalation", timeoutHours: 24 }}
          onUpdate={onUpdate}
        />
      );
      const input = screen.getByLabelText("Timeout (hours):");
      fireEvent.change(input, { target: { value } });
      if (behavior === "reject") {
        expect(onUpdate).not.toHaveBeenCalled();
      } else {
        expect(onUpdate).toHaveBeenCalledWith({ timeoutHours: null });
      }
    });
  });

  describe("Remove callback", () => {
    it("calls onRemove when remove button is clicked", () => {
      const onRemove = jest.fn();
      render(<StepCard {...baseProps} stepCount={2} onRemove={onRemove} />);
      fireEvent.click(screen.getByText("Remove"));
      expect(onRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe("Rule selector", () => {
    it("renders rule dropdown with any and all options", () => {
      render(<StepCard {...baseProps} />);
      const select = screen.getByLabelText("Rule:") as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toEqual(["any", "all"]);
    });

    it("calls onUpdate when rule value changes", () => {
      const onUpdate = jest.fn();
      render(<StepCard {...baseProps} onUpdate={onUpdate} />);
      const select = screen.getByLabelText("Rule:");
      fireEvent.change(select, { target: { value: "all" } });
      expect(onUpdate).toHaveBeenCalledWith({ rule: "all" });
    });
  });
});
