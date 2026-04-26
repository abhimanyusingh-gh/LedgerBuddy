/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@/api/client", () => {
  const { buildApiClientMockModule } = require("@/test-utils/mockApiClient");
  return buildApiClientMockModule();
});
jest.mock("@/api", () => ({
  fetchInvoices: jest.fn().mockResolvedValue({ items: [], total: 0 })
}));

import { getMockedApiClient } from "@/test-utils/mockApiClient";
const apiClient = getMockedApiClient();

import { WorkspaceTopNav } from "@/features/workspace/WorkspaceTopNav";
import type { ClientOrganization } from "@/api/clientOrgs";
import {
  ACTIVE_CLIENT_ORG_STORAGE_KEY,
  setActiveClientOrgId
} from "@/hooks/useActiveClientOrg";

function buildOrg(overrides: Partial<ClientOrganization> & { _id: string; companyName: string }): ClientOrganization {
  return {
    tenantId: "tenant-1",
    gstin: "29ABCPK1234F1Z5",
    f12OverwriteByGuidVerified: false,
    detectedVersion: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides
  };
}

function clearActiveRealm() {
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
}

function renderTopNav(overrides: Partial<React.ComponentProps<typeof WorkspaceTopNav>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  const props: React.ComponentProps<typeof WorkspaceTopNav> = {
    userEmail: "ca@example.com",
    tenantName: "Mahir & Co.",
    onLogout: jest.fn(),
    onChangePassword: jest.fn(),
    counts: { total: 0, approved: 0, pending: 0, failed: 0 },
    ...overrides
  };
  return { props, ...render(<Wrapper><WorkspaceTopNav {...props} /></Wrapper>) };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearActiveRealm();
});
afterEach(clearActiveRealm);

describe("WorkspaceTopNav realm switcher integration", () => {
  it("opens the realm switcher when the active-realm badge is clicked", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { items: [buildOrg({ _id: "org-1", companyName: "Sharma Textiles" })] }
    });
    setActiveClientOrgId("org-1");
    renderTopNav();

    await waitFor(() => expect(screen.getByTestId("active-realm-badge")).toHaveTextContent("Sharma Textiles"));
    fireEvent.click(screen.getByTestId("active-realm-badge"));
    expect(screen.getByTestId("realm-switcher-overlay")).toBeInTheDocument();
  });

  it("opens the realm switcher when the 'Select a client' CTA is clicked", async () => {
    apiClient.get.mockResolvedValueOnce({ data: { items: [] } });
    renderTopNav();

    await waitFor(() => expect(screen.getByTestId("select-client-cta")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("select-client-cta"));
    expect(screen.getByTestId("realm-switcher-overlay")).toBeInTheDocument();
    // Empty state surfaces because tenant has no client orgs.
    expect(screen.getByTestId("realm-switcher-empty")).toBeInTheDocument();
  });

  it("toggles the switcher with the Cmd+K shortcut", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { items: [buildOrg({ _id: "org-1", companyName: "Sharma Textiles" })] }
    });
    renderTopNav();

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(screen.queryByTestId("realm-switcher-overlay")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("realm-switcher-overlay")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByTestId("realm-switcher-overlay")).not.toBeInTheDocument();
  });

  it("opens the switcher with Ctrl+K (non-mac) as well", async () => {
    apiClient.get.mockResolvedValueOnce({ data: { items: [] } });
    renderTopNav();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("realm-switcher-overlay")).toBeInTheDocument();
  });

  it("commits a new realm via the switcher and updates session storage", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: {
        items: [
          buildOrg({ _id: "org-1", companyName: "Sharma Textiles" }),
          buildOrg({ _id: "org-2", companyName: "Bose Steel" })
        ]
      }
    });
    renderTopNav();
    await waitFor(() => expect(screen.getByTestId("select-client-cta")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("select-client-cta"));
    fireEvent.click(screen.getByTestId("realm-switcher-option-org-2"));
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBe("org-2");
    expect(screen.queryByTestId("realm-switcher-overlay")).not.toBeInTheDocument();
  });
});
