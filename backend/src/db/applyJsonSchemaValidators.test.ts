import mongoose from "mongoose";
import {
  applyMinorFieldValidators,
  REGISTERED_MODEL_NAMES,
  ValidationAction,
  ValidationLevel
} from "@/db/applyJsonSchemaValidators.js";

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

type CommandArg = {
  collMod: string;
  validator: { $jsonSchema: unknown };
  validationLevel: string;
  validationAction: string;
};

function makeFakeDb(overrides: Partial<{ createCollectionError: unknown; commandError: unknown }> = {}) {
  const commandCalls: CommandArg[] = [];
  const createCollectionCalls: string[] = [];
  const db = {
    createCollection: jest.fn(async (name: string) => {
      createCollectionCalls.push(name);
      if (overrides.createCollectionError) throw overrides.createCollectionError;
    }),
    command: jest.fn(async (cmd: CommandArg) => {
      commandCalls.push(cmd);
      if (overrides.commandError) throw overrides.commandError;
      return { ok: 1 };
    })
  } as unknown as Parameters<typeof applyMinorFieldValidators>[0];
  return { db, commandCalls, createCollectionCalls };
}

describe("applyMinorFieldValidators", () => {
  it("invokes collMod once per registered model with the expected shape", async () => {
    const { db, commandCalls } = makeFakeDb();
    const results = await applyMinorFieldValidators(db, {
      action: ValidationAction.Warn,
      level: ValidationLevel.Strict
    });

    expect(results.length).toBe(REGISTERED_MODEL_NAMES.length);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(commandCalls.length).toBe(REGISTERED_MODEL_NAMES.length);

    for (const cmd of commandCalls) {
      expect(cmd.collMod).toBeTruthy();
      expect(cmd.validationAction).toBe(ValidationAction.Warn);
      expect(cmd.validationLevel).toBe(ValidationLevel.Strict);
      expect(cmd.validator.$jsonSchema).toMatchObject({ bsonType: "object" });
    }

    const collections = commandCalls.map((c) => c.collMod).sort();
    const expected = REGISTERED_MODEL_NAMES
      .map((name) => mongoose.models[name]?.collection.name)
      .filter(Boolean)
      .sort();
    expect(collections).toEqual(expected);
  });

  it("is idempotent: two back-to-back runs issue the same commands", async () => {
    const first = makeFakeDb();
    await applyMinorFieldValidators(first.db, { action: ValidationAction.Warn });
    const second = makeFakeDb();
    await applyMinorFieldValidators(second.db, { action: ValidationAction.Warn });
    expect(first.commandCalls).toEqual(second.commandCalls);
  });

  it("honors --action=error by flipping validationAction", async () => {
    const { db, commandCalls } = makeFakeDb();
    await applyMinorFieldValidators(db, {
      action: ValidationAction.Error,
      level: ValidationLevel.Strict
    });
    for (const cmd of commandCalls) {
      expect(cmd.validationAction).toBe(ValidationAction.Error);
    }
  });

  it("swallows NamespaceExists (code 48) from createCollection", async () => {
    const nsExists = Object.assign(new Error("ns exists"), { code: 48 });
    const { db } = makeFakeDb({ createCollectionError: nsExists });
    const results = await applyMinorFieldValidators(db, { action: ValidationAction.Warn });
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("surfaces other createCollection errors as ok: false without aborting siblings", async () => {
    const boom = Object.assign(new Error("boom"), { code: 13 });
    const { db } = makeFakeDb({ createCollectionError: boom });
    const results = await applyMinorFieldValidators(db, { action: ValidationAction.Warn });
    expect(results.length).toBe(REGISTERED_MODEL_NAMES.length);
    expect(results.every((r) => !r.ok)).toBe(true);
    for (const r of results) {
      expect(r.errorMessage).toContain("boom");
    }
  });

  it("collects a collMod error per-collection rather than aborting the batch", async () => {
    const boom = new Error("collmod denied");
    const { db, commandCalls } = makeFakeDb({ commandError: boom });
    const results = await applyMinorFieldValidators(db, { action: ValidationAction.Warn });
    expect(commandCalls.length).toBe(REGISTERED_MODEL_NAMES.length);
    expect(results.every((r) => !r.ok)).toBe(true);
  });
});
