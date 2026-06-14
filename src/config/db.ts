import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../../drizzle/schema'
import { env } from './env'

const isCloudDb = env.DATABASE_URL.includes('neon.tech') || env.DATABASE_URL.includes('render.com')
const client = postgres(env.DATABASE_URL, {
  ssl: isCloudDb ? 'require' : false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle(client, { schema })
