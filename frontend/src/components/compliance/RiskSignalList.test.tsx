/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RiskSignalList } from "@/components/compliance/RiskSignalList";
import type { InvoiceCompliance } from "@/types";

type RiskSignal = NonNullable<InvoiceCompliance["riskSignals"]>[number];

function buildSignal(overrides: Partial<RiskSignal> = {}): RiskSignal {
  return {
    code: "SIG_1",
    category: "compliance",
    severity: "warning",
    message: "Something needs review",
    confidencePenalty: 5,
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
    ...overrides
  };
}

describe("RiskSignalList", () => {
  it("renders a no-risks empty state when there are no signals", () => {
    render(<RiskSignalList signals={[]} />);
    expect(screen.getByText("No risks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse|expand/i })).not.toBeInTheDocument();
  });

  it("is expanded by default and renders signal messages", () => {
    render(
      <RiskSignalList
        signals={[
          buildSignal({ code: "A", message: "Missing GSTIN", severity: "critical" }),
          buildSignal({ code: "B", message: "PAN mismatch", severity: "warning" })
        ]}
      />
    );

    expect(screen.getByText("Missing GSTIN")).toBeInTheDocument();
    expect(screen.getByText("PAN mismatch")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /risk signals/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses when the toggle is clicked (uncontrolled)", () => {
    render(<RiskSignalList signals={[buildSignal({ message: "Hello" })]} />);
    const toggle = screen.getByRole("button", { name: /risk signals/i });

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });

  it("honours the controlled expanded prop and invokes onToggle", () => {
    const onToggle = jest.fn();
    const { rerender } = render(
      <RiskSignalList
        signals={[buildSignal({ message: "Hello" })]}
        expanded={false}
        onToggle={onToggle}
        controlsId="risk-panel-1"
      />
    );

    const toggle = screen.getByRole("button", { name: /risk signals/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("risk-panel-1");
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <RiskSignalList
        signals={[buildSignal({ message: "Hello" })]}
        expanded={true}
        onToggle={onToggle}
        controlsId="risk-panel-1"
      />
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("calls onDismiss for open signals when Dismiss is clicked", () => {
    const onDismiss = jest.fn();
    render(
      <RiskSignalList
        signals={[buildSignal({ code: "SIG_OPEN" })]}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("SIG_OPEN");
  });
});
