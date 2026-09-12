// 从 simple-icons 生成相机/镜头品牌 logo 资产。
// simple-icons 的画布是 24x24 正方形，FUJIFILM/SONY 这类字标只占中间一条细带，
// 直接缩到图标尺寸不可读。本脚本计算 path 实际包围盒，输出裁剪 viewBox 的 SVG
// （public/brand-logos/）+ 尺寸清单（app/utils/brand-logos.ts，含宽高比），
// 前端用 CSS mask 渲染即可继承文字颜色。运行：pnpm brand-logos
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import getBounds from 'svg-path-bounds'

// 品牌规范名 → simple-icons slug（缺省即 simple-icons 已下架该标，回退通用图标）
const BRAND_SLUGS = {
  FUJIFILM: 'fujifilm',
  SONY: 'sony',
  PANASONIC: 'panasonic',
  NIKON: 'nikon',
  LEICA: 'leica',
  APPLE: 'apple',
  SAMSUNG: 'samsung',
  DJI: 'dji',
  GOOGLE: 'google',
  XIAOMI: 'xiaomi',
  HUAWEI: 'huawei',
  ONEPLUS: 'oneplus',
  OPPO: 'oppo',
  VIVO: 'vivo',
  REALME: 'realme',
  HONOR: 'honor',
  RICOH: 'ricoh',
  PENTAX: 'pentax',
  ZEISS: 'zeiss',
  SIGMA: 'sigma',
  TAMRON: 'tamron',
  SAMYANG: 'samyang',
  TOKINA: 'tokina',
  HASSELBLAD: 'hasselblad',
  CANON: 'canon',
  OLYMPUS: 'olympus',
}

const iconsJson = JSON.parse(
  await readFile('node_modules/@iconify-json/simple-icons/icons.json', 'utf8'),
)

const outDir = 'public/brand-logos'
await mkdir(outDir, { recursive: true })

const manifest = {}
const skipped = []
for (const [brand, slug] of Object.entries(BRAND_SLUGS)) {
  const icon = iconsJson.icons[slug] ?? iconsJson.aliases?.[slug]
  const body = icon?.body
  if (!body) {
    skipped.push(`${brand} (${slug})`)
    continue
  }
  // body 可能含多个 path 及 circle 等元素，取所有 path d 的联合包围盒
  const dAttrs = [...body.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1])
  if (dAttrs.length === 0) {
    skipped.push(`${brand} (no paths)`)
    continue
  }
  let b = null
  for (const d of dAttrs) {
    let pb
    try {
      pb = getBounds(d)
    } catch {
      continue
    }
    b = b
      ? {
          x1: Math.min(b.x1, pb[0]),
          y1: Math.min(b.y1, pb[1]),
          x2: Math.max(b.x2, pb[2]),
          y2: Math.max(b.y2, pb[3]),
        }
      : { x1: pb[0], y1: pb[1], x2: pb[2], y2: pb[3] }
  }
  if (!b) {
    skipped.push(`${brand} (bounds failed)`)
    continue
  }
  const w = b.x2 - b.x1
  const h = b.y2 - b.y1
  if (!(w > 0 && h > 0)) {
    skipped.push(`${brand} (empty bounds)`)
    continue
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x1} ${b.y1} ${w} ${h}" fill="currentColor"><path d="${dAttrs.join(' ')}"/></svg>\n`
  await writeFile(`${outDir}/${slug}.svg`, svg)
  manifest[brand] = { file: slug, ratio: Number((w / h).toFixed(4)) }
}

await writeFile(
  'app/utils/brand-logos.ts',
  `// 由 scripts/generate-brand-logos.mjs 生成，勿手改；运行 pnpm brand-logos 重新生成。
// ratio 为裁剪后字标的宽高比（w/h），供 CSS mask 按 aspect-ratio 渲染。
export const BRAND_LOGOS = ${JSON.stringify(manifest, null, 2)} as const

export type BrandLogoName = keyof typeof BRAND_LOGOS
`,
)

console.log(`generated: ${Object.keys(manifest).length} brands -> ${outDir}`)
if (skipped.length > 0) {
  console.log(`skipped (not in simple-icons): ${skipped.join(', ')}`)
}
