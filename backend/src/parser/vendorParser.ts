const baseVendorPrefixes = ["vendor", "supplier", "sold\\s*by", "bill\\s*from", "from", "company", "merchant", "hotel\\s*details"];
const vendorRefinementPattern = /^(?:vendor|supplier|sold\s*by|bill\s*from|from|company|merchant|fournisseur|vendeur|soci[ée]t[ée]|lieferant|anbieter|firma|leverancier|verkoper|bedrijf|proveedor|empresa|vendedor|fornitore|azienda|venditore)\s*[:\-]?\s*/i;
const legalEntityPattern =
  /\b(ltd|limited|pvt|private|llc|inc|corp|corporation|gmbh|s\.?a\.?r\.?l\.?|plc|pte|company|co\.?)\b/i;
const genericVendorStopPattern =
  /\b(facture|factuur|invoice|receipt|payment|statement|description|charges|summary|account|customer|memo|quotation|bill)\b/i;
const blockedVendorPrefixPattern =
  /^(guest\s*name|billing\s*address|shipping\s*address|warehouse\s*address|order\s*id|order\s*date|booking\s*id|payment\s*mode|invoice\s*date|due\s*date|date)\b/i;
const addressSignalPattern =
  /\b(address|warehouse|village|road|street|st\.|avenue|ave\.|taluk|district|state|country|india|karnataka|hobli|zip|zipcode|postal|pin|near)\b/i;
const nonVendorSignalPattern =
  /\b(invoice|bill|date|total|tax|amount|qty|quantity|gst|vat|phone|email|mobile|bank|ifsc|swift|branch|guest|customer|booking|description|payment|receipt)\b/i;

export const VENDOR_ADDRESS_SIGNAL_PATTERN = addressSignalPattern;
export const VENDOR_NON_VENDOR_SIGNAL_PATTERN = nonVendorSignalPattern;

export function resolveVendorName(text: string, explicitPattern: RegExp): string | undefined {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2);

  const explicit = extractExplicitVendor(lines, explicitPattern);
  if (explicit) {
    return explicit;
  }

  const hotelCandidate = extractHotelVendor(lines);
  if (hotelCandidate) {
    return hotelCandidate;
  }

  return pickLikelyVendorLine(lines);
}

function extractExplicitVendor(lines: string[], explicitPattern: RegExp): string | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(explicitPattern);
    if (!match) {
      continue;
    }

    const candidate = sanitizeVendorCandidate(match[2], { allowSingleWord: true });
    if (candidate) {
      return candidate;
    }

    const nextLine = lines[index + 1];
    if (!nextLine) {
      continue;
    }

    const nextCandidate = sanitizeVendorCandidate(nextLine, { allowSingleWord: true });
    if (nextCandidate) {
      return nextCandidate;
    }
  }

  return undefined;
}

function extractHotelVendor(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 20)) {
    const match = line.match(/hotel\s*details\s*[:\-]?\s*([A-Za-z0-9&'().\-\s]{2,})/i);
    if (!match?.[1]) {
      continue;
    }

    const normalized = match[1].split(",")[0].trim();
    const brandToken = normalized.match(/([A-Za-z][A-Za-z0-9&'().-]{1,})/)?.[1];
    if (!brandToken) {
      continue;
    }

    const candidate = sanitizeVendorCandidate(brandToken, { allowSingleWord: true });
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function pickLikelyVendorLine(lines: string[]): string | undefined {
  const scopedLines = lines.slice(0, 18);

  let bestCandidate: { value: string; score: number } | null = null;

  for (const [index, rawLine] of scopedLines.entries()) {
    const candidate = sanitizeVendorCandidate(rawLine, { relaxed: true });
    if (!candidate) {
      continue;
    }

    let score = 0;
    if (index <= 3) {
      score += 28;
    } else if (index <= 8) {
      score += 16;
    } else {
      score += 6;
    }

    if (legalEntityPattern.test(candidate)) {
      score += 20;
    }

    if (/^[A-Z0-9&.,'()/\-\s]+$/.test(candidate)) {
      score += 8;
    }

    const wordCount = candidate.split(/\s+/).length;
    if (wordCount >= 2 && wordCount <= 8) {
      score += 8;
    } else if (wordCount === 1) {
      score -= 10;
    }

    if (candidate.includes(",")) {
      score -= 6;
    }

    const digitCount = (candidate.match(/\d/g) ?? []).length;
    if (digitCount > 4) {
      score -= 20;
    } else if (digitCount > 0) {
      score -= 8;
    }

    if (candidate.length > 72) {
      score -= 14;
    }

    if (genericVendorStopPattern.test(candidate)) {
      score -= 28;
    }

    if (candidate.includes(":")) {
      score -= 20;
    }

    if (bestCandidate === null || score > bestCandidate.score) {
      bestCandidate = { value: candidate, score };
    }
  }

  if (!bestCandidate || bestCandidate.score < 0) {
    return undefined;
  }

  return bestCandidate.value;
}

function sanitizeVendorCandidate(rawValue: string, options?: { allowSingleWord?: boolean; relaxed?: boolean }): string | undefined {
  const normalized = rawValue
    .replace(vendorRefinementPattern, "")
    .replace(/^[^:]+:\s*/g, (prefix) => (blockedVendorPrefixPattern.test(prefix) ? "" : prefix))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[#*|`]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[,:;.\-–|]+$/, "")
    .trim();

  if (normalized.length < 3) {
    return undefined;
  }

  if (blockedVendorPrefixPattern.test(normalized)) {
    return undefined;
  }

  if (!options?.relaxed) {
    if (addressSignalPattern.test(normalized)) {
      return undefined;
    }

    if (nonVendorSignalPattern.test(normalized)) {
      return undefined;
    }

    if (genericVendorStopPattern.test(normalized) && !legalEntityPattern.test(normalized)) {
      return undefined;
    }
  }

  if (normalized.split(",").length > 3) {
    return undefined;
  }

  if (normalized.length > 80) {
    return undefined;
  }

  if (!options?.allowSingleWord && normalized.split(/\s+/).length === 1 && !legalEntityPattern.test(normalized)) {
    return undefined;
  }

  return normalized;
}

export function buildExplicitVendorLinePattern(
  languageHint: string | undefined,
  languageVendorPrefixes: string[]
): RegExp {
  const prefixes = [...new Set([...baseVendorPrefixes, ...languageVendorPrefixes])];
  const pattern = prefixes.join("|");
  return new RegExp(`^(${pattern})\\s*[:\\-]?\\s*(.*)$`, "i");
}
