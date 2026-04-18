let shutdownFn: (() => Promise<void>) | undefined;

const enabled = process.env.OTEL_ENABLED === "true";

if (enabled) {
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

  const exporter = new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318"}/v1/traces`,
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "ledgerbuddy-backend" }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-express": { enabled: true },
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-mongoose": { enabled: true },
      }),
    ],
  });

  sdk.start();
  shutdownFn = () => sdk.shutdown();
}

export async function shutdownTracing(): Promise<void> {
  if (shutdownFn) {
    await shutdownFn();
  }
}
