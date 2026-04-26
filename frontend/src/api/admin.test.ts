/**
 * @jest-environment jsdom
 */
import { fetchAnalyticsOverview } from "@/api/admin";

jest.mock("@/api/client", () => {
  const { buildApiClientMockModule } = require("@/test-utils/mockApiClient");
  return buildApiClientMockModule({
    safeNum: (v: unknown) => (typeof v === "number" ? v : 0),
    stripNulls: (v: unknown) => v
  });
});

import { getMockedApiClient } from "@/test-utils/mockApiClient";

const apiClient = getMockedApiClient();

beforeEach(() => {
  jest.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: {} });
});

describe("api/admin/fetchAnalyticsOverview", () => {
  it("requests /analytics/overview WITHOUT clientOrgId when omitted (aggregate mode)", async () => {
    await fetchAnalyticsOverview("2026-04-01", "2026-04-30", "all");
    expect(apiClient.get).toHaveBeenCalledWith("/analytics/overview", {
      params: { from: "2026-04-01", to: "2026-04-30", scope: "all" }
    });
  });

  it("requests /analytics/overview WITHOUT clientOrgId when explicitly null (All clients)", async () => {
    await fetchAnalyticsOverview("2026-04-01", "2026-04-30", "mine", null);
    expect(apiClient.get).toHaveBeenCalledWith("/analytics/overview", {
      params: { from: "2026-04-01", to: "2026-04-30", scope: "mine" }
    });
  });

  it("appends ?clientOrgId=... when a specific realm is passed (per-realm mode)", async () => {
    await fetchAnalyticsOverview("2026-04-01", "2026-04-30", "all", "65a1b2c3d4e5f6a7b8c9d0e1");
    expect(apiClient.get).toHaveBeenCalledWith("/analytics/overview", {
      params: {
        from: "2026-04-01",
        to: "2026-04-30",
        scope: "all",
        clientOrgId: "65a1b2c3d4e5f6a7b8c9d0e1"
      }
    });
  });

  it("does NOT append clientOrgId when given an empty string", async () => {
    await fetchAnalyticsOverview("2026-04-01", "2026-04-30", "all", "");
    expect(apiClient.get).toHaveBeenCalledWith("/analytics/overview", {
      params: { from: "2026-04-01", to: "2026-04-30", scope: "all" }
    });
  });

  it("defaults scope to 'mine' when omitted", async () => {
    await fetchAnalyticsOverview("2026-04-01", "2026-04-30");
    expect(apiClient.get).toHaveBeenCalledWith("/analytics/overview", {
      params: { from: "2026-04-01", to: "2026-04-30", scope: "mine" }
    });
  });
});
