import { describe, expect, it } from 'vitest'
import {
  checksumMigration,
  compareMigrationLedger,
  requiresMigrationBaseline,
  sortMigrationFiles,
  splitMigrationStatements,
} from '../../scripts/migration-utils'

describe('migration utilities', () => {
  it('sorts migration filenames deterministically', () => {
    const migrations = sortMigrationFiles([
      { filename: '2026-07-14_second.sql', sql: '', checksum: 'b' },
      { filename: '2026-01-01_first.sql', sql: '', checksum: 'a' },
    ])

    expect(migrations.map((migration) => migration.filename)).toEqual([
      '2026-01-01_first.sql',
      '2026-07-14_second.sql',
    ])
  })

  it('detects missing, modified, and unknown ledger entries', () => {
    const migrations = [
      { filename: '001.sql', sql: 'select 1', checksum: checksumMigration('select 1') },
      { filename: '002.sql', sql: 'select 2', checksum: checksumMigration('select 2') },
    ]

    expect(
      compareMigrationLedger(migrations, [
        { filename: '001.sql', checksum: 'changed' },
        { filename: 'old.sql', checksum: 'old' },
      ]),
    ).toEqual({
      missing: [migrations[1]],
      modified: ['001.sql'],
      unknown: ['old.sql'],
    })
  })

  it('keeps semicolons inside quoted and dollar-quoted values intact', () => {
    const statements = splitMigrationStatements(`
      begin;
      insert into events (message) values ('first; second');
      do $$ begin perform 'still; one statement'; end $$;
      commit;
    `)

    expect(statements).toEqual([
      "insert into events (message) values ('first; second')",
      "do $$ begin perform 'still; one statement'; end $$",
    ])
  })

  it('requires an explicit baseline for any populated schema with no recorded migrations', () => {
    expect(
      requiresMigrationBaseline({ applicationTableCount: 44, appliedMigrationCount: 0 }),
    ).toBe(true)
    expect(
      requiresMigrationBaseline({ applicationTableCount: 44, appliedMigrationCount: 1 }),
    ).toBe(false)
    expect(
      requiresMigrationBaseline({ applicationTableCount: 0, appliedMigrationCount: 0 }),
    ).toBe(false)
  })
})
