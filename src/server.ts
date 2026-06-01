import { initTelemetry } from './config/telemetry'
import { buildApp } from './app'
import { env } from './config/env'

async function start() {
  // Initialise OpenTelemetry FIRST so auto-instrumentation can hook into
  // Fastify / postgres / axios before those modules are required by buildApp.
  await initTelemetry()

  const app = await buildApp()

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
  } catch (err) {
    app.log.error(err, 'Failed to start server')
    process.exit(1)
  }
}

void start()
