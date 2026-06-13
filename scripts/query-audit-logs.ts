import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { auditLogs, users } from '../drizzle/schema'
import { desc, eq } from 'drizzle-orm'
import { decrypt } from '../src/utils/encryption'

async function main() {
  const rows = await db
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
    .orderBy(desc(auditLogs.createdAt))
    .limit(20)

  const result = rows.map((r) => ({
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
  }))

  console.log(JSON.stringify({ total: result.length, logs: result }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
