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

  it("uses french language hint to parse localized due date labels", () => {
    const text = [
      "Numéro de facture: FAC-88",
      "Fournisseur: Alpha SARL",
      "Date de facture: 12/02/2026",
      "Date d'échéance: 25/02/2026",
      "Montant total: 1500,50 EUR"
    ].join("\n");
    const result = parseInvoiceText(text, { languageHint: "fr" });

    expect(result.parsed.invoiceNumber).toBe("FAC-88");
    expect(result.parsed.vendorName).toBe("Alpha SARL");
    expect(result.parsed.invoiceDate).toBe("2026-02-12");
    expect(result.parsed.dueDate).toBe("2026-02-25");
  });

  it("uses german language hint to parse rechnungsnummer labels", () => {
    const text = [
      "Rechnungsnummer: DE-443-20",
      "Lieferant: Nord GmbH",
      "Rechnungsdatum: 12.02.2026",
      "Fälligkeitsdatum: 20.02.2026",
      "Gesamtbetrag: EUR 1250,50"
    ].join("\n");
    const result = parseInvoiceText(text, { languageHint: "de" });

    expect(result.parsed.invoiceNumber).toBe("DE-443-20");
    expect(result.parsed.vendorName).toBe("Nord GmbH");
    expect(result.parsed.invoiceDate).toBe("2026-02-12");
    expect(result.parsed.dueDate).toBe("2026-02-20");
  });

  it("falls back gracefully when language hint is blank", () => {
    const text = [
      "Invoice Number: INV-901",
      "Vendor: ACME LTD",
      "Grand Total: 10.00"
    ].join("\n");
    const result = parseInvoiceText(text, { languageHint: "   " });

    expect(result.parsed.invoiceNumber).toBe("INV-901");
    expect(result.parsed.vendorName).toBe("ACME LTD");
    expect(result.parsed.totalAmountMinor).toBe(1000);
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

  it("penalises document-type labels like CASH MEMO in vendor scoring", () => {
    const text = [
      "Raju Ram",
      "CASH MEMO",
      "Cell: 9351812576",
      "SHREE RAJARAM MOBILES",
      "Invoice Number: INV-999",
      "Grand Total: 300.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.vendorName).toBe("SHREE RAJARAM MOBILES");
  });

  it("extracts invoice number from standalone No.: label with backward search", () => {
    const text = [
      "SHREE RAJARAM MOBILES",
      "401",
      "Date: 11/10/25",
      "No.:",
      "Grand Total: 300.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBe("401");
  });

  it("extracts invoice number inline from No.: label", () => {
    const text = [
      "SHREE RAJARAM MOBILES",
      "No.: 8812",
      "Grand Total: 300.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceNumber).toBe("8812");
  });

  it("normalises concatenated DDMM/YY date format from OCR", () => {
    const text = [
      "Invoice Number: INV-500",
      "Vendor: ACME LTD",
      "Date: 1110/25",
      "Grand Total: 100.00"
    ].join("\n");
    const result = parseInvoiceText(text);

    expect(result.parsed.invoiceDate).toBe("2025-10-11");
  });

  it("penalises CASH BILL header in vendor scoring", () => {
    const text = ["CASH BILL", "SLNS ENTERPRISES", "Date: 28/01/26", "TOTAL", "210"].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toBe("SLNS ENTERPRISES");
  });

  it("extracts invoice number from bare No. label on separate line", () => {
    const text = ["ACME SUPPLIES", "No.", "317", "Date: 04/02/26", "TOTAL", "3000"].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceNumber).toBe("317");
  });

  it("recognises Dt. as date label abbreviation", () => {
    const text = ["ACME LTD", "Invoice Number: INV-600", "Dt. 15/01/2026", "Grand Total: 100.00"].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceDate).toBe("2026-01-15");
  });

  it("recognises Bill Dt as date label", () => {
    const text = ["DMART", "Bill No : 502001004-001126", "Bill Dt : 17/01/2026", "Grand Total: 355.00"].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceDate).toBe("2026-01-17");
  });

  it("recognises OCR-garbled Do• as date label", () => {
    const text = ["ACME LTD", "Do• 14/02/26", "Grand Total: 100.00"].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceDate).toBe("2026-02-14");
  });

  it("extracts invoice number from Receipt No. label", () => {
    const text = ["VENNELA FILLING STATION", "Receipt No.: A2304", "Date: 06/01/26", "Amount(Rs): 00300.00"].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceNumber).toBe("A2304");
  });

  it("extracts invoice number from Challan No label", () => {
    const text = ["SHRI VISHWARUPA ENTERPRISE", "Challan No : 2950", "DATE:07-01-2026", "TOTAL", "1172.00"].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceNumber).toBe("2950");
  });

  it("extracts all fields from handwritten Indian cash bill (invoice 24)", () => {
    const text = [
      "Mob : 99638 07896", "86861 00661", "CASH BILL", "Mob",
      ": 95502 95186", "62811 78854", "GLASS AND ALUMINIUM",
      "FABRICATION WORKS, DOORS, WINDOWS, PARTITION, GLAZING,",
      "GLASS ETCHING, COLOURING, DESIGNING, GLASS POLISH ETC.",
      "Banjara Hills Road, Tolichowki, Hakeempet, Hyderabad.",
      "No.", "317", "Do• 14/02/26", "M/S.:", "Abhee sta Business",
      "Solution put", "SI.", "No.", "PARTICULARS", "QTY.", "RATE", "AMOUNT",
      "Waiting Bood Gland.", "3,000", "Colous white Di com", "Stas filling",
      "Size 42x30=1", "Bes SFT 290", "Includiy troing and", "Harowave",
      "TOTAL", "3000", "Signature"
    ].join("\n");

    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/GLASS AND ALUMINIUM/i);
    expect(result.parsed.invoiceNumber).toBe("317");
    expect(result.parsed.invoiceDate).toBe("2026-02-14");
    expect(result.parsed.totalAmountMinor).toBe(300000);
  });

  it("extracts vendor and total from simple cash bill with Date: label", () => {
    const text = [
      "ESTIMATION", "Cell : 97059 57879",
      "SRI BALAJI TRADERS",
      "ALL TYPES OF DISPOSABLE ITMES AVAILABLE HERE",
      "Shop No. #2-28, Metro Piller No C-1716, Guttala Begumpet,",
      "Madhapur, Hi-tech City Road, Hyderabed - 500081",
      "M/S", "Date: 15/10/25",
      "S.No.", "PARTICULARS", "QTY.", "AMOUNT", "Rs.", "Ps.",
      "1", "Tissue Paper", "850",
      "TOTAL", "850"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/SRI BALAJI TRADERS/i);
    expect(result.parsed.invoiceDate).toBe("2025-10-15");
    expect(result.parsed.totalAmountMinor).toBe(85000);
  });

  it("extracts fields from formal tax invoice", () => {
    const text = [
      "KARANAM", "TAX INVOICE",
      "Billing Address", "Invoice No : KFS/25-26/1935",
      "M/s. ABHEESTA BUSINESS SOLUTIONS PVT LTD", "Invoice Date : 31/12/2025",
      "8thFloor, Sanali Spazio, Plot19,", "Invoice Month : DEC 2025",
      "Grand Total", "19882.00",
      "KARANAM FACILITY SERVICES PVT LTD"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceNumber).toBe("KFS/25-26/1935");
    expect(result.parsed.invoiceDate).toBe("2025-12-31");
    expect(result.parsed.totalAmountMinor).toBe(1988200);
  });

  it("extracts fields from fuel station receipt", () => {
    const text = [
      "Bharat Petroleum", "Welcomes You",
      "VENNELA FILLING STATION", "MADHAPUR,HYD 500081",
      "Receipt No.: A2304", "Local ID : 00339845",
      "Amount(Rs) : 00300.00",
      "Date : 06/01/26 Time: 16:02"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/VENNELA FILLING STATION/i);
    expect(result.parsed.invoiceNumber).toBe("A2304");
    expect(result.parsed.totalAmountMinor).toBe(30000);
  });

  it("extracts fields from DMart-style bill with Bill Dt label", () => {
    const text = [
      "AVENUE SUPERMARTS LTD", "DMART KAVURI HILLS",
      "PLOT NO:43/P,45,46848", "KAVURI HILLS ROAD MADHAPUR",
      "TAX INVOICE",
      "Bill No : 502001004-001126", "Bill Dt : 17/01/2026",
      "Items: 1", "Qty: 1", "355.00",
      "Grand Total", "355.00"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceNumber).toBe("502001004-001126");
    expect(result.parsed.invoiceDate).toBe("2026-01-17");
    expect(result.parsed.totalAmountMinor).toBe(35500);
  });

  it("extracts fields from delivery challan", () => {
    const text = [
      "Delivery Challan", "SHRI VISHWARUPA ENTERPRISE",
      "1-89/10", "PLOT NO 14 RBI COLONY",
      "KAVURI HILLS PHASE 2", "MADHAPUR",
      "Challan No : 2950", "DATE:17-01-2026",
      "Sr itemname Qty BasicPrice",
      "1 250 Ml Tata Water 2.00 130.00 260.00",
      "Grand Total", "1,172.00"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.invoiceNumber).toBe("2950");
    expect(result.parsed.invoiceDate).toBe("2026-01-17");
    expect(result.parsed.totalAmountMinor).toBe(117200);
  });

  it("extracts fields from computer services invoice", () => {
    const text = [
      "Date:30.01.2026", "INVOICE #",
      "SKS Computers",
      "Plot No 16, KS Residency, DD Nagar,",
      "invoice",
      "S.No DESCRIPTION Qty Price",
      "1 Laptop Format 3 600.00 1800.00",
      "Grand Total 1800.00"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/SKS Computers/i);
    expect(result.parsed.invoiceDate).toBe("2026-01-30");
    expect(result.parsed.totalAmountMinor).toBe(180000);
  });

  it("extracts vendor from CASH BILL invoice when bill is in header", () => {
    const text = [
      "CASH BILL", "Cell: +91 9702416341",
      "SLNS ENTERPRISES",
      "Near Metro Pillar No. 1732, Beside Kotak Mahindra Bank,",
      "Madhapur, Hyderabad-500 081.",
      "No.", "Date: 28/01/26",
      "S.No.", "PARTICULARS", "QTY.", "AMOUNT",
      "TOTAL", "210"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/SLNS ENTERPRISES/i);
    expect(result.parsed.totalAmountMinor).toBe(21000);
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

  it("extracts total from next line when label has no amount", () => {
    const text = ["Total", "500.00"].join("\n");
    expect(extractTotalAmount(text)).toBe(500);
  });

  it("extracts amount from standalone Amount label on next line", () => {
    const text = ["Header", "Amount", "300 -", "Authorised"].join("\n");
    expect(extractTotalAmount(text)).toBe(300);
  });

  it("drops non-finite parsed amounts", () => {
    const huge = "9".repeat(400);
    expect(extractTotalAmount(`Grand Total: ${huge}`)).toBeUndefined();
  });
});

describe("sample invoice regression", () => {
  it("invoice 3: LAKSHMIKALA TRADERS estimation with hardware items", () => {
    const text = [
      "ESTIMATION", "Cell : 86391 09576",
      "LAKSHMIKALA TRADERS",
      "ALL TYPES OF HARDWARE ITEMS",
      "Shop No. 3-14, Tolichowki, Hyderabad - 500008",
      "M/S", "Date: 18/01/26",
      "S.No.", "PARTICULARS", "QTY.", "AMOUNT", "Rs.", "Ps.",
      "1", "Plumbing materials", "29000",
      "TOTAL", "29000"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/LAKSHMIKALA TRADERS/i);
    expect(result.parsed.totalAmountMinor).toBe(2900000);
  });

  it("invoice 4: A. SIVARAM PRASAD with No: 097", () => {
    const text = [
      "A. SIVARAM PRASAD",
      "Civil Contractor",
      "No: 097", "Dt. 15/02/26",
      "Particulars",
      "Civil works at 8th floor",
      "TOTAL", "190000"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/SIVARAM PRASAD/i);
    expect(result.parsed.invoiceNumber).toBe("097");
    expect(result.parsed.totalAmountMinor).toBe(19000000);
  });

  it("invoice 5: SLNS Rubber Stamps cash bill dated 19/11/2025", () => {
    const text = [
      "CASH BILL", "Cell: +91 9702416341",
      "SLNS Rubber Stamps",
      "Near Metro Pillar No. 1732, Beside Kotak Mahindra Bank,",
      "Madhapur, Hyderabad-500 081.",
      "Date: 19/11/2025",
      "S.No.", "PARTICULARS", "QTY.",
      "1", "Rubber stamp making charges", "15000",
      "TOTAL", "15000"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/SLNS Rubber Stamps/i);
    expect(result.parsed.invoiceDate).toBe("2025-11-19");
    expect(result.parsed.totalAmountMinor).toBe(1500000);
  });

  it("invoice 13: LAKSHMIKALA TRADERS second estimation", () => {
    const text = [
      "ESTIMATION", "Cell : 86391 09576",
      "LAKSHMIKALA TRADERS",
      "ALL TYPES OF HARDWARE ITEMS",
      "Shop No. 3-14, Tolichowki, Hyderabad - 500008",
      "M/S", "Dt. 20/01/26",
      "S.No.", "PARTICULARS", "QTY.", "AMOUNT", "Rs.", "Ps.",
      "1", "Hardware supplies", "28000",
      "TOTAL", "28000"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/LAKSHMIKALA TRADERS/i);
    expect(result.parsed.totalAmountMinor).toBe(2800000);
  });

  it("invoice 14: Jay Ramdev Steels Home Appliance", () => {
    const text = [
      "Jay Ramdev Steels Home Appliance",
      "Mob : 90000 12345",
      "Opp Pillar No C-1234, Madhapur",
      "Date: 22/12/25",
      "S.No.", "PARTICULARS",
      "1", "Steel almira", "12000",
      "TOTAL", "12000"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/Jay Ramdev Steels/i);
    expect(result.parsed.totalAmountMinor).toBe(1200000);
  });

  it("invoice 19: Hasti Stationery & Disposable", () => {
    const text = [
      "Hasti Stationery & Disposable",
      "Mob: 98765 43210",
      "Shop No. 45, Market Road, Hyderabad",
      "Date: 25/01/26",
      "S.No.", "PARTICULARS", "QTY.",
      "1", "Office stationery supplies", "40000",
      "TOTAL", "40000"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/Hasti Stationery/i);
    expect(result.parsed.totalAmountMinor).toBe(4000000);
  });

  it("invoice 22: SRI BALAJI TRADERS estimation", () => {
    const text = [
      "ESTIMATION", "Cell : 97059 57879",
      "SRI BALAJI TRADERS",
      "ALL TYPES OF DISPOSABLE ITMES AVAILABLE HERE",
      "Shop No. #2-28, Metro Piller No C-1716, Guttala Begumpet,",
      "Madhapur, Hi-tech City Road, Hyderabed - 500081",
      "M/S", "Date: 31/01/26",
      "S.No.", "PARTICULARS", "QTY.", "AMOUNT", "Rs.", "Ps.",
      "1", "Disposable items bulk", "36000",
      "TOTAL", "36000"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/SRI BALAJI TRADERS/i);
    expect(result.parsed.totalAmountMinor).toBe(3600000);
  });

  it("invoice 23: LAKSHMIKALA TRADERS third estimation", () => {
    const text = [
      "ESTIMATION", "Cell : 86391 09576",
      "LAKSHMIKALA TRADERS",
      "ALL TYPES OF HARDWARE ITEMS",
      "Shop No. 3-14, Tolichowki, Hyderabad - 500008",
      "M/S", "Date: 14/02/26",
      "S.No.", "PARTICULARS", "QTY.", "AMOUNT", "Rs.", "Ps.",
      "1", "Plumbing accessories", "28000",
      "TOTAL", "28000"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/LAKSHMIKALA TRADERS/i);
    expect(result.parsed.totalAmountMinor).toBe(2800000);
  });

  it("invoice 25: SLNS Rubber Stamps large order dated 20/02/2026", () => {
    const text = [
      "CASH BILL", "Cell: +91 9702416341",
      "SLNS Rubber Stamps",
      "Near Metro Pillar No. 1732, Beside Kotak Mahindra Bank,",
      "Madhapur, Hyderabad-500 081.",
      "Date: 20/02/2026",
      "S.No.", "PARTICULARS", "QTY.",
      "1", "Name plates and rubber stamps bulk", "130200",
      "TOTAL", "130200"
    ].join("\n");
    const result = parseInvoiceText(text);
    expect(result.parsed.vendorName).toMatch(/SLNS Rubber Stamps/i);
    expect(result.parsed.invoiceDate).toBe("2026-02-20");
    expect(result.parsed.totalAmountMinor).toBe(13020000);
  });
});
