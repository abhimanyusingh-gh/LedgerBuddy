import { extractTotalAmount, parseInvoiceText } from "./invoiceParser.ts";

describe("parseInvoiceText", () => {
  it("extracts common invoice fields from standard content", () => {
    const text = [
      "Invoice Number: INV-55",
      "Vendor: Alpine Supplies",
      "Invoice Date: 02/17/2026",
      "Due Date: 03/01/2026",
      "Currency: USD",
      "Grand Total: 2,450.90"
    ].join("\n");

    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBe("INV-55");
    expect(result.parsed.vendorName).toBe("Alpine Supplies");
    expect(result.parsed.currency).toBe("USD");
    expect(result.parsed.totalAmountMinor).toBe(245090);
    expect(result.warnings.length).toBeLessThanOrEqual(1);
  });

  it("returns warnings for low-information OCR", () => {
    const result = parseInvoiceText("Random words without invoice structure");

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.parsed.totalAmountMinor).toBeUndefined();
  });

  it("prefers grand total over subtotal and tax values", () => {
    const text = [
      "Invoice Number: INV-2026-88",
      "Vendor: Cedar Labs",
      "Subtotal: 1,200.00",
      "Tax: 216.00",
      "Grand Total: 1,416.00"
    ].join("\n");

    const result = parseInvoiceText(text);
    expect(result.parsed.totalAmountMinor).toBe(141600);
  });

  it("handles european numeric formatting for totals", () => {
    const text = [
      "Invoice Number: INV-EU-77",
      "Supplier: Nord GmbH",
      "Amount Payable: EUR 1.234,56"
    ].join("\n");

    expect(extractTotalAmount(text)).toBe(1234.56);
  });

  it("avoids selecting year values over decimal totals on same line", () => {
    const text = [
      "Invoice Number: 42183017",
      "Invoice Date: August 3, 2014",
      "TOTAL AMOUNT DUE ON August 3, 2014 $4.11"
    ].join("\n");

    expect(extractTotalAmount(text)).toBe(4.11);
  });

  it("handles concatenated OCR totals and selects the final grand total value", () => {
    const text = [
      "Invoice No : # BLR_WFLD20151000982590",
      "Total",
      "1278.6140.39319.00",
      "Grand Total",
      "319.00"
    ].join("\n");

    expect(extractTotalAmount(text)).toBe(319);
  });

  it("captures invoice numbers containing underscores and hash prefixes", () => {
    const text = "Invoice No : # BLR_WFLD20151000982590";
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBe("BLR_WFLD20151000982590");
  });

  it("maps Rs-prefixed amounts to INR currency", () => {
    const text = ["Invoice Number: INV-100", "Grand Total: Rs 1939"].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.currency).toBe("INR");
  });

  it("stores JPY totals directly as minor units with zero decimals", () => {
    const text = ["Invoice Number: INV-JP-1", "Currency: JPY", "Grand Total: 5000"].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.totalAmountMinor).toBe(5000);
  });

  it("prefers vendor-like header text and skips warehouse address lines", () => {
    const text = [
      "ACME SUPPLIES PRIVATE LIMITED",
      "Warehouse Address: NO. 42/1 & 43, KACHERAKANAHALLI VILLAGE, JADIGENAHALLI HOBLI, HOSKOTE TALUK, Bangalore, Karnataka, India - 560067",
      "Invoice Number: INV-443",
      "Grand Total: 100.00"
    ].join("\n");

    const result = parseInvoiceText(text);

    expect(result.parsed.vendorName).toBe("ACME SUPPLIES PRIVATE LIMITED");
  });

  it("rejects explicit vendor captures that contain address-like text", () => {
    const text = [
      "ZENITH INDUSTRIES LTD",
      "Vendor: Warehouse Address: NO. 42/1 & 43, KACHERAKANAHALLI VILLAGE, Bangalore",
      "Invoice Number: INV-444",
      "Grand Total: 100.00"
    ].join("\n");

    const result = parseInvoiceText(text);

    expect(result.parsed.vendorName).toBe("ZENITH INDUSTRIES LTD");
  });

  it("extracts vendor from sold-by labels and skips guest-name lines", () => {
    const text = [
      "Guest Name: Sanjay",
      "Sold By: WS Retail Services Pvt. Ltd.,",
      "Invoice Number: INV-900",
      "Grand Total: 100.00"
    ].join("\n");

    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toBe("WS Retail Services Pvt. Ltd");
  });

  it("extracts invoice number when label and value are on separate lines", () => {
    const text = ["N° de facture", "INV/01/2015/074320", "Grand Total: EUR 100.00"].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBe("INV/01/2015/074320");
  });

  it("extracts invoice number from fallback inline hint patterns", () => {
    const text = [
      "Document Header",
      "Invoice ref INV-ALPHA-77",
      "Vendor: ACME LTD",
      "Grand Total: 10.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBe("ALPHA-77");
  });

  it("does not accept short alpha-only invoice tokens from weak OCR", () => {
    const text = [
      "Invoice Number: AWS",
      "Vendor: Blue River Ltd",
      "Grand Total: 10.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBeUndefined();
  });

  it("accepts long alpha-only invoice numbers", () => {
    const text = ["Invoice Number: ABCDEF", "Vendor: Blue River Ltd", "Grand Total: 10.00"].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBe("ABCDEF");
  });

  it("extracts invoice number from line after hint and continues past unrelated lines", () => {
    const text = [
      "Document Header",
      "Reference block",
      "invoice reference",
      "INV/99/2026/4455",
      "Vendor: ACME LTD",
      "Grand Total: 10.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBe("INV/99/2026/4455");
  });

  it("uses hotel details as vendor when explicit vendor labels are absent", () => {
    const text = [
      "Guest Name: Sanjay",
      "Hotel Details OYO, Line 1, Line 2, Line 3, Line 4",
      "Invoice Date: 31/12/2017",
      "Grand Total: Rs 896.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.vendorName).toBe("OYO");
  });

  it("skips hotel detail lines without alphabetic brand tokens", () => {
    const text = [
      "OMEGA INDUSTRIES LTD",
      "Hotel Details 12345",
      "Invoice Number: INV-902",
      "Grand Total: 10.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.vendorName).toBe("OMEGA INDUSTRIES LTD");
  });

  it("falls back to header vendor when explicit vendor label is empty at file end", () => {
    const text = [
      "OMEGA INDUSTRIES LTD",
      "Invoice Number: INV-901",
      "Grand Total: 10.00",
      "Vendor:"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.vendorName).toBe("OMEGA INDUSTRIES LTD");
  });

  it("falls back to raw date text when date token cannot be normalized", () => {
    const text = [
      "Invoice Number: INV-445",
      "Vendor: ACME LTD",
      "Invoice Date: Foo 12 2026",
      "Due Date: Bar 05 2026",
      "Grand Total: 100.00"
    ].join("\n");

    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceDate).toBe("Foo 12 2026");
    expect(result.parsed.dueDate).toBe("Bar 05 2026");
  });

  it("normalizes day-first invalid-calendar values for 2-digit and 4-digit years", () => {
    const shortYear = parseInvoiceText([
      "Invoice Number: INV-446",
      "Vendor: ACME LTD",
      "Invoice Date: 31-13-24",
      "Grand Total: 100.00"
    ].join("\n"));

    const longYear = parseInvoiceText([
      "Invoice Number: INV-447",
      "Vendor: ACME LTD",
      "Invoice Date: 31-13-2024",
      "Grand Total: 100.00"
    ].join("\n"));

    expect(shortYear.parsed.invoiceDate).toBe("2024-13-31");
    expect(longYear.parsed.invoiceDate).toBe("2024-13-31");
  });

  it("handles all supported currency symbols in extraction fallback", () => {
    const usd = parseInvoiceText("Invoice Number: INV-448\nGrand Total: $10.00");
    const eur = parseInvoiceText("Invoice Number: INV-449\nGrand Total: €10.00");
    const gbp = parseInvoiceText("Invoice Number: INV-450\nGrand Total: £10.00");
    const inr = parseInvoiceText("Invoice Number: INV-451\nGrand Total: ₹10.00");

    expect(usd.parsed.currency).toBe("USD");
    expect(eur.parsed.currency).toBe("EUR");
    expect(gbp.parsed.currency).toBe("GBP");
    expect(inr.parsed.currency).toBe("INR");
  });

  it("scores vendor candidates across header/middle/late lines and ignores noisy lines", () => {
    const text = [
      "Invoice Document",
      "AB",
      "A,B,C,D,E",
      "Warehouse Address Main Road",
      "Shop 12 LLC",
      "MEGA, TRADERS LTD",
      "ACME LOGISTICS 123456",
      `${"VERYLONGNAME".repeat(8)} LLC`,
      "Mid Level Vendor Pvt Ltd",
      "LATE ENTRY SUPPLIES LTD",
      "Invoice Number: INV-452",
      "Grand Total: 99.00"
    ].join("\n");

    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toBeDefined();
  });

  it("falls back from short explicit vendor labels to a stronger vendor candidate", () => {
    const text = [
      "Vendor: AB",
      "OMEGA INDUSTRIES LTD",
      "Invoice Number: INV-456",
      "Grand Total: 10.00"
    ].join("\n");

    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toBe("OMEGA INDUSTRIES LTD");
  });

  it("rejects explicit vendor labels with too many comma-separated fragments", () => {
    const text = [
      "Vendor: A,B,C,D,E",
      "OMEGA INDUSTRIES LTD",
      "Invoice Number: INV-457",
      "Grand Total: 10.00"
    ].join("\n");

    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toBe("OMEGA INDUSTRIES LTD");
  });

  it("evaluates vendor scores across all index bands and scoring penalties", () => {
    const text = [
      "ALPHA TRADING LLC",
      "LTD",
      "CHARGES LTD",
      "INVOICE COMPANY LTD",
      "BETA PARTNERS LLC",
      "GAMMA GROUP LLC",
      "DELTA SERVICES LLC",
      "EPSILON SUPPLY LLC",
      "ZETA INDUSTRIES 1234 LLC",
      "ETA INDUSTRIES 123456 LLC",
      "THETA, INDUSTRIES LLC",
      `${"ALPHA".repeat(14)} LTD`,
      `${"LONGNAME".repeat(12)} LLC`,
      "IOTA WHOLESALE LTD",
      "KAPPA RETAIL LTD",
      "Invoice Number: INV-458",
      "Grand Total: 10.00"
    ].join("\n");

    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toBeDefined();
  });
});

describe("extractTotalAmount additional branch paths", () => {
  it("returns undefined for empty or whitespace-only input", () => {
    expect(extractTotalAmount(" \n\r\n\t ")).toBeUndefined();
  });

  it("uses fallback scoring when no labeled total keywords are present", () => {
    const text = ["Item charge 50.00", "Description only"].join("\n");
    expect(extractTotalAmount(text)).toBe(50);
  });

  it("applies fallback position bonus for late unlabeled amount candidates", () => {
    const text = ["Description only", "More text", "Item charge 75.00"].join("\n");
    expect(extractTotalAmount(text)).toBe(75);
  });

  it("evaluates both early and late unlabeled amount candidates in fallback mode", () => {
    const text = ["Fee line 10.00", "Description", "Notes", "Fee line 20.00"].join("\n");
    expect(extractTotalAmount(text)).toBe(20);
  });

  it("uses fallback position bonus when ranking unlabeled totals", () => {
    const text = ["Fee line 101.00", "Description", "Notes", "Fee line 99.00"].join("\n");
    expect(extractTotalAmount(text)).toBe(99);
  });

  it("ignores unlabeled integer identifiers without monetary context", () => {
    const text = ["Customer Number 47774", "Order Number 365146"].join("\n");
    expect(extractTotalAmount(text)).toBeUndefined();
  });

  it("handles weak total labels with percentage noise penalty", () => {
    const text = ["Total 10% 99.99", "Total 80.00"].join("\n");
    expect(extractTotalAmount(text)).toBe(80);
  });

  it("ignores tax total labels that score non-positive and do not represent payable totals", () => {
    const text = ["Tax Total 10% 99.99"].join("\n");
    expect(extractTotalAmount(text)).toBeUndefined();
  });

  it("splits dotted concatenated OCR tokens", () => {
    const text = ["Invoice Number: INV-453", "Grand Total: 1.001.50"].join("\n");
    expect(extractTotalAmount(text)).toBe(1.5);
  });

  it("splits comma concatenated OCR tokens", () => {
    const text = ["Invoice Number: INV-454", "Grand Total: 1,001,50"].join("\n");
    expect(extractTotalAmount(text)).toBe(1.5);
  });

  it("keeps very small decimal amounts and handles sign-only token noise", () => {
    const text = ["Invoice Number: INV-455", "Grand Total: +", "Amount Due: 0.50"].join("\n");
    expect(extractTotalAmount(text)).toBe(0.5);
  });

  it("prefers the later line when candidates have identical score and amount", () => {
    const text = ["Header", "Grand Total: 100.00", "Grand Total: 100.00"].join("\n");
    expect(extractTotalAmount(text)).toBe(100);
  });

  it("prefers higher amount when score and line index are identical", () => {
    expect(extractTotalAmount("Grand Total: 100.00 200.00")).toBe(200);
  });

  it("uses currency keyword as monetary context in fallback extraction", () => {
    expect(extractTotalAmount("Charge USD 500")).toBe(500);
  });

  it("parses comma-grouped tokens where the last group is not fractional", () => {
    expect(extractTotalAmount("Grand Total: 12,345,678")).toBe(12345678);
  });

  it("parses multi-dot tokens where the last segment is not fractional", () => {
    expect(extractTotalAmount("Grand Total: 1.234.567")).toBe(1234567);
  });

  it("parses multi-dot tokens where final segment is fractional", () => {
    expect(extractTotalAmount("Grand Total: 1.234.5")).toBe(1234.5);
  });

  it("drops non-finite parsed amounts", () => {
    const huge = "9".repeat(400);
    expect(extractTotalAmount(`Grand Total: ${huge}`)).toBeUndefined();
  });
});
