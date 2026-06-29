import { config } from 'dotenv'
import { z } from 'zod'

// Load .env before anything else — must happen synchronously at startup
config({ path: '.env' })

const envSchema = z.object({
  // ─── App ──────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // ─── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: z.url({ message: 'DATABASE_URL must be a valid URL' }),

  // ─── Clerk Authentication ─────────────────────────────────────────────────
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),

  // ─── Cloudflare R2 ────────────────────────────────────────────────────────
  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET_NAME: z.string().min(1, 'R2_BUCKET_NAME is required'),
  R2_PUBLIC_URL: z.url({ message: 'R2_PUBLIC_URL must be a valid URL' }),

  // ─── Resend ───────────────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  RESEND_FROM_EMAIL: z.email({ message: 'RESEND_FROM_EMAIL must be a valid email' }),
  RESEND_FROM_NAME: z.string().min(1, 'RESEND_FROM_NAME is required'),
  // Publicly accessible logo URL used in transactional email headers.
  // Defaults to the R2-hosted brand asset — override only if the logo moves.
  EMAIL_LOGO_URL: z.url().optional(),

  // ─── Termii SMS / WhatsApp (optional) ────────────────────────────────────
  TERMII_API_KEY: z.string().optional(),
  // Alphanumeric sender ID (max 11 chars). Defaults to "talert" on trial.
  TERMII_SENDER_ID: z.string().optional(),
  // Set to "whatsapp" to send via WhatsApp (requires Termii WhatsApp registration)
  // Leave blank to default to SMS
  TERMII_CHANNEL: z.enum(['generic', 'dnd', 'whatsapp']).optional(),

  // ─── Paystack ─────────────────────────────────────────────────────────────
  PAYSTACK_SECRET_KEY: z.string().min(1, 'PAYSTACK_SECRET_KEY is required'),
  PAYSTACK_PUBLIC_KEY: z.string().min(1, 'PAYSTACK_PUBLIC_KEY is required'),

  // ─── Clerk Webhook ────────────────────────────────────────────────────────
  // Signing secret from Clerk Dashboard → Webhooks.
  // Optional — if not set the /webhooks/clerk endpoint returns 503.
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  // ─── Internal JWT (staff / admin / superadmin) ───────────────────────────
  // Secret for signing internal JWTs — must be at least 32 chars (use a 64-char hex string)
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Token expiry for internal sessions — e.g. "8h", "1d"
  JWT_EXPIRES_IN: z.string().default('8h'),

  // ─── Security ─────────────────────────────────────────────────────────────
  // 64-char hex string = 32 bytes for AES-256
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)'),
  // Comma-separated allowed CORS origins
  CORS_ORIGINS: z.string().min(1, 'CORS_ORIGINS is required'),

  // Optional: comma-separated list of IPs/CIDRs allowed to reach admin/internal-auth endpoints.
  // Leave blank/unset to disable IP filtering (development default).
  ADMIN_IP_WHITELIST: z.string().optional(),

  // ─── Web Push (VAPID) ────────────────────────────────────────────────────
  // Generated via: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(), // e.g. "mailto:admin@globalexpress.kr"

  // ─── OpenTelemetry (optional) ────────────────────────────────────────────
  // Setting OTEL_EXPORTER_OTLP_ENDPOINT enables tracing instrumentation.
  // Typical values: "http://localhost:4318/v1/traces" (local Tempo/Jaeger)
  // or a hosted endpoint like Honeycomb / Grafana Cloud.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),

  // ─── VirusTotal AV scanning (optional) ───────────────────────────────────
  // Setting VIRUSTOTAL_API_KEY enables malware scanning of every uploaded file
  // (receipts, claim proofs, gallery media, package photos, CSV imports).
  // Get a free key: https://www.virustotal.com/gui/my-apikey
  //
  // Status rolls through pending → clean | malicious | error in `file_scans`.
  // Without a key, the upload still succeeds; rows are marked `skipped`. In
  // production, the staff UI MUST gate file access on status='clean'.
  VIRUSTOTAL_API_KEY: z.string().optional(),

  // ─── Cloudflare Turnstile CAPTCHA (optional) ─────────────────────────────
  // Setting TURNSTILE_SECRET_KEY enables CAPTCHA on public mutation endpoints
  // (newsletter, D2D intake, gallery claims). The FE sends the token in the
  // `cf-turnstile-response` header. Get a key:
  //   https://dash.cloudflare.com/?to=/:account/turnstile
  //
  // In dev, leave unset for a bypass — set TURNSTILE_REQUIRE=true to force
  // enforcement even without a key (will reject everything).
  TURNSTILE_SECRET_KEY: z.string().optional(),
  TURNSTILE_REQUIRE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('\n❌  Invalid or missing environment variables:\n')
  const errors = parsed.error.flatten((i) => i.message).fieldErrors
  for (const [field, messages] of Object.entries(errors)) {
    console.error(`  • ${field}: ${messages?.join(', ')}`)
  }
  console.error('\nFix the issues above in your .env file and restart the server.\n')
  process.exit(1)
}

export const env = parsed.data
