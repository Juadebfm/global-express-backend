import { config } from 'dotenv'
config({ path: '.env' })

import { randomUUID } from 'crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../src/config/db'
import {
  dispatchBatches,
  galleryClaims,
  galleryItems,
  orderPackages,
  orders,
  packageImages,
  users,
} from '../drizzle/schema'
import { galleryService } from '../src/services/gallery.service'
import {
  GalleryClaimStatus,
  GalleryClaimType,
  GalleryItemStatus,
  GalleryItemType,
  ShipmentType,
  TransportMode,
  UserRole,
} from '../src/types/enums'
import { encrypt, hashEmail } from '../src/utils/encryption'

type ScenarioResult = {
  name: string
  ok: boolean
  detail: string
}

function assertCondition(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

async function main() {
  const results: ScenarioResult[] = []
  const createdOrderIds: string[] = []
  const createdItemIds: string[] = []

  const [reviewer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, UserRole.SUPER_ADMIN), isNull(users.deletedAt)))
    .limit(1)

  if (!reviewer) {
    throw new Error('No superadmin reviewer found.')
  }

  const ts = Date.now()
  const claimantEmail = `qa.gallery.claim.${ts}@example.com`
  const [claimant] = await db
    .insert(users)
    .values({
      clerkId: `qa_gallery_claim_${ts}`,
      role: UserRole.USER,
      email: encrypt(claimantEmail),
      emailHash: hashEmail(claimantEmail),
      firstName: encrypt('QA'),
      lastName: encrypt('Claimant'),
      phone: encrypt('+2348011111111'),
      isActive: true,
    })
    .returning({ id: users.id })

  const [supplier] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, UserRole.SUPPLIER), isNull(users.deletedAt)))
    .limit(1)

  const supplierId = supplier?.id ?? null

  async function createPendingClaim(input: {
    key: string
    metadata: Record<string, unknown>
    title?: string
  }) {
    const trackingNumber = `QA-CHECKLIST-${input.key}-${ts}`
    const [item] = await db
      .insert(galleryItems)
      .values({
        trackingNumber,
        itemType: GalleryItemType.ANONYMOUS_GOODS,
        status: GalleryItemStatus.CLAIM_PENDING,
        isPublished: false,
        title: input.title ?? `QA ${input.key} item`,
        description: `QA scenario ${input.key}`,
        previewImageUrl: `https://source.unsplash.com/1200x800/?package,warehouse&sig=${ts}`,
        mediaUrls: [`https://source.unsplash.com/1200x800/?parcel,logistics&sig=${ts + 1}`],
        metadata: input.metadata,
        createdBy: reviewer.id,
        updatedBy: reviewer.id,
      })
      .returning({ id: galleryItems.id, trackingNumber: galleryItems.trackingNumber })

    createdItemIds.push(item.id)

    const [claim] = await db
      .insert(galleryClaims)
      .values({
        itemId: item.id,
        claimType: GalleryClaimType.OWNERSHIP,
        status: GalleryClaimStatus.PENDING,
        claimantUserId: claimant.id,
        claimantFullName: encrypt('QA Claimant'),
        claimantEmail: encrypt(claimantEmail),
        claimantPhone: encrypt('+2348011111111'),
        message: `qa ${input.key}`,
        uploadToken: null,
        proofUrls: [],
      })
      .returning({ id: galleryClaims.id, itemId: galleryClaims.itemId })

    return { item, claim }
  }

  try {
    // 1) Air create_shipment -> links air batch
    {
      const { claim } = await createPendingClaim({
        key: 'air',
        metadata: {
          shipmentType: 'air',
          description: 'QA Air',
          quantity: 1,
          dimensionsCm: { length: 40, width: 30, height: 20 },
          weightKg: 1.25,
          cbm: 0.024,
          warehouseReceivedAt: new Date().toISOString(),
          supplierId,
          origin: 'South Korea',
          destination: 'Lagos, Nigeria',
        },
      })

      const payload = await galleryService.reviewClaim({
        claimId: claim.id,
        reviewerId: reviewer.id,
        decision: 'approve',
        postApprovalAction: 'create_shipment',
        shipmentType: ShipmentType.AIR,
      })

      assertCondition(payload.shipment, 'Expected shipment payload for air scenario.')
      const [orderRow] = await db
        .select({
          id: orders.id,
          transportMode: orders.transportMode,
          statusV2: orders.statusV2,
          dispatchBatchId: orders.dispatchBatchId,
        })
        .from(orders)
        .where(eq(orders.id, payload.shipment!.orderId))
        .limit(1)
      assertCondition(orderRow, 'Air scenario order not found.')
      assertCondition(orderRow!.transportMode === TransportMode.AIR, 'Air scenario transportMode mismatch.')
      assertCondition(
        orderRow!.statusV2 === 'CLAIM_APPROVED_PENDING_BULK_PROCESSING',
        'Air scenario status mismatch.',
      )

      const [batch] = await db
        .select({ id: dispatchBatches.id, transportMode: dispatchBatches.transportMode })
        .from(dispatchBatches)
        .where(eq(dispatchBatches.id, orderRow!.dispatchBatchId!))
        .limit(1)
      assertCondition(batch?.transportMode === TransportMode.AIR, 'Air scenario batch mode mismatch.')

      createdOrderIds.push(payload.shipment!.orderId)
      results.push({ name: 'air_create_shipment', ok: true, detail: 'Order + air batch linked.' })
    }

    // 2) Ocean create_shipment -> links sea batch
    {
      const { claim } = await createPendingClaim({
        key: 'ocean',
        metadata: {
          shipmentType: 'ocean',
          description: 'QA Ocean',
          quantity: 2,
          dimensionsCm: { length: 60, width: 45, height: 40 },
          weightKg: 3.8,
          cbm: 0.108,
          warehouseReceivedAt: new Date().toISOString(),
          supplierId,
          origin: 'South Korea',
          destination: 'Lagos, Nigeria',
        },
      })

      const payload = await galleryService.reviewClaim({
        claimId: claim.id,
        reviewerId: reviewer.id,
        decision: 'approve',
        postApprovalAction: 'create_shipment',
        shipmentType: ShipmentType.OCEAN,
      })

      assertCondition(payload.shipment, 'Expected shipment payload for ocean scenario.')

      const [orderRow] = await db
        .select({ id: orders.id, transportMode: orders.transportMode, dispatchBatchId: orders.dispatchBatchId })
        .from(orders)
        .where(eq(orders.id, payload.shipment!.orderId))
        .limit(1)
      assertCondition(orderRow?.transportMode === TransportMode.SEA, 'Ocean scenario transportMode mismatch.')

      const [batch] = await db
        .select({ id: dispatchBatches.id, transportMode: dispatchBatches.transportMode })
        .from(dispatchBatches)
        .where(eq(dispatchBatches.id, orderRow!.dispatchBatchId!))
        .limit(1)
      assertCondition(batch?.transportMode === TransportMode.SEA, 'Ocean scenario batch mode mismatch.')

      createdOrderIds.push(payload.shipment!.orderId)
      results.push({ name: 'ocean_create_shipment', ok: true, detail: 'Order + sea batch linked.' })
    }

    // 3) D2D requires mode, then links chosen mode
    {
      const { claim } = await createPendingClaim({
        key: 'd2d',
        metadata: {
          shipmentType: 'd2d',
          description: 'QA D2D',
          quantity: 1,
          dimensionsCm: { length: 50, width: 38, height: 25 },
          weightKg: 2.1,
          cbm: 0.0475,
          warehouseReceivedAt: new Date().toISOString(),
          supplierId,
          origin: 'South Korea',
          destination: 'Lagos, Nigeria',
        },
      })

      let missingModeFailed = false
      try {
        await galleryService.reviewClaim({
          claimId: claim.id,
          reviewerId: reviewer.id,
          decision: 'approve',
          postApprovalAction: 'create_shipment',
          shipmentType: ShipmentType.D2D,
        })
      } catch (err: any) {
        missingModeFailed = Boolean(err?.statusCode === 422)
      }
      assertCondition(missingModeFailed, 'D2D scenario should fail without dispatch mode.')

      const payload = await galleryService.reviewClaim({
        claimId: claim.id,
        reviewerId: reviewer.id,
        decision: 'approve',
        postApprovalAction: 'create_shipment',
        shipmentType: ShipmentType.D2D,
        d2dDispatchMode: 'sea',
      })
      assertCondition(payload.shipment, 'Expected shipment payload for d2d scenario.')

      const [orderRow] = await db
        .select({ id: orders.id, transportMode: orders.transportMode, shipmentType: orders.shipmentType })
        .from(orders)
        .where(eq(orders.id, payload.shipment!.orderId))
        .limit(1)
      assertCondition(orderRow?.shipmentType === ShipmentType.D2D, 'D2D scenario shipmentType mismatch.')
      assertCondition(orderRow?.transportMode === TransportMode.SEA, 'D2D scenario chosen mode mismatch.')

      createdOrderIds.push(payload.shipment!.orderId)
      results.push({
        name: 'd2d_create_shipment',
        ok: true,
        detail: 'Mode required and chosen mode batch linkage validated.',
      })
    }

    // 4) Missing supplier metadata still creates shipment and package supplier is null
    {
      const { claim } = await createPendingClaim({
        key: 'nosupplier',
        metadata: {
          shipmentType: 'air',
          description: 'QA No supplier',
          quantity: 1,
          dimensionsCm: { length: 45, width: 35, height: 20 },
          weightKg: 1.9,
          cbm: 0.0315,
          warehouseReceivedAt: new Date().toISOString(),
          origin: 'South Korea',
          destination: 'Lagos, Nigeria',
        },
      })

      const payload = await galleryService.reviewClaim({
        claimId: claim.id,
        reviewerId: reviewer.id,
        decision: 'approve',
        postApprovalAction: 'create_shipment',
        shipmentType: ShipmentType.AIR,
      })
      assertCondition(payload.shipment, 'Expected shipment payload for missing supplier scenario.')

      const [pkg] = await db
        .select({ supplierId: orderPackages.supplierId })
        .from(orderPackages)
        .where(eq(orderPackages.orderId, payload.shipment!.orderId))
        .limit(1)
      assertCondition(pkg && pkg.supplierId === null, 'Expected null supplierId when metadata supplier is missing.')

      createdOrderIds.push(payload.shipment!.orderId)
      results.push({ name: 'missing_supplier', ok: true, detail: 'Shipment created with null supplier package.' })
    }

    // 5) Failure path does not approve claim (rollback-safe behavior)
    {
      const { claim, item } = await createPendingClaim({
        key: 'rollback',
        metadata: {
          shipmentType: 'air',
          description: 'QA rollback',
          quantity: 1,
          dimensionsCm: { length: 30, width: 25, height: 20 },
          weightKg: 0.95,
          cbm: 0.015,
          warehouseReceivedAt: new Date().toISOString(),
        },
      })

      let failed = false
      try {
        await galleryService.reviewClaim({
          claimId: claim.id,
          reviewerId: randomUUID(),
          decision: 'approve',
          postApprovalAction: 'create_shipment',
          shipmentType: ShipmentType.AIR,
        })
      } catch {
        failed = true
      }
      assertCondition(failed, 'Expected simulated failure with invalid reviewerId.')

      const [postClaim] = await db
        .select({ status: galleryClaims.status, reviewedBy: galleryClaims.reviewedBy })
        .from(galleryClaims)
        .where(eq(galleryClaims.id, claim.id))
        .limit(1)
      const [postItem] = await db
        .select({ status: galleryItems.status, updatedBy: galleryItems.updatedBy })
        .from(galleryItems)
        .where(eq(galleryItems.id, item.id))
        .limit(1)

      assertCondition(postClaim?.status === GalleryClaimStatus.PENDING, 'Claim status changed despite failure.')
      assertCondition(postClaim?.reviewedBy === null, 'Claim reviewedBy changed despite failure.')
      assertCondition(postItem?.status === GalleryItemStatus.CLAIM_PENDING, 'Item status changed despite failure.')

      results.push({
        name: 'failure_rollback_behavior',
        ok: true,
        detail: 'Claim/item remained pending when shipment creation failed.',
      })
    }

    // 6) approve_only does not create shipment
    {
      const { claim } = await createPendingClaim({
        key: 'approveonly',
        metadata: {
          shipmentType: 'air',
          description: 'QA approve only',
          quantity: 1,
          dimensionsCm: { length: 34, width: 26, height: 18 },
          weightKg: 0.88,
          cbm: 0.0159,
          warehouseReceivedAt: new Date().toISOString(),
        },
      })

      const payload = await galleryService.reviewClaim({
        claimId: claim.id,
        reviewerId: reviewer.id,
        decision: 'approve',
        postApprovalAction: 'approve_only',
      })

      assertCondition(payload.shipment === null, 'approve_only should not return shipment payload.')
      assertCondition(payload.claim.status === GalleryClaimStatus.APPROVED, 'approve_only claim should be approved.')
      assertCondition(payload.item.status === GalleryItemStatus.CLAIMED, 'approve_only item should be claimed.')

      const linkedOrder = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.senderId, claimant.id))
        .orderBy(orders.createdAt)

      const idsSet = new Set(createdOrderIds)
      const nonFlowOrder = linkedOrder.find((row) => !idsSet.has(row.id))
      assertCondition(!nonFlowOrder, 'approve_only unexpectedly created a shipment order.')

      results.push({ name: 'approve_only_no_shipment', ok: true, detail: 'No shipment created.' })
    }
  } finally {
    if (createdOrderIds.length > 0) {
      await db.delete(packageImages).where(inArray(packageImages.orderId, createdOrderIds))
      await db.delete(orderPackages).where(inArray(orderPackages.orderId, createdOrderIds))
      await db.delete(orders).where(inArray(orders.id, createdOrderIds))
    }
    if (createdItemIds.length > 0) {
      await db.delete(galleryItems).where(inArray(galleryItems.id, createdItemIds))
    }
  }

  for (const row of results) {
    console.log(`${row.ok ? 'PASS' : 'FAIL'} | ${row.name} | ${row.detail}`)
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    process.exit(1)
  }

  console.log(`\nAll verification scenarios passed (${results.length}).`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Verification script failed:', err)
  process.exit(1)
})
