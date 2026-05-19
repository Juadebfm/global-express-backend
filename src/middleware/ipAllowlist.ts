import type { FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../config/env'

/**
 * Enforces ADMIN_IP_WHITELIST on the route it's applied to (ASVS 4.3.2).
 *
 * Whitelist is comma-separated IPv4/IPv6 addresses or CIDR blocks loaded from env.
 * If ADMIN_IP_WHITELIST is unset or empty, this middleware no-ops — making it safe
 * to apply unconditionally and have it activate when ops set the env var.
 *
 * Apply after the rate-limit + before authenticate so unauthenticated probes from
 * disallowed IPs still get rejected before bcrypt cost is paid.
 */

let cachedRules: Rule[] | null = null

interface Rule {
  match: (ip: string) => boolean
  raw: string
}

function parseRules(): Rule[] {
  if (cachedRules) return cachedRules
  const raw = env.ADMIN_IP_WHITELIST?.trim()
  if (!raw) {
    cachedRules = []
    return cachedRules
  }

  cachedRules = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes('/')) {
        return { raw: entry, match: cidrMatcher(entry) }
      }
      return { raw: entry, match: (ip: string) => ip === entry }
    })

  return cachedRules
}

function cidrMatcher(cidr: string): (ip: string) => boolean {
  const [base, bitsStr] = cidr.split('/')
  const bits = Number(bitsStr)
  const baseBytes = ipToBytes(base)
  if (!baseBytes || Number.isNaN(bits) || bits < 0 || bits > baseBytes.length * 8) {
    // Malformed entry — never matches.
    return () => false
  }
  return (ip) => {
    const ipBytes = ipToBytes(ip)
    if (ipBytes?.length !== baseBytes.length) return false
    return sameNetwork(ipBytes, baseBytes, bits)
  }
}

function ipToBytes(ip: string): Uint8Array | null {
  if (ip.includes(':')) return ipv6ToBytes(ip)
  return ipv4ToBytes(ip)
}

function ipv4ToBytes(ip: string): Uint8Array | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const bytes = new Uint8Array(4)
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i])
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    bytes[i] = n
  }
  return bytes
}

function ipv6ToBytes(ip: string): Uint8Array | null {
  // Minimal IPv6 parser — supports `::` once.
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - (left.length + right.length)
  if (missing < 0) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8) return null
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const v = parseInt(groups[i], 16)
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null
    bytes[i * 2] = (v >> 8) & 0xff
    bytes[i * 2 + 1] = v & 0xff
  }
  return bytes
}

function sameNetwork(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8)
  for (let i = 0; i < fullBytes; i++) {
    if (a[i] !== b[i]) return false
  }
  const remainder = bits % 8
  if (remainder === 0) return true
  const mask = 0xff << (8 - remainder) & 0xff
  return (a[fullBytes] & mask) === (b[fullBytes] & mask)
}

/**
 * Test-only: clears the parsed-rules cache. Not exported for app code.
 */
export function __resetIpAllowlistCache(): void {
  cachedRules = null
}

export async function enforceAdminIpAllowlist(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const rules = parseRules()
  if (rules.length === 0) return // not configured → allow

  const ip = request.ip
  const allowed = rules.some((rule) => rule.match(ip))
  if (allowed) return

  request.log.warn({ ip, url: request.url }, 'Admin IP allowlist denied request')
  reply.code(403).send({
    success: false,
    message: 'Forbidden — request IP not in admin allowlist',
  })
}
