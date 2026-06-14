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

const isCloudDb = DATABASE_URL.includes('neon.tech') || DATABASE_URL.includes('render.com')
const client = postgres(DATABASE_URL, { ssl: isCloudDb ? 'require' : false, max: 1 })

/**
 * Split SQL into individual statements, correctly handling:
 * - Dollar-quoted strings: $$...$$  or $tag$...$tag$
 * - Single-quoted string literals: '...'
 * - Line comments: -- ...
 * - Block comments: /* ... *\/
 * - BEGIN / COMMIT / ROLLBACK — skipped (we run auto-commit per statement)
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  const len = sql.length

  while (i < len) {
    // Line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < len && sql[i] !== '\n') i++
      continue
    }

    // Block comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }

    // Single-quoted string literal
    if (sql[i] === "'") {
      current += sql[i++]
      while (i < len) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += "''" ; i += 2
        } else if (sql[i] === "'") {
          current += sql[i++]
          break
        } else {
          current += sql[i++]
        }
      }
      continue
    }

    // Dollar-quoted string
    if (sql[i] === '$') {
      // Match the dollar tag: $identifier$ or $$
      let j = i + 1
      while (j < len && sql[j] !== '$' && /[a-zA-Z0-9_]/.test(sql[j])) j++
      if (j < len && sql[j] === '$') {
        const tag = sql.slice(i, j + 1)
        current += tag
        i = j + 1
        // Consume until the matching closing tag
        while (i < len) {
          const close = sql.indexOf(tag, i)
          if (close === -1) { i = len; break }
          current += sql.slice(i, close + tag.length)
          i = close + tag.length
          break
        }
        continue
      }
    }

    // Statement terminator
    if (sql[i] === ';') {
      const stmt = current.trim()
      const upper = stmt.toUpperCase()
      // Skip transaction control — we run each statement auto-committed
      if (stmt && upper !== 'BEGIN' && upper !== 'COMMIT' && upper !== 'ROLLBACK') {
        statements.push(stmt)
      }
      current = ''
      i++
      continue
    }

    current += sql[i++]
  }

  // Any trailing content without a final semicolon
  const stmt = current.trim()
  const upper = stmt.toUpperCase()
  if (stmt && upper !== 'BEGIN' && upper !== 'COMMIT' && upper !== 'ROLLBACK') {
    statements.push(stmt)
  }

  return statements
}

async function runMigration(file: string) {
  const sqlContent = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
  const statements = splitStatements(sqlContent)

  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 80)
    try {
      await client.unsafe(stmt)
      console.log(`    ✓ ${preview}`)
    } catch (err: any) {
      const msg: string = err.message ?? ''
      const upper = stmt.trimStart().toUpperCase()
      const isStructural =
        upper.startsWith('DROP') ||
        upper.startsWith('ALTER') ||
        upper.startsWith('CREATE INDEX') ||
        upper.startsWith('DO ')   // DO $$ ... $$ blocks for conditional DDL
      const isDataMigration =
        upper.startsWith('INSERT') ||
        upper.startsWith('UPDATE') ||
        upper.startsWith('DELETE')
      const isSkippable =
        msg.includes('already exists') ||
        (msg.includes('does not exist') && (isStructural || isDataMigration)) ||
        (msg.includes('invalid input value for enum') && isDataMigration) ||
        (msg.includes('foreign key constraint') && isDataMigration)
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
