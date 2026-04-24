/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RiskDot, RISK_SEVERITY } from "@/components/compliance/RiskDot";

describe("RiskDot", () => {
  it("renders clean state with success tone and no count", () => {
    render(<RiskDot severity={RISK_SEVERITY.CLEAN} count={0} />);
    const dot = screen.getByRole("img", { name: "No risk signals" });
    expect(dot).toBeInTheDocument();
    expect(dot.textContent).toBe("check_circle");
  });

  it("renders critical severity with count and pluralised label", () => {
    render(<RiskDot severity={RISK_SEVERITY.CRITICAL} count={3} />);
    const dot = screen.getByRole("img", { name: "3 critical risk signals" });
    expect(dot.textContent).toContain("3");
    expect(dot.textContent).toContain("error");
  });

  it("renders warning severity with singular label when count is 1", () => {
    render(<RiskDot severity={RISK_SEVERITY.WARNING} count={1} />);
    expect(screen.getByRole("img", { name: "1 warning risk signal" })).toBeInTheDocument();
  });

  it("renders info severity with count", () => {
    render(<RiskDot severity={RISK_SEVERITY.INFO} count={2} />);
    const dot = screen.getByRole("img", { name: "2 info risk signals" });
    expect(dot.textContent).toContain("info");
    expect(dot.textContent).toContain("2");
  });

  it("falls back to clean label when a severity is paired with a zero count", () => {
    render(<RiskDot severity={RISK_SEVERITY.WARNING} count={0} />);
    expect(screen.getByRole("img", { name: "No risk signals" })).toBeInTheDocument();
  });
});
