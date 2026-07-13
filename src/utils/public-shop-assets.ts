import { env } from '../config/env'
import { GalleryItemType } from '../types/enums'

export const PUBLIC_SHOP_ASSET_KEYS = {
  CAR_SEDAN: 'shop-car-sedan',
  CAR_SUV: 'shop-car-suv',
  SALE_ITEM: 'shop-sale-item',
} as const

export type PublicShopAssetKey =
  (typeof PUBLIC_SHOP_ASSET_KEYS)[keyof typeof PUBLIC_SHOP_ASSET_KEYS]

const SHOP_ASSET_SVGS: Record<PublicShopAssetKey, string> = {
  [PUBLIC_SHOP_ASSET_KEYS.CAR_SEDAN]: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" role="img" aria-labelledby="title desc">
  <title id="title">Global Express sedan listing</title>
  <desc id="desc">Illustrated preview image for a sedan vehicle listing.</desc>
  <defs>
    <linearGradient id="bgSedan" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#fff4ec"/>
      <stop offset="100%" stop-color="#ffd8bf"/>
    </linearGradient>
    <linearGradient id="carSedan" x1="0%" x2="100%" y1="0%" y2="0%">
      <stop offset="0%" stop-color="#1f2937"/>
      <stop offset="100%" stop-color="#4b5563"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" rx="36" fill="url(#bgSedan)"/>
  <rect x="80" y="90" width="1040" height="620" rx="28" fill="#ffffff" opacity="0.78"/>
  <rect x="92" y="482" width="1016" height="142" rx="24" fill="#ff6a13" opacity="0.14"/>
  <path d="M248 468c28-88 112-174 238-201l162-34c114-23 196 20 249 114l51 89c10 18 15 38 15 58v54H208v-42c0-21 5-40 14-58l26-52z" fill="url(#carSedan)"/>
  <path d="M384 301h279c63 0 113 24 154 83l29 42H321l28-55c10-20 20-40 35-70z" fill="#111827" opacity="0.92"/>
  <circle cx="360" cy="549" r="72" fill="#111827"/>
  <circle cx="360" cy="549" r="38" fill="#e5e7eb"/>
  <circle cx="853" cy="549" r="72" fill="#111827"/>
  <circle cx="853" cy="549" r="38" fill="#e5e7eb"/>
  <rect x="520" y="170" width="230" height="58" rx="29" fill="#ff6a13"/>
  <text x="635" y="208" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">CAR LISTING</text>
  <text x="120" y="674" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#1f2937">Global Express verified vehicle preview</text>
  <text x="120" y="718" font-family="Arial, sans-serif" font-size="24" fill="#4b5563">Stable backend-served image for public shop cards</text>
</svg>`,
  [PUBLIC_SHOP_ASSET_KEYS.CAR_SUV]: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" role="img" aria-labelledby="title desc">
  <title id="title">Global Express SUV listing</title>
  <desc id="desc">Illustrated preview image for an SUV vehicle listing.</desc>
  <defs>
    <linearGradient id="bgSuv" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#eef6ff"/>
      <stop offset="100%" stop-color="#d6ecff"/>
    </linearGradient>
    <linearGradient id="carSuv" x1="0%" x2="100%" y1="0%" y2="0%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" rx="36" fill="url(#bgSuv)"/>
  <rect x="80" y="90" width="1040" height="620" rx="28" fill="#ffffff" opacity="0.82"/>
  <rect x="108" y="470" width="984" height="154" rx="28" fill="#0ea5e9" opacity="0.12"/>
  <path d="M221 452c29-105 132-212 279-247l148-35c120-28 232 23 309 141l44 69c14 22 21 46 21 72v88H188v-50c0-19 4-38 12-55l21-43z" fill="url(#carSuv)"/>
  <path d="M366 249h333c95 0 164 52 224 160H294c25-74 42-107 72-160z" fill="#111827" opacity="0.94"/>
  <circle cx="368" cy="554" r="74" fill="#111827"/>
  <circle cx="368" cy="554" r="39" fill="#e2e8f0"/>
  <circle cx="868" cy="554" r="74" fill="#111827"/>
  <circle cx="868" cy="554" r="39" fill="#e2e8f0"/>
  <rect x="468" y="164" width="264" height="58" rx="29" fill="#ff6a13"/>
  <text x="600" y="202" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">SUV LISTING</text>
  <text x="120" y="674" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#0f172a">Global Express verified vehicle preview</text>
  <text x="120" y="718" font-family="Arial, sans-serif" font-size="24" fill="#475569">Stable backend-served image for public shop cards</text>
</svg>`,
  [PUBLIC_SHOP_ASSET_KEYS.SALE_ITEM]: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" role="img" aria-labelledby="title desc">
  <title id="title">Global Express sale item listing</title>
  <desc id="desc">Illustrated preview image for a regular warehouse sale item.</desc>
  <defs>
    <linearGradient id="bgSale" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#fff7ed"/>
      <stop offset="100%" stop-color="#ffedd5"/>
    </linearGradient>
    <linearGradient id="boxSale" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#f4b26c"/>
      <stop offset="100%" stop-color="#d9863d"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" rx="36" fill="url(#bgSale)"/>
  <rect x="86" y="100" width="1028" height="602" rx="28" fill="#ffffff" opacity="0.8"/>
  <rect x="132" y="152" width="302" height="496" rx="32" fill="#ff6a13" opacity="0.12"/>
  <rect x="766" y="132" width="282" height="520" rx="32" fill="#ff6a13" opacity="0.18"/>
  <path d="M465 284l156-96 198 113v220L655 618 465 508z" fill="url(#boxSale)" stroke="#9f5d22" stroke-width="8"/>
  <path d="M621 188v333" stroke="#9f5d22" stroke-width="8"/>
  <path d="M465 284l190 111 164-94" fill="none" stroke="#9f5d22" stroke-width="8"/>
  <rect x="518" y="162" width="205" height="54" rx="27" fill="#ff6a13"/>
  <text x="621" y="198" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff">SALE ITEM</text>
  <text x="126" y="680" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#1f2937">Global Express warehouse sale preview</text>
  <text x="126" y="724" font-family="Arial, sans-serif" font-size="24" fill="#4b5563">Stable backend-served image for public shop cards</text>
</svg>`,
}

const UNCONTROLLED_PUBLIC_IMAGE_HOSTS = ['source.unsplash.com']

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function getPublicAppBaseUrl(): string {
  const configuredBase =
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    process.env.PUBLIC_BASE_URL?.trim()

  if (configuredBase) {
    return stripTrailingSlash(configuredBase)
  }

  if (env.NODE_ENV === 'production') {
    return 'https://api.globalexpress.kr'
  }

  return `http://localhost:${env.PORT}`
}

export function getPublicShopAssetUrl(assetKey: PublicShopAssetKey): string {
  return `${getPublicAppBaseUrl()}/api/v1/public/gallery/assets/${assetKey}.svg`
}

export function isPublicShopAssetKey(value: string): value is PublicShopAssetKey {
  return Object.values(PUBLIC_SHOP_ASSET_KEYS).includes(value as PublicShopAssetKey)
}

export function getPublicShopAssetSvg(assetKey: PublicShopAssetKey): string {
  return SHOP_ASSET_SVGS[assetKey]
}

export function isUncontrolledPublicImageUrl(url: string | null | undefined): boolean {
  if (!url) return true

  return UNCONTROLLED_PUBLIC_IMAGE_HOSTS.some((host) => url.includes(host))
}

export function getDefaultPublicShopAssetKey(input: {
  itemType: GalleryItemType | string | null | undefined
  title?: string | null
  description?: string | null
}): PublicShopAssetKey | null {
  if (input.itemType === GalleryItemType.CAR) {
    const searchable = `${input.title ?? ''} ${input.description ?? ''}`.toLowerCase()
    return /suv|rx|lexus|crossover/.test(searchable)
      ? PUBLIC_SHOP_ASSET_KEYS.CAR_SUV
      : PUBLIC_SHOP_ASSET_KEYS.CAR_SEDAN
  }

  if (input.itemType === GalleryItemType.FOR_SALE) {
    return PUBLIC_SHOP_ASSET_KEYS.SALE_ITEM
  }

  return null
}
