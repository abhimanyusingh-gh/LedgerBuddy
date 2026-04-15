import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getCorrelationId } from "@/utils/logger.js";

const tracer = trace.getTracer("billforge-ocr");

export function traceOcrExtract<T>(
  provider: string,
  tier: string,
  fn: () => Promise<T>,
  onResult?: (result: T) => { chars: number; blocks: number },
): Promise<T> {
  return tracer.startActiveSpan("ocr.llamaparse.extract", async (span) => {
    const correlationId = getCorrelationId();
    if (correlationId) {
      span.setAttribute("correlation.id", correlationId);
    }
    span.setAttribute("ocr.provider", provider);
    span.setAttribute("ocr.tier", tier);
    try {
      const result = await fn();
      if (onResult) {
        const metrics = onResult(result);
        span.setAttribute("ocr.chars", metrics.chars);
        span.setAttribute("ocr.blocks", metrics.blocks);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function traceExtractRun<T>(fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan("extract.llamaextract.run", async (span) => {
    const correlationId = getCorrelationId();
    if (correlationId) {
      span.setAttribute("correlation.id", correlationId);
    }
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
