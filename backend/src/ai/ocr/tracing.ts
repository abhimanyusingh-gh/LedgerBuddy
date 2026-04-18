import { traceSpan } from "@/utils/traceSpan.js";

const TRACER = "ledgerbuddy-ocr";

export function traceOcrExtract<T>(
  provider: string,
  tier: string,
  fn: () => Promise<T>,
  onResult?: (result: T) => { chars: number; blocks: number },
): Promise<T> {
  return traceSpan(
    {
      tracerName: TRACER,
      spanName: "ocr.llamaparse.extract",
      attributes: { "ocr.provider": provider, "ocr.tier": tier },
      onSuccess: onResult
        ? (result) => {
            const metrics = onResult(result as T);
            return { "ocr.chars": metrics.chars, "ocr.blocks": metrics.blocks };
          }
        : undefined,
    },
    fn,
  );
}

export function traceExtractRun<T>(fn: () => Promise<T>): Promise<T> {
  return traceSpan(
    {
      tracerName: TRACER,
      spanName: "extract.llamaextract.run",
    },
    fn,
  );
}
