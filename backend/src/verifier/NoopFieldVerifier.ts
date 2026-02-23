import type { FieldVerifier, FieldVerifierInput, FieldVerifierResult } from "../core/interfaces/FieldVerifier.js";

export class NoopFieldVerifier implements FieldVerifier {
  readonly name = "none";

  async verify(input: FieldVerifierInput): Promise<FieldVerifierResult> {
    return {
      parsed: input.parsed,
      issues: [],
      changedFields: []
    };
  }
}
