/**
 * Run a custom SQL migration file against the database.
 * Usage: npx tsx scripts/run-migration.ts drizzle/migrations/2026-03-08_unify_notifications.sql
 */
import { readFileSync } from 'fs'
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const file = process.argv[2]
if (!file) {
  console.error('Usage: npx tsx scripts/run-migration.ts <path-to-sql-file>')
  process.exit(1)
}

const sqlContent = readFileSync(file, 'utf-8')

const client = postgres(DATABASE_URL, { ssl: 'require', max: 1 })

async function run() {
  console.log(`Running migration: ${file}`)

  // Strip SQL comments, then split on semicolons
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
    console.log(`  → ${preview}...`)
    try {
      await client.unsafe(stmt)
    } catch (err: any) {
      // Ignore "already exists" errors for ADD VALUE (idempotent)
      if (err.message?.includes('already exists')) {
        console.log(`    (skipped — already exists)`)
      } else {
        throw err
      }
    }
  }

  console.log('Migration complete.')
  await client.end()
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
