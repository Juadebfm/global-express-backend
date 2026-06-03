import { describe, it, expect } from 'vitest'
import { clientMatchesSearch } from '../../src/services/clients.service'

const julius = {
  email: 'julius@example.com',
  firstName: 'Julius',
  lastName: 'Adebowale',
  businessName: 'Pluralcode',
  shippingMark: 'julade',
}

const hayom = {
  email: 'hayom@gmail.com',
  firstName: 'Hayom',
  lastName: null,
  businessName: null,
  shippingMark: 'hayomz',
}

const empty = {
  email: 'ghost@nowhere.com',
  firstName: null,
  lastName: null,
  businessName: null,
  shippingMark: null,
}

describe('clientMatchesSearch', () => {
  it('matches first name partial, case-insensitively', () => {
    expect(clientMatchesSearch(julius, 'juli')).toBe(true)
    expect(clientMatchesSearch(julius, 'JULIUS'.toLowerCase())).toBe(true)
  })

  it('matches last name partial', () => {
    expect(clientMatchesSearch(julius, 'bowale')).toBe(true)
  })

  it('matches business name partial', () => {
    expect(clientMatchesSearch(julius, 'plural')).toBe(true)
  })

  it('matches email partial — local part or domain', () => {
    expect(clientMatchesSearch(julius, 'julius@')).toBe(true)
    expect(clientMatchesSearch(hayom, '@gmail')).toBe(true)
  })

  it('matches shipping mark partial', () => {
    expect(clientMatchesSearch(julius, 'lade')).toBe(true)
    expect(clientMatchesSearch(hayom, 'hayom')).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(clientMatchesSearch(julius, 'nonexistent')).toBe(false)
    expect(clientMatchesSearch(empty, 'julius')).toBe(false)
  })

  it('returns true on empty search (no filtering)', () => {
    expect(clientMatchesSearch(julius, '')).toBe(true)
  })

  it('handles null fields safely', () => {
    expect(clientMatchesSearch(empty, 'ghost')).toBe(true)
    expect(clientMatchesSearch(empty, 'julius')).toBe(false)
  })

  it('treats SQL wildcards as literals (no LIKE pattern semantics)', () => {
    // % and _ should match literally — i.e. they should NOT match anything in
    // these records because no field contains those characters.
    expect(clientMatchesSearch(julius, '%')).toBe(false)
    expect(clientMatchesSearch(julius, '_')).toBe(false)
    // and they should match if a field genuinely contains the character
    expect(
      clientMatchesSearch(
        { ...julius, firstName: '50% off promo' },
        '%',
      ),
    ).toBe(true)
  })
})
