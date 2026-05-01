import mongoose from "mongoose";
import {
  MINOR_FIELD_REGISTRY,
  buildAllJsonSchemas,
  buildCollectionJsonSchema,
  buildMinorFieldRule
} from "@/db/jsonSchemaValidators.js";

import "@/models/invoice/Invoice.js";
import "@/models/bank/BankAccount.js";
import "@/models/bank/BankTransaction.js";
import "@/models/core/TenantUserRole.js";
import "@/models/integration/ClientComplianceConfig.js";
import "@/models/compliance/TdsRateTable.js";
import "@/models/compliance/TdsVendorLedger.js";
import "@/models/compliance/TdsVendorLedgerArchive.js";
import "@/models/compliance/TdsVendorLedgerEntryOverflow.js";
import "@/models/compliance/VendorMaster.js";

describe("buildMinorFieldRule", () => {
  it("accepts int, long, and double with multipleOf: 1 for non-nullable fields", () => {
    expect(buildMinorFieldRule(false)).toEqual({
      bsonType: ["int", "long", "double"],
      multipleOf: 1
    });
  });

  it("adds 'null' for nullable fields", () => {
    expect(buildMinorFieldRule(true)).toEqual({
      bsonType: ["int", "long", "double", "null"],
      multipleOf: 1
    });
  });
});

describe("buildCollectionJsonSchema", () => {
  it("emits a top-level properties entry for flat (prefix: '') groups", () => {
    const schema = buildCollectionJsonSchema({
      modelName: "BankAccount",
      groups: [{ prefix: "", fields: ["balanceMinor"], nullable: true }]
    });
    expect(schema).toEqual({
      bsonType: "object",
      properties: {
        balanceMinor: { bsonType: ["int", "long", "double", "null"], multipleOf: 1 }
      }
    });
  });

  it("emits nested object wrappers for dotted prefixes", () => {
    const schema = buildCollectionJsonSchema({
      modelName: "TenantUserRole",
      groups: [{ prefix: "capabilities", fields: ["approvalLimitMinor"], nullable: true }]
    });
    const capabilities = (schema.properties as Record<string, unknown>).capabilities as {
      bsonType: string;
      properties: Record<string, unknown>;
    };
    expect(capabilities.bsonType).toBe("object");
    expect(capabilities.properties.approvalLimitMinor).toEqual({
      bsonType: ["int", "long", "double", "null"],
      multipleOf: 1
    });
  });

  it("emits array-item wrappers for array groups", () => {
    const schema = buildCollectionJsonSchema({
      modelName: "Invoice",
      groups: [
        {
          prefix: "parsed.lineItems",
          fields: ["amountMinor"],
          nullable: true,
          array: true
        }
      ]
    });
    const parsed = (schema.properties as Record<string, unknown>).parsed as {
      properties: { lineItems: { bsonType: string; items: { bsonType: string; properties: Record<string, unknown> } } };
    };
    expect(parsed.properties.lineItems.bsonType).toBe("array");
    expect(parsed.properties.lineItems.items.bsonType).toBe("object");
    expect(parsed.properties.lineItems.items.properties.amountMinor).toEqual({
      bsonType: ["int", "long", "double", "null"],
      multipleOf: 1
    });
  });

  it("merges multiple groups that share a common ancestor prefix", () => {
    const schema = buildCollectionJsonSchema({
      modelName: "Invoice",
      groups: [
        { prefix: "parsed", fields: ["totalAmountMinor"], nullable: true },
        {
          prefix: "parsed.gst",
          fields: ["subtotalMinor", "cgstMinor"],
          nullable: true
        }
      ]
    });
    const parsed = (schema.properties as Record<string, unknown>).parsed as {
      properties: Record<string, unknown>;
    };
    expect(parsed.properties.totalAmountMinor).toBeDefined();
    const gst = parsed.properties.gst as { properties: Record<string, unknown> };
    expect(gst.properties.subtotalMinor).toBeDefined();
    expect(gst.properties.cgstMinor).toBeDefined();
  });

  it("marks required-in-Mongoose fields as non-nullable", () => {
    const schema = buildCollectionJsonSchema({
      modelName: "TdsRateTable",
      groups: [
        { prefix: "", fields: ["thresholdSingleMinor", "thresholdAnnualMinor"], nullable: false }
      ]
    });
    const single = (schema.properties as Record<string, unknown>).thresholdSingleMinor as {
      bsonType: string[];
    };
    expect(single.bsonType).not.toContain("null");
    expect(single.bsonType).toEqual(["int", "long", "double"]);
  });
});

describe("MINOR_FIELD_REGISTRY", () => {
  it("includes every expected collection (no silent drops)", () => {
    const names = MINOR_FIELD_REGISTRY.map((s) => s.modelName).sort();
    expect(names).toEqual(
      [
        "BankAccount",
        "BankTransaction",
        "ClientComplianceConfig",
        "Invoice",
        "TdsRateTable",
        "TdsVendorLedger",
        "TdsVendorLedgerArchive",
        "TdsVendorLedgerEntryOverflow",
        "TenantUserRole",
        "VendorMaster"
      ].sort()
    );
  });

  it("buildAllJsonSchemas returns one entry per registry row", () => {
    const out = buildAllJsonSchemas();
    expect(out.length).toBe(MINOR_FIELD_REGISTRY.length);
    for (const row of out) {
      expect(row.jsonSchema).toHaveProperty("bsonType", "object");
      expect(row.jsonSchema).toHaveProperty("properties");
    }
  });

  it("every generated field rule is an integer-compatible bsonType with multipleOf: 1", () => {
    const schemas = buildAllJsonSchemas();
    const minorFieldsSeen: string[] = [];

    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.multipleOf === "number") {
        expect(obj.multipleOf).toBe(1);
        const bson = obj.bsonType as string[];
        expect(bson).toEqual(expect.arrayContaining(["int", "long", "double"]));
        minorFieldsSeen.push(path);
        return;
      }
      if (obj.properties && typeof obj.properties === "object") {
        for (const [k, v] of Object.entries(obj.properties)) walk(v, `${path}.${k}`);
      }
      if (obj.items) walk(obj.items, `${path}[]`);
    };

    for (const { modelName, jsonSchema } of schemas) walk(jsonSchema, modelName);
    expect(minorFieldsSeen.length).toBeGreaterThan(0);
    const collectionsHit = new Set(minorFieldsSeen.map((p) => p.split(".")[0]));
    expect(collectionsHit.size).toBe(MINOR_FIELD_REGISTRY.length);
  });

  it("registry covers every *Minor field declared in mongoose models", () => {
    const MINOR_SUFFIX = /Minor$/;

    const collectMinorPaths = (schema: mongoose.Schema, prefix: string, out: Set<string>): void => {
      for (const [key, schemaType] of Object.entries(schema.paths)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        const nestedSchema = (schemaType as { schema?: mongoose.Schema }).schema;
        if (nestedSchema) {
          collectMinorPaths(nestedSchema, fullPath, out);
          continue;
        }
        if (MINOR_SUFFIX.test(key)) {
          out.add(fullPath);
        }
      }
    };

    const coveredByModel = new Map<string, Set<string>>();
    for (const entry of MINOR_FIELD_REGISTRY) {
      const paths = new Set<string>();
      for (const group of entry.groups) {
        for (const field of group.fields) {
          const full = group.prefix === "" ? field : `${group.prefix}.${field}`;
          paths.add(full);
        }
      }
      coveredByModel.set(entry.modelName, paths);
    }

    const missing: string[] = [];
    for (const [modelName, model] of Object.entries(mongoose.models)) {
      if (!coveredByModel.has(modelName)) continue;
      const declared = new Set<string>();
      collectMinorPaths(model.schema, "", declared);
      const covered = coveredByModel.get(modelName)!;
      for (const path of declared) {
        if (!covered.has(path)) missing.push(`${modelName}.${path}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
