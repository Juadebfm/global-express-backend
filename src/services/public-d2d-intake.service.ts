import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { decrypt, encrypt, hashEmail } from '../utils/encryption'
import { supportService } from './support.service'
import { notificationsService } from './notifications.service'
import { UserRole } from '../types/enums'

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

function splitFullName(fullName: string) {
  const normalized = fullName.trim().replace(/\s+/g, ' ')
  const [first, ...rest] = normalized.split(' ')
  const firstName = first ?? normalized
  const lastName = rest.length > 0 ? rest.join(' ') : null
  return { firstName, lastName }
}

export interface PublicD2dIntakeInput {
  fullName: string
  email: string
  phone: string
  city: string
  country: string
  goodsDescription: string
  deliveryPhone: string
  deliveryAddressLine1: string
  deliveryState?: string
  deliveryCity?: string
  deliveryPostalCode?: string
  deliveryLandmark?: string
  wantsAccount: boolean
  estimatedWeightKg?: number
  estimatedCbm?: number
}

function formatOptionalLine(label: string, value: string | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  return `- ${label}: ${normalized}`
}

export class PublicD2dIntakeService {
  private async resolveOrCreateCustomer(input: PublicD2dIntakeInput) {
    const normalizedEmail = input.email.trim().toLowerCase()
    const emailHash = hashEmail(normalizedEmail)
    const { firstName, lastName } = splitFullName(input.fullName)

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1)

    if (existing) {
      if (existing.deletedAt) {
        throw httpError('This email belongs to a deleted account. Please contact support.', 409)
      }

      if ([UserRole.STAFF, UserRole.SUPER_ADMIN].includes(existing.role as UserRole)) {
        throw httpError(
          'This email belongs to an internal account and cannot be used for public D2D intake.',
          409,
        )
      }

      const patch: Partial<typeof users.$inferInsert> = {}

      if (!existing.emailHash) patch.emailHash = emailHash
      if (!existing.firstName && firstName) patch.firstName = encrypt(firstName)
      if (!existing.lastName && lastName) patch.lastName = encrypt(lastName)
      if (!existing.phone) patch.phone = encrypt(input.phone.trim())
      if (!existing.addressCity) patch.addressCity = input.city.trim()
      if (!existing.addressCountry) patch.addressCountry = input.country.trim()

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date()
        const [updated] = await db
          .update(users)
          .set(patch)
          .where(eq(users.id, existing.id))
          .returning()
        return updated ?? existing
      }

      return existing
    }

    const [created] = await db
      .insert(users)
      .values({
        clerkId: null,
        role: UserRole.USER,
        email: encrypt(normalizedEmail),
        emailHash,
        firstName: encrypt(firstName),
        lastName: lastName ? encrypt(lastName) : null,
        phone: encrypt(input.phone.trim()),
        addressCity: input.city.trim(),
        addressCountry: input.country.trim(),
        isActive: false,
      })
      .returning()

    return created
  }

  async submitIntake(input: PublicD2dIntakeInput) {
    const customer = await this.resolveOrCreateCustomer(input)

    const estimatedParts: string[] = []
    if (input.estimatedWeightKg !== undefined) {
      estimatedParts.push(`Estimated weight: ${input.estimatedWeightKg.toFixed(3)}kg`)
    }
    if (input.estimatedCbm !== undefined) {
      estimatedParts.push(`Estimated volume: ${input.estimatedCbm.toFixed(6)}cbm`)
    }
    const estimatedSummary = estimatedParts.length > 0 ? `\n${estimatedParts.join('\n')}` : ''

    const deliveryLines = [
      `- Phone: ${input.deliveryPhone.trim()}`,
      `- Address line 1: ${input.deliveryAddressLine1.trim()}`,
      '- Country: Nigeria',
      formatOptionalLine('State', input.deliveryState),
      formatOptionalLine('City', input.deliveryCity),
      formatOptionalLine('Postal code', input.deliveryPostalCode),
      formatOptionalLine('Landmark', input.deliveryLandmark),
    ].filter((line): line is string => Boolean(line))

    const supportBody =
      `Public D2D intake submitted.\n\n` +
      `Contact:\n` +
      `- Full name: ${input.fullName.trim()}\n` +
      `- Email: ${input.email.trim().toLowerCase()}\n` +
      `- Phone: ${input.phone.trim()}\n` +
      `- City/Country: ${input.city.trim()}, ${input.country.trim()}\n` +
      `- Register intent: ${input.wantsAccount ? 'Wants to register' : 'Remain external'}\n\n` +
      `Intended Nigeria delivery details:\n${deliveryLines.join('\n')}\n\n` +
      `Goods details:\n${input.goodsDescription.trim()}` +
      (estimatedSummary ? `\n\n${estimatedParts.join('\n')}` : '')

    const ticketPayload = await supportService.createTicket(
      {
        subject: 'Public D2D intake request',
        category: 'shipment_inquiry',
        body: supportBody,
      },
      { id: customer.id, role: customer.role },
    )

    notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'admin_alert',
      title: 'New Public D2D Intake',
      body: `Public D2D intake ticket ${ticketPayload.ticket.ticketNumber} requires review.`,
      metadata: {
        ticketId: ticketPayload.ticket.id,
        ticketNumber: ticketPayload.ticket.ticketNumber,
        requesterUserId: customer.id,
      },
    })

    const [freshUser] = await db
      .select({
        id: users.id,
        role: users.role,
        clerkId: users.clerkId,
        email: users.email,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, customer.id))
      .limit(1)

    return {
      ticket: ticketPayload.ticket,
      contact: {
        userId: freshUser?.id ?? customer.id,
        role: freshUser?.role ?? customer.role,
        email: freshUser?.email ? decrypt(freshUser.email) : input.email.trim().toLowerCase(),
        accountLinked: Boolean(freshUser?.clerkId),
        isActive: freshUser?.isActive ?? customer.isActive,
        registerIntent: input.wantsAccount,
      },
      intakeRequest: {
        fullName: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        city: input.city.trim(),
        country: input.country.trim(),
        goodsDescription: input.goodsDescription.trim(),
        wantsAccount: input.wantsAccount,
        estimatedWeightKg: input.estimatedWeightKg ?? null,
        estimatedCbm: input.estimatedCbm ?? null,
        delivery: {
          phone: input.deliveryPhone.trim(),
          addressLine1: input.deliveryAddressLine1.trim(),
          country: 'Nigeria',
          state: input.deliveryState?.trim() || null,
          city: input.deliveryCity?.trim() || null,
          postalCode: input.deliveryPostalCode?.trim() || null,
          landmark: input.deliveryLandmark?.trim() || null,
        },
      },
    }
  }
}

export const publicD2dIntakeService = new PublicD2dIntakeService()
