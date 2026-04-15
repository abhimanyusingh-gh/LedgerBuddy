import { PAN_FORMAT, GSTIN_FORMAT, extractPanFromGstin } from "@/constants/indianCompliance.js";
import type { CompliancePanResult, ComplianceRiskSignal } from "@/types/invoice.js";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory.js";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals.js";

interface PanValidationResult {
  pan: CompliancePanResult;
  riskSignals: ComplianceRiskSignal[];
}

export class PanValidationService {
  validate(pan: string | undefined | null, gstin: string | undefined | null): PanValidationResult {
    const riskSignals: ComplianceRiskSignal[] = [];

    if (!pan) {
      if (gstin && GSTIN_FORMAT.test(gstin)) {
        const derivedPan = extractPanFromGstin(gstin);
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
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.PAN_FORMAT_INVALID,
        "compliance",
        "warning",
        `Extracted PAN "${upperPan}" does not match expected format (ABCDE1234F).`,
        4
      ));

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

    const panFromGstin = extractPanFromGstin(gstin);
    const crossRefMatch = panFromGstin === upperPan;

    if (!crossRefMatch) {
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.PAN_GSTIN_MISMATCH,
        "compliance",
        "warning",
        `PAN "${upperPan}" does not match PAN embedded in GSTIN "${gstin}" (expected "${panFromGstin}").`,
        4
      ));

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
