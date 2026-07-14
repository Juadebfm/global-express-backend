import { createHash } from 'node:crypto'

export interface MigrationFile {
  filename: string
  checksum: string
  sql: string
}

export interface AppliedMigration {
  filename: string
  checksum: string
}

export interface MigrationLedgerState {
  missing: MigrationFile[]
  modified: string[]
  unknown: string[]
}

export function requiresMigrationBaseline(input: {
  applicationTableCount: number
  appliedMigrationCount: number
}): boolean {
  return input.applicationTableCount > 0 && input.appliedMigrationCount === 0
}

export function checksumMigration(sql: string): string {
  return createHash('sha256').update(sql).digest('hex')
}

export function sortMigrationFiles(files: MigrationFile[]): MigrationFile[] {
  return [...files].sort((left, right) => left.filename.localeCompare(right.filename))
}

export function compareMigrationLedger(
  migrations: MigrationFile[],
  appliedMigrations: AppliedMigration[],
): MigrationLedgerState {
  const filesByName = new Map(migrations.map((migration) => [migration.filename, migration]))
  const appliedByName = new Map(
    appliedMigrations.map((migration) => [migration.filename, migration]),
  )

  return {
    missing: migrations.filter((migration) => !appliedByName.has(migration.filename)),
    modified: appliedMigrations
      .filter((applied) => {
        const migration = filesByName.get(applied.filename)
        return migration !== undefined && migration.checksum !== applied.checksum
      })
      .map((applied) => applied.filename),
    unknown: appliedMigrations
      .filter((applied) => !filesByName.has(applied.filename))
      .map((applied) => applied.filename),
  }
}

/**
 * Split SQL safely enough for the repository's hand-authored migration files.
 * It preserves quoted strings and dollar-quoted PL/pgSQL blocks, while skipping
 * explicit transaction statements because the runner creates one transaction per file.
 */
export function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let index = 0

  const pushStatement = () => {
    const statement = current.trim()
    const upper = statement.toUpperCase()
    if (statement && !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(upper)) {
      statements.push(statement)
    }
    current = ''
  }

  while (index < sql.length) {
    if (sql[index] === '-' && sql[index + 1] === '-') {
      while (index < sql.length && sql[index] !== '\n') index += 1
      continue
    }

    if (sql[index] === '/' && sql[index + 1] === '*') {
      index += 2
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        index += 1
      }
      index += 2
      continue
    }

    if (sql[index] === "'") {
      current += sql[index]
      index += 1
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          current += "''"
          index += 2
        } else if (sql[index] === "'") {
          current += sql[index]
          index += 1
          break
        } else {
          current += sql[index]
          index += 1
        }
      }
      continue
    }

    if (sql[index] === '$') {
      let tagEnd = index + 1
      while (
        tagEnd < sql.length &&
        sql[tagEnd] !== '$' &&
        /[a-zA-Z0-9_]/.test(sql[tagEnd])
      ) {
        tagEnd += 1
      }

      if (sql[tagEnd] === '$') {
        const tag = sql.slice(index, tagEnd + 1)
        const close = sql.indexOf(tag, tagEnd + 1)
        if (close === -1) {
          current += sql.slice(index)
          break
        }
        current += sql.slice(index, close + tag.length)
        index = close + tag.length
        continue
      }
    }

    if (sql[index] === ';') {
      pushStatement()
      index += 1
      continue
    }

    current += sql[index]
    index += 1
  }

  pushStatement()
  return statements
}
