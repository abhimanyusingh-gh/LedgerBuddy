import type {
  InvoiceFieldKey,
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  InvoiceVerifierContract,
  ParsedInvoiceData
} from "@/types/invoice.js";
import { normalizeVerifierFieldProvenance, normalizeVerifierSingleProvenance } from "@/ai/verifiers/VerifierProvenanceNormalizer.js";
import { isRecord } from "@/utils/validation.js";

export function parseVerifierParsedResponse(value: unknown): ParsedInvoiceData | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const parsed: ParsedInvoiceData = {};
  if (typeof source.invoiceNumber === "string" && source.invoiceNumber.trim()) {
    parsed.invoiceNumber = source.invoiceNumber.trim();
  }
  if (typeof source.vendorName === "string" && source.vendorName.trim()) {
    parsed.vendorName = source.vendorName.trim();
  }
  if (typeof source.invoiceDate === "string" && source.invoiceDate.trim()) {
    const d = new Date(source.invoiceDate.trim());
    if (!isNaN(d.getTime())) parsed.invoiceDate = d;
  }
  if (typeof source.dueDate === "string" && source.dueDate.trim()) {
    const d = new Date(source.dueDate.trim());
    if (!isNaN(d.getTime())) parsed.dueDate = d;
  }
  if (typeof source.currency === "string" && source.currency.trim()) {
    parsed.currency = source.currency.trim().toUpperCase();
  }
  if (Number.isInteger(source.totalAmountMinor)) {
    parsed.totalAmountMinor = Number(source.totalAmountMinor);
  }
  if (Array.isArray(source.notes)) {
    const notes = source.notes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    if (notes.length > 0) {
      parsed.notes = notes;
    }
  }

  if (Array.isArray(source.lineItems)) {
    const items = source.lineItems
      .filter((item: unknown): item is Record<string, unknown> =>
        isRecord(item) &&
        typeof item.description === "string" &&
        Number.isInteger(item.amountMinor))
      .map((item: Record<string, unknown>) => ({
        description: String(item.description).trim(),
        amountMinor: Number(item.amountMinor),
        ...(typeof item.hsnSac === "string" && item.hsnSac.trim() ? { hsnSac: item.hsnSac.trim() } : {}),
        ...(typeof item.quantity === "number" && item.quantity > 0 ? { quantity: item.quantity } : {}),
        ...(typeof item.rate === "number" && item.rate > 0 ? { rate: item.rate } : {}),
        ...(typeof item.taxRate === "number" && item.taxRate > 0 ? { taxRate: item.taxRate } : {}),
        ...(Number.isInteger(item.cgstMinor) && Number(item.cgstMinor) > 0 ? { cgstMinor: Number(item.cgstMinor) } : {}),
        ...(Number.isInteger(item.sgstMinor) && Number(item.sgstMinor) > 0 ? { sgstMinor: Number(item.sgstMinor) } : {}),
        ...(Number.isInteger(item.igstMinor) && Number(item.igstMinor) > 0 ? { igstMinor: Number(item.igstMinor) } : {})
      }));
    if (items.length > 0) {
      parsed.lineItems = items;
    }
  }

  if (typeof source.udyamNumber === "string" && source.udyamNumber.trim()) {
    (parsed as Record<string, unknown>).udyamNumber = source.udyamNumber.trim().toUpperCase();
  }

  if (typeof source.pan === "string" && source.pan.trim()) {
    parsed.pan = source.pan.trim().toUpperCase();
  }
  if (typeof source.bankAccountNumber === "string" && source.bankAccountNumber.trim()) {
    parsed.bankAccountNumber = source.bankAccountNumber.trim();
  }
  if (typeof source.bankIfsc === "string" && source.bankIfsc.trim()) {
    parsed.bankIfsc = source.bankIfsc.trim().toUpperCase();
  }

  if (isRecord(source.gst)) {
    const gstSource = source.gst as Record<string, unknown>;
    const gst: Record<string, unknown> = {};
    if (typeof gstSource.gstin === "string" && gstSource.gstin.trim()) {
      gst.gstin = gstSource.gstin.trim();
    }
    for (const field of ["subtotalMinor", "cgstMinor", "sgstMinor", "igstMinor", "cessMinor", "totalTaxMinor"]) {
      if (Number.isInteger(gstSource[field]) && Number(gstSource[field]) > 0) {
        gst[field] = Number(gstSource[field]);
      }
    }
    if (Object.keys(gst).length > 0) {
      parsed.gst = gst as ParsedInvoiceData["gst"];
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function normalizeVerifierContract(value: unknown): InvoiceVerifierContract | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const result: InvoiceVerifierContract = {};
  if (typeof source.file === "string" && source.file.trim()) {
    result.file = source.file.trim();
  }
  if (Number.isInteger(source.lineItemCount) && Number(source.lineItemCount) >= 0) {
    result.lineItemCount = Number(source.lineItemCount);
  }

  const invoiceNumber = normalizeContractScalarString(source.invoiceNumber);
  if (invoiceNumber) result.invoiceNumber = invoiceNumber;
  const vendorNameContains = normalizeContractScalarString(source.vendorNameContains ?? source.vendorName);
  if (vendorNameContains) result.vendorNameContains = vendorNameContains;
  const contractInvoiceDate = normalizeContractScalarString(source.invoiceDate);
  if (contractInvoiceDate) result.invoiceDate = contractInvoiceDate;
  const contractDueDate = normalizeContractScalarString(source.dueDate);
  if (contractDueDate) result.dueDate = contractDueDate;
  const currency = normalizeContractScalarString(source.currency, true);
  result.currency = currency ?? { value: "INR" };
  const totalAmountMinor = normalizeContractScalarInt(source.totalAmountMinor);
  if (totalAmountMinor) result.totalAmountMinor = totalAmountMinor;

  if (Array.isArray(source.lineItems)) {
    const lineItems = source.lineItems
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => {
        const amount = Number(entry.amountMinor);
        if (!Number.isInteger(amount)) {
          return undefined;
        }
        const description = typeof entry.description === "string" && entry.description.trim() ? entry.description.trim() : undefined;
        const provenance = normalizeVerifierSingleProvenance(entry.provenance);
        return {
          ...(description ? { description } : {}),
          amountMinor: amount,
          ...(provenance ? { provenance } : {})
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (lineItems.length > 0) {
      result.lineItems = lineItems;
    }
  }

  if (isRecord(source.gst)) {
    const gstSource = source.gst as Record<string, unknown>;
    const gst: NonNullable<InvoiceVerifierContract["gst"]> = {};
    const cgstMinor = normalizeContractScalarInt(gstSource.cgstMinor);
    if (cgstMinor) gst.cgstMinor = cgstMinor;
    const sgstMinor = normalizeContractScalarInt(gstSource.sgstMinor);
    if (sgstMinor) gst.sgstMinor = sgstMinor;
    const igstMinor = normalizeContractScalarInt(gstSource.igstMinor);
    if (igstMinor) gst.igstMinor = igstMinor;
    const cessMinor = normalizeContractScalarInt(gstSource.cessMinor);
    if (cessMinor) gst.cessMinor = cessMinor;
    const subtotalMinor = normalizeContractScalarInt(gstSource.subtotalMinor);
    if (subtotalMinor) gst.subtotalMinor = subtotalMinor;
    const totalTaxMinor = normalizeContractScalarInt(gstSource.totalTaxMinor);
    if (totalTaxMinor) gst.totalTaxMinor = totalTaxMinor;
    if (Object.keys(gst).length > 0) {
      result.gst = gst;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function parsedFromVerifierContract(contract: InvoiceVerifierContract): ParsedInvoiceData | undefined {
  const parsed: ParsedInvoiceData = {};
  if (contract.invoiceNumber) parsed.invoiceNumber = contract.invoiceNumber.value;
  if (contract.vendorNameContains) parsed.vendorName = contract.vendorNameContains.value;
  if (contract.invoiceDate) {
    const d = new Date(contract.invoiceDate.value);
    if (!isNaN(d.getTime())) parsed.invoiceDate = d;
  }
  if (contract.dueDate) {
    const d = new Date(contract.dueDate.value);
    if (!isNaN(d.getTime())) parsed.dueDate = d;
  }
  parsed.currency = contract.currency?.value ?? "INR";
  if (contract.totalAmountMinor) parsed.totalAmountMinor = contract.totalAmountMinor.value;
  if (contract.lineItems?.length) {
    parsed.lineItems = contract.lineItems
      .map((entry) => ({
        description: entry.description ?? "",
        amountMinor: entry.amountMinor
      }))
      .filter((entry) => entry.description || Number.isInteger(entry.amountMinor));
  }
  if (contract.gst) {
    const gst: Record<string, number> = {};
    if (contract.gst.cgstMinor) gst.cgstMinor = contract.gst.cgstMinor.value;
    if (contract.gst.sgstMinor) gst.sgstMinor = contract.gst.sgstMinor.value;
    if (contract.gst.igstMinor) gst.igstMinor = contract.gst.igstMinor.value;
    if (contract.gst.cessMinor) gst.cessMinor = contract.gst.cessMinor.value;
    if (contract.gst.subtotalMinor) gst.subtotalMinor = contract.gst.subtotalMinor.value;
    if (contract.gst.totalTaxMinor) gst.totalTaxMinor = contract.gst.totalTaxMinor.value;
    if (Object.keys(gst).length > 0) {
      parsed.gst = gst;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function fieldProvenanceFromVerifierContract(
  contract: InvoiceVerifierContract
): Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> | undefined {
  return normalizeVerifierFieldProvenance({
    invoiceNumber: contract.invoiceNumber?.provenance,
    vendorName: contract.vendorNameContains?.provenance,
    invoiceDate: contract.invoiceDate?.provenance,
    dueDate: contract.dueDate?.provenance,
    currency: contract.currency?.provenance,
    totalAmountMinor: contract.totalAmountMinor?.provenance,
    "gst.cgstMinor": contract.gst?.cgstMinor?.provenance,
    "gst.sgstMinor": contract.gst?.sgstMinor?.provenance,
    "gst.igstMinor": contract.gst?.igstMinor?.provenance,
    "gst.cessMinor": contract.gst?.cessMinor?.provenance,
    "gst.subtotalMinor": contract.gst?.subtotalMinor?.provenance,
    "gst.totalTaxMinor": contract.gst?.totalTaxMinor?.provenance
  });
}

export function lineItemProvenanceFromVerifierContract(contract: InvoiceVerifierContract): InvoiceLineItemProvenance[] | undefined {
  if (!Array.isArray(contract.lineItems) || contract.lineItems.length === 0) {
    return undefined;
  }

  const result: InvoiceLineItemProvenance[] = [];
  contract.lineItems.forEach((entry, index) => {
    if (!entry.provenance) {
      return;
    }
    result.push({
      index,
      row: entry.provenance,
      fields: {
        amountMinor: entry.provenance
      }
    });
  });
  return result.length > 0 ? result : undefined;
}

export function normalizeReasonCodes(value: unknown): Partial<Record<InvoiceFieldKey, string>> {
  if (!isRecord(value)) {
    return {};
  }

  const output: Partial<Record<InvoiceFieldKey, string>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      output[key as InvoiceFieldKey] = entry.trim();
    }
  }
  return output;
}

function normalizeContractScalarString(
  value: unknown,
  uppercase = false
): { value: string; provenance?: InvoiceFieldProvenance } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.value !== "string" || !raw.value.trim()) {
    return undefined;
  }
  return {
    value: uppercase ? raw.value.trim().toUpperCase() : raw.value.trim(),
    ...(isRecord(raw.provenance) ? { provenance: raw.provenance as InvoiceFieldProvenance } : {})
  };
}

function normalizeContractScalarInt(
  value: unknown
): { value: number; provenance?: InvoiceFieldProvenance } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (!Number.isInteger(raw.value)) {
    return undefined;
  }
  return {
    value: Number(raw.value),
    ...(isRecord(raw.provenance) ? { provenance: raw.provenance as InvoiceFieldProvenance } : {})
  };
}

