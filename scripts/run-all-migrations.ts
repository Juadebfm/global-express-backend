/**
 * Run every migration in drizzle/migrations/ in filename order.
 * Safe to re-run: each statement is executed with IF EXISTS / IF NOT EXISTS
 * guards where possible, and any "already exists" errors are silently skipped.
 *
 * Usage (against a specific database):
 *   DATABASE_URL=<render-db-url> npx tsx scripts/run-all-migrations.ts
 *
 * The DATABASE_URL from .env is used by default.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import postgres from 'postgres'
import { config } from 'dotenv'

config({ path: '.env' })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, '..', 'drizzle', 'migrations')

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const client = postgres(DATABASE_URL, { ssl: 'require', max: 1 })

async function runMigration(file: string) {
  const sqlContent = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')

  const stripped = sqlContent
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 80)
    try {
      await client.unsafe(stmt)
      console.log(`    ✓ ${preview}`)
    } catch (err: any) {
      const msg: string = err.message ?? ''
      const isSkippable =
        msg.includes('already exists') ||
        msg.includes('does not exist') && stmt.toUpperCase().includes('DROP')
      if (isSkippable) {
        console.log(`    ~ skipped (${msg.split('\n')[0]})`)
      } else {
        throw err
      }
    }
  }
}

async function run() {
  console.log(`Running ${files.length} migrations against: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`)

  for (const file of files) {
    console.log(`→ ${file}`)
    try {
      await runMigration(file)
    } catch (err: any) {
      console.error(`\nFailed in ${file}:`)
      console.error(err.message)
      await client.end()
      process.exit(1)
    }
  }

  console.log('\nAll migrations complete.')
  await client.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
