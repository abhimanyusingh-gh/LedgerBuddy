import { resolveLineItemProvenance } from "@/ai/extractors/invoice/stages/provenance.js";
import type { InvoiceLineItemProvenance, ParsedInvoiceData } from "@/types/invoice.js";
import { PROVENANCE_SOURCE } from "@/types/invoice.js";

describe("resolveLineItemProvenance — aggregate-bbox row splitting", () => {
  const aggregateBboxNormalized: [number, number, number, number] = [0.05, 0.30, 0.95, 0.60];

  const buildVerifierRow = (index: number): InvoiceLineItemProvenance => ({
    index,
    row: {
      source: PROVENANCE_SOURCE.SLM,
      page: 1,
      bboxNormalized: [...aggregateBboxNormalized]
    },
    fields: {
      amountMinor: {
        source: PROVENANCE_SOURCE.SLM,
        page: 1,
        bboxNormalized: [...aggregateBboxNormalized]
      }
    }
  });

  const lineItems: NonNullable<ParsedInvoiceData["lineItems"]> = [
    { description: "Item A", amountMinor: 100000 },
    { description: "Item B", amountMinor: 200000 },
    { description: "Item C", amountMinor: 300000 }
  ];

  it("splits shared aggregate row bbox into equal y-bands preserving order", () => {
    const verifier = [buildVerifierRow(0), buildVerifierRow(1), buildVerifierRow(2)];

    const result = resolveLineItemProvenance({
      lineItems,
      ocrBlocks: [],
      verifierLineItemProvenance: verifier
    });

    expect(result).toHaveLength(3);
    const yBands = result.map((item) => item.row?.bboxNormalized);
    // y1 increases monotonically with index; y2 of band[i] == y1 of band[i+1].
    const [band0, band1, band2] = yBands as [number, number, number, number][];
    expect(band0[1]).toBeCloseTo(0.30, 6);
    expect(band0[3]).toBeCloseTo(0.40, 6);
    expect(band1[1]).toBeCloseTo(0.40, 6);
    expect(band1[3]).toBeCloseTo(0.50, 6);
    expect(band2[1]).toBeCloseTo(0.50, 6);
    expect(band2[3]).toBeCloseTo(0.60, 6);
    // x-range is preserved untouched.
    for (const band of [band0, band1, band2]) {
      expect(band[0]).toBeCloseTo(0.05, 6);
      expect(band[2]).toBeCloseTo(0.95, 6);
    }
  });

  it("propagates the per-row band to fields that inherited the aggregate bbox", () => {
    const verifier = [buildVerifierRow(0), buildVerifierRow(1)];

    const result = resolveLineItemProvenance({
      lineItems: lineItems.slice(0, 2),
      ocrBlocks: [],
      verifierLineItemProvenance: verifier
    });

    expect(result).toHaveLength(2);
    // amountMinor field was a verifier-aggregate; after splitting it must match
    // its own row's y-band (not the whole-table aggregate).
    for (const item of result) {
      expect(item.fields?.amountMinor?.bboxNormalized).toEqual(item.row?.bboxNormalized);
    }
    expect(result[0].fields?.amountMinor?.bboxNormalized?.[1]).toBeCloseTo(0.30, 6);
    expect(result[1].fields?.amountMinor?.bboxNormalized?.[1]).toBeCloseTo(0.45, 6);
  });

  it("is a no-op when only one line item exists", () => {
    const verifier = [buildVerifierRow(0)];
    const result = resolveLineItemProvenance({
      lineItems: lineItems.slice(0, 1),
      ocrBlocks: [],
      verifierLineItemProvenance: verifier
    });
    expect(result[0].row?.bboxNormalized).toEqual(aggregateBboxNormalized);
  });

  it("leaves distinct per-row bboxes untouched", () => {
    const verifier: InvoiceLineItemProvenance[] = [
      {
        index: 0,
        row: { source: PROVENANCE_SOURCE.SLM, page: 1, bboxNormalized: [0.05, 0.10, 0.95, 0.20] }
      },
      {
        index: 1,
        row: { source: PROVENANCE_SOURCE.SLM, page: 1, bboxNormalized: [0.05, 0.20, 0.95, 0.30] }
      }
    ];
    const result = resolveLineItemProvenance({
      lineItems: lineItems.slice(0, 2),
      ocrBlocks: [],
      verifierLineItemProvenance: verifier
    });
    expect(result[0].row?.bboxNormalized).toEqual([0.05, 0.10, 0.95, 0.20]);
    expect(result[1].row?.bboxNormalized).toEqual([0.05, 0.20, 0.95, 0.30]);
  });

  it("splits both absolute bbox and bboxNormalized when both are set", () => {
    const absBbox: [number, number, number, number] = [40, 300, 560, 400];
    const verifier: InvoiceLineItemProvenance[] = [0, 1].map((idx) => ({
      index: idx,
      row: {
        source: PROVENANCE_SOURCE.SLM,
        page: 1,
        bbox: [...absBbox],
        bboxNormalized: [...aggregateBboxNormalized]
      }
    }));
    const result = resolveLineItemProvenance({
      lineItems: lineItems.slice(0, 2),
      ocrBlocks: [],
      verifierLineItemProvenance: verifier
    });
    const rowBb0 = result[0].row?.bbox as [number, number, number, number];
    const rowBb1 = result[1].row?.bbox as [number, number, number, number];
    expect(rowBb0[1]).toBeCloseTo(300, 6);
    expect(rowBb0[3]).toBeCloseTo(350, 6);
    expect(rowBb1[1]).toBeCloseTo(350, 6);
    expect(rowBb1[3]).toBeCloseTo(400, 6);
  });
});
