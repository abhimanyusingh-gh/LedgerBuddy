import type { CompliancePanResult, ComplianceRiskSignal } from "@/types/invoice.js";

const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

interface PanValidationResult {
  pan: CompliancePanResult;
  riskSignals: ComplianceRiskSignal[];
}

export class PanValidationService {
  validate(pan: string | undefined | null, gstin: string | undefined | null): PanValidationResult {
    const riskSignals: ComplianceRiskSignal[] = [];

    if (!pan) {
      if (gstin && GSTIN_FORMAT.test(gstin)) {
        const derivedPan = gstin.substring(2, 12);
        if (PAN_FORMAT.test(derivedPan)) {
          return {
            pan: {
              value: derivedPan,
              source: "vendor-master",
              validationLevel: "L2",
              validationResult: "valid",
              gstinCrossRef: true
            },
            riskSignals
          };
        }
      }

      return {
        pan: {
          value: null,
          source: "extracted",
          validationLevel: null,
          validationResult: null,
          gstinCrossRef: false
        },
        riskSignals
      };
    }

    const upperPan = pan.toUpperCase();
    const formatValid = PAN_FORMAT.test(upperPan);

    if (!formatValid) {
      riskSignals.push({
        code: "PAN_FORMAT_INVALID",
        category: "compliance",
        severity: "warning",
        message: `Extracted PAN "${upperPan}" does not match expected format (ABCDE1234F).`,
        confidencePenalty: 4,
        status: "open",
        resolvedBy: null,
        resolvedAt: null
      });

      return {
        pan: {
          value: upperPan,
          source: "extracted",
          validationLevel: "L1",
          validationResult: "format-invalid",
          gstinCrossRef: false
        },
        riskSignals
      };
    }

    if (!gstin || !GSTIN_FORMAT.test(gstin)) {
      return {
        pan: {
          value: upperPan,
          source: "extracted",
          validationLevel: "L1",
          validationResult: "valid",
          gstinCrossRef: false
        },
        riskSignals
      };
    }

    const panFromGstin = gstin.substring(2, 12);
    const crossRefMatch = panFromGstin === upperPan;

    if (!crossRefMatch) {
      riskSignals.push({
        code: "PAN_GSTIN_MISMATCH",
        category: "compliance",
        severity: "warning",
        message: `PAN "${upperPan}" does not match PAN embedded in GSTIN "${gstin}" (expected "${panFromGstin}").`,
        confidencePenalty: 4,
        status: "open",
        resolvedBy: null,
        resolvedAt: null
      });

      return {
        pan: {
          value: upperPan,
          source: "extracted",
          validationLevel: "L2",
          validationResult: "gstin-mismatch",
          gstinCrossRef: true
        },
        riskSignals
      };
    }

    return {
      pan: {
        value: upperPan,
        source: "extracted",
        validationLevel: "L2",
        validationResult: "valid",
        gstinCrossRef: true
      },
      riskSignals
    };
  }
}
