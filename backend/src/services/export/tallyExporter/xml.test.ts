import {
  buildTallyBatchImportXml,
  buildTallyBatchImportXmlChunks,
  buildTallyPurchaseVoucherPayload,
  chunkVoucherInputs,
  TALLY_ACTION,
  TALLY_BATCH_SIZE,
  type VoucherPayloadInput
} from "@/services/export/tallyExporter/xml.ts";

const BASE_INPUT: VoucherPayloadInput = {
  companyName: "Demo Co",
  purchaseLedgerName: "Purchase",
  voucherNumber: "INV-1",
  partyLedgerName: "Vendor A",
  amountMinor: 120000,
  currency: "INR",
  date: new Date("2026-04-15")
};

function makeInputs(count: number): VoucherPayloadInput[] {
  return Array.from({ length: count }, (_, i) => ({
    ...BASE_INPUT,
    voucherNumber: `INV-${i + 1}`
  }));
}

describe("TALLY_BATCH_SIZE", () => {
  it("defaults to 25 per Tally rule #6", () => {
    expect(TALLY_BATCH_SIZE).toBe(25);
  });
});

describe("XML prolog / UTF-8 hygiene", () => {
  it("prepends the UTF-8 prolog to every envelope", () => {
    const xml = buildTallyPurchaseVoucherPayload(BASE_INPUT);
    expect(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")).toBe(true);
  });

  it("escapes non-ASCII BMP and supplementary-plane characters without mangling bytes", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      ...BASE_INPUT,
      partyLedgerName: "Café Rüth ₹ 💸 Co",
      narration: "café/₹/💸"
    });
    expect(xml).toContain("<PARTYLEDGERNAME>Café Rüth ₹ 💸 Co</PARTYLEDGERNAME>");
    expect(xml).toContain("<NARRATION>café/₹/💸</NARRATION>");
    const roundTripped = Buffer.from(xml, "utf-8").toString("utf-8");
    expect(roundTripped).toBe(xml);
  });
});

describe("VOUCHER ACTION attribute", () => {
  it("defaults to Create when action is not supplied", () => {
    const xml = buildTallyPurchaseVoucherPayload(BASE_INPUT);
    expect(xml).toContain("ACTION=\"Create\"");
    expect(xml).not.toContain("ACTION=\"Alter\"");
  });

  it("emits ACTION=\"Alter\" when action=TALLY_ACTION.ALTER", () => {
    const xml = buildTallyPurchaseVoucherPayload({ ...BASE_INPUT, action: TALLY_ACTION.ALTER });
    expect(xml).toContain("ACTION=\"Alter\"");
    expect(xml).not.toContain("ACTION=\"Create\"");
  });
});

describe("voucher GUID", () => {
  it("emits <GUID> when supplied (xml-escaped)", () => {
    const guid = "a1b2c3-<unsafe>-&42";
    const xml = buildTallyPurchaseVoucherPayload({ ...BASE_INPUT, guid });
    expect(xml).toContain("<GUID>a1b2c3-&lt;unsafe&gt;-&amp;42</GUID>");
  });

  it("omits <GUID> when not supplied", () => {
    const xml = buildTallyPurchaseVoucherPayload(BASE_INPUT);
    expect(xml).not.toContain("<GUID>");
  });
});

describe("PLACEOFSUPPLY emission", () => {
  it("omits <PLACEOFSUPPLY> when placeOfSupplyStateName is absent", () => {
    const xml = buildTallyPurchaseVoucherPayload(BASE_INPUT);
    expect(xml).not.toContain("<PLACEOFSUPPLY>");
  });

  it("emits <PLACEOFSUPPLY> at voucher envelope level (not inside LEDGERENTRIES.LIST)", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      ...BASE_INPUT,
      placeOfSupplyStateName: "Karnataka"
    });
    expect(xml).toContain("<PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>");
    const posLine = xml.indexOf("<PLACEOFSUPPLY>");
    const firstLedgerLine = xml.indexOf("<LEDGERENTRIES.LIST>");
    expect(posLine).toBeGreaterThan(0);
    expect(posLine).toBeLessThan(firstLedgerLine);
  });

  it("escapes PLACEOFSUPPLY content", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      ...BASE_INPUT,
      placeOfSupplyStateName: "A & <B>"
    });
    expect(xml).toContain("<PLACEOFSUPPLY>A &amp; &lt;B&gt;</PLACEOFSUPPLY>");
  });
});

describe("chunkVoucherInputs", () => {
  it.each([
    [0, 0],
    [1, 1],
    [24, 1],
    [25, 1],
    [26, 2],
    [50, 2],
    [51, 3],
    [76, 4]
  ])("chunks %d inputs into %d groups of <= 25", (count, expectedChunks) => {
    const chunks = chunkVoucherInputs(makeInputs(count));
    expect(chunks).toHaveLength(expectedChunks);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TALLY_BATCH_SIZE);
    }
    const flattened = chunks.flat();
    expect(flattened).toHaveLength(count);
    flattened.forEach((item, idx) => {
      expect(item.voucherNumber).toBe(`INV-${idx + 1}`);
    });
  });

  it("preserves ordinal order within and across chunks (Tally rule #7)", () => {
    const inputs = makeInputs(60);
    const chunks = chunkVoucherInputs(inputs);
    const ordinals: string[] = [];
    for (const chunk of chunks) {
      for (const input of chunk) {
        ordinals.push(input.voucherNumber);
      }
    }
    expect(ordinals).toEqual(inputs.map((i) => i.voucherNumber));
  });

  it("throws when size is <= 0", () => {
    expect(() => chunkVoucherInputs(makeInputs(3), 0)).toThrow();
    expect(() => chunkVoucherInputs(makeInputs(3), -1)).toThrow();
  });
});

describe("buildTallyBatchImportXmlChunks", () => {
  it("returns one envelope per chunk, each with <=25 vouchers, deterministic ordinals", () => {
    const inputs = makeInputs(51);
    const xmls = buildTallyBatchImportXmlChunks("Demo Co", inputs);
    expect(xmls).toHaveLength(3);
    expect(xmls.every((xml) => xml.startsWith("<?xml"))).toBe(true);
    expect((xmls[0].match(/<VOUCHER /g) ?? []).length).toBe(25);
    expect((xmls[1].match(/<VOUCHER /g) ?? []).length).toBe(25);
    expect((xmls[2].match(/<VOUCHER /g) ?? []).length).toBe(1);
    expect(xmls[0]).toContain("<VOUCHERNUMBER>INV-1</VOUCHERNUMBER>");
    expect(xmls[0]).toContain("<VOUCHERNUMBER>INV-25</VOUCHERNUMBER>");
    expect(xmls[1]).toContain("<VOUCHERNUMBER>INV-26</VOUCHERNUMBER>");
    expect(xmls[2]).toContain("<VOUCHERNUMBER>INV-51</VOUCHERNUMBER>");
  });

  it("returns empty array on empty input", () => {
    expect(buildTallyBatchImportXmlChunks("Demo Co", [])).toEqual([]);
  });
});

describe("buildTallyBatchImportXml (single envelope)", () => {
  it("carries SVCURRENTCOMPANY on every envelope (Tally rule #3)", () => {
    const xml = buildTallyBatchImportXml("Demo Co", makeInputs(3));
    expect((xml.match(/<SVCURRENTCOMPANY>Demo Co<\/SVCURRENTCOMPANY>/g) ?? []).length).toBe(1);
  });
});
