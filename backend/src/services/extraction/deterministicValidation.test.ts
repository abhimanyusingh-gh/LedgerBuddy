import { validateInvoiceFields } from "./deterministicValidation.ts";

describe("validateInvoiceFields", () => {
  it("passes when required fields are present and consistent", () => {
    const result = validateInvoiceFields({
      parsed: {
        invoiceNumber: "INV-100",
        vendorName: "ACME Corp",
        currency: "USD",
        totalAmountMinor: 125000,
        invoiceDate: "2026-02-01",
        dueDate: "2026-02-15"
      },
      expectedMaxTotal: 50000,
      expectedMaxDueDays: 60,
      referenceDate: new Date("2026-02-20T00:00:00.000Z")
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags missing and suspicious fields", () => {
    const result = validateInvoiceFields({
      parsed: {
        vendorName: "Warehouse Address: No 42/1",
        currency: "USD",
        totalAmountMinor: 0
      },
      expectedMaxTotal: 1000,
      expectedMaxDueDays: 30
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Invoice number is missing.");
    expect(result.issues).toContain("Vendor name looks like an address line.");
    expect(result.issues).toContain("Total amount is missing or invalid.");
  });

  it("flags date inconsistencies and outlier totals", () => {
    const result = validateInvoiceFields({
      parsed: {
        invoiceNumber: "INV-404",
        vendorName: "Globex Ltd",
        currency: "USD",
        totalAmountMinor: 999999999,
        invoiceDate: "2026-04-20",
        dueDate: "2026-02-20"
      },
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 15
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Total amount exceeds configured expected maximum.");
    expect(result.issues).toContain("Due date is earlier than invoice date.");
  });
});
