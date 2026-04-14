interface AmountCandidate {
  amount: number;
  score: number;
  lineIndex: number;
}

const strongTotalPattern =
  /(grand\s*total|amount\s*payable|amount\s*due|total\s*due|invoice\s*total|invoice\s*value|total\s*amount|net\s*payable|net\s*amount\s*payable|total\s*payable|amt\s*due|betrag)/i;
const weakTotalPattern = /\b(total|payable|balance|amount\s*due|amt\s*due|amount)\b/i;
const negativeTotalPattern =
  /(sub\s*total|subtotal|balance\s*due|tax(?:able)?|vat|gst|cgst|sgst|igst|mwst|u\s*st|ust|discount|round(?:ing)?\s*off|shipping|freight|delivery|paid|payment\s*received|advance|credit\s*note)/i;
const amountTokenPattern = /[-+]?(?:\d{1,3}(?:[,\s.]\d{2,3})+|\d+)(?:[.,]\d{1,2})?/g;

export function extractTotalAmount(text: string): number | undefined {
  const lines = splitLines(text);
  if (lines.length === 0) {
    return undefined;
  }

  const labeledCandidates = collectLabeledAmountCandidates(lines);
  if (labeledCandidates.length > 0) {
    return pickBestAmountCandidate(labeledCandidates)?.amount;
  }

  return pickBestFallbackAmount(lines);
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectLabeledAmountCandidates(lines: string[]): AmountCandidate[] {
  const candidates: AmountCandidate[] = [];

  for (const [index, line] of lines.entries()) {
    if (!strongTotalPattern.test(line) && !weakTotalPattern.test(line)) {
      continue;
    }

    const values = extractValuesNearLabeledTotal(lines, index);
    if (values.length === 0) {
      continue;
    }

    const baseScore = scoreLineForLabeledAmount(line, index, lines.length);
    if (baseScore <= 0) {
      continue;
    }

    for (const value of values) {
      candidates.push({
        amount: value,
        score: baseScore + scoreAmountMagnitude(value),
        lineIndex: index
      });
    }
  }

  return candidates;
}

function extractValuesNearLabeledTotal(lines: string[], lineIndex: number): number[] {
  const directValues = extractAmountValuesFromLine(lines[lineIndex]);
  if (directValues.length > 0) {
    return directValues;
  }

  const collected: number[] = [];
  for (let offset = 1; offset <= 3; offset += 1) {
    const nextLine = lines[lineIndex + offset];
    if (!nextLine) {
      break;
    }
    if (offset > 1 && /[A-Za-z]/.test(nextLine) && extractAmountValuesFromLine(nextLine).length === 0) {
      break;
    }
    collected.push(...extractAmountValuesFromLine(nextLine));
  }
  return collected;
}

function pickBestFallbackAmount(lines: string[]): number | undefined {
  const candidates: AmountCandidate[] = [];

  for (const [index, line] of lines.entries()) {
    if (negativeTotalPattern.test(line)) {
      continue;
    }

    const values = extractAmountValuesFromLine(line);
    if (values.length === 0) {
      continue;
    }

    if (!weakTotalPattern.test(line) && !hasMonetaryContext(line, values)) {
      continue;
    }

    const positionBonus = index >= Math.floor(lines.length * 0.6) ? 8 : 0;
    for (const value of values) {
      candidates.push({
        amount: value,
        score: positionBonus + scoreAmountMagnitude(value),
        lineIndex: index
      });
    }
  }

  return pickBestAmountCandidate(candidates)?.amount;
}

function scoreLineForLabeledAmount(line: string, lineIndex: number, totalLines: number): number {
  let score = 0;

  if (strongTotalPattern.test(line)) {
    score += 120;
  } else if (weakTotalPattern.test(line)) {
    score += 55;
  }

  if (negativeTotalPattern.test(line)) {
    score -= 85;
  }

  if (/[€£$₹]|(?:\bUSD\b|\bEUR\b|\bGBP\b|\bINR\b)/i.test(line)) {
    score += 6;
  }

  if (lineIndex >= Math.floor(totalLines * 0.6)) {
    score += 8;
  }

  if (/%/.test(line)) {
    score -= 12;
  }

  return score;
}

function pickBestAmountCandidate(candidates: AmountCandidate[]): AmountCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.amount !== left.amount) {
      return right.amount - left.amount;
    }

    return right.lineIndex - left.lineIndex;
  })[0];
}

function extractAmountValuesFromLine(line: string): number[] {
  const normalized = line.replace(/\u00A0/g, " ").replace(/\s+/g, " ");
  const rawTokens = normalized.match(amountTokenPattern) ?? [];
  const tokens = rawTokens.flatMap(splitConcatenatedAmountToken);

  const values = tokens
    .map((token) => parseAmountToken(token))
    .filter((value): value is number => value !== null)
    .filter((value) => value > 0);

  return values;
}

function splitConcatenatedAmountToken(token: string): string[] {
  const compact = token.replace(/\s+/g, "");

  if (/^\d+\.\d{2}(?:\d+\.\d{2})+$/.test(compact)) {
    return compact.match(/\d+\.\d{2}/g) as string[];
  }

  if (/^\d+,\d{2}(?:\d+,\d{2})+$/.test(compact)) {
    return compact.match(/\d+,\d{2}/g) as string[];
  }

  return [token];
}

export function parseAmountToken(token: string): number | null {
  const raw = token.replace(/[^0-9,.\-+]/g, "");
  const sign = raw.startsWith("-") ? -1 : 1;
  if (raw === "" || raw === "-" || raw === "+") {
    return null;
  }
  let working = raw.replace(/^[-+]/, "");

  const commaCount = (working.match(/,/g) ?? []).length;
  const dotCount = (working.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = working.lastIndexOf(",");
    const lastDot = working.lastIndexOf(".");
    if (lastDot > lastComma) {
      working = working.replace(/,/g, "");
    } else {
      working = working.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (commaCount > 0) {
    const parts = working.split(",");
    const fraction = parts[parts.length - 1];
    if (parts.length > 1 && fraction.length <= 2) {
      working = `${parts.slice(0, -1).join("")}.${fraction}`;
    } else {
      working = parts.join("");
    }
  } else if (dotCount > 1) {
    const parts = working.split(".");
    const fraction = parts[parts.length - 1];
    if (fraction.length <= 2) {
      working = `${parts.slice(0, -1).join("")}.${fraction}`;
    } else {
      working = parts.join("");
    }
  } else if (dotCount === 1) {
    const parts = working.split(".");
    const fraction = parts[1];
    if (fraction.length === 3 && parts[0].length >= 1) {
      working = parts.join("");
    }
  }

  const parsed = Number(working);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Number((sign * parsed).toFixed(2));
}

export function parseAmountTokenWithOcrRepair(token: string): number | null {
  const parsed = parseAmountToken(token);
  if (parsed === null) {
    return null;
  }
  const repaired = recoverOCRLeadingDigitAmount(token, Math.abs(parsed));
  if (repaired === null) {
    return parsed;
  }
  return parsed >= 0 ? repaired : -repaired;
}

function recoverOCRLeadingDigitAmount(token: string, parsedMajor: number): number | null {
  if (!Number.isFinite(parsedMajor) || parsedMajor <= 0 || parsedMajor >= 1_000_000) {
    return null;
  }
  const raw = token.replace(/[^0-9,.\-+]/g, "");
  const fractionPartLength = raw.includes(".") ? raw.split(".").pop()?.length ?? 0 : 0;
  if (fractionPartLength === 0) {
    return null;
  }

  const normalized = Math.abs(parsedMajor).toFixed(2);
  const match = normalized.match(/^(\d+)\.(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, integerPart, fractionPart] = match;
  if (integerPart.length < 5 || integerPart.length > 6 || fractionPart === "00") {
    return null;
  }

  const leadingDigit = integerPart[0];
  if (leadingDigit < "5" || leadingDigit > "9") {
    return null;
  }

  const repairedIntegerPart = integerPart.slice(1);
  if (repairedIntegerPart.length < 3) {
    return null;
  }

  const repairedMajor = Number(`${repairedIntegerPart}.${fractionPart}`);
  if (!Number.isFinite(repairedMajor) || repairedMajor <= 0) {
    return null;
  }

  const ratio = parsedMajor / repairedMajor;
  if (ratio < 5 || ratio > 120) {
    return null;
  }
  if (repairedMajor >= 10000) {
    return null;
  }

  return Number(repairedMajor.toFixed(2));
}

function scoreAmountMagnitude(amount: number): number {
  let score = 0;

  if (!Number.isInteger(amount)) {
    score += 6;
  }

  if (Number.isInteger(amount) && amount >= 1900 && amount <= 2100) {
    score -= 18;
  }

  if (amount >= 1_000_000) {
    score -= 8;
  }

  if (amount >= 10_000) {
    score += 6;
  } else if (amount >= 100) {
    score += 4;
  } else if (amount >= 1) {
    score += 1;
  } else {
    score -= 5;
  }

  return score;
}

function hasMonetaryContext(line: string, values: number[]): boolean {
  if (/[€£$₹]|(?:\bUSD\b|\bEUR\b|\bGBP\b|\bINR\b|\bAUD\b|\bCAD\b|\bJPY\b|\bAED\b|\bSGD\b|\bCHF\b|\bCNY\b)/i.test(line)) {
    return true;
  }

  if (/[.,]\d{1,2}\b/.test(line)) {
    return true;
  }

  return values.some((value) => !Number.isInteger(value));
}
