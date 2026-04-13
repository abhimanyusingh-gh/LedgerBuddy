import type { OcrBlock } from "../../../core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "../../../types/invoice.js";
export { DEFAULT_FIELD_LABEL_PATTERNS } from "./groundingLabels.js";
export { findBlockByAmountValue, extractNumericValueNearColumn, extractAmountValueNearColumn } from "./groundingAmounts.js";
export {
  blockMatchesFieldValue,
  findBlockByLabelProximity,
  findBlockForField,
  findBlockIndexByExactText,
  findPreferredDateValueBlock,
  findVendorBlock
} from "./groundingText.js";

// Keep this module as a compatibility barrel while domain logic lives in focused siblings.
type GroundingBlock = OcrBlock;
type GroundingField = keyof ParsedInvoiceData;
