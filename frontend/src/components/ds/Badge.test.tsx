/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Badge } from "@/components/ds/Badge";

describe("ds/Badge", () => {
  it("renders children as accessible name when no title given", () => {
    render(<Badge>Active</Badge>);
    const badge = screen.getByText("Active");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.getAttribute("role")).toBeNull();
  });

  it("exposes role=img + aria-label when title supplied (dot badge use case)", () => {
    render(<Badge title="3 critical risk signals" tone="danger" />);
    const badge = screen.getByRole("img", { name: "3 critical risk signals" });
    expect(badge).toBeInTheDocument();
  });

  it("applies tone-specific background and foreground styling", () => {
    const { rerender } = render(<Badge tone="success">Valid</Badge>);
    let badge = screen.getByText("Valid");
    expect(badge.style.background).toContain("--badge-valid-bg");
    expect(badge.style.color).toContain("--badge-valid-fg");

    rerender(<Badge tone="danger">Error</Badge>);
    badge = screen.getByText("Error");
    expect(badge.style.background).toContain("--badge-invalid-bg");
  });

  it("applies size-based padding and font-size", () => {
    const { rerender } = render(<Badge size="sm">x</Badge>);
    let badge = screen.getByText("x");
    const smPadding = badge.style.padding;

    rerender(<Badge size="md">x</Badge>);
    badge = screen.getByText("x");
    expect(badge.style.padding).not.toBe(smPadding);
  });

  it("renders icon with aria-hidden when icon prop provided", () => {
    render(<Badge icon="warning">Review</Badge>);
    const badge = screen.getByText("Review");
    const icon = badge.querySelector(".material-symbols-outlined");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.textContent).toBe("warning");
  });

  it("forwards className", () => {
    const { container } = render(<Badge className="x-test">Tag</Badge>);
    expect(container.querySelector(".x-test")).not.toBeNull();
  });
});
