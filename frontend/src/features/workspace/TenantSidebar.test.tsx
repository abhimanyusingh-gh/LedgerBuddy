/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { TenantSidebar } from "@/features/workspace/TenantSidebar";

const ORDERED_LABELS = [
  "Dashboard",
  "Inbox",
  "Triage",
  "Invoices",
  "Vendors",
  "Payments",
  "Reconciliation",
  "Exports",
  "Settings"
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof TenantSidebar>> = {}) {
  const props: React.ComponentProps<typeof TenantSidebar> = {
    activeTab: "overview",
    activeStandaloneRoute: null,
    onTabChange: jest.fn(),
    onStandaloneRouteChange: jest.fn(),
    canViewTenantConfig: true,
    canViewConnections: true,
    invoiceActionRequiredCount: 0,
    triageCount: 0,
    ...overrides
  };
  const utils = render(<TenantSidebar {...props} />);
  return { ...utils, props };
}

describe("TenantSidebar", () => {
  it("renders all items in the PRD-defined order (Triage between Inbox and Invoices)", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const labels = within(nav).getAllByRole("button").map((btn) => btn.querySelector(".tenant-sidebar-label")?.textContent);
    expect(labels).toEqual(ORDERED_LABELS);
  });

  it("marks only the matching item with aria-current=page when activeTab is dashboard", () => {
    renderSidebar({ activeTab: "dashboard" });
    const invoicesBtn = screen.getByRole("button", { name: /Invoices/ });
    expect(invoicesBtn).toHaveAttribute("aria-current", "page");
    const dashBtn = screen.getByRole("button", { name: /^Dashboard/ });
    expect(dashBtn).not.toHaveAttribute("aria-current");
  });

  it("calls onTabChange with the mapped tab when a backed item is clicked", () => {
    const { props } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Invoices/ }));
    expect(props.onTabChange).toHaveBeenCalledWith("dashboard");
    fireEvent.click(screen.getByRole("button", { name: /Exports/ }));
    expect(props.onTabChange).toHaveBeenCalledWith("exports");
  });

  it("does not call onTabChange for placeholder items (Vendors, Payments, Inbox)", () => {
    const { props } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Vendors/ }));
    fireEvent.click(screen.getByRole("button", { name: /Payments/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(props.onTabChange).not.toHaveBeenCalled();
  });

  it("disables Settings when canViewTenantConfig is false", () => {
    renderSidebar({ canViewTenantConfig: false });
    const settingsBtn = screen.getByRole("button", { name: /Settings/ });
    expect(settingsBtn).toBeDisabled();
    expect(settingsBtn).toHaveAttribute("aria-disabled", "true");
  });

  it("disables Reconciliation when canViewConnections is false", () => {
    renderSidebar({ canViewConnections: false });
    const reconBtn = screen.getByRole("button", { name: /Reconciliation/ });
    expect(reconBtn).toBeDisabled();
  });

  it("renders the action-required count badge on Invoices when > 0", () => {
    renderSidebar({ invoiceActionRequiredCount: 7 });
    const invoicesBtn = screen.getByRole("button", { name: /Invoices/ });
    expect(within(invoicesBtn).getByText("7")).toBeInTheDocument();
  });

  it("renders the triage count badge on Triage when > 0", () => {
    renderSidebar({ triageCount: 5 });
    const triageBtn = screen.getByRole("button", { name: /Triage/ });
    expect(within(triageBtn).getByText("5")).toBeInTheDocument();
    expect(within(triageBtn).getByTitle("5 awaiting triage")).toBeInTheDocument();
  });

  it("extends aria-label with the action-required count when > 0 (a11y for SR users)", () => {
    renderSidebar({ invoiceActionRequiredCount: 7 });
    const invoicesBtn = screen.getByRole("button", { name: "Invoices, 7 action required" });
    expect(invoicesBtn).toBeInTheDocument();
  });

  it("extends aria-label with the triage count when > 0 (a11y for SR users)", () => {
    renderSidebar({ triageCount: 4 });
    const triageBtn = screen.getByRole("button", { name: "Triage, 4 awaiting" });
    expect(triageBtn).toBeInTheDocument();
  });

  it("calls onStandaloneRouteChange('triage') when Triage is clicked", () => {
    const { props } = renderSidebar({ triageCount: 3 });
    fireEvent.click(screen.getByRole("button", { name: /Triage/ }));
    expect(props.onStandaloneRouteChange).toHaveBeenCalledWith("triage");
    expect(props.onTabChange).not.toHaveBeenCalled();
  });

  it("marks Triage as aria-current=page when activeStandaloneRoute is 'triage'", () => {
    renderSidebar({ activeStandaloneRoute: "triage", activeTab: "dashboard" });
    const triageBtn = screen.getByRole("button", { name: /Triage/ });
    expect(triageBtn).toHaveAttribute("aria-current", "page");
    const invoicesBtn = screen.getByRole("button", { name: /Invoices/ });
    expect(invoicesBtn).not.toHaveAttribute("aria-current");
  });

  it("does not mark any tab item as active while a standalone route is open", () => {
    renderSidebar({ activeStandaloneRoute: "triage", activeTab: "overview" });
    const dashBtn = screen.getByRole("button", { name: /^Dashboard/ });
    expect(dashBtn).not.toHaveAttribute("aria-current");
  });
});
