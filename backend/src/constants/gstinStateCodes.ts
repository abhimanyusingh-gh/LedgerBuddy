import { GSTIN_FORMAT } from "@/constants/indianCompliance.js";

const GSTIN_STATE_CODES = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory"
} as const;

type GstinStateCode = keyof typeof GSTIN_STATE_CODES;
type CanonicalStateName = (typeof GSTIN_STATE_CODES)[GstinStateCode];

const CANONICAL_BY_NORMALIZED: Map<string, CanonicalStateName> = new Map(
  (Object.values(GSTIN_STATE_CODES) as CanonicalStateName[]).map((name) => [normalizeStateName(name), name])
);

export function deriveVendorState(gstin?: string | null, addressState?: string | null): CanonicalStateName | null {
  const fromGstin = stateFromGstin(gstin);
  if (fromGstin) {
    return fromGstin;
  }
  return stateFromAddress(addressState);
}

function stateFromGstin(gstin?: string | null): CanonicalStateName | null {
  if (!gstin) {
    return null;
  }
  const trimmed = gstin.trim().toUpperCase();
  if (!GSTIN_FORMAT.test(trimmed)) {
    return null;
  }
  const prefix = trimmed.slice(0, 2);
  return (GSTIN_STATE_CODES as Record<string, CanonicalStateName>)[prefix] ?? null;
}

function stateFromAddress(addressState?: string | null): CanonicalStateName | null {
  if (!addressState) {
    return null;
  }
  const normalized = normalizeStateName(addressState);
  const exact = CANONICAL_BY_NORMALIZED.get(normalized);
  if (exact) {
    return exact;
  }
  const matches: Array<{ candidate: string; canonical: CanonicalStateName }> = [];
  for (const [candidate, canonical] of CANONICAL_BY_NORMALIZED) {
    if (matchesWholeToken(normalized, candidate)) {
      matches.push({ candidate, canonical });
    }
  }
  if (matches.length === 0) {
    return null;
  }
  matches.sort((a, b) => {
    if (b.candidate.length !== a.candidate.length) {
      return b.candidate.length - a.candidate.length;
    }
    return a.canonical.localeCompare(b.canonical);
  });
  return matches[0].canonical;
}

function matchesWholeToken(haystack: string, needle: string): boolean {
  const index = haystack.indexOf(needle);
  if (index < 0) {
    return false;
  }
  const before = index === 0 ? " " : haystack.charAt(index - 1);
  const afterIndex = index + needle.length;
  const after = afterIndex >= haystack.length ? " " : haystack.charAt(afterIndex);
  return !isTokenChar(before) && !isTokenChar(after);
}

function isTokenChar(ch: string): boolean {
  return /[a-z0-9]/.test(ch);
}

function normalizeStateName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/&/g, "and");
}
