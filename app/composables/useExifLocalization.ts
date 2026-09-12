import {
  toCamelCaseKey,
  translateExifValue,
} from '~/utils/exif-localization'

/**
 * EXIF 本地化的 Composable
 * 提供在组件中使用的便捷方法
 */
export function useExifLocalization() {
  const { $i18n } = useNuxtApp()

  /**
   * 本地化 EXIF 字段值
   * @param category EXIF 字段名
   * @param value 原始值
   * @returns 本地化后的值
   */
  const localizeExif = (
    category: ExifCategory,
    value: string | number | undefined,
  ): string => {
    return translateExifValue(category, value, $i18n.t)
  }

  /**
   * 带回退的本地化：枚举值没有对应翻译键时返回原值，
   * 适用于值集合开放的字段（如富士白平衡的 Kelvin/Custom 系列）
   */
  const localizeExifSafe = (
    category: ExifCategory,
    value: string | number | undefined,
  ): string => {
    if (!value) return ''
    const key = `exif.values.${category}.${toCamelCaseKey(String(value))}`
    return $i18n.te(key) ? $i18n.t(key) : String(value)
  }

  return {
    localizeExif,
    localizeExifSafe,
  }
}
