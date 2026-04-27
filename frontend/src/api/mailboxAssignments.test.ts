/**
 * @jest-environment jsdom
 */
import {
  createMailboxAssignment,
  deleteMailboxAssignment,
  fetchMailboxAssignments,
  fetchMailboxRecentIngestions,
  listIntegrations,
  updateMailboxAssignment
} from "@/api/mailboxAssignments";

jest.mock("@/api/client", () => {
  const { buildApiClientMockModule } = require("@/test-utils/mockApiClient");
  return buildApiClientMockModule();
});

import { getMockedApiClient } from "@/test-utils/mockApiClient";

const apiClient = getMockedApiClient();

beforeEach(() => {
  jest.clearAllMocks();
});

describe("api/mailboxAssignments", () => {
  it("fetchMailboxAssignments unwraps the items array and returns [] for malformed payloads", async () => {
    apiClient.get.mockResolvedValueOnce({ data: { items: [{ _id: "a-1" }] } });
    const items = await fetchMailboxAssignments();
    expect(apiClient.get).toHaveBeenCalledWith("/admin/mailbox-assignments");
    expect(items).toEqual([{ _id: "a-1" }]);

    apiClient.get.mockResolvedValueOnce({ data: {} });
    expect(await fetchMailboxAssignments()).toEqual([]);
  });

  it("createMailboxAssignment POSTs the payload verbatim", async () => {
    apiClient.post.mockResolvedValueOnce({ data: { _id: "a-1" } });
    const result = await createMailboxAssignment({
      integrationId: "int-1",
      clientOrgIds: ["org-1", "org-2"]
    });
    expect(apiClient.post).toHaveBeenCalledWith("/admin/mailbox-assignments", {
      integrationId: "int-1",
      clientOrgIds: ["org-1", "org-2"]
    });
    expect(result).toEqual({ _id: "a-1" });
  });

  it("updateMailboxAssignment PATCHes the assignment id and percent-encodes it", async () => {
    apiClient.patch.mockResolvedValueOnce({ data: { _id: "a 1" } });
    await updateMailboxAssignment("a 1", { clientOrgIds: ["org-3"] });
    expect(apiClient.patch).toHaveBeenCalledWith("/admin/mailbox-assignments/a%201", {
      clientOrgIds: ["org-3"]
    });
  });

  it("deleteMailboxAssignment DELETEs by id", async () => {
    apiClient.delete.mockResolvedValueOnce({ data: undefined });
    await deleteMailboxAssignment("a-1");
    expect(apiClient.delete).toHaveBeenCalledWith("/admin/mailbox-assignments/a-1");
  });

  it("fetchMailboxRecentIngestions GETs the recent-ingestions endpoint with days+limit query", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { items: [], total: 0, periodDays: 30, truncatedAt: 50 }
    });
    await fetchMailboxRecentIngestions("a-1", { days: 30, limit: 50 });
    expect(apiClient.get).toHaveBeenCalledWith(
      "/admin/mailbox-assignments/a-1/recent-ingestions",
      { params: { days: 30, limit: 50 } }
    );
  });

  it("listIntegrations unwraps the items array and returns [] for malformed payloads", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { items: [{ _id: "i-1", emailAddress: "a@b.com", status: "CONNECTED", provider: "gmail" }] }
    });
    const items = await listIntegrations();
    expect(apiClient.get).toHaveBeenCalledWith("/admin/integrations");
    expect(items).toEqual([
      { _id: "i-1", emailAddress: "a@b.com", status: "CONNECTED", provider: "gmail" }
    ]);

    apiClient.get.mockResolvedValueOnce({ data: {} });
    expect(await listIntegrations()).toEqual([]);
  });

  it("fetchMailboxRecentIngestions omits limit when not provided and percent-encodes the id", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { items: [], total: 0, periodDays: 30, truncatedAt: 50 }
    });
    await fetchMailboxRecentIngestions("a 1", { days: 30 });
    expect(apiClient.get).toHaveBeenCalledWith(
      "/admin/mailbox-assignments/a%201/recent-ingestions",
      { params: { days: 30 } }
    );
  });
});
