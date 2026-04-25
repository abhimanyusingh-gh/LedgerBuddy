jest.mock("@/api/client", () => ({ apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

import { summarizeLinkedCounts } from "@/features/admin/onboarding/clientOrgArchiveSummary";

describe("features/admin/onboarding/clientOrgArchiveSummary", () => {
  it("returns an empty list for nullish or empty input", () => {
    expect(summarizeLinkedCounts(undefined)).toEqual([]);
    expect(summarizeLinkedCounts(null)).toEqual([]);
    expect(summarizeLinkedCounts({})).toEqual([]);
  });

  it("filters out zero counts and undefined entries", () => {
    const summary = summarizeLinkedCounts({ invoices: 0, vendors: 4, glCodes: undefined });
    expect(summary).toHaveLength(1);
    expect(summary[0]?.label).toBe("vendors");
    expect(summary[0]?.text).toBe("4 vendors");
  });

  it("sorts dependents by descending count", () => {
    const summary = summarizeLinkedCounts({
      invoices: 12,
      vendors: 30,
      bankStatements: 2
    });
    expect(summary.map((entry) => entry.label)).toEqual(["vendors", "invoices", "bankStatements"]);
  });

  it("breaks ties on equal counts by alphabetical label order", () => {
    const summary = summarizeLinkedCounts({
      vendors: 3,
      invoices: 3,
      bankStatements: 3
    });
    expect(summary.map((entry) => entry.label)).toEqual(["bankStatements", "invoices", "vendors"]);

    const reordered = summarizeLinkedCounts({
      invoices: 3,
      bankStatements: 3,
      vendors: 3
    });
    expect(reordered.map((entry) => entry.label)).toEqual(["bankStatements", "invoices", "vendors"]);
  });

  it("uses singular nouns when the count is 1", () => {
    const summary = summarizeLinkedCounts({
      invoices: 1,
      bankStatements: 1,
      vendors: 5
    });
    const byLabel = Object.fromEntries(summary.map((entry) => [entry.label, entry.text]));
    expect(byLabel.invoices).toBe("1 invoice");
    expect(byLabel.bankStatements).toBe("1 bank statement");
    expect(byLabel.vendors).toBe("5 vendors");
  });
});
