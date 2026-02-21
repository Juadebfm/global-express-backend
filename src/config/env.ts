import { config } from 'dotenv'
import { z } from 'zod'

// Load .env before anything else — must happen synchronously at startup
config({ path: '.env' })

const envSchema = z.object({
  // ─── App ──────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
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
  // Comma-separated IP addresses allowed on admin routes
  ADMIN_IP_WHITELIST: z.string().min(1, 'ADMIN_IP_WHITELIST is required'),
  // Comma-separated allowed CORS origins
  CORS_ORIGINS: z.string().min(1, 'CORS_ORIGINS is required'),
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
