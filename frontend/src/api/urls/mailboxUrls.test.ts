/**
 * @jest-environment jsdom
 */
import { mailboxUrls } from "@/api/urls/mailboxUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";

beforeEach(() => {
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("client-1");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/urls/mailboxUrls — id-bearing routes", () => {
  it("assign encodes the integration id and appends /assign", () => {
    expect(mailboxUrls.assign("int/1")).toBe(
      "/tenants/tenant-1/admin/mailboxes/int%2F1/assign"
    );
  });

  it("removeAssignment encodes BOTH integration id and user id", () => {
    expect(mailboxUrls.removeAssignment("int 2", "user#3")).toBe(
      "/tenants/tenant-1/admin/mailboxes/int%202/assign/user%233"
    );
  });

  it("remove encodes the integration id into the tenant-scoped path", () => {
    expect(mailboxUrls.remove("int 7")).toBe(
      "/tenants/tenant-1/admin/mailboxes/int%207"
    );
  });

  it("assignmentUpdate encodes the assignment id", () => {
    expect(mailboxUrls.assignmentUpdate("ma/42")).toBe(
      "/tenants/tenant-1/admin/mailbox-assignments/ma%2F42"
    );
  });

  it("assignmentDelete encodes the assignment id", () => {
    expect(mailboxUrls.assignmentDelete("ma#1")).toBe(
      "/tenants/tenant-1/admin/mailbox-assignments/ma%231"
    );
  });

  it("assignmentRecentIngestions encodes the assignment id and appends /recent-ingestions", () => {
    expect(mailboxUrls.assignmentRecentIngestions("ma 9")).toBe(
      "/tenants/tenant-1/admin/mailbox-assignments/ma%209/recent-ingestions"
    );
  });
});

describe("api/urls/mailboxUrls — missing-context guards", () => {
  it("throws MissingActiveClientOrgError when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => mailboxUrls.list()).toThrow(MissingActiveClientOrgError);
    expect(() => mailboxUrls.integrationsList()).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => mailboxUrls.assignmentsList()).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => mailboxUrls.gmailStatus()).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => mailboxUrls.notificationLog()).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => mailboxUrls.assign("int-1")).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => mailboxUrls.removeAssignment("int-1", "user-1")).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => mailboxUrls.assignmentRecentIngestions("ma-1")).toThrow(
      MissingActiveClientOrgError
    );
  });
});
