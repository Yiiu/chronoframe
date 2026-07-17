/**
 * 处理相机品牌和型号的显示，避免品牌名称重复
 */
export function formatCameraInfo(make?: string, model?: string): string {
  if (!make && !model) return ''
  if (!make) return model || ''
  if (!model) return make

  // 常见品牌名称映射（包括各种可能的变体）
  const brandMap: Record<string, string[]> = {
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

  // 镜头品牌映射
  const lensBrandMap: Record<string, string[]> = {
    Canon: ['canon', 'ef', 'rf'],
    Nikon: ['nikon', 'nikkor'],
    Sony: ['sony', 'fe', 'e '],
    Sigma: ['sigma'],
    Tamron: ['tamron'],
    Tokina: ['tokina'],
    Samyang: ['samyang'],
    Zeiss: ['zeiss'],
    Voigtländer: ['voigtlander', 'voigtländer'],
    Leica: ['leica'],
    Panasonic: ['panasonic', 'lumix'],
    Olympus: ['olympus', 'zuiko'],
    Fujifilm: ['fujifilm', 'fujinon', 'xf', 'xc'],
  }

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
