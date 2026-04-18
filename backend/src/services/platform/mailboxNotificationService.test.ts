const mockEmailSend = jest.fn();
const mockUserFindById = jest.fn();
const mockTenantUserRoleFindOne = jest.fn();
const mockEventCreate = jest.fn();
const mockEventSave = jest.fn();

jest.mock("../../models/core/User.js", () => ({
  UserModel: {
    findById: (...args: unknown[]) => mockUserFindById(...args)
  }
}));

jest.mock("../../models/core/TenantUserRole.js", () => ({
  TenantUserRoleModel: {
    findOne: (...args: unknown[]) => mockTenantUserRoleFindOne(...args)
  }
}));

jest.mock("../../models/integration/MailboxNotificationEvent.js", () => ({
  MailboxNotificationEventModel: {
    create: (...args: unknown[]) => mockEventCreate(...args)
  }
}));

jest.mock("../../config/env.js", () => ({
  env: {
    INVITE_FROM: "no-reply@billforge.local"
  }
}));

jest.mock("../../utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn()
  }
}));

import { MailboxNotificationService } from "./mailboxNotificationService.js";
import type { InviteEmailSenderBoundary } from "@/core/boundaries/InviteEmailSenderBoundary.js";

function buildSender(): InviteEmailSenderBoundary {
  return { send: mockEmailSend };
}

function buildInput() {
  return {
    tenantId: "tenant-1",
    userId: "user-creator",
    provider: "gmail" as const,
    emailAddress: "inbox@example.com",
    reason: "Token revoked"
  };
}

describe("MailboxNotificationService", () => {
  let service: MailboxNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmailSend.mockResolvedValue(undefined);
    mockEventCreate.mockResolvedValue({ delivered: false, save: mockEventSave });
    mockEventSave.mockResolvedValue(undefined);
    service = new MailboxNotificationService(buildSender());
  });

  it("uses the injected email sender to deliver notifications", async () => {
    mockUserFindById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ email: "creator@example.com" }) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "no-reply@billforge.local",
        to: "creator@example.com",
        subject: "LedgerBuddy mailbox requires reconnection"
      })
    );
  });

  it("resolves recipient from creator userId", async () => {
    mockUserFindById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ email: "creator@example.com" }) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(mockUserFindById).toHaveBeenCalledWith("user-creator");
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "creator@example.com" })
    );
  });

  it("falls back to tenant admin when creator is not found", async () => {
    mockUserFindById
      .mockReturnValueOnce({
        select: () => ({ lean: () => Promise.resolve(null) })
      })
      .mockReturnValueOnce({
        select: () => ({ lean: () => Promise.resolve({ email: "admin@example.com" }) })
      });
    mockTenantUserRoleFindOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ userId: "admin-user-id" }) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(mockTenantUserRoleFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", role: "TENANT_ADMIN" })
    );
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com" })
    );
  });

  it("skips sending when no recipient can be resolved", async () => {
    mockUserFindById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) })
    });
    mockTenantUserRoleFindOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("marks event as delivered after successful send", async () => {
    const event = { delivered: false, save: mockEventSave };
    mockEventCreate.mockResolvedValue(event);
    mockUserFindById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ email: "creator@example.com" }) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(event.delivered).toBe(true);
    expect(mockEventSave).toHaveBeenCalled();
  });

  it("does not mark event as delivered when recipient is missing", async () => {
    const event = { delivered: false, save: mockEventSave };
    mockEventCreate.mockResolvedValue(event);
    mockUserFindById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) })
    });
    mockTenantUserRoleFindOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(event.delivered).toBe(false);
    expect(mockEventSave).not.toHaveBeenCalled();
  });

  it("creates a notification event before attempting delivery", async () => {
    mockUserFindById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ email: "creator@example.com" }) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-creator",
        provider: "gmail",
        emailAddress: "inbox@example.com",
        eventType: "MAILBOX_NEEDS_REAUTH",
        reason: "Token revoked",
        delivered: false
      })
    );
  });
});
