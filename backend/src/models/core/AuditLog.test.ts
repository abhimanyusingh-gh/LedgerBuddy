import { execSync } from "child_process";
import path from "path";
import { AuditLogModel, AUDIT_ENTITY_TYPE } from "@/models/core/AuditLog.js";
import { AUDIT_ENTITY_TYPE_MOCK } from "@/test-utils/auditLogMocks.js";

describe("AuditLog schema", () => {
  it("does not declare timestamps (timestamp field is canonical per C-006)", () => {
    const opts = AuditLogModel.schema.options as { timestamps?: unknown };
    expect(opts.timestamps).toBeFalsy();
  });

  it("does not declare any TTL index (8-year retention per C-019)", () => {
    const indexes = AuditLogModel.schema.indexes();
    for (const [, options] of indexes) {
      expect(options).not.toHaveProperty("expireAfterSeconds");
      expect(options).not.toHaveProperty("expires");
    }
  });

  it("declares the four indexes from MASTER-SYNTHESIS section 4.1", () => {
    const indexKeys = AuditLogModel.schema.indexes().map(([key]) => key);
    expect(indexKeys).toEqual(
      expect.arrayContaining([
        { tenantId: 1, entityType: 1, entityId: 1, timestamp: -1 },
        { tenantId: 1, timestamp: -1 },
        { tenantId: 1, userId: 1, timestamp: -1 },
        { tenantId: 1, action: 1, timestamp: -1 }
      ])
    );
  });

  it("requires tenantId, entityType, entityId, action, userId", () => {
    const paths = AuditLogModel.schema.paths;
    expect(paths.tenantId.isRequired).toBe(true);
    expect(paths.entityType.isRequired).toBe(true);
    expect(paths.entityId.isRequired).toBe(true);
    expect(paths.action.isRequired).toBe(true);
    expect(paths.userId.isRequired).toBe(true);
  });

  it("constrains entityType to the named enum values", () => {
    const enumValues = (AuditLogModel.schema.paths.entityType as unknown as { enumValues: string[] }).enumValues;
    expect(enumValues).toEqual(expect.arrayContaining(Object.values(AUDIT_ENTITY_TYPE)));
  });

  it("AUDIT_ENTITY_TYPE_MOCK in test-utils stays in sync with the production enum", () => {
    expect(AUDIT_ENTITY_TYPE_MOCK).toEqual(AUDIT_ENTITY_TYPE);
  });

  it("AuditLogModel exposes no mutating operations in production code (C-006 enforcement)", () => {
    const backendSrc = path.resolve(__dirname, "../..");
    const pattern = "AuditLogModel\\.(update|findOneAndUpdate|delete|deleteOne|deleteMany|replaceOne|findOneAndReplace|findOneAndDelete|bulkWrite|findByIdAndUpdate|findByIdAndDelete)";
    const result = execSync(
      `grep -rEn --include='*.ts' --exclude='*.test.ts' "${pattern}" "${backendSrc}" || true`,
      { encoding: "utf8" }
    );
    expect(result.trim()).toBe("");
  });

});
