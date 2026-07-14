import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import postgres from 'postgres'
import {
  checksumMigration,
  compareMigrationLedger,
  requiresMigrationBaseline,
  sortMigrationFiles,
  splitMigrationStatements,
  type AppliedMigration,
  type MigrationFile,
} from './migration-utils'

config({ path: '.env' })

const command = process.argv[2]
const isConfirmed = process.argv.includes('--confirm')
const migrationsDirectory = join(import.meta.dirname ?? __dirname, '..', 'drizzle', 'migrations')
const ledgerTable = 'schema_migrations'

type SqlClient = ReturnType<typeof postgres>

function loadMigrations(): MigrationFile[] {
  const migrations = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .map((filename) => {
      const sql = readFileSync(join(migrationsDirectory, filename), 'utf8')
      return { filename, sql, checksum: checksumMigration(sql) }
    })

  return sortMigrationFiles(migrations)
}

function getClient(): SqlClient {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const isLocalDatabase = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(databaseUrl)
  return postgres(databaseUrl, {
    max: 1,
    ssl: isLocalDatabase ? false : 'require',
  })
}

async function ledgerExists(sql: SqlClient): Promise<boolean> {
  const [result] = await sql`select to_regclass('public.schema_migrations') as table_name`
  return result?.table_name !== null
}

async function ensureLedger(sql: SqlClient): Promise<void> {
  await sql.unsafe(`
    create table if not exists ${ledgerTable} (
      filename text primary key,
      checksum char(64) not null,
      applied_at timestamptz not null default now(),
      execution_ms integer,
      source text not null check (source in ('apply', 'baseline'))
    )
  `)
}

async function getAppliedMigrations(sql: SqlClient): Promise<AppliedMigration[]> {
  if (!(await ledgerExists(sql))) return []

  const rows = await sql<AppliedMigration[]>`
    select filename, checksum
    from schema_migrations
    order by filename
  `
  return rows
}

async function getApplicationTableCount(sql: SqlClient): Promise<number> {
  const [result] = await sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name <> 'schema_migrations'
  `
  return Number(result?.count ?? 0)
}

function printStatus(input: {
  migrations: MigrationFile[]
  ledgerPresent: boolean
  applied: AppliedMigration[]
  appTableCount: number
}) {
  const state = compareMigrationLedger(input.migrations, input.applied)
  console.log(`Repository migrations: ${input.migrations.length}`)
  console.log(`Migration ledger: ${input.ledgerPresent ? 'present' : 'absent'}`)
  console.log(`Applied migrations: ${input.applied.length}`)
  console.log(`Application tables: ${input.appTableCount}`)
  console.log(`Pending migrations: ${state.missing.length}`)

  if (state.modified.length > 0) {
    console.log(`Modified applied migrations: ${state.modified.join(', ')}`)
  }
  if (state.unknown.length > 0) {
    console.log(`Unknown ledger migrations: ${state.unknown.join(', ')}`)
  }
  if (
    requiresMigrationBaseline({
      applicationTableCount: input.appTableCount,
      appliedMigrationCount: input.applied.length,
    })
  ) {
    console.log('Action required: baseline this existing schema before normal migration application.')
  }
}

function assertConsistentLedger(migrations: MigrationFile[], applied: AppliedMigration[]) {
  const state = compareMigrationLedger(migrations, applied)
  if (state.modified.length > 0 || state.unknown.length > 0) {
    const problems = [
      state.modified.length > 0 && `modified: ${state.modified.join(', ')}`,
      state.unknown.length > 0 && `unknown: ${state.unknown.join(', ')}`,
    ]
      .filter(Boolean)
      .join('; ')
    throw new Error(`Migration ledger does not match the repository (${problems}).`)
  }
  return state
}

async function withMigrationLock<T>(sql: SqlClient, action: () => Promise<T>): Promise<T> {
  await sql`select pg_advisory_lock(hashtext('global-express-backend:migrations'))`
  try {
    return await action()
  } finally {
    await sql`select pg_advisory_unlock(hashtext('global-express-backend:migrations'))`
  }
}

async function runApply(sql: SqlClient, migrations: MigrationFile[]): Promise<void> {
  await withMigrationLock(sql, async () => {
    const applicationTableCount = await getApplicationTableCount(sql)
    const applied = await getAppliedMigrations(sql)

    if (
      requiresMigrationBaseline({
        applicationTableCount,
        appliedMigrationCount: applied.length,
      })
    ) {
      throw new Error(
        'This database has an existing schema but no recorded migrations. Run the explicit baseline command only after confirming it is current.',
      )
    }

    await ensureLedger(sql)
    const state = assertConsistentLedger(migrations, applied)

    for (const migration of state.missing) {
      const startedAt = Date.now()
      const statements = splitMigrationStatements(migration.sql)
      console.log(`Applying ${migration.filename}`)

      await sql.begin(async (transaction) => {
        for (const statement of statements) {
          await transaction.unsafe(statement)
        }
        await transaction`
          insert into schema_migrations (filename, checksum, execution_ms, source)
          values (${migration.filename}, ${migration.checksum}, ${Date.now() - startedAt}, 'apply')
        `
      })
    }

    console.log(`Migration apply complete. Applied ${state.missing.length} migration(s).`)
  })
}

async function runBaseline(sql: SqlClient, migrations: MigrationFile[]): Promise<void> {
  if (!isConfirmed) {
    throw new Error('Baseline is destructive to migration history. Re-run with --confirm after verifying the target database is current.')
  }

  await withMigrationLock(sql, async () => {
    const applicationTableCount = await getApplicationTableCount(sql)
    if (applicationTableCount === 0) {
      throw new Error('Cannot baseline an empty database. Use the normal apply command instead.')
    }

    await ensureLedger(sql)
    const applied = await getAppliedMigrations(sql)
    if (applied.length > 0) {
      throw new Error('Migration ledger already contains entries. Refusing to overwrite migration history.')
    }

    await sql.begin(async (transaction) => {
      for (const migration of migrations) {
        await transaction`
          insert into schema_migrations (filename, checksum, execution_ms, source)
          values (${migration.filename}, ${migration.checksum}, null, 'baseline')
        `
      }
    })

    console.log(`Baseline complete. Recorded ${migrations.length} migration(s) without executing SQL.`)
  })
}

async function run(): Promise<void> {
  if (!['apply', 'baseline', 'status'].includes(command ?? '')) {
    throw new Error('Usage: tsx scripts/migrate.ts <apply|baseline|status> [--confirm]')
  }

  const sql = getClient()
  try {
    const migrations = loadMigrations()

    if (command === 'status') {
      const hasLedger = await ledgerExists(sql)
      const [applied, appTableCount] = await Promise.all([
        getAppliedMigrations(sql),
        getApplicationTableCount(sql),
      ])
      printStatus({ migrations, ledgerPresent: hasLedger, applied, appTableCount })
      return
    }

    if (command === 'baseline') {
      await runBaseline(sql, migrations)
      return
    }

    await runApply(sql, migrations)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
