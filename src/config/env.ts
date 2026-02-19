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
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  // ─── Clerk Authentication ─────────────────────────────────────────────────
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),

  // ─── Cloudflare R2 ────────────────────────────────────────────────────────
  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET_NAME: z.string().min(1, 'R2_BUCKET_NAME is required'),
  R2_PUBLIC_URL: z.string().url('R2_PUBLIC_URL must be a valid URL'),

  // ─── SendGrid ─────────────────────────────────────────────────────────────
  SENDGRID_API_KEY: z.string().min(1, 'SENDGRID_API_KEY is required'),
  SENDGRID_FROM_EMAIL: z.string().email('SENDGRID_FROM_EMAIL must be a valid email'),
  SENDGRID_FROM_NAME: z.string().min(1, 'SENDGRID_FROM_NAME is required'),

  // ─── WhatsApp Business Cloud API ──────────────────────────────────────────
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, 'WHATSAPP_PHONE_NUMBER_ID is required'),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1, 'WHATSAPP_ACCESS_TOKEN is required'),

  // ─── Paystack ─────────────────────────────────────────────────────────────
  PAYSTACK_SECRET_KEY: z.string().min(1, 'PAYSTACK_SECRET_KEY is required'),
  PAYSTACK_PUBLIC_KEY: z.string().min(1, 'PAYSTACK_PUBLIC_KEY is required'),

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
  const errors = parsed.error.flatten().fieldErrors
  for (const [field, messages] of Object.entries(errors)) {
    console.error(`  • ${field}: ${messages?.join(', ')}`)
  }
  console.error('\nFix the issues above in your .env file and restart the server.\n')
  process.exit(1)
}

export const env = parsed.data
