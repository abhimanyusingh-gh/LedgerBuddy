const mockEmailSend = jest.fn();
const mockUserFindById = jest.fn();
const mockUserFind = jest.fn();
const mockTenantUserRoleFindOne = jest.fn();
const mockTenantUserRoleFind = jest.fn();
const mockEventCreate = jest.fn();
const mockEventFind = jest.fn();
const mockEventFindOne = jest.fn();
const mockEventSave = jest.fn();

jest.mock("../../models/core/User.js", () => ({
  UserModel: {
    findById: (...args: unknown[]) => mockUserFindById(...args),
    find: (...args: unknown[]) => mockUserFind(...args)
  }
}));

jest.mock("../../models/core/TenantUserRole.js", () => ({
  TenantUserRoleModel: {
    findOne: (...args: unknown[]) => mockTenantUserRoleFindOne(...args),
    find: (...args: unknown[]) => mockTenantUserRoleFind(...args)
  }
}));

jest.mock("../../models/integration/MailboxNotificationEvent.js", () => ({
  MailboxNotificationEventModel: {
    create: (...args: unknown[]) => mockEventCreate(...args),
    find: (...args: unknown[]) => mockEventFind(...args),
    findOne: (...args: unknown[]) => mockEventFindOne(...args)
  }
}));

jest.mock("../../config/env.js", () => ({
  env: {
    INVITE_FROM: "no-reply@ledgerbuddy.local"
  }
}));

jest.mock("../../utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
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

function mockCreatorResolution(email: string) {
  mockUserFindById.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve({ email }) })
  });
}

function mockNoCreator() {
  mockUserFindById.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(null) })
  });
}

function mockNoCcRecipients() {
  mockTenantUserRoleFind.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve([]) })
  });
}

function mockNoDedupHit() {
  mockEventFindOne.mockReturnValue({
    lean: () => Promise.resolve(null)
  });
}

describe("MailboxNotificationService", () => {
  let service: MailboxNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmailSend.mockResolvedValue(undefined);
    mockEventCreate.mockResolvedValue({
      _id: "event-1",
      delivered: false,
      retryCount: 0,
      deliveryFailed: false,
      failureReason: null,
      skippedReason: null,
      recipient: null,
      ccRecipients: [],
      save: mockEventSave
    });
    mockEventSave.mockResolvedValue(undefined);
    mockNoCcRecipients();
    mockNoDedupHit();
    service = new MailboxNotificationService(buildSender());
  });

  it("uses the injected email sender to deliver notifications", async () => {
    mockCreatorResolution("creator@example.com");

    await service.notifyNeedsReauth(buildInput());

    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "no-reply@ledgerbuddy.local",
        to: "creator@example.com",
        subject: "LedgerBuddy mailbox requires reconnection"
      })
    );
  });

  it("resolves recipient from creator userId", async () => {
    mockCreatorResolution("creator@example.com");

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
    mockNoCreator();
    mockTenantUserRoleFindOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("marks event as delivered after successful send", async () => {
    const event = {
      _id: "event-1",
      delivered: false,
      retryCount: 0,
      deliveryFailed: false,
      failureReason: null,
      skippedReason: null,
      recipient: null,
      ccRecipients: [],
      save: mockEventSave
    };
    mockEventCreate.mockResolvedValue(event);
    mockCreatorResolution("creator@example.com");

    await service.notifyNeedsReauth(buildInput());

    expect(event.delivered).toBe(true);
    expect(event.recipient).toBe("creator@example.com");
    expect(mockEventSave).toHaveBeenCalled();
  });

  it("does not mark event as delivered when recipient is missing", async () => {
    const event = {
      _id: "event-1",
      delivered: false,
      retryCount: 0,
      deliveryFailed: false,
      failureReason: null,
      skippedReason: null,
      recipient: null,
      ccRecipients: [],
      save: mockEventSave
    };
    mockEventCreate.mockResolvedValue(event);
    mockNoCreator();
    mockTenantUserRoleFindOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) })
    });

    await service.notifyNeedsReauth(buildInput());

    expect(event.delivered).toBe(false);
    expect(mockEventSave).not.toHaveBeenCalled();
  });

  it("creates a notification event before attempting delivery", async () => {
    mockCreatorResolution("creator@example.com");

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

  describe("CC recipients", () => {
    it("includes CC recipients with canManageConnections capability", async () => {
      mockCreatorResolution("creator@example.com");
      mockTenantUserRoleFind.mockReturnValue({
        select: () => ({
          lean: () => Promise.resolve([
            { userId: "user-mgr-1" },
            { userId: "user-mgr-2" }
          ])
        })
      });
      mockUserFind.mockReturnValue({
        select: () => ({
          lean: () => Promise.resolve([
            { email: "mgr1@example.com" },
            { email: "mgr2@example.com" }
          ])
        })
      });

      await service.notifyNeedsReauth(buildInput());

      expect(mockEmailSend).toHaveBeenCalledWith(
        expect.objectContaining({
          cc: ["mgr1@example.com", "mgr2@example.com"]
        })
      );
    });

    it("excludes the primary recipient from CC list", async () => {
      mockCreatorResolution("creator@example.com");
      mockTenantUserRoleFind.mockReturnValue({
        select: () => ({
          lean: () => Promise.resolve([])
        })
      });

      await service.notifyNeedsReauth(buildInput());

      expect(mockTenantUserRoleFind).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: { $ne: "user-creator" }
        })
      );
    });

    it("omits cc field when no CC recipients exist", async () => {
      mockCreatorResolution("creator@example.com");
      mockNoCcRecipients();

      await service.notifyNeedsReauth(buildInput());

      const payload = mockEmailSend.mock.calls[0][0];
      expect(payload.cc).toBeUndefined();
    });
  });

  describe("deduplication", () => {
    it("skips delivery when same event type was sent within 24 hours", async () => {
      mockEventFindOne.mockReturnValue({
        lean: () => Promise.resolve({ _id: "existing-event", delivered: true })
      });

      await service.notifyNeedsReauth(buildInput());

      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(mockEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryFailed: true,
          skippedReason: "duplicate_within_24h"
        })
      );
    });

    it("records a skipped event when dedup triggers", async () => {
      mockEventFindOne.mockReturnValue({
        lean: () => Promise.resolve({ _id: "existing-event", delivered: true })
      });

      await service.notifyNeedsReauth(buildInput());

      expect(mockEventCreate).toHaveBeenCalledTimes(1);
      expect(mockEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          skippedReason: "duplicate_within_24h",
          delivered: false,
          deliveryFailed: true
        })
      );
    });

    it("allows delivery when no recent event exists", async () => {
      mockNoDedupHit();
      mockCreatorResolution("creator@example.com");

      await service.notifyNeedsReauth(buildInput());

      expect(mockEmailSend).toHaveBeenCalled();
    });
  });

  describe("event tracking on delivery failure", () => {
    it("records failure reason when email delivery fails", async () => {
      const event = {
        _id: "event-1",
        delivered: false,
        retryCount: 0,
        deliveryFailed: false,
        failureReason: null,
        skippedReason: null,
        recipient: null,
        ccRecipients: [],
        save: mockEventSave
      };
      mockEventCreate.mockResolvedValue(event);
      mockCreatorResolution("creator@example.com");
      mockEmailSend.mockRejectedValue(new Error("SMTP connection refused"));

      await service.notifyNeedsReauth(buildInput());

      expect(event.failureReason).toBe("SMTP connection refused");
      expect(event.delivered).toBe(false);
      expect(event.recipient).toBe("creator@example.com");
      expect(mockEventSave).toHaveBeenCalled();
    });
  });

  describe("retryFailedNotifications", () => {
    it("retries undelivered events and marks as delivered on success", async () => {
      const event = {
        _id: "event-retry-1",
        delivered: false,
        deliveryFailed: false,
        retryCount: 0,
        recipient: "admin@example.com",
        ccRecipients: [],
        emailAddress: "inbox@example.com",
        reason: "Token revoked",
        failureReason: "SMTP timeout",
        save: mockEventSave
      };
      mockEventFind.mockResolvedValue([event]);
      mockEmailSend.mockResolvedValue(undefined);

      await service.retryFailedNotifications();

      expect(event.delivered).toBe(true);
      expect(event.retryCount).toBe(1);
      expect(mockEventSave).toHaveBeenCalled();
    });

    it("increments retryCount on failed retry", async () => {
      const event = {
        _id: "event-retry-2",
        delivered: false,
        deliveryFailed: false,
        retryCount: 1,
        recipient: "admin@example.com",
        ccRecipients: [],
        emailAddress: "inbox@example.com",
        reason: "Token revoked",
        failureReason: null,
        save: mockEventSave
      };
      mockEventFind.mockResolvedValue([event]);
      mockEmailSend.mockRejectedValue(new Error("SMTP still down"));

      await service.retryFailedNotifications();

      expect(event.retryCount).toBe(2);
      expect(event.delivered).toBe(false);
      expect(event.failureReason).toBe("SMTP still down");
      expect(event.deliveryFailed).toBe(false);
    });

    it("marks as deliveryFailed after 3 retry attempts", async () => {
      const event = {
        _id: "event-retry-3",
        delivered: false,
        deliveryFailed: false,
        retryCount: 2,
        recipient: "admin@example.com",
        ccRecipients: [],
        emailAddress: "inbox@example.com",
        reason: "Token revoked",
        failureReason: null,
        save: mockEventSave
      };
      mockEventFind.mockResolvedValue([event]);
      mockEmailSend.mockRejectedValue(new Error("SMTP permanent failure"));

      await service.retryFailedNotifications();

      expect(event.retryCount).toBe(3);
      expect(event.deliveryFailed).toBe(true);
      expect(event.failureReason).toBe("SMTP permanent failure");
    });

    it("marks event as deliveryFailed when no recipient is stored", async () => {
      const event = {
        _id: "event-retry-4",
        delivered: false,
        deliveryFailed: false,
        retryCount: 0,
        recipient: null,
        ccRecipients: [],
        emailAddress: "inbox@example.com",
        reason: "Token revoked",
        failureReason: null,
        save: mockEventSave
      };
      mockEventFind.mockResolvedValue([event]);

      await service.retryFailedNotifications();

      expect(event.deliveryFailed).toBe(true);
      expect(event.failureReason).toBe("no_recipient");
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it("does nothing when no failed events exist", async () => {
      mockEventFind.mockResolvedValue([]);

      await service.retryFailedNotifications();

      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it("includes CC recipients in retry emails", async () => {
      const event = {
        _id: "event-retry-5",
        delivered: false,
        deliveryFailed: false,
        retryCount: 0,
        recipient: "admin@example.com",
        ccRecipients: ["mgr@example.com"],
        emailAddress: "inbox@example.com",
        reason: "Token revoked",
        failureReason: null,
        save: mockEventSave
      };
      mockEventFind.mockResolvedValue([event]);
      mockEmailSend.mockResolvedValue(undefined);

      await service.retryFailedNotifications();

      expect(mockEmailSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "admin@example.com",
          cc: ["mgr@example.com"]
        })
      );
    });
  });
});
