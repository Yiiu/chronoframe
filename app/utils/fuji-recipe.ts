/**
 * 富士胶片模拟（Film Simulation）值的格式化规则。
 *
 * 规则与 Afilmory 的实现保持一致：括号注释清洗、FilmMode 短名映射、
 * 动态范围 DR 值拼接。全部是纯函数，方便单测。
 */

/**
 * 去掉 exiftool 枚举值尾部的括号注释：'+2 (hard)' → '+2'
 */
export function cleanExifAnnotation(value: string): string {
  return value.replace(/\s*\([^)]*\)$/, '').trim()
}

/**
 * 富士 FilmMode 长名映射为机身菜单短名：
 * 'F1b/Studio Portrait Smooth Skin Tone (Astia)' → 'Astia'
 * 'F1a/Studio Portrait Enhanced Saturation'      → 'Studio Portrait Enhanced Saturation'
 * 'Classic Chrome'                               → 'Classic Chrome'
 */
export function formatFujiFilmMode(filmMode: string): string {
  const parenthesis = filmMode.match(/\(([^)]+)\)\s*$/)
  if (parenthesis) {
    return parenthesis[1]
  }
  return filmMode.replace(/^F\d[a-c]?\//, '').trim()
}

/**
 * 动态范围显示值：手动模式拼 DR 值（如 DR400），标准档 DR100，其余视为 Auto。
 * DR200/DR400 是富士机身菜单的原生写法，不做翻译。
 */
export function formatFujiDynamicRange(
  setting: string | undefined,
  developmentDynamicRange: number | string | undefined,
): string {
  const dev =
    typeof developmentDynamicRange === 'string'
      ? Number.parseInt(developmentDynamicRange, 10)
      : developmentDynamicRange

  if (setting === 'Manual' && dev && dev > 0) {
    return `DR${dev}`
  }
  if (dev && dev > 100) {
    return `DR${dev}`
  }
  if (setting === 'Standard') {
    return 'DR100'
  }
  return 'Auto'
}
