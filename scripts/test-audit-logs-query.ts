import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { auditLogs, users } from '../drizzle/schema'
import { desc, eq, and, gte, lte, ilike, count } from 'drizzle-orm'
import { decrypt } from '../src/utils/encryption'

async function main() {
  try {
    const page = 1
    const limit = 50
    const offset = 0

    const conditions: ReturnType<typeof eq>[] = []
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          ipAddress: auditLogs.ipAddress,
          userAgent: auditLogs.userAgent,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
          actorId: users.id,
          actorFirstName: users.firstName,
          actorLastName: users.lastName,
          actorRole: users.role,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(auditLogs).where(where),
    ])

    const total = totalResult[0]?.total ?? 0

    const result = {
      logs: rows.map((r) => ({
        id: r.id,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        metadata: r.metadata,
        createdAt: r.createdAt,
        actor: r.actorId
          ? {
              id: r.actorId,
              firstName: r.actorFirstName ? decrypt(r.actorFirstName) : null,
              lastName: r.actorLastName ? decrypt(r.actorLastName) : null,
              role: r.actorRole,
            }
          : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }

    console.log(`OK — ${result.logs.length} logs, total=${total}`)
    console.log(JSON.stringify(result.logs[0], null, 2))
  } catch (err) {
    console.error('FAILED:', err)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
