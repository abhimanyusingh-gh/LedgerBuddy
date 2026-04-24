/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { TenantSidebar, SIDEBAR_ITEM_ID } from "@/features/workspace/TenantSidebar";

const ORDERED_LABELS = [
  "Dashboard",
  "Inbox",
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
    onTabChange: jest.fn(),
    canViewTenantConfig: true,
    canViewConnections: true,
    invoiceActionRequiredCount: 0,
    ...overrides
  };
  const utils = render(<TenantSidebar {...props} />);
  return { ...utils, props };
}

describe("TenantSidebar", () => {
  it("renders all 8 items in the PRD-defined order", () => {
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

  it("maps overview tab to the Dashboard item", () => {
    renderSidebar({ activeTab: "overview" });
    const dashBtn = screen.getByRole("button", { name: /^Dashboard/ });
    expect(dashBtn).toHaveAttribute("aria-current", "page");
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
    fireEvent.click(screen.getByRole("button", { name: /Inbox/ }));
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

  it("hides the action-required badge on Invoices when count is 0", () => {
    renderSidebar({ invoiceActionRequiredCount: 0 });
    const invoicesBtn = screen.getByRole("button", { name: /Invoices/ });
    expect(within(invoicesBtn).queryByText("0")).toBeNull();
  });

  it("supports keyboard activation (Enter) on a focused backed item", async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar();
    const dashBtn = screen.getByRole("button", { name: /^Dashboard/ });
    dashBtn.focus();
    expect(dashBtn).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(props.onTabChange).toHaveBeenCalledWith("overview");
  });

  it("exports a stable SIDEBAR_ITEM_ID enum in the PRD-defined order (drift-guard)", () => {
    expect(Object.values(SIDEBAR_ITEM_ID)).toEqual([
      "dashboard",
      "inbox",
      "invoices",
      "vendors",
      "payments",
      "reconciliation",
      "exports",
      "settings"
    ]);
  });
});
