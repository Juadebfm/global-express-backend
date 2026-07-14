import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import postgres from 'postgres'

const migrationTestDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const tsxCli = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url))
const migrateScript = fileURLToPath(new URL('../../scripts/migrate.ts', import.meta.url))

const migrationTest = migrationTestDatabaseUrl ? it : it.skip

describe('migration runner', () => {
  migrationTest('applies every committed migration to a dedicated empty database', async () => {
    const isLocalDatabase = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(
      migrationTestDatabaseUrl!,
    )
    const sql = postgres(migrationTestDatabaseUrl!, {
      max: 1,
      ssl: isLocalDatabase ? false : 'require',
    })

    try {
      const [before] = await sql`
        select count(*)::int as count
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
      `
      expect(Number(before?.count ?? 0)).toBe(0)

      execFileSync(process.execPath, [tsxCli, migrateScript, 'apply'], {
        cwd: repositoryRoot,
        env: { ...process.env, DATABASE_URL: migrationTestDatabaseUrl },
        stdio: 'pipe',
      })

      const [ledger] = await sql`select count(*)::int as count from schema_migrations`
      expect(Number(ledger?.count ?? 0)).toBe(46)

      const [orders] = await sql`
        select count(*)::int as count
        from information_schema.tables
        where table_schema = 'public' and table_name = 'orders'
      `
      expect(Number(orders?.count ?? 0)).toBe(1)
    } finally {
      await sql.unsafe('drop schema public cascade')
      await sql.unsafe('create schema public')
      await sql.end({ timeout: 5 })
    }
  })
})
