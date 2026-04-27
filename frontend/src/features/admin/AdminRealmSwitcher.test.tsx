/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AdminRealmSwitcher } from "@/features/admin/AdminRealmSwitcher";
import { ADMIN_CLIENT_ORG_QUERY_PARAM } from "@/hooks/useAdminClientOrgFilter";
import { resetStores } from "@/test-utils/resetStores";

const ORG_A = "65a1b2c3d4e5f6a7b8c9d0e1";
const ORG_B = "65a1b2c3d4e5f6a7b8c9d0e2";
const ORG_C = "65a1b2c3d4e5f6a7b8c9d0e3";

jest.mock("@/api/clientOrgs", () => ({
  fetchClientOrganizations: jest.fn()
}));

const mocked = jest.requireMock("@/api/clientOrgs") as {
  fetchClientOrganizations: jest.Mock;
};

function renderSwitcher() {
  mocked.fetchClientOrganizations.mockResolvedValue([
    { _id: ORG_A, tenantId: "t-1", gstin: "27AAAAA0000A1Z5", companyName: "Sharma Textiles", f12OverwriteByGuidVerified: false, detectedVersion: null, createdAt: "", updatedAt: "" },
    { _id: ORG_B, tenantId: "t-1", gstin: "27AAAAA0000A1Z6", companyName: "Bose Steel", f12OverwriteByGuidVerified: false, detectedVersion: null, createdAt: "", updatedAt: "" },
    { _id: ORG_C, tenantId: "t-1", gstin: "27AAAAA0000A1Z7", companyName: "Bharti Logistics", f12OverwriteByGuidVerified: false, detectedVersion: null, createdAt: "", updatedAt: "" }
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<AdminRealmSwitcher />, { wrapper });
}

function urlClientOrgId(): string | null {
  return new URLSearchParams(window.location.search).get(ADMIN_CLIENT_ORG_QUERY_PARAM);
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  resetStores();
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("AdminRealmSwitcher", () => {
  it("renders 'All clients' option and a trigger button for the specific-realm picker", async () => {
    renderSwitcher();
    expect(await screen.findByTestId("admin-realm-switcher-segment-all")).toHaveTextContent("All clients");
    expect(screen.getByTestId("admin-realm-switcher-segment-picker")).toBeInTheDocument();
  });

  it("defaults to 'All clients' when URL has no clientOrgId param", () => {
    renderSwitcher();
    const allBtn = screen.getByTestId("admin-realm-switcher-segment-all");
    expect(allBtn).toHaveAttribute("data-active", "true");
    expect(allBtn).toHaveAttribute("aria-pressed", "true");
    expect(urlClientOrgId()).toBeNull();
  });

  it("initializes from URL when ?clientOrgId=... is present (URL is single source of truth)", async () => {
    window.history.replaceState({}, "", `/?clientOrgId=${ORG_B}`);
    renderSwitcher();
    expect(screen.getByTestId("admin-realm-switcher-segment-all")).not.toHaveAttribute("data-active");
    expect(screen.getByTestId("admin-realm-switcher-segment-picker")).toHaveAttribute("data-active", "true");
    await waitFor(() =>
      expect(screen.getByTestId("admin-realm-switcher-segment-picker")).toHaveTextContent("Bose Steel")
    );
  });

  it("treats invalid (non-ObjectId) URL values as null — defaults to All clients", () => {
    window.history.replaceState({}, "", "/?clientOrgId=not-a-real-id");
    renderSwitcher();
    expect(screen.getByTestId("admin-realm-switcher-segment-all")).toHaveAttribute("data-active", "true");
  });

  it("clicking 'All clients' clears the URL query param", () => {
    window.history.replaceState({}, "", `/?clientOrgId=${ORG_A}`);
    renderSwitcher();
    fireEvent.click(screen.getByTestId("admin-realm-switcher-segment-all"));
    expect(urlClientOrgId()).toBeNull();
    expect(screen.getByTestId("admin-realm-switcher-segment-all")).toHaveAttribute("data-active", "true");
  });

  it("opens the picker when the trigger is clicked", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId("admin-realm-switcher-segment-picker"));
    expect(await screen.findByTestId("admin-realm-switcher-picker-overlay")).toBeInTheDocument();
  });

  it("selecting a specific realm sets ?clientOrgId=... in the URL", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId("admin-realm-switcher-segment-picker"));
    const option = await screen.findByTestId(`admin-realm-switcher-picker-option-${ORG_A}`);
    fireEvent.click(option);
    expect(urlClientOrgId()).toBe(ORG_A);
    expect(screen.getByTestId("admin-realm-switcher-segment-picker")).toHaveAttribute("data-active", "true");
  });

  it("selecting a realm closes the picker", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId("admin-realm-switcher-segment-picker"));
    const option = await screen.findByTestId(`admin-realm-switcher-picker-option-${ORG_C}`);
    fireEvent.click(option);
    expect(screen.queryByTestId("admin-realm-switcher-picker-overlay")).not.toBeInTheDocument();
  });

  it("groups the two segments under role=group with an aria-label naming the dimension being toggled", () => {
    renderSwitcher();
    const group = screen.getByTestId("admin-realm-switcher");
    expect(group).toHaveAttribute("role", "group");
    expect(group).toHaveAttribute("aria-label", "Analytics scope");
  });

  it("each segment exposes aria-pressed reflecting the current selection", () => {
    renderSwitcher();
    expect(screen.getByTestId("admin-realm-switcher-segment-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("admin-realm-switcher-segment-picker")).toHaveAttribute("aria-pressed", "false");
  });

  it("uses replaceState (not pushState) — selection is in-page state, not navigation", () => {
    const replaceSpy = jest.spyOn(window.history, "replaceState");
    const pushSpy = jest.spyOn(window.history, "pushState");
    renderSwitcher();
    fireEvent.click(screen.getByTestId("admin-realm-switcher-segment-all"));
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
