import { clampProbability } from "../stages/fieldParsingUtils.js";

interface ScriptLanguageCandidate {
  code: string;
  pattern: RegExp;
}

interface LatinLanguageLexicon {
  code: string;
  keywords: string[];
  phrases: string[];
}

interface LanguageHintKeyword {
  keyword: string;
  code: string;
}

export interface DetectedInvoiceLanguage {
  code: string;
  confidence: number;
  signals: string[];
}

interface PreOcrLanguageInput {
  attachmentName: string;
  sourceKey: string;
  mimeType: string;
  fileBuffer: Buffer;
}

const SCRIPT_LANGUAGE_CANDIDATES: ScriptLanguageCandidate[] = [
  { code: "hi", pattern: /[\u0900-\u097F]/g },
  { code: "ar", pattern: /[\u0600-\u06FF]/g },
  { code: "ru", pattern: /[\u0400-\u04FF]/g },
  { code: "zh", pattern: /[\u4E00-\u9FFF]/g },
  { code: "ja", pattern: /[\u3040-\u30FF]/g },
  { code: "ko", pattern: /[\uAC00-\uD7AF]/g }
];

const LATIN_LEXICONS: LatinLanguageLexicon[] = [
  {
    code: "en",
    keywords: ["invoice", "number", "vendor", "total", "amount", "due", "balance", "bill", "tax"],
    phrases: ["invoice number", "due date", "grand total", "amount payable"]
  },
  {
    code: "fr",
    keywords: ["facture", "numero", "montant", "echeance", "fournisseur", "tva", "reglement", "total"],
    phrases: ["numero de facture", "date de facture", "date d echeance"]
  },
  {
    code: "de",
    keywords: ["rechnung", "rechnungsnummer", "betrag", "gesamt", "lieferant", "mwst", "falligkeit", "datum"],
    phrases: ["rechnungsnummer", "falligkeitsdatum", "zahlbar bis"]
  },
  {
    code: "nl",
    keywords: ["factuur", "factuurnummer", "bedrag", "totaal", "leverancier", "btw", "vervaldatum"],
    phrases: ["factuur nummer", "te betalen voor", "vervaldatum"]
  },
  {
    code: "es",
    keywords: ["factura", "numero", "importe", "vencimiento", "proveedor", "fecha", "iva", "total"],
    phrases: ["numero de factura", "fecha de factura", "fecha de vencimiento"]
  },
  {
    code: "it",
    keywords: ["fattura", "numero", "importo", "scadenza", "fornitore", "data", "iva", "totale"],
    phrases: ["numero fattura", "data fattura", "data di scadenza"]
  },
  {
    code: "pt",
    keywords: ["fatura", "numero", "valor", "vencimento", "fornecedor", "data", "iva", "total"],
    phrases: ["numero da fatura", "data da fatura", "data de vencimento"]
  }
];

const LANGUAGE_HINT_KEYWORDS: LanguageHintKeyword[] = [
  { keyword: "facture", code: "fr" },
  { keyword: "rechn", code: "de" },
  { keyword: "factuur", code: "nl" },
  { keyword: "fattura", code: "it" },
  { keyword: "factura", code: "es" },
  { keyword: "fatura", code: "pt" },
  { keyword: "arabe", code: "ar" },
  { keyword: "arabic", code: "ar" },
  { keyword: "hindi", code: "hi" },
  { keyword: "devanagari", code: "hi" },
  { keyword: "japanese", code: "ja" },
  { keyword: "korean", code: "ko" },
  { keyword: "chinese", code: "zh" }
];

export function detectInvoiceLanguage(textCandidates: string[]): DetectedInvoiceLanguage {
  const compactText = normalizeTextCandidates(textCandidates);
  if (!compactText) {
    return {
      code: "und",
      confidence: 0,
      signals: []
    };
  }

  const scriptCandidate = detectScriptLanguage(compactText);
  if (scriptCandidate) {
    return scriptCandidate;
  }

  return detectLatinLanguage(compactText);
}

export function detectInvoiceLanguageBeforeOcr(input: PreOcrLanguageInput): DetectedInvoiceLanguage {
  const filenameHints = [input.attachmentName, input.sourceKey]
    .map((value) => normalizeHintText(value))
    .filter((value) => value.length > 0);
  const binaryHintText = extractUtf8Probe(input.fileBuffer, input.mimeType);
  const preOcrCandidates = [...filenameHints];
  if (binaryHintText.length > 0) {
    preOcrCandidates.push(binaryHintText);
  }

  const lexicalDetection = detectInvoiceLanguage(preOcrCandidates);
  if (lexicalDetection.code !== "und" && lexicalDetection.confidence >= 0.4) {
    return {
      code: lexicalDetection.code,
      confidence: clampProbability(Math.min(0.82, lexicalDetection.confidence)),
      signals: [...lexicalDetection.signals.slice(0, 4), "pre-ocr"]
    };
  }

  const keywordHint = detectLanguageFromHintKeywords(filenameHints.join(" "));
  if (keywordHint) {
    return {
      code: keywordHint,
      confidence: 0.44,
      signals: ["filename-hint", `hint:${keywordHint}`]
    };
  }

  if (
    lexicalDetection.code === "en" &&
    lexicalDetection.signals.includes("latin-fallback") &&
    binaryHintText.length === 0
  ) {
    return {
      code: "und",
      confidence: 0,
      signals: []
    };
  }

  if (lexicalDetection.code !== "und") {
    return {
      code: lexicalDetection.code,
      confidence: clampProbability(Math.min(0.4, lexicalDetection.confidence)),
      signals: [...lexicalDetection.signals.slice(0, 3), "pre-ocr-low"]
    };
  }

  return lexicalDetection;
}

function normalizeTextCandidates(textCandidates: string[]): string {
  return [...textCandidates]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .sort((left, right) => right.length - left.length)
    .slice(0, 3)
    .join("\n");
}

function detectScriptLanguage(text: string): DetectedInvoiceLanguage | undefined {
  const scored = SCRIPT_LANGUAGE_CANDIDATES.map((candidate) => {
    const hits = text.match(candidate.pattern)?.length ?? 0;
    return {
      code: candidate.code,
      hits
    };
  }).sort((left, right) => right.hits - left.hits);

  const best = scored[0];
  if (!best || best.hits < 6) {
    return undefined;
  }

  const secondHits = scored[1]?.hits ?? 0;
  if (secondHits > 0 && best.hits < secondHits * 1.2) {
    return undefined;
  }

  return {
    code: best.code,
    confidence: clampProbability(0.62 + Math.min(0.35, best.hits / 120)),
    signals: [`script:${best.code}`]
  };
}

function detectLatinLanguage(text: string): DetectedInvoiceLanguage {
  const normalized = normalizeForLatinScoring(text);
  const tokenMatches = normalized.match(/\b[\p{L}\p{N}]{2,}\b/gu) ?? [];
  const tokenCounts = tokenMatches.reduce<Record<string, number>>((accumulator, token) => {
    accumulator[token] = (accumulator[token] ?? 0) + 1;
    return accumulator;
  }, {});

  const scored = LATIN_LEXICONS.map((lexicon) => {
    const keywordScore = lexicon.keywords.reduce((total, keyword) => total + (tokenCounts[keyword] ?? 0), 0);
    const phraseSignals = lexicon.phrases.filter((phrase) => normalized.includes(phrase));
    return {
      code: lexicon.code,
      score: keywordScore + phraseSignals.length * 2,
      keywordScore,
      phraseSignals
    };
  }).sort((left, right) => right.score - left.score);

  const best = scored[0];
  if (!best || best.score === 0) {
    return /[A-Za-z]/.test(text)
      ? {
          code: "en",
          confidence: 0.35,
          signals: ["latin-fallback"]
        }
      : {
          code: "und",
          confidence: 0,
          signals: []
        };
  }

  const secondScore = scored[1]?.score ?? 0;
  const totalTop = best.score + secondScore;
  const dominance = best.score / Math.max(1, totalTop);
  const signalTokens = [
    ...best.phraseSignals,
    ...LATIN_LEXICONS.find((entry) => entry.code === best.code)!.keywords.filter((keyword) => (tokenCounts[keyword] ?? 0) > 0)
  ].slice(0, 4);

  return {
    code: best.code,
    confidence: clampProbability(0.45 + dominance * 0.5),
    signals: signalTokens
  };
}

function normalizeForLatinScoring(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHintText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUtf8Probe(fileBuffer: Buffer, mimeType: string): string {
  if (fileBuffer.length === 0) {
    return "";
  }

  const isLikelyTextDocument = mimeType.startsWith("text/") || mimeType === "application/pdf";
  if (!isLikelyTextDocument) {
    return "";
  }

  const sample = fileBuffer.subarray(0, Math.min(fileBuffer.length, 64 * 1024)).toString("utf8");
  const normalized = sample.replace(/\0/g, "").trim();
  if (!normalized) {
    return "";
  }

  const printableChars = normalized.replace(/[^\p{L}\p{N}\s.,:/\-#@]/gu, "");
  const printableRatio = printableChars.length / normalized.length;
  if (printableRatio < 0.32) {
    return "";
  }

  if (mimeType === "application/pdf") {
    const asciiOnly = normalized.replace(/[^\x20-\x7E]/g, "");
    const asciiRatio = asciiOnly.length / Math.max(1, normalized.length);
    if (asciiRatio < 0.5) {
      return "";
    }
    return asciiOnly.slice(0, 3000);
  }

  return normalized.slice(0, 3000);
}

function detectLanguageFromHintKeywords(text: string): string | undefined {
  const normalized = normalizeHintText(text);
  for (const candidate of LANGUAGE_HINT_KEYWORDS) {
    if (normalized.includes(candidate.keyword)) {
      return candidate.code;
    }
  }
  return undefined;
}

export function resolvePreOcrLanguageHint(
  language: DetectedInvoiceLanguage,
  mimeType: string
): { hint?: string; reason: "detected" | "low-confidence-detected" | "default-en" | "none" } {
  if (language.code !== "und") {
    return {
      hint: language.code,
      reason: shouldUseLanguageHint(language) ? "detected" : "low-confidence-detected"
    };
  }

  if (isDocumentMimeType(mimeType)) {
    return {
      hint: "en",
      reason: "default-en"
    };
  }

  return {
    reason: "none"
  };
}

export function resolveDetectedLanguage(
  preOcrLanguage: DetectedInvoiceLanguage,
  postOcrLanguage: DetectedInvoiceLanguage
): DetectedInvoiceLanguage {
  if (postOcrLanguage.code === "und") {
    return preOcrLanguage;
  }

  if (preOcrLanguage.code === "und") {
    return postOcrLanguage;
  }

  if (postOcrLanguage.code === preOcrLanguage.code) {
    return {
      code: postOcrLanguage.code,
      confidence: clampProbability(Math.max(postOcrLanguage.confidence, preOcrLanguage.confidence)),
      signals: [...new Set([...postOcrLanguage.signals, ...preOcrLanguage.signals].map((s) => s.trim()).filter((s) => s.length > 0))]
    };
  }

  if (postOcrLanguage.confidence >= preOcrLanguage.confidence - 0.12) {
    return postOcrLanguage;
  }

  return preOcrLanguage;
}

function shouldUseLanguageHint(language: DetectedInvoiceLanguage): boolean {
  return language.code !== "und" && language.confidence >= 0.4;
}

function isDocumentMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return normalized.startsWith("image/") || normalized === "application/pdf";
}
