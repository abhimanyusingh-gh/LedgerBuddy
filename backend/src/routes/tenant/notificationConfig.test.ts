jest.mock("../../auth/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
}));

jest.mock("../../auth/requireCapability.js", () => ({
  requireCap: () => (_req: unknown, _res: unknown, next: Function) => next()
}));

let configStore: Record<string, Record<string, unknown>> = {};

function configKey(query: { tenantId: unknown; clientOrgId?: unknown }): string {
  return `${String(query.tenantId)}::${String(query.clientOrgId)}`;
}

jest.mock("../../models/integration/ClientNotificationConfig.js", () => {
  const toObject = (doc: Record<string, unknown>) => ({ ...doc });

  return {
    NOTIFICATION_RECIPIENT_TYPES: ["integration_creator", "all_tenant_admins", "specific_user"],
    ClientNotificationConfigModel: {
      findOne: jest.fn((query: { tenantId: string; clientOrgId?: unknown }) => ({
        lean: async () => configStore[configKey(query)] ?? null
      })),
      create: jest.fn(async (data: Record<string, unknown>) => {
        const k = configKey(data as { tenantId: string; clientOrgId?: unknown });
        configStore[k] = { ...data };
        return { toObject: () => toObject(configStore[k]) };
      }),
      findOneAndUpdate: jest.fn(async (
        query: { tenantId: string; clientOrgId?: unknown },
        update: { $set: Record<string, unknown>; $setOnInsert?: Record<string, unknown> }
      ) => {
        const k = configKey(query);
        if (!configStore[k]) {
          configStore[k] = {
            tenantId: query.tenantId,
            clientOrgId: query.clientOrgId,
            mailboxReauthEnabled: true,
            escalationEnabled: true,
            inAppEnabled: false,
            primaryRecipientType: "integration_creator",
            specificRecipientUserId: null,
            ...(update.$setOnInsert ?? {})
          };
        }
        Object.assign(configStore[k], update.$set);
        return { toObject: () => toObject(configStore[k]) };
      })
    }
  };
});

let eventStore: Array<Record<string, unknown>> = [];

jest.mock("../../models/integration/MailboxNotificationEvent.js", () => ({
  MailboxNotificationEventModel: {
    find: jest.fn(() => ({
      sort: jest.fn(function (this: { _items: Record<string, unknown>[] }) {
        return {
          skip: jest.fn((n: number) => ({
            limit: jest.fn((l: number) => ({
              lean: async () => eventStore.slice(n, n + l)
            }))
          }))
        };
      })
    })),
    countDocuments: jest.fn(async () => eventStore.length)
  }
}));

jest.mock("../../models/core/TenantUserRole.js", () => ({
  TenantUserRoleModel: {
    find: jest.fn(() => ({
      select: jest.fn(() => ({
        lean: async () => [{ userId: "user-1" }, { userId: "user-2" }]
      }))
    }))
  }
}));

import { Types } from "mongoose";
import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";

const ACTIVE_CLIENT_ORG_ID = new Types.ObjectId("65f0000000000000000000c1");
const authedReq = (overrides: Record<string, unknown> = {}) =>
  mockRequest({ authContext: defaultAuth, activeClientOrgId: ACTIVE_CLIENT_ORG_ID, ...overrides });

let createNotificationConfigRouter: typeof import("./notificationConfig.ts").createNotificationConfigRouter;
let createNotificationLogRouter: typeof import("./notificationConfig.ts").createNotificationLogRouter;

const nextFn = jest.fn();

beforeEach(async () => {
  jest.resetModules();

  jest.mock("../../auth/requireAuth.js", () => ({
    requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
  }));
  jest.mock("../../auth/requireCapability.js", () => ({
    requireCap: () => (_req: unknown, _res: unknown, next: Function) => next()
  }));

  configStore = {};
  eventStore = [];
  nextFn.mockClear();

  const mod = await import("./notificationConfig.ts");
  createNotificationConfigRouter = mod.createNotificationConfigRouter;
  createNotificationLogRouter = mod.createNotificationLogRouter;
});

describe("notification config routes", () => {
  describe("GET /admin/notification-config", () => {
    it("returns default config when none exists", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "get", "/admin/notification-config");
      const res = mockResponse();

      await handler(authedReq(), res, nextFn);

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.tenantId).toBe("tenant-a");
      expect(body.mailboxReauthEnabled).toBe(true);
      expect(body.escalationEnabled).toBe(true);
      expect(body.inAppEnabled).toBe(false);
      expect(body.primaryRecipientType).toBe("integration_creator");
      expect(body.specificRecipientUserId).toBeNull();
    });

    it("returns existing config", async () => {
      configStore[`tenant-a::${ACTIVE_CLIENT_ORG_ID.toHexString()}`] = {
        tenantId: "tenant-a",
        clientOrgId: ACTIVE_CLIENT_ORG_ID,
        mailboxReauthEnabled: false,
        escalationEnabled: true,
        primaryRecipientType: "all_tenant_admins"
      };

      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "get", "/admin/notification-config");
      const res = mockResponse();

      await handler(authedReq(), res, nextFn);

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.mailboxReauthEnabled).toBe(false);
      expect(body.primaryRecipientType).toBe("all_tenant_admins");
    });
  });

  describe("PATCH /admin/notification-config", () => {
    it.each([
      ["mailboxReauthEnabled", { mailboxReauthEnabled: false }, "mailboxReauthEnabled", false],
      ["escalationEnabled", { escalationEnabled: false }, "escalationEnabled", false],
      ["primaryRecipientType", { primaryRecipientType: "all_tenant_admins" }, "primaryRecipientType", "all_tenant_admins"],
    ])("updates %s", async (_label, body, field, expected) => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(authedReq({ body }), res, nextFn);

      expect((res.jsonBody as Record<string, unknown>)[field]).toBe(expected);
    });

    it.each([
      ["invalid primaryRecipientType", { primaryRecipientType: "invalid" }, "primaryRecipientType must be one of"],
      ["missing specificRecipientUserId when type is specific_user", { primaryRecipientType: "specific_user", specificRecipientUserId: null }, "specificRecipientUserId is required"],
      ["non-string specificRecipientUserId", { specificRecipientUserId: 123 }, "specificRecipientUserId must be a string or null"],
    ])("rejects %s", async (_label, body, messageSubstring) => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(authedReq({ body }), res, nextFn);

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as Record<string, unknown>).message).toContain(messageSubstring);
    });

    it("accepts specific_user with userId", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        authedReq({ body: { primaryRecipientType: "specific_user", specificRecipientUserId: "user-42" }
        }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.primaryRecipientType).toBe("specific_user");
      expect(body.specificRecipientUserId).toBe("user-42");
    });

    it("sets updatedBy from auth context", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        authedReq({ body: { mailboxReauthEnabled: true } }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.updatedBy).toBe("admin@test.com");
    });
  });

  describe("GET /admin/notifications/log", () => {
    it("returns empty log when no events exist", async () => {
      const router = createNotificationLogRouter();
      const handler = findHandler(router, "get", "/admin/notifications/log");
      const res = mockResponse();

      await handler(authedReq(), res, nextFn);

      const body = res.jsonBody as { items: unknown[]; page: number; limit: number; total: number };
      expect(body.items).toEqual([]);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.total).toBe(0);
    });

    it("returns events with pagination info", async () => {
      eventStore = [
        {
          userId: "user-1",
          provider: "gmail",
          emailAddress: "test@example.com",
          eventType: "MAILBOX_NEEDS_REAUTH",
          reason: "token_expired",
          delivered: true,
          recipient: "admin@test.com",
          createdAt: "2026-04-17T10:00:00Z"
        },
        {
          userId: "user-2",
          provider: "gmail",
          emailAddress: "other@example.com",
          eventType: "MAILBOX_NEEDS_REAUTH",
          reason: "permission_revoked",
          delivered: false,
          deliveryFailed: true,
          failureReason: "SMTP error",
          recipient: "admin2@test.com",
          createdAt: "2026-04-16T10:00:00Z"
        }
      ];

      const router = createNotificationLogRouter();
      const handler = findHandler(router, "get", "/admin/notifications/log");
      const res = mockResponse();

      await handler(authedReq(), res, nextFn);

      const body = res.jsonBody as { items: Record<string, unknown>[]; total: number };
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.items[0].eventType).toBe("MAILBOX_NEEDS_REAUTH");
      expect(body.items[0].delivered).toBe(true);
      expect(body.items[1].deliveryFailed).toBe(true);
      expect(body.items[1].failureReason).toBe("SMTP error");
    });

    it("respects page and limit query params", async () => {
      const router = createNotificationLogRouter();
      const handler = findHandler(router, "get", "/admin/notifications/log");
      const res = mockResponse();

      await handler(
        authedReq({ query: { page: "2", limit: "5" } }),
        res,
        nextFn
      );

      const body = res.jsonBody as { page: number; limit: number };
      expect(body.page).toBe(2);
      expect(body.limit).toBe(5);
    });
  });
});
