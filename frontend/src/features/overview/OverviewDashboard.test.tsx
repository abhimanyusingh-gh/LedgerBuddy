/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OverviewDashboard } from "@/features/overview/OverviewDashboard";
import { ADMIN_CLIENT_ORG_QUERY_PARAM } from "@/hooks/useAdminClientOrgFilter";

const ORG_A = "65a1b2c3d4e5f6a7b8c9d0e1";
const ORG_B = "65a1b2c3d4e5f6a7b8c9d0e2";

jest.mock("@/api", () => ({
  fetchAnalyticsOverview: jest.fn()
}));

jest.mock("@/api/clientOrgs", () => ({
  fetchClientOrganizations: jest.fn()
}));

jest.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  // Proxy returns Stub for ANY exported name (Area, AreaChart, ResponsiveContainer, ...)
  // — recharts has many; this avoids per-symbol churn.
  return new Proxy(
    {},
    {
      get: () => Stub
    }
  );
});

jest.mock("@/features/overview/OverviewDashboardCharts", () => ({
  ChartCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ChartOrEmpty: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  KpiCard: () => <div />,
  StatusDonut: () => <div />,
  TimeSeriesBarChart: () => <div />,
  VendorBarChart: () => <div />
}));

const mockedApi = jest.requireMock("@/api") as { fetchAnalyticsOverview: jest.Mock };
const mockedOrgs = jest.requireMock("@/api/clientOrgs") as { fetchClientOrganizations: jest.Mock };

function emptyOverview() {
  return {
    kpis: { totalInvoices: 0, approvedAmountMinor: 0, pendingAmountMinor: 0, exportedCount: 0, needsReviewCount: 0, approvedCount: 0 },
    statusBreakdown: [],
    dailyApprovals: [],
    dailyIngestion: [],
    dailyExports: [],
    topVendorsByApproved: [],
    topVendorsByPending: []
  };
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<OverviewDashboard />, { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/");
  mockedApi.fetchAnalyticsOverview.mockResolvedValue(emptyOverview());
  mockedOrgs.fetchClientOrganizations.mockResolvedValue([
    { _id: ORG_A, tenantId: "t-1", gstin: "27AAAAA0000A1Z5", companyName: "Sharma Textiles", f12OverwriteByGuidVerified: false, detectedVersion: null, createdAt: "", updatedAt: "" },
    { _id: ORG_B, tenantId: "t-1", gstin: "27AAAAA0000A1Z6", companyName: "Bose Steel", f12OverwriteByGuidVerified: false, detectedVersion: null, createdAt: "", updatedAt: "" }
  ]);
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("OverviewDashboard — admin clientOrgId integration (#162)", () => {
  it("mounts the AdminRealmSwitcher in the dashboard topbar", async () => {
    renderDashboard();
    expect(await screen.findByTestId("admin-realm-switcher")).toBeInTheDocument();
  });

  it("calls fetchAnalyticsOverview WITHOUT clientOrgId by default (All clients aggregate)", async () => {
    renderDashboard();
    await waitFor(() => expect(mockedApi.fetchAnalyticsOverview).toHaveBeenCalled());
    const calls = mockedApi.fetchAnalyticsOverview.mock.calls;
    for (const args of calls) {
      // 4th positional arg is clientOrgId
      expect(args[3]).toBeNull();
    }
  });

  it("calls fetchAnalyticsOverview WITH clientOrgId when URL has ?clientOrgId=...", async () => {
    window.history.replaceState({}, "", `/?${ADMIN_CLIENT_ORG_QUERY_PARAM}=${ORG_A}`);
    renderDashboard();
    await waitFor(() => expect(mockedApi.fetchAnalyticsOverview).toHaveBeenCalled());
    const calls = mockedApi.fetchAnalyticsOverview.mock.calls;
    expect(calls[0][3]).toBe(ORG_A);
  });

  it("re-fetches with the new clientOrgId when the switcher selects a specific realm", async () => {
    renderDashboard();
    await waitFor(() => expect(mockedApi.fetchAnalyticsOverview).toHaveBeenCalled());
    mockedApi.fetchAnalyticsOverview.mockClear();
    fireEvent.click(await screen.findByTestId("admin-realm-switcher-trigger"));
    const option = await screen.findByTestId(`admin-realm-switcher-picker-option-${ORG_B}`);
    fireEvent.click(option);
    await waitFor(() => expect(mockedApi.fetchAnalyticsOverview).toHaveBeenCalled());
    const lastArgs = mockedApi.fetchAnalyticsOverview.mock.calls[0];
    expect(lastArgs[3]).toBe(ORG_B);
  });

  it("re-fetches WITHOUT clientOrgId when 'All clients' is selected", async () => {
    window.history.replaceState({}, "", `/?${ADMIN_CLIENT_ORG_QUERY_PARAM}=${ORG_A}`);
    renderDashboard();
    await waitFor(() => expect(mockedApi.fetchAnalyticsOverview).toHaveBeenCalled());
    mockedApi.fetchAnalyticsOverview.mockClear();
    fireEvent.click(await screen.findByTestId("admin-realm-switcher-option-all"));
    await waitFor(() => expect(mockedApi.fetchAnalyticsOverview).toHaveBeenCalled());
    const lastArgs = mockedApi.fetchAnalyticsOverview.mock.calls[0];
    expect(lastArgs[3]).toBeNull();
  });
});
