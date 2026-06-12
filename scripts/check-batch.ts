import { config } from 'dotenv'
config({ path: '.env' })
import { db } from '../src/config/db'
import { dispatchBatches } from '../drizzle/schema'
import { eq } from 'drizzle-orm'

async function main() {
  const [batch] = await db
    .select()
    .from(dispatchBatches)
    .where(eq(dispatchBatches.id, '40564c98-7312-4bf5-89cb-276672f4076d'))
    .limit(1)

  if (!batch) {
    console.log('Batch NOT FOUND in DB')
  } else {
    console.log('id:', batch.id)
    console.log('status:', batch.status)
    console.log('deletedAt:', batch.deletedAt)
    console.log('masterTrackingNumber:', batch.masterTrackingNumber)
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
