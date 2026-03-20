const CURRENCY_MINOR_UNIT_DIGITS: Record<string, number> = {
  BHD: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  MGA: 0,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0
};

const DEFAULT_MINOR_UNIT_DIGITS = 2;

export function getCurrencyMinorUnitDigits(currency?: string): number {
  if (!currency) {
    return DEFAULT_MINOR_UNIT_DIGITS;
  }

  return CURRENCY_MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? DEFAULT_MINOR_UNIT_DIGITS;
}

export function minorUnitsToMajorString(amountMinor: number, currency?: string): string {
  const digits = getCurrencyMinorUnitDigits(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const absoluteMinor = Math.abs(Math.trunc(amountMinor));

  if (digits === 0) {
    return `${sign}${absoluteMinor}`;
  }

  const factor = 10 ** digits;
  const major = Math.floor(absoluteMinor / factor);
  const fraction = (absoluteMinor % factor).toString().padStart(digits, "0");
  return `${sign}${major}.${fraction}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "\u20B9",
  USD: "$",
  EUR: "\u20AC",
  GBP: "\u00A3",
  JPY: "\u00A5",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF",
  CNY: "\u00A5",
  SGD: "S$",
  AED: "AED",
  SAR: "SAR"
};

export function getCurrencySymbol(currency?: string): string {
  if (!currency) return "";
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency;
}

export function formatMinorAmountWithCurrency(amountMinor?: number, currency?: string): string {
  if (!Number.isInteger(amountMinor)) {
    return "-";
  }

  const symbol = getCurrencySymbol(currency);
  const formatted = minorUnitsToMajorString(amountMinor as number, currency);
  return symbol ? `${symbol}${formatted}` : formatted;
}
