jest.mock("../../models/core/AuditLog.js", () => ({
  AuditLogModel: { create: jest.fn() },
  AUDIT_ENTITY_TYPE: {
    TDS_MANUAL_OVERRIDE: "tds_manual_override",
    GL_OVERRIDE: "gl_override",
    VENDOR: "vendor",
    CONFIG: "config",
    INVOICE: "invoice",
    PAYMENT: "payment",
    BANK_TRANSACTION: "bank_transaction",
    RECONCILIATION: "reconciliation",
    EXPORT: "export",
    APPROVAL: "approval"
  }
}));

jest.mock("../../models/core/AuditLogDeadLetter.js", () => ({
  AuditLogDeadLetterModel: {
    create: jest.fn(),
    find: jest.fn(),
    deleteOne: jest.fn(),
    updateOne: jest.fn()
  }
}));

jest.mock("../../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import { AuditLogModel, AUDIT_ENTITY_TYPE } from "@/models/core/AuditLog.js";
import { AuditLogDeadLetterModel } from "@/models/core/AuditLogDeadLetter.js";
import { AuditLogService, AUDIT_RETRY_MAX_ATTEMPTS, RETRY_BACKOFF_MS } from "@/services/core/AuditLogService.js";
import { logger } from "@/utils/logger.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const samplePayload = {
  tenantId: "tenant-1",
  entityType: AUDIT_ENTITY_TYPE.CONFIG,
  entityId: "tenant-1",
  action: "approval_workflow_updated",
  userId: "user-1",
  userEmail: "user@example.com",
  previousValue: { enabled: false },
  newValue: { enabled: true }
};

describe("AuditLogService.record", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes audit log on success without bubbling errors", async () => {
    (AuditLogModel.create as jest.Mock).mockResolvedValueOnce({});
    const service = new AuditLogService();

    await service.record(samplePayload);

    expect(AuditLogModel.create).toHaveBeenCalledTimes(1);
    expect(AuditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        entityType: "config",
        entityId: "tenant-1",
        action: "approval_workflow_updated",
        userId: "user-1",
        userEmail: "user@example.com"
      })
    );
  });

  it("does not bubble error on Mongo failure (fire-and-forget)", async () => {
    (AuditLogModel.create as jest.Mock).mockRejectedValueOnce(new Error("mongo down"));
    (AuditLogDeadLetterModel.create as jest.Mock).mockResolvedValueOnce({});
    const service = new AuditLogService();

    await expect(service.record(samplePayload)).resolves.toBeUndefined();
    expect(AuditLogDeadLetterModel.create).toHaveBeenCalledTimes(1);
  });

  it("emits a structured audit_log_write_failed log on Mongo failure", async () => {
    (AuditLogModel.create as jest.Mock).mockRejectedValueOnce(new Error("mongo down"));
    (AuditLogDeadLetterModel.create as jest.Mock).mockResolvedValueOnce({});
    const service = new AuditLogService();

    await service.record(samplePayload);

    expect(logger.error).toHaveBeenCalledWith(
      "audit_log_write_failed",
      expect.objectContaining({
        tenantId: "tenant-1",
        entityType: "config",
        entityId: "tenant-1",
        action: "approval_workflow_updated",
        error: "mongo down"
      })
    );
  });

  it("queues failed write to dead-letter store with first 1h backoff", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00Z");
    (AuditLogModel.create as jest.Mock).mockRejectedValueOnce(new Error("write failed"));
    (AuditLogDeadLetterModel.create as jest.Mock).mockResolvedValueOnce({});
    const service = new AuditLogService({ now: () => fixedNow });

    await service.record(samplePayload);

    expect(AuditLogDeadLetterModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 0,
        nextAttemptAt: new Date(fixedNow.getTime() + RETRY_BACKOFF_MS[0]),
        lastError: "write failed"
      })
    );
  });
});

describe("AuditLogService.retryDeadLetters backoff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retries due entries and removes them on success", async () => {
    const fixedNow = new Date("2026-01-01T05:00:00Z");
    (AuditLogDeadLetterModel.find as jest.Mock).mockReturnValue({
      lean: () => Promise.resolve([
        { _id: "dl-1", attempts: 0, payload: { tenantId: "tenant-1" } }
      ])
    });
    (AuditLogModel.create as jest.Mock).mockResolvedValueOnce({});
    (AuditLogDeadLetterModel.deleteOne as jest.Mock).mockResolvedValueOnce({});

    const service = new AuditLogService({ now: () => fixedNow });
    const result = await service.retryDeadLetters();

    expect(result).toEqual({ retried: 1, succeeded: 1, givenUp: 0 });
    expect(AuditLogDeadLetterModel.deleteOne).toHaveBeenCalledWith({ _id: "dl-1" });
  });

  it("schedules next attempt with exponential backoff: 1h -> 2h -> 4h -> 8h", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00Z");
    const updateCalls: Array<Record<string, unknown>> = [];

    (AuditLogDeadLetterModel.updateOne as jest.Mock).mockImplementation((filter, update) => {
      updateCalls.push({ filter, update });
      return Promise.resolve({});
    });

    for (let attempts = 0; attempts < AUDIT_RETRY_MAX_ATTEMPTS - 1; attempts++) {
      (AuditLogDeadLetterModel.find as jest.Mock).mockReturnValueOnce({
        lean: () => Promise.resolve([{ _id: "dl-1", attempts, payload: {} }])
      });
      (AuditLogModel.create as jest.Mock).mockRejectedValueOnce(new Error("still down"));

      const service = new AuditLogService({ now: () => fixedNow });
      await service.retryDeadLetters();
    }

    const scheduledNextAttempts = updateCalls.map((call) => {
      const setOps = (call.update as { $set: Record<string, unknown> }).$set;
      return (setOps.nextAttemptAt as Date).getTime() - fixedNow.getTime();
    });

    expect(scheduledNextAttempts).toEqual([
      RETRY_BACKOFF_MS[1],
      RETRY_BACKOFF_MS[2],
      RETRY_BACKOFF_MS[3]
    ]);
    expect(RETRY_BACKOFF_MS).toEqual([
      ONE_HOUR_MS,
      2 * ONE_HOUR_MS,
      4 * ONE_HOUR_MS,
      8 * ONE_HOUR_MS
    ]);
  });

  it("marks entry as given up after 4 attempts", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00Z");
    (AuditLogDeadLetterModel.find as jest.Mock).mockReturnValue({
      lean: () => Promise.resolve([
        { _id: "dl-1", attempts: AUDIT_RETRY_MAX_ATTEMPTS - 1, payload: {} }
      ])
    });
    (AuditLogModel.create as jest.Mock).mockRejectedValueOnce(new Error("still down"));
    (AuditLogDeadLetterModel.updateOne as jest.Mock).mockResolvedValueOnce({});

    const service = new AuditLogService({ now: () => fixedNow });
    const result = await service.retryDeadLetters();

    expect(result).toEqual({ retried: 1, succeeded: 0, givenUp: 1 });
    expect(AuditLogDeadLetterModel.updateOne).toHaveBeenCalledWith(
      { _id: "dl-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          attempts: AUDIT_RETRY_MAX_ATTEMPTS,
          givenUp: true
        })
      })
    );
  });
});

describe("AuditLogService chaos: primary operation succeeds even if audit fails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("simulates a TDS-override flow where AuditLog write fails but business op completes", async () => {
    (AuditLogModel.create as jest.Mock).mockRejectedValueOnce(new Error("mongo write timeout"));
    (AuditLogDeadLetterModel.create as jest.Mock).mockResolvedValueOnce({});
    const service = new AuditLogService();

    let tdsUpdateCommitted = false;

    const performTdsOverride = async () => {
      tdsUpdateCommitted = true;
      void service.record({
        tenantId: "tenant-x",
        entityType: AUDIT_ENTITY_TYPE.TDS_MANUAL_OVERRIDE,
        entityId: "invoice-42",
        action: "tds_manual_override_applied",
        userId: "cfo-1",
        userEmail: "cfo@example.com",
        previousValue: { tdsAmountMinor: 1000 },
        newValue: { tdsAmountMinor: 0 }
      });
      return { ok: true };
    };

    const result = await performTdsOverride();
    expect(result).toEqual({ ok: true });
    expect(tdsUpdateCommitted).toBe(true);

    await new Promise((resolve) => setImmediate(resolve));
    expect(AuditLogDeadLetterModel.create).toHaveBeenCalledTimes(1);
  });
});
