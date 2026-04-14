/* eslint-disable @typescript-eslint/no-explicit-any */
const mockFind = jest.fn();
const mockCreate = jest.fn();
const mockCountDocuments = jest.fn();

jest.mock("../../models/compliance/GlCodeMaster.js", () => ({
  GlCodeMasterModel: {
    find: jest.fn(() => ({ lean: () => mockFind() })),
    create: mockCreate,
    countDocuments: mockCountDocuments
  }
}));

jest.mock("../../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import { seedDefaultGlCodes, DEFAULT_GL_CODES } from "./seedGlCodes";

beforeEach(() => {
  mockFind.mockReset().mockResolvedValue([]);
  mockCreate.mockReset().mockImplementation(async (data: any) => ({ ...data, _id: `gl-${data.code}` }));
  mockCountDocuments.mockReset().mockResolvedValue(0);
});

describe("seedDefaultGlCodes", () => {
  it("creates 20 GL codes for a new tenant with zero existing codes", async () => {
    const result = await seedDefaultGlCodes("tenant-new");

    expect(result.created).toBe(20);
    expect(result.skipped).toBe(0);
    expect(mockCreate).toHaveBeenCalledTimes(20);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-new",
      code: "4001",
      name: "Professional Services",
      category: "Professional Services",
      linkedTdsSection: "194J",
      isActive: true
    }));

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-new",
      code: "4020",
      name: "Miscellaneous Expenses",
      category: "Other",
      linkedTdsSection: null,
      isActive: true
    }));
  });

  it("is idempotent — running twice does not create duplicates", async () => {
    const firstResult = await seedDefaultGlCodes("tenant-idem");
    expect(firstResult.created).toBe(20);
    expect(firstResult.skipped).toBe(0);

    const existingCodes = DEFAULT_GL_CODES.map((gl) => ({ code: gl.code }));
    mockFind.mockResolvedValue(existingCodes);
    mockCreate.mockReset();

    const secondResult = await seedDefaultGlCodes("tenant-idem");
    expect(secondResult.created).toBe(0);
    expect(secondResult.skipped).toBe(20);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("skips codes that already exist and creates the rest", async () => {
    mockFind.mockResolvedValue([
      { code: "4001" },
      { code: "4005" },
      { code: "4010" }
    ]);

    const result = await seedDefaultGlCodes("tenant-partial");

    expect(result.created).toBe(17);
    expect(result.skipped).toBe(3);
    expect(mockCreate).toHaveBeenCalledTimes(17);

    const createdCodes = mockCreate.mock.calls.map((call: any[]) => call[0].code);
    expect(createdCodes).not.toContain("4001");
    expect(createdCodes).not.toContain("4005");
    expect(createdCodes).not.toContain("4010");
    expect(createdCodes).toContain("4002");
    expect(createdCodes).toContain("4020");
  });

  it("handles E11000 duplicate key race condition gracefully", async () => {
    const dupError = Object.assign(new Error("E11000"), { code: 11000 });
    mockCreate
      .mockResolvedValueOnce({ code: "4001" })
      .mockRejectedValueOnce(dupError)
      .mockImplementation(async (data: any) => ({ ...data }));

    const result = await seedDefaultGlCodes("tenant-race");

    expect(result.created).toBe(19);
    expect(result.skipped).toBe(1);
  });

  it("propagates non-duplicate database errors", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Connection lost"));

    await expect(seedDefaultGlCodes("tenant-fail")).rejects.toThrow("Connection lost");
  });

  it("sets isActive to true for all seeded GL codes", async () => {
    await seedDefaultGlCodes("tenant-active");

    for (const call of mockCreate.mock.calls) {
      expect(call[0].isActive).toBe(true);
    }
  });

  it("seeds correct TDS section for each GL code", async () => {
    await seedDefaultGlCodes("tenant-tds");

    const codeToTds = new Map(mockCreate.mock.calls.map((call: any[]) => [call[0].code, call[0].linkedTdsSection]));
    expect(codeToTds.get("4001")).toBe("194J");
    expect(codeToTds.get("4002")).toBe("194C");
    expect(codeToTds.get("4003")).toBe("194H");
    expect(codeToTds.get("4004")).toBe("194I(b)");
    expect(codeToTds.get("4005")).toBe("194I(a)");
    expect(codeToTds.get("4006")).toBe("194A");
    expect(codeToTds.get("4007")).toBe("194Q");
    expect(codeToTds.get("4009")).toBeNull();
    expect(codeToTds.get("4010")).toBeNull();
    expect(codeToTds.get("4019")).toBeNull();
  });

  it("DEFAULT_GL_CODES contains exactly 20 entries", () => {
    expect(DEFAULT_GL_CODES).toHaveLength(20);
  });
});
