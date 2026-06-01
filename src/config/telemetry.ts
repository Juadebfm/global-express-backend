/**
 * OpenTelemetry SDK bootstrap. Env-gated: nothing initializes unless
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set (or `OTEL_ENABLED=true`).
 *
 * Tracing instrumentation auto-wires Fastify, postgres, axios, and others via
 * @opentelemetry/auto-instrumentations-node. Spans are exported via OTLP HTTP.
 *
 * Imported from server.ts BEFORE the app is built so instrumentation can hook
 * into the relevant libraries on first require.
 */
import { env } from './env'

const ENABLED = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT)

export async function initTelemetry(): Promise<void> {
  if (!ENABLED) return

  // Dynamic import keeps the OTel modules out of the require graph when disabled,
  // avoiding ~30MB of cold-start overhead in environments that don't use it.
  const { NodeSDK } = await import('@opentelemetry/sdk-node')
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
  const { getNodeAutoInstrumentations } = await import(
    '@opentelemetry/auto-instrumentations-node'
  )

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? 'global-express-backend',
    traceExporter: new OTLPTraceExporter({
      url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  })

  sdk.start()

  const shutdown = (): void => {
    sdk
      .shutdown()
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('OpenTelemetry shutdown error', err)
      })
      .finally(() => process.exit(0))
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // eslint-disable-next-line no-console
  console.log(
    `[otel] tracing enabled — exporter: ${env.OTEL_EXPORTER_OTLP_ENDPOINT}, service: ${env.OTEL_SERVICE_NAME ?? 'global-express-backend'}`,
  )
}
