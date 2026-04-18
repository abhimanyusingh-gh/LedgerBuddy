jest.mock("../../auth/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
}));

jest.mock("../../auth/requireCapability.js", () => ({
  requireCap: () => (_req: unknown, _res: unknown, next: Function) => next()
}));

let configStore: Record<string, Record<string, unknown>> = {};

jest.mock("../../models/integration/TenantNotificationConfig.js", () => {
  const toObject = (doc: Record<string, unknown>) => ({ ...doc });

  return {
    NOTIFICATION_RECIPIENT_TYPES: ["integration_creator", "all_tenant_admins", "specific_user"],
    TenantNotificationConfigModel: {
      findOne: jest.fn((query: { tenantId: string }) => ({
        lean: async () => configStore[query.tenantId] ?? null
      })),
      create: jest.fn(async (data: Record<string, unknown>) => {
        configStore[data.tenantId as string] = { ...data };
        return { toObject: () => toObject(configStore[data.tenantId as string]) };
      }),
      findOneAndUpdate: jest.fn(async (
        query: { tenantId: string },
        update: { $set: Record<string, unknown> }
      ) => {
        if (!configStore[query.tenantId]) {
          configStore[query.tenantId] = {
            tenantId: query.tenantId,
            mailboxReauthEnabled: true,
            escalationEnabled: true,
            inAppEnabled: false,
            primaryRecipientType: "integration_creator",
            specificRecipientUserId: null
          };
        }
        Object.assign(configStore[query.tenantId], update.$set);
        return { toObject: () => toObject(configStore[query.tenantId]) };
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

import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";

let createNotificationConfigRouter: typeof import("./notificationConfig.ts").createNotificationConfigRouter;

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
});

describe("notification config routes", () => {
  describe("GET /admin/notification-config", () => {
    it("returns default config when none exists", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "get", "/admin/notification-config");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, nextFn);

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.tenantId).toBe("tenant-a");
      expect(body.mailboxReauthEnabled).toBe(true);
      expect(body.escalationEnabled).toBe(true);
      expect(body.inAppEnabled).toBe(false);
      expect(body.primaryRecipientType).toBe("integration_creator");
      expect(body.specificRecipientUserId).toBeNull();
    });

    it("returns existing config", async () => {
      configStore["tenant-a"] = {
        tenantId: "tenant-a",
        mailboxReauthEnabled: false,
        escalationEnabled: true,
        primaryRecipientType: "all_tenant_admins"
      };

      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "get", "/admin/notification-config");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, nextFn);

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.mailboxReauthEnabled).toBe(false);
      expect(body.primaryRecipientType).toBe("all_tenant_admins");
    });
  });

  describe("PATCH /admin/notification-config", () => {
    it("updates mailboxReauthEnabled", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, body: { mailboxReauthEnabled: false } }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.mailboxReauthEnabled).toBe(false);
    });

    it("updates escalationEnabled", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, body: { escalationEnabled: false } }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.escalationEnabled).toBe(false);
    });

    it("updates primaryRecipientType", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, body: { primaryRecipientType: "all_tenant_admins" } }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.primaryRecipientType).toBe("all_tenant_admins");
    });

    it("rejects invalid primaryRecipientType", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, body: { primaryRecipientType: "invalid" } }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.message).toContain("primaryRecipientType must be one of");
    });

    it("requires specificRecipientUserId when type is specific_user", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { primaryRecipientType: "specific_user", specificRecipientUserId: null }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.message).toContain("specificRecipientUserId is required");
    });

    it("accepts specific_user with userId", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { primaryRecipientType: "specific_user", specificRecipientUserId: "user-42" }
        }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.primaryRecipientType).toBe("specific_user");
      expect(body.specificRecipientUserId).toBe("user-42");
    });

    it("rejects non-string specificRecipientUserId", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { specificRecipientUserId: 123 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.message).toContain("specificRecipientUserId must be a string or null");
    });

    it("sets updatedBy from auth context", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "patch", "/admin/notification-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, body: { mailboxReauthEnabled: true } }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.updatedBy).toBe("admin@test.com");
    });
  });

  describe("GET /admin/notifications/log", () => {
    it("returns empty log when no events exist", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "get", "/admin/notifications/log");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, nextFn);

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

      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "get", "/admin/notifications/log");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, nextFn);

      const body = res.jsonBody as { items: Record<string, unknown>[]; total: number };
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.items[0].eventType).toBe("MAILBOX_NEEDS_REAUTH");
      expect(body.items[0].delivered).toBe(true);
      expect(body.items[1].deliveryFailed).toBe(true);
      expect(body.items[1].failureReason).toBe("SMTP error");
    });

    it("respects page and limit query params", async () => {
      const router = createNotificationConfigRouter();
      const handler = findHandler(router, "get", "/admin/notifications/log");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, query: { page: "2", limit: "5" } }),
        res,
        nextFn
      );

      const body = res.jsonBody as { page: number; limit: number };
      expect(body.page).toBe(2);
      expect(body.limit).toBe(5);
    });
  });
});
