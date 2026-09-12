import { BRAND_LOGOS } from './brand-logos'

/** 相机品牌规范名 → 品牌关键词（与 formatCameraInfo 的判定保持一致） */
const CAMERA_BRANDS: Record<string, string[]> = {
  Canon: ['canon', 'eos'],
  Nikon: ['nikon'],
  Sony: ['sony', 'ilce', 'dsc'],
  Fujifilm: ['fujifilm', 'fuji', 'x-'],
  Olympus: ['olympus', 'om-', 'e-'],
  Panasonic: ['panasonic', 'lumix', 'dc-', 'dmc-'],
  Leica: ['leica'],
  Pentax: ['pentax', 'k-'],
  Ricoh: ['ricoh', 'gr'],
  Hasselblad: ['hasselblad'],
  'Phase One': ['phase one'],
  Mamiya: ['mamiya'],
  Apple: ['apple'],
  Samsung: ['samsung', 'galaxy', 'sm-'],
  Google: ['pixel'],
  Xiaomi: ['xiaomi', 'mi ', 'redmi'],
  Huawei: ['huawei', 'p30', 'p40', 'p50', 'mate'],
  OnePlus: ['oneplus'],
  OPPO: ['oppo'],
  Vivo: ['vivo'],
  Realme: ['realme'],
  Honor: ['honor'],
}

/** 镜头品牌规范名 → 品牌关键词 */
const LENS_BRANDS: Record<string, string[]> = {
  Canon: ['canon', 'ef', 'rf'],
  Nikon: ['nikon', 'nikkor'],
  Sony: ['sony', 'fe', 'e '],
  Sigma: ['sigma'],
  Tamron: ['tamron'],
  Tokina: ['tokina'],
  Samyang: ['samyang'],
  Zeiss: ['zeiss'],
  'Voigtländer': ['voigtlander', 'voigtländer'],
  Leica: ['leica'],
  Panasonic: ['panasonic', 'lumix'],
  Olympus: ['olympus', 'zuiko'],
  Fujifilm: ['fujifilm', 'fujinon', 'xf', 'xc'],
}

/** 型号文本里需要剥掉的品牌词（只剥品牌本名/别名，避免误伤 X-T5 这类型号） */
const BRAND_NAME_WORDS: Record<string, string[]> = {
  Fujifilm: ['fujifilm', 'fuji', 'fujinon'],
  Panasonic: ['panasonic', 'lumix'],
  Sony: ['sony'],
  Nikon: ['nikon', 'nikkor'],
  Canon: ['canon'],
  Leica: ['leica'],
  Sigma: ['sigma'],
  Tamron: ['tamron'],
  Zeiss: ['zeiss'],
  Samsung: ['samsung'],
  Apple: ['apple'],
}

export interface BrandParts {
  /** 有本地 logo 资产的品牌（BRAND_LOGOS 键，如 'FUJIFILM'），无则 null */
  logoBrand: string | null
  /** 品牌规范名（如 'Fujifilm'），无法识别品牌时为 null */
  brand: string | null
  /** 去掉品牌词后的型号文本 */
  modelText: string
  /** 品牌与型号合并的完整展示文本（无品牌时回退用） */
  fullText: string
  /** logo 宽高比（w/h），logo 为 null 时无意义 */
  ratio: number
}

const splitBrand = (
  make: string | undefined,
  raw: string | undefined,
  brandMap: Record<string, string[]>,
): BrandParts => {
  const model = raw?.trim() || ''
  let canonical = make
    ? Object.keys(brandMap).find(
        (b) => b.toLowerCase() === make.toLowerCase().trim(),
      ) ?? null
    : null

  let modelText = model

  // 部分机身不写 LensMake（如 Panasonic），从型号首词反推品牌（LUMIX/FUJINON/NIKKOR…）
  if (!canonical && model) {
    const lower = model.toLowerCase()
    for (const [brand, words] of Object.entries(BRAND_NAME_WORDS)) {
      if (!brandMap[brand]) continue
      const hit = words.find((w) => lower.startsWith(`${w} `))
      if (hit) {
        canonical = brand
        modelText = model.replace(new RegExp(`^${hit}\\s+`, 'i'), '').trim()
        break
      }
    }
  }

  if (canonical && modelText) {
    for (const word of BRAND_NAME_WORDS[canonical] ?? []) {
      const re = new RegExp(`^${word}\\s+`, 'i')
      if (re.test(modelText)) {
        modelText = modelText.replace(re, '').trim()
        break
      }
    }
  }

  const logoKey = canonical?.toUpperCase()
  const logo = logoKey ? BRAND_LOGOS[logoKey as keyof typeof BRAND_LOGOS] : undefined

  const fullText = formatCameraInfo(make, raw)

  return {
    logoBrand: logo ? (logoKey as string) : null,
    brand: canonical,
    modelText: modelText || fullText,
    fullText,
    /** 值区展示文本：有字标 logo 时品牌由 logo 承担，只显示型号；否则回退完整文本 */
    displayText: logo ? modelText : fullText,
    ratio: logo?.ratio ?? 1,
  }
}

/**
 * 相机品牌拆分：返回可渲染字标 logo 的品牌键与剥离品牌词后的型号
 */
export function splitCameraBrand(make?: string, model?: string): BrandParts {
  return splitBrand(make, model, CAMERA_BRANDS)
}

/**
 * 镜头品牌拆分（同上，品牌词额外覆盖 FUJINON/NIKKOR 等镜头线名）
 */
export function splitLensBrand(lensMake?: string, lensModel?: string): BrandParts {
  return splitBrand(lensMake, lensModel, LENS_BRANDS)
}

/**
 * 处理相机品牌和型号的显示，避免品牌名称重复
 */
export function formatCameraInfo(make?: string, model?: string): string {
  if (!make && !model) return ''
  if (!make) return model || ''
  if (!model) return make

  // 品牌关键词判定与 splitCameraBrand 共用一张表
  const brandMap = CAMERA_BRANDS

  const makeNormalized = make.toLowerCase().trim()
  const modelNormalized = model.toLowerCase().trim()

  // 检查型号中是否已经包含品牌信息
  const brandKeywords = brandMap[make] || [makeNormalized]
  const modelContainsBrand = brandKeywords.some((keyword) =>
    modelNormalized.includes(keyword.toLowerCase()),
  )

  if (modelContainsBrand) {
    // 如果型号已包含品牌信息，只返回型号
    return model
  } else {
    // 如果型号不包含品牌信息，返回品牌+型号
    return `${make} ${model}`
  }
}

/**
 * 格式化曝光时间：>=1s 显示为 "Ns"，快门以分数 "1/x" 显示；无法解析时原样返回
 */
export function formatExposureTime(
  exposureTime: string | number | undefined,
): string {
  if (!exposureTime) return ''

  let seconds: number

  if (typeof exposureTime === 'string') {
    if (exposureTime.includes('/')) {
      const parts = exposureTime.split('/')
      if (parts.length === 2 && parts[0] && parts[1]) {
        const numerator = parseFloat(parts[0])
        const denominator = parseFloat(parts[1])
        if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
          seconds = numerator / denominator
        } else {
          return exposureTime
        }
      } else {
        return exposureTime
      }
    } else {
      seconds = parseFloat(exposureTime)
      if (isNaN(seconds)) {
        return exposureTime
      }
    }
  } else {
    seconds = exposureTime
  }

  if (seconds >= 1) {
    return `${seconds}s`
  } else {
    const denominator = Math.round(1 / seconds)
    return `1/${denominator}`
  }
}

/**
 * 格式化镜头信息，处理品牌和型号
 */
export function formatLensInfo(lensMake?: string, lensModel?: string): string {
  if (!lensMake && !lensModel) return ''
  if (!lensMake) return lensModel || ''
  if (!lensModel) return lensMake

  // 镜头品牌关键词与 splitLensBrand 共用一张表
  const lensBrandMap = LENS_BRANDS

  const lensMakeNormalized = lensMake.toLowerCase().trim()
  const lensModelNormalized = lensModel.toLowerCase().trim()

  // 检查镜头型号中是否已经包含品牌信息
  const brandKeywords = lensBrandMap[lensMake] || [lensMakeNormalized]
  const modelContainsBrand = brandKeywords.some((keyword) =>
    lensModelNormalized.includes(keyword.toLowerCase()),
  )

  if (modelContainsBrand) {
    return lensModel
  } else {
    return `${lensMake} ${lensModel}`
  }
}
