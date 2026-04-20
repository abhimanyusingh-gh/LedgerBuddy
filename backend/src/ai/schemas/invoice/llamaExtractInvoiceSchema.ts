export const LLAMA_EXTRACT_INVOICE_SCHEMA = {
  type: "object",
  properties: {
    invoice_number: {
    type: "string",
    description:
      "The unique identifier assigned by the supplier/seller to this invoice. May be labeled 'Invoice No', 'Invoice Number', 'Document No', 'Bill No', 'Ref No', or 'Tax Invoice No'. Extract only the alphanumeric code (e.g. 'AIT/G/524/25-26', 'A3081731'), never the label text.",
  },
  vendor_name: {
    type: "string",
    description:
      "The full legal name of the company or individual who ISSUED (sold/supplied) this invoice — the seller or service provider. Look in sections labeled 'Name of Supplier', 'Supplier', 'From', 'Sold By', or the letterhead. Do NOT return the buyer, recipient, consignee, or 'Bill To' / 'Ship To' party name.",
  },
  vendor_address: {
    type: "string",
    description:
      "The full postal address of the vendor/supplier who issued this invoice. Look in sections labeled 'Supplier Address', 'From', 'Sold By', or near the vendor name in the letterhead. Include street, city, state, PIN/ZIP code, and country if present.",
  },
  invoice_date: {
    type: "string",
    description:
      "The date this invoice was issued, in YYYY-MM-DD format. The label on the document may say 'Dated', 'Invoice Date', 'Date', 'Bill Date', or appear as a column header with the value in an adjacent cell. Extract the actual date value (e.g. '2026-03-26'), never the label text ('Dated', 'Date', etc.).",
  },
  due_date: {
    type: "string",
    description:
      "The payment due date in YYYY-MM-DD format. May be labeled 'Due Date', 'Payment Due', 'Due By', or 'Last Date of Payment'. Extract the actual date value, never the label text.",
  },
  currency: {
    type: "string",
    description:
      "ISO 4217 currency code (e.g. 'INR', 'USD', 'EUR'). Infer from currency symbols (₹=INR, $=USD) or explicit text if no code is present.",
  },
  total_amount: {
    type: "number",
    description:
      "The final grand total amount payable AFTER all taxes are included. Typically labeled 'Total Value Including Tax', 'Grand Total', 'Total Amount Payable', 'Invoice Total', or 'Total (Incl. GST)'. This is the LARGEST amount on the invoice and includes GST/IGST/VAT. Do NOT use the pre-tax subtotal, taxable value, or 'Transaction Value'.",
  },
  subtotal: {
    type: "number",
    description:
      "The pre-tax subtotal — the taxable value before GST or other taxes are added. May be labeled 'Taxable Value', 'Transaction Value', 'Sub Total', 'Net Amount', or 'Assessable Value'. Numeric value only, no currency symbol.",
  },
  cgst_amount: {
    type: "number",
    description:
      "Central GST (CGST) tax amount. Labeled 'CGST' on the invoice. Numeric value only. Leave null/absent if not present (e.g. when IGST applies instead).",
  },
  sgst_amount: {
    type: "number",
    description:
      "State GST (SGST) or Union Territory GST (UTGST/SGST/UTGST) tax amount. Labeled 'SGST', 'UTGST', or 'SGST/UTGST'. Numeric value only. Leave null/absent if not present.",
  },
  igst_amount: {
    type: "number",
    description:
      "Integrated GST (IGST) tax amount for inter-state transactions. Labeled 'IGST'. Numeric value only. Leave null/absent if not present (when CGST+SGST apply instead).",
  },
  cess_amount: {
    type: "number",
    description:
      "GST Cess or compensation cess amount, if present. Labeled 'Cess', 'GST Cess', or 'Compensation Cess'. Numeric value only. Leave null/absent if not applicable.",
  },
  vendor_gstin: {
    type: "string",
    description:
      "The 15-character GST Identification Number of the SUPPLIER/VENDOR (not the buyer). Look in the supplier/seller section labeled 'GSTIN', 'GST No', 'GSTIN/UIN', or similar. Format: 2-digit state code + 10-char PAN + 1 digit + Z + 1 check digit.",
  },
  vendor_pan: {
    type: "string",
    description:
      "The 10-character Permanent Account Number (PAN) of the SUPPLIER/VENDOR. May be labeled 'PAN', 'Company PAN', or \"Company's PAN\". Format: 5 letters + 4 digits + 1 letter (e.g. 'AGIPP2724Q').",
  },
  customer_name: {
    type: "string",
    description:
      "The full legal name of the BUYER/CUSTOMER — the party receiving goods or services. Look in sections labeled 'Bill To', 'Buyer', 'Billed To', 'Ship To', 'Customer Name', 'Consignee', or 'Sold To'. Do NOT return the vendor/supplier name.",
  },
  customer_address: {
    type: "string",
    description:
      "The full postal address of the buyer/customer. Look in sections labeled 'Bill To', 'Buyer Address', 'Ship To', 'Consignee Address', or near the customer name. Include street, city, state, PIN/ZIP code, and country if present.",
  },
  customer_gstin: {
    type: "string",
    description:
      "The 15-character GST Identification Number of the BUYER/CUSTOMER (not the supplier). Look in the buyer/consignee section labeled 'GSTIN', 'GST No', 'GSTIN/UIN of Recipient', or similar. Format: 2-digit state code + 10-char PAN + 1 digit + Z + 1 check digit.",
  },
  line_items: {
    type: "array",
    description:
      "All line items listed in the invoice body table. Each item represents one billable row. Extract every row that has a description and a monetary amount.",
    items: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "The product or service name/description for this line item.",
        },
        hsn_sac: {
          type: "string",
          description: "HSN (Harmonized System of Nomenclature) or SAC (Services Accounting Code) for this line item, if present.",
        },
        quantity: {
          type: "number",
          description: "Quantity or number of units for this line item.",
        },
        rate: {
          type: "number",
          description: "Unit rate or price per unit for this line item.",
        },
        amount: {
          type: "number",
          description: "Total pre-tax amount for this line item (quantity × rate). Numeric value only.",
        },
        tax_rate: {
          type: "number",
          description: "GST or tax rate percentage applied to this line item (e.g. 18 for 18%).",
        },
        cgst: {
          type: "number",
          description: "CGST amount for this line item. Numeric value only.",
        },
        sgst: {
          type: "number",
          description: "SGST/UTGST amount for this line item. Numeric value only.",
        },
        igst: {
          type: "number",
          description: "IGST amount for this line item. Numeric value only.",
        },
      },
    },
  },
  },
};
