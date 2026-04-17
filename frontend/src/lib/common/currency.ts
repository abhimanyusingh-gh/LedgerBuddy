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

function getCurrencyMinorUnitDigits(currency?: string): number {
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

function getCurrencySymbol(currency?: string): string {
  if (!currency) return "";
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency;
}

const DEFAULT_DISPLAY_CURRENCY = "INR";

export function formatMinorAmountWithCurrency(amountMinor?: number, currency?: string): string {
  if (!Number.isInteger(amountMinor)) {
    return "-";
  }

  const effectiveCurrency = currency || DEFAULT_DISPLAY_CURRENCY;
  const symbol = getCurrencySymbol(effectiveCurrency);
  const majorString = minorUnitsToMajorString(amountMinor as number, effectiveCurrency);
  const formatted = effectiveCurrency.toUpperCase() === "INR"
    ? formatIndianNumber(majorString)
    : formatWesternNumber(majorString);
  return symbol ? `${symbol}${formatted}` : formatted;
}

function formatIndianNumber(value: string): string {
  const negative = value.startsWith("-");
  const clean = negative ? value.slice(1) : value;
  const [intPart, decPart] = clean.split(".");
  if (!intPart || intPart.length <= 3) {
    return value;
  }
  const last3 = intPart.slice(-3);
  const remaining = intPart.slice(0, -3);
  const grouped = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const formatted = `${grouped},${last3}${decPart !== undefined ? `.${decPart}` : ""}`;
  return negative ? `-${formatted}` : formatted;
}

function formatWesternNumber(value: string): string {
  const negative = value.startsWith("-");
  const clean = negative ? value.slice(1) : value;
  const [intPart, decPart] = clean.split(".");
  if (!intPart) return value;
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = `${grouped}${decPart !== undefined ? `.${decPart}` : ""}`;
  return negative ? `-${formatted}` : formatted;
}
