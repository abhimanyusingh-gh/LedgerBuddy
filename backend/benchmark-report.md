# BillForge Extraction Benchmark Report

**Date:** 2026-04-03
**Pipeline:** OCR (heuristic parser) + deterministic OCR recovery
**Script:** `backend/check-benchmark.ts`
**Ground truth:** `sample-invoices/ground-truth.json`

---

## Summary

| Metric | Value |
|--------|-------|
| Files tested | 16 |
| Fields checked | 122 |
| Mismatches | 0 |
| Pass rate | 100% |

---

## Fields Covered

The benchmark checks the following fields against ground truth (where defined):

- `invoiceNumber` -- exact match
- `vendorNameContains` -- case-insensitive substring match
- `invoiceDate` -- normalized to YYYY-MM-DD
- `dueDate` -- normalized to YYYY-MM-DD
- `currency` -- exact match (e.g. USD, INR)
- `totalAmountMinor` -- integer minor units (cents/paise)
- `lineItemAmountsMinor` -- sorted array of line item amounts in minor units
- `gst.subtotalMinor` -- subtotal before tax
- `gst.cgstMinor` -- Central GST
- `gst.sgstMinor` -- State GST
- `gst.igstMinor` -- Integrated GST
- `gst.totalTaxMinor` -- total tax amount

---

## Per-File Results

| # | File | Vendor | Currency | OCR Data | Fields Checked | Status |
|---|------|--------|----------|----------|----------------|--------|
| 1 | 1-Claud-26-02-Abhi.pdf | Anthropic | USD | Yes | 7 | PASS |
| 2 | 10-Claud-04-03-Abhi.pdf | Anthropic | USD | Yes | 7 | PASS |
| 3 | 11-Claud-Sai-05-03.pdf | Anthropic | USD | Yes | 9 | PASS |
| 4 | 13-mailchimp-receipt-MC23316509.pdf | Mailchimp | INR | Yes | 6 | PASS |
| 5 | 15-Fillout.pdf | Fillout | USD | Yes | 7 | PASS |
| 6 | 18-Calendly.pdf | Calendly | USD | Yes | 6 | PASS |
| 7 | 26-Invoice-LP6XQHGY-0011.pdf | Cursor | USD | Yes | 9 | PASS |
| 8 | 28-Invoice-BGPWKKCA-0005.pdf | Cursor | USD | Yes | 9 | PASS |
| 9 | 3-Cloudflare.pdf | Cloudflare | USD | Yes | 7 | PASS |
| 10 | 31-Invoice-NWSEPPTE-0002.pdf | Anthropic | USD | Yes | 9 | PASS |
| 11 | 33-Invoice-MULJRLNR-0006.pdf | Anthropic | USD | Yes | 9 | PASS |
| 12 | 38-Cloudflare.pdf | Cloudflare | USD | Yes | 7 | PASS |
| 13 | 41-BOOKING_INVOICE_M06AI26I23851611.pdf | MAKEMYTRIP | INR | Yes | 7 | PASS |
| 14 | 42-Trips_Hotel_DownloadETicket (6).pdf | MAKEMYTRIP | INR | Yes | 5 | PASS |
| 15 | 7-Chat GPT.pdf | OpenAI | INR | Yes | 7 | PASS |
| 16 | INV-FY2526-939.pdf | Sprinto | INR | Yes | 11 | PASS |

---

## GST Coverage

Five invoices include GST ground-truth assertions:

| File | subtotal | CGST | SGST | IGST | Total Tax |
|------|----------|------|------|------|-----------|
| 11-Claud-Sai-05-03.pdf | 8982 | -- | -- | -- | 1617 |
| 26-Invoice-LP6XQHGY-0011.pdf | 4001 | -- | -- | -- | 720 |
| 28-Invoice-BGPWKKCA-0005.pdf | 2000 | -- | -- | -- | 360 |
| 31-Invoice-NWSEPPTE-0002.pdf | 2000 | -- | -- | -- | 360 |
| 33-Invoice-MULJRLNR-0006.pdf | 2000 | -- | -- | -- | 360 |
| 41-BOOKING_INVOICE_M06AI26I23851611.pdf | -- | -- | -- | 3051 | 3051 |
| INV-FY2526-939.pdf | 9450000 | 850500 | 850500 | -- | 1701000 |

All values in minor units (cents/paise).

---

## Missing OCR Data

None. All 16 ground-truth files have corresponding OCR raw JSON in `.local-run/benchmark/ocr-raw/`.

---

## Notes

- The benchmark runs the deterministic heuristic parser (`parseInvoiceText`) followed by OCR block recovery (`recoverParsedFromOcr`). It does not invoke the SLM.
- Vendor matching uses case-insensitive substring (`vendorNameContains`), not exact equality.
- Line item amounts are compared as sorted arrays to allow order-independent matching.
- Date fields are normalized to ISO 8601 (YYYY-MM-DD) before comparison.
