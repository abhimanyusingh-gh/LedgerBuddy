export const currencyBySymbol: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR"
};

const currencyPatterns = [
  /\b(USD|EUR|GBP|INR|AUD|CAD|JPY|AED|SGD|CHF|CNY)\b/i,
  /([$€£₹])/g
];

export function extractCurrency(text: string): string | undefined {
  const codeMatch = text.match(currencyPatterns[0]);
  if (codeMatch?.[1]) {
    return codeMatch[1].toUpperCase();
  }

  if (/\b(gstin|cgst|sgst|igst)\b/i.test(text)) {
    return "INR";
  }

  if (/\bRs\.?\b/i.test(text)) {
    return "INR";
  }

  const symbolMatch = text.match(currencyPatterns[1]);
  if (!symbolMatch?.[0]) {
    return undefined;
  }

  return currencyBySymbol[symbolMatch[0]];
}
