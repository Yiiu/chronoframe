// 由 scripts/generate-brand-logos.mjs 生成，勿手改；运行 pnpm brand-logos 重新生成。
// ratio 为裁剪后字标的宽高比（w/h），供 CSS mask 按 aspect-ratio 渲染。
export const BRAND_LOGOS = {
  "FUJIFILM": {
    "file": "fujifilm",
    "ratio": 5.944
  },
  "SONY": {
    "file": "sony",
    "ratio": 5.6799
  },
  "PANASONIC": {
    "file": "panasonic",
    "ratio": 6.4857
  },
  "NIKON": {
    "file": "nikon",
    "ratio": 3.5797
  },
  "LEICA": {
    "file": "leica",
    "ratio": 1
  },
  "APPLE": {
    "file": "apple",
    "ratio": 0.8591
  },
  "SAMSUNG": {
    "file": "samsung",
    "ratio": 6.5431
  },
  "DJI": {
    "file": "dji",
    "ratio": 1.694
  },
  "GOOGLE": {
    "file": "google",
    "ratio": 0.9744
  },
  "XIAOMI": {
    "file": "xiaomi",
    "ratio": 1
  },
  "HUAWEI": {
    "file": "huawei",
    "ratio": 1.3269
  },
  "ONEPLUS": {
    "file": "oneplus",
    "ratio": 1
  },
  "OPPO": {
    "file": "oppo",
    "ratio": 4.2068
  },
  "VIVO": {
    "file": "vivo",
    "ratio": 3.7956
  },
  "HONOR": {
    "file": "honor",
    "ratio": 4.9991
  }
} as const

export type BrandLogoName = keyof typeof BRAND_LOGOS
