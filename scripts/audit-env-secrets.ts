/**
 * Audits .env (or process.env) for the secret-hygiene rules in
 * SECURITY_CHECKLIST.md (ASVS V2.5.1, V2.5.4). Run before every deploy:
 *
 *   npx tsx scripts/audit-env-secrets.ts          # audit local .env
 *   npx tsx scripts/audit-env-secrets.ts --prod   # apply stricter prod rules
 *
 * Checks performed:
 *   - Required secrets are present and non-empty
 *   - Known placeholder/sample/default values are not used
 *   - ENCRYPTION_KEY is a 64-char hex string (32 bytes)
 *   - JWT_SECRET is ≥ 32 chars and not a repeating pattern
 *   - PAYSTACK keys use the expected env prefix
 *   - CLERK keys use the expected env prefix
 *   - --prod: rejects test/dev keys
 *
 * Exit code: 0 if all pass, 1 if any issue. Suitable for CI gating.
 */
import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { existsSync } from 'fs'
import { resolve } from 'path'

config({ path: '.env' })

interface Issue {
  level: 'error' | 'warning'
  variable: string
  message: string
}

const issues: Issue[] = []
const isProd = process.argv.includes('--prod')

const PLACEHOLDER_PATTERNS = [
  /^placeholder$/i,
  /^your_/i,
  /^changeme$/i,
  /^change[-_ ]me$/i,
  /^secret$/i,
  /^test$/i,
  /^example/i,
  /^xxx+$/i,
  /^aaaa+$/i,
  /^(?:0|1){32,}$/, // long string of single character
  /^(.)\1{15,}$/, // any 16+ repeated character (catches `aaa...`, `XXX...`)
]

function require_(name: string, value: string | undefined): string | null {
  if (!value || value.trim() === '') {
    issues.push({ level: 'error', variable: name, message: 'required but missing' })
    return null
  }
  return value
}

function rejectPlaceholder(name: string, value: string): void {
  for (const pat of PLACEHOLDER_PATTERNS) {
    if (pat.test(value)) {
      issues.push({
        level: 'error',
        variable: name,
        message: `looks like a placeholder/default value ("${value.slice(0, 24)}…")`,
      })
      return
    }
  }
}

function checkHex(name: string, value: string, expectedLength: number): void {
  if (value.length !== expectedLength) {
    issues.push({
      level: 'error',
      variable: name,
      message: `must be exactly ${expectedLength} hex chars (got ${value.length})`,
    })
  }
  if (!/^[0-9a-fA-F]+$/.test(value)) {
    issues.push({
      level: 'error',
      variable: name,
      message: 'must contain only hex characters',
    })
  }
}

function checkMinLength(name: string, value: string, min: number): void {
  if (value.length < min) {
    issues.push({
      level: 'error',
      variable: name,
      message: `must be ≥ ${min} chars (got ${value.length})`,
    })
  }
}

function checkPrefix(name: string, value: string, allowed: string[], hint?: string): void {
  if (!allowed.some((p) => value.startsWith(p))) {
    issues.push({
      level: 'warning',
      variable: name,
      message: `unexpected prefix${hint ? ` — ${hint}` : ''} (got "${value.slice(0, 10)}…")`,
    })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Encryption key — 32-byte hex
const encryptionKey = require_('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY)
if (encryptionKey) {
  rejectPlaceholder('ENCRYPTION_KEY', encryptionKey)
  checkHex('ENCRYPTION_KEY', encryptionKey, 64)
}

// JWT secret — ≥ 32 chars
const jwtSecret = require_('JWT_SECRET', process.env.JWT_SECRET)
if (jwtSecret) {
  rejectPlaceholder('JWT_SECRET', jwtSecret)
  checkMinLength('JWT_SECRET', jwtSecret, 32)
}

// Paystack
const paystackSecret = require_('PAYSTACK_SECRET_KEY', process.env.PAYSTACK_SECRET_KEY)
if (paystackSecret) {
  rejectPlaceholder('PAYSTACK_SECRET_KEY', paystackSecret)
  checkPrefix('PAYSTACK_SECRET_KEY', paystackSecret, ['sk_live_', 'sk_test_'])
  if (isProd && paystackSecret.startsWith('sk_test_')) {
    issues.push({
      level: 'error',
      variable: 'PAYSTACK_SECRET_KEY',
      message: 'production environment must NOT use a test key (sk_test_*)',
    })
  }
}

const paystackPub = require_('PAYSTACK_PUBLIC_KEY', process.env.PAYSTACK_PUBLIC_KEY)
if (paystackPub) {
  rejectPlaceholder('PAYSTACK_PUBLIC_KEY', paystackPub)
  checkPrefix('PAYSTACK_PUBLIC_KEY', paystackPub, ['pk_live_', 'pk_test_'])
}

// Clerk
const clerkSecret = require_('CLERK_SECRET_KEY', process.env.CLERK_SECRET_KEY)
if (clerkSecret) {
  rejectPlaceholder('CLERK_SECRET_KEY', clerkSecret)
  checkPrefix('CLERK_SECRET_KEY', clerkSecret, ['sk_live_', 'sk_test_'])
  if (isProd && clerkSecret.startsWith('sk_test_')) {
    issues.push({
      level: 'error',
      variable: 'CLERK_SECRET_KEY',
      message: 'production environment must NOT use a test key (sk_test_*)',
    })
  }
}

// DB URL
const dbUrl = require_('DATABASE_URL', process.env.DATABASE_URL)
if (dbUrl) {
  rejectPlaceholder('DATABASE_URL', dbUrl)
  if (isProd && /localhost|127\.0\.0\.1/.test(dbUrl)) {
    issues.push({
      level: 'error',
      variable: 'DATABASE_URL',
      message: 'production environment must NOT point at localhost',
    })
  }
  if (isProd && /password=password|:password@/i.test(dbUrl)) {
    issues.push({
      level: 'error',
      variable: 'DATABASE_URL',
      message: 'production environment must NOT use the default password',
    })
  }
}

// R2
const r2AccountId = require_('R2_ACCOUNT_ID', process.env.R2_ACCOUNT_ID)
if (r2AccountId) rejectPlaceholder('R2_ACCOUNT_ID', r2AccountId)
const r2AccessKey = require_('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID)
if (r2AccessKey) rejectPlaceholder('R2_ACCESS_KEY_ID', r2AccessKey)
const r2SecretKey = require_('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY)
if (r2SecretKey) rejectPlaceholder('R2_SECRET_ACCESS_KEY', r2SecretKey)

// CORS — should not be wildcard
const corsOrigins = process.env.CORS_ORIGINS
if (corsOrigins && corsOrigins.includes('*')) {
  issues.push({
    level: 'error',
    variable: 'CORS_ORIGINS',
    message: 'must not contain "*" — list explicit origins',
  })
}

// Optional env vars — only check format if present
for (const optional of [
  'RESEND_API_KEY',
  'CLERK_WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'VIRUSTOTAL_API_KEY',
  'TERMII_API_KEY',
]) {
  const value = process.env[optional]
  if (value) rejectPlaceholder(optional, value)
}

// ────────────────────────────────────────────────────────────────────────────
// Sample-file collision detector: error if a SECRET-LIKE var (key, token,
// secret, password, etc.) has the same value as in `.env.example`.
//
// Excludes plain config vars (NODE_ENV, PORT, HOST, JWT_EXPIRES_IN, ...) where
// matching the default is expected and not a security issue.
const SECRET_LIKE_PATTERNS = [
  /SECRET/i,
  /KEY/i,
  /TOKEN/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /WEBHOOK/i,
  /DATABASE_URL/i,
]
function isSecretLikeVarName(name: string): boolean {
  return SECRET_LIKE_PATTERNS.some((pat) => pat.test(name))
}

const samplePaths = ['.env.example', '.env.sample', '.env.template']
const sampleValuesByKey = new Map<string, string>()
for (const p of samplePaths) {
  const path = resolve(p)
  if (!existsSync(path)) continue
  const content = readFileSync(path, 'utf-8')
  for (const line of content.split('\n')) {
    const m = /^([A-Z_]+)\s*=\s*"?([^"#\n]+)"?$/.exec(line.trim())
    if (m && m[1] && m[2]) {
      sampleValuesByKey.set(m[1], m[2].trim())
    }
  }
}
for (const [key, sampleValue] of sampleValuesByKey) {
  if (!isSecretLikeVarName(key)) continue
  const liveValue = process.env[key]
  if (liveValue && liveValue === sampleValue) {
    issues.push({
      level: 'error',
      variable: key,
      message: 'live value matches the sample env file — replace it',
    })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Report
const errors = issues.filter((i) => i.level === 'error')
const warnings = issues.filter((i) => i.level === 'warning')

if (issues.length === 0) {
  console.log(
    `✅  Secret audit passed${isProd ? ' (prod-strict mode)' : ''}: ${process.env.NODE_ENV ?? 'unknown env'}`,
  )
  process.exit(0)
}

console.log(
  `\n${errors.length} error(s), ${warnings.length} warning(s)${isProd ? ' [prod-strict mode]' : ''}\n`,
)
for (const issue of issues) {
  const icon = issue.level === 'error' ? '❌' : '⚠️ '
  console.log(`${icon}  ${issue.variable}: ${issue.message}`)
}

if (errors.length > 0) {
  console.log('\n[31mAborting: fix the errors above before deploying.[0m\n')
  process.exit(1)
}
process.exit(0)
