/* eslint-disable @typescript-eslint/no-explicit-any */
const mockFind = jest.fn(async () => [] as any[]);
const mockCountDocuments = jest.fn(async () => 0);
const mockCreate = jest.fn(async (data: any) => ({
  ...data,
  _id: `gl-${data.code}`,
  toObject() { return { ...data, _id: `gl-${data.code}` }; }
}));
const mockFindOne = jest.fn(async () => null);

jest.mock("../models/compliance/GlCodeMaster.js", () => ({
  GlCodeMasterModel: {
    find: jest.fn(() => ({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: () => mockFind() }) }) }),
      lean: () => mockFind()
    })),
    countDocuments: mockCountDocuments,
    create: mockCreate,
    findOne: mockFindOne,
    findOneAndUpdate: jest.fn(async () => null)
  }
}));

import { defaultAuth, findHandler, findSecondHandler, mockRequest, mockResponse } from "./testHelpers.ts";
import { parseCsvContent, MAX_CSV_ROWS } from "./glCodes.ts";

let createGlCodesRouter: typeof import("./glCodes.ts").createGlCodesRouter;

beforeEach(async () => {
  jest.resetModules();

  jest.mock("../models/compliance/GlCodeMaster.js", () => ({
    GlCodeMasterModel: {
      find: jest.fn(() => ({
        sort: () => ({ skip: () => ({ limit: () => ({ lean: () => mockFind() }) }) }),
        lean: () => mockFind()
      })),
      countDocuments: mockCountDocuments,
      create: mockCreate,
      findOne: mockFindOne,
      findOneAndUpdate: jest.fn(async () => null)
    }
  }));

  mockFind.mockReset().mockResolvedValue([]);
  mockCountDocuments.mockReset().mockResolvedValue(0);
  mockCreate.mockReset().mockImplementation(async (data: any) => ({
    ...data,
    _id: `gl-${data.code}`,
    toObject() { return { ...data, _id: `gl-${data.code}` }; }
  }));
  mockFindOne.mockReset().mockResolvedValue(null);

  const mod = await import("./glCodes.ts");
  createGlCodesRouter = mod.createGlCodesRouter;
});

describe("parseCsvContent", () => {
  it("parses valid CSV with all columns", () => {
    const csv = "code,name,category,tdsSection,costCenter\n4001,Office Rent,Rent,194I,CC-001\n4002,Legal Fees,Professional Services,194J,CC-002";
    const { rows, errors } = parseCsvContent(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ code: "4001", name: "Office Rent", category: "Rent", tdsSection: "194I", costCenter: "CC-001" });
    expect(rows[1]).toEqual({ code: "4002", name: "Legal Fees", category: "Professional Services", tdsSection: "194J", costCenter: "CC-002" });
  });

  it("parses CSV with only required columns", () => {
    const csv = "code,name\n5001,Stationery\n5002,Printing";
    const { rows, errors } = parseCsvContent(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ code: "5001", name: "Stationery", category: undefined, tdsSection: undefined, costCenter: undefined });
  });

  it("returns error when header missing required columns", () => {
    const csv = "code,category\n5001,Rent";
    const { rows, errors } = parseCsvContent(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].message).toContain("code");
    expect(errors[0].message).toContain("name");
  });

  it("reports row-level errors for missing required fields", () => {
    const csv = "code,name\n,Missing Code\n6001,";
    const { rows, errors } = parseCsvContent(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toContain("code");
    expect(errors[1].row).toBe(3);
    expect(errors[1].message).toContain("name");
  });

  it("returns empty for empty content", () => {
    const { rows, errors } = parseCsvContent("");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("skips empty lines", () => {
    const csv = "code,name\n7001,Item A\n\n7002,Item B\n";
    const { rows, errors } = parseCsvContent(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it("handles quoted fields with commas", () => {
    const csv = 'code,name\n8001,"Rent, Office"\n8002,"Legal ""Pro"" Fees"';
    const { rows, errors } = parseCsvContent(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].name).toBe("Rent, Office");
    expect(rows[1].name).toBe('Legal "Pro" Fees');
  });

  it("handles Windows-style line endings", () => {
    const csv = "code,name\r\n9001,Item A\r\n9002,Item B";
    const { rows, errors } = parseCsvContent(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it("recognizes alternative tdsSection header names", () => {
    const csv = "code,name,tds_section\nA1,Test,194C";
    const { rows } = parseCsvContent(csv);
    expect(rows[0].tdsSection).toBe("194C");
  });

  it("recognizes alternative costCenter header names", () => {
    const csv = "code,name,cost_center\nA1,Test,CC-10";
    const { rows } = parseCsvContent(csv);
    expect(rows[0].costCenter).toBe("CC-10");
  });
});

describe("POST /admin/gl-codes/import-csv", () => {
  function buildCsvBuffer(content: string): Buffer {
    return Buffer.from(content, "utf-8");
  }

  it("imports valid CSV and returns summary", async () => {
    const router = createGlCodesRouter();
    const csv = "code,name,category,tdsSection\n4001,Office Rent,Rent,194I\n4002,Legal Fees,Professional Services,194J";
    const file = { buffer: buildCsvBuffer(csv), originalname: "gl.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { imported: number; skipped: number; errors: unknown[] };
    expect(body.imported).toBe(2);
    expect(body.skipped).toBe(0);
    expect(body.errors).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-a",
      code: "4001",
      name: "Office Rent",
      category: "Rent",
      linkedTdsSection: "194I"
    }));
  });

  it("skips duplicate codes that already exist in the database", async () => {
    mockFind.mockResolvedValueOnce([{ code: "4001" }] as any);
    const router = createGlCodesRouter();
    const csv = "code,name\n4001,Existing Code\n4002,New Code";
    const file = { buffer: buildCsvBuffer(csv), originalname: "gl.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    const body = res.jsonBody as { imported: number; skipped: number };
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(1);
  });

  it("skips duplicate codes within the same CSV batch", async () => {
    const router = createGlCodesRouter();
    const csv = "code,name\nDUP1,First Entry\nDUP1,Duplicate Entry\nDUP2,Another";
    const file = { buffer: buildCsvBuffer(csv), originalname: "gl.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    const body = res.jsonBody as { imported: number; skipped: number };
    expect(body.imported).toBe(2);
    expect(body.skipped).toBe(1);
  });

  it("returns 400 when no file is provided", async () => {
    const router = createGlCodesRouter();
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file: undefined }),
      res, jest.fn()
    );

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { message: string }).message).toContain("No CSV file");
  });

  it("returns 400 for empty file", async () => {
    const router = createGlCodesRouter();
    const file = { buffer: Buffer.alloc(0), originalname: "empty.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { message: string }).message).toContain("empty");
  });

  it("returns 400 for headers-only CSV", async () => {
    const router = createGlCodesRouter();
    const csv = "code,name,category\n";
    const file = { buffer: buildCsvBuffer(csv), originalname: "headers.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { message: string }).message).toContain("empty");
  });

  it("returns 400 when CSV exceeds max row count", async () => {
    const router = createGlCodesRouter();
    const lines = ["code,name"];
    for (let i = 0; i < MAX_CSV_ROWS + 1; i++) {
      lines.push(`GL${i},Item ${i}`);
    }
    const csv = lines.join("\n");
    const file = { buffer: buildCsvBuffer(csv), originalname: "big.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { message: string }).message).toContain("5000");
  });

  it("reports row-level errors for rows missing required fields", async () => {
    const router = createGlCodesRouter();
    const csv = "code,name\n,No Code\n4001,Valid Row\n4002,";
    const file = { buffer: buildCsvBuffer(csv), originalname: "gl.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    const body = res.jsonBody as { imported: number; errors: Array<{ row: number; message: string }> };
    expect(body.imported).toBe(1);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0].row).toBe(2);
    expect(body.errors[1].row).toBe(4);
  });

  it("handles E11000 duplicate key errors from database gracefully", async () => {
    const dupError = Object.assign(new Error("E11000"), { code: 11000 });
    mockCreate.mockRejectedValueOnce(dupError).mockImplementation(async (data: any) => ({
      ...data,
      _id: `gl-${data.code}`
    }));
    const router = createGlCodesRouter();
    const csv = "code,name\nRACE1,Race Condition\nRACE2,Normal";
    const file = { buffer: buildCsvBuffer(csv), originalname: "gl.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    const body = res.jsonBody as { imported: number; skipped: number };
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(1);
  });

  it("defaults category to Other when not provided", async () => {
    const router = createGlCodesRouter();
    const csv = "code,name\nX001,No Category";
    const file = { buffer: buildCsvBuffer(csv), originalname: "gl.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: defaultAuth, file }),
      res, jest.fn()
    );

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ category: "Other" }));
  });

  it("is scoped to authenticated tenant", async () => {
    const router = createGlCodesRouter();
    const csv = "code,name\nT001,Tenant Scoped";
    const customAuth = { ...defaultAuth, tenantId: "tenant-xyz" };
    const file = { buffer: buildCsvBuffer(csv), originalname: "gl.csv", mimetype: "text/csv" };
    const res = mockResponse();

    await findSecondHandler(router, "post", "/admin/gl-codes/import-csv")(
      mockRequest({ authContext: customAuth, file }),
      res, jest.fn()
    );

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-xyz" }));
  });
});
