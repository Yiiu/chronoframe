<script setup lang="ts">
import { computed } from 'vue'
import { motion } from 'motion-v'
import type { NeededExif } from '../../../shared/types/photo'
import type { KVData } from './KVRenderer.vue'
import RatingStars from './RatingStars.vue'
import {
  formatExposureTime,
  splitCameraBrand,
  splitLensBrand,
} from '~/utils/camera'
import {
  cleanExifAnnotation,
  formatFujiDynamicRange,
  formatFujiFilmMode,
} from '~/utils/fuji-recipe'

interface Props {
  currentPhoto: Photo
  exifData?: NeededExif | null
  onClose?: () => void
  /** 对焦点标记是否开启（点亮"对焦"卡片） */
  focusMarkerActive?: boolean
}

const emit = defineEmits<{
  (e: 'toggleFocusMarker'): void
}>()

interface Album {
  id: number
  title: string
  description: string | null
  coverPhotoId: string | null
  createdAt: Date
  updatedAt: Date
}

const dayjs = useDayjs()
const router = useRouter()
const { localizeExif, localizeExifSafe } = useExifLocalization()

const props = defineProps<Props>()

// 获取照片所属的相册
const { data: _albums } = useFetch<Album[]>(
  () => `/api/photos/${props.currentPhoto.id}/albums`,
  {
    watch: [() => props.currentPhoto.id],
  },
)

const albums = computed(() => _albums.value || [])

// 富士胶片模拟设置，非富士照片（无 FilmMode 标签）为 null
const fujiRecipe = computed(() => props.exifData?.fujiRecipe ?? null)

const fujiFilmMode = computed(() =>
  fujiRecipe.value?.FilmMode
    ? formatFujiFilmMode(String(fujiRecipe.value.FilmMode))
    : null,
)

// 富士白平衡：Kelvin 模式用色温插值，其余走现有白平衡枚举翻译
const fujiWhiteBalance = computed(() => {
  const recipe = fujiRecipe.value
  if (!recipe?.WhiteBalance) return null
  const wb = String(recipe.WhiteBalance)
  if (wb === 'Kelvin' && recipe.ColorTemperature) {
    return `${String(recipe.ColorTemperature).replace(/[^0-9]/g, '')}K`
  }
  return localizeExifSafe('whiteBalance', wb)
})

// 品牌 logo 拆分（相机/镜头行在值区渲染字标）
const cameraParts = computed(() =>
  splitCameraBrand(props.exifData?.Make, props.exifData?.Model),
)
const lensParts = computed(() =>
  splitLensBrand(props.exifData?.LensMake, props.exifData?.LensModel),
)

// 格式化GPS坐标为两行显示
const formatGPSCoordinatesMultiLine = (
  latitude: number,
  longitude: number,
): string => {
  const latDirection = latitude >= 0 ? 'N' : 'S'
  const lngDirection = longitude >= 0 ? 'E' : 'W'

  const latDegrees = Math.abs(latitude)
  const lngDegrees = Math.abs(longitude)

  const latDeg = Math.floor(latDegrees)
  const lngDeg = Math.floor(lngDegrees)
  const latMin = Math.floor((latDegrees - latDeg) * 60)
  const lngMin = Math.floor((lngDegrees - lngDeg) * 60)
  const latSec = ((latDegrees - latDeg) * 60 - latMin) * 60
  const lngSec = ((lngDegrees - lngDeg) * 60 - lngMin) * 60

  return `${latDeg}°${latMin}'${latSec.toFixed(2)}"${latDirection}\n${lngDeg}°${lngMin}'${lngSec.toFixed(2)}"${lngDirection}`
}

const gpsCoordinates = computed(() => {
  // 优先使用数据库中存储的坐标
  if (props.currentPhoto.latitude && props.currentPhoto.longitude) {
    return {
      latitude: props.currentPhoto.latitude,
      longitude: props.currentPhoto.longitude,
    }
  }

  // 如果数据库中没有，尝试从EXIF数据中获取
  if (!props.exifData) return null
  const { GPSLatitude, GPSLongitude } = props.exifData
  if (GPSLatitude && GPSLongitude) {
    return {
      latitude: parseFloat(`${GPSLatitude}`),
      longitude: parseFloat(`${GPSLongitude}`),
    }
  }
  return null
})

// ① 信息芯片行：分辨率 / 文件大小 / 拍摄时间
const infoChips = computed(() => {
  const photo = props.currentPhoto
  const chips: { icon: string; text: string }[] = []
  if (photo.width && photo.height) {
    chips.push({
      icon: 'tabler:dimensions',
      text: `${photo.width} × ${photo.height}`,
    })
  }
  if (photo.fileSize) {
    chips.push({ icon: 'tabler:database', text: formatBytes(photo.fileSize) })
  }
  const dateText = photo.dateTaken || props.exifData?.DateTimeOriginal
  if (dateText) {
    chips.push({ icon: 'tabler:calendar', text: dayjs(dateText).format('L LT') })
  }
  return chips
})

// ④ 拍摄参数芯片网格（末位为通栏对焦卡，仅有机身记录对焦信息时出现）
const paramCards = computed(() => {
  const exif = props.exifData
  if (!exif) return []
  const cards: {
    icon: string
    value: string
    label: string
    span2?: boolean
    /** 可点击的对焦卡：切换照片上的对焦点标记 */
    actionable?: boolean
  }[] = []
  if (exif.FocalLengthIn35mmFormat) {
    cards.push({
      icon: 'tabler:zoom-in-area',
      value: `${exif.FocalLengthIn35mmFormat}`,
      label: $t('exif.param.focal'),
    })
  }
  if (exif.FNumber) {
    cards.push({
      icon: 'tabler:aperture',
      value: `f/${exif.FNumber}`,
      label: $t('exif.param.aperture'),
    })
  }
  if (exif.ExposureTime) {
    cards.push({
      icon: 'tabler:clock',
      value: formatExposureTime(exif.ExposureTime),
      label: $t('exif.param.shutter'),
    })
  }
  if (exif.ISO) {
    cards.push({
      icon: 'tabler:sun-electricity',
      value: `ISO ${exif.ISO}`,
      label: $t('exif.param.iso'),
    })
  }
  const focusParts = [
    exif.FocusMode2 ? String(exif.FocusMode2) : '',
    exif.AFAreaMode
      ? localizeExifSafe('afAreaMode', String(exif.AFAreaMode))
      : '',
  ].filter(Boolean)
  if (focusParts.length > 0) {
    cards.push({
      icon: 'tabler:focus-2',
      value: focusParts.join(' · '),
      label: $t('exif.focus.title'),
      span2: true,
      actionable: true,
    })
  }
  return cards
})

const formatedExifData = computed<Record<string, KVData[]>>(() => {
  const sections: Record<string, KVData[]> = {}

  // 相机与文件（原基本信息 + 设备信息合并）
  sections.cameraFiles = [
    {
      title: $t('exif.sections.cameraFiles'),
      items: [
        props.exifData?.Make && props.exifData?.Model
          ? {
              label: $t('exif.camera'),
              value: cameraParts.value.displayText,
              icon: 'tabler:camera',
              brandLogo: cameraParts.value.logoBrand
                ? {
                    name: cameraParts.value.logoBrand,
                    ratio: cameraParts.value.ratio,
                  }
                : null,
            }
          : null,
        props.exifData?.LensModel
          ? {
              label: $t('exif.lens'),
              value: lensParts.value.displayText,
              icon: 'tabler:focus',
              brandLogo: lensParts.value.logoBrand
                ? {
                    name: lensParts.value.logoBrand,
                    ratio: lensParts.value.ratio,
                  }
                : null,
            }
          : null,
        props.currentPhoto.width && props.currentPhoto.height
          ? {
              label: $t('exif.pixels'),
              value: `${((props.currentPhoto.width * props.currentPhoto.height) / 1000000).toFixed(2)} MP`,
              icon: 'tabler:grid-dots',
            }
          : null,
        props.exifData?.ColorSpace
          ? {
              label: $t('exif.colorSpace.title'),
              value: localizeExif('colorSpace', props.exifData.ColorSpace),
              icon: 'tabler:palette',
            }
          : null,
        props.exifData?.Software
          ? {
              label: $t('exif.software'),
              value: props.exifData.Software,
              icon: 'tabler:app-window',
            }
          : null,
        props.currentPhoto.storageKey
          ? {
              label: $t('exif.filename'),
              value:
                props.currentPhoto.storageKey.split('/').pop() ||
                props.currentPhoto.storageKey,
              icon: 'tabler:file',
            }
          : null,
      ],
    },
  ]

  // 拍摄模式（富士照片的白平衡行由胶片模拟分组展示，这里跳过避免重复）
  sections.captureMode = [
    {
      title: $t('exif.sections.shooting.mode'),
      items: [
        !fujiRecipe.value && props.exifData?.WhiteBalance
          ? {
              label: $t('exif.wb.title'),
              value: localizeExif('whiteBalance', props.exifData.WhiteBalance),
              icon: 'mdi:white-balance-auto',
            }
          : null,
        props.exifData?.WBShiftAB
          ? {
              label: $t('exif.wb.shiftAB'),
              value: `${props.exifData.WBShiftAB}`,
              icon: 'mdi:white-balance-auto',
            }
          : null,
        props.exifData?.WBShiftGM
          ? {
              label: $t('exif.wb.shiftGM'),
              value: `${props.exifData.WBShiftGM}`,
              icon: 'mdi:white-balance-auto',
            }
          : null,
        props.exifData?.WhiteBalanceBias
          ? {
              label: $t('exif.wb.bias'),
              value: `${props.exifData.WhiteBalanceBias}`,
              icon: 'mdi:white-balance-auto',
            }
          : null,
        props.exifData?.ExposureProgram
          ? {
              label: $t('exif.exposure.program'),
              value: localizeExif(
                'exposureProgram',
                props.exifData.ExposureProgram,
              ),
              icon: 'tabler:exposure',
            }
          : null,
        props.exifData?.ExposureMode
          ? {
              label: $t('exif.exposure.mode'),
              value: localizeExif('exposureMode', props.exifData.ExposureMode),
              icon: 'tabler:exposure-filled',
            }
          : null,
        props.exifData?.MeteringMode
          ? {
              label: $t('exif.metering.title'),
              value: localizeExif('meteringMode', props.exifData.MeteringMode),
              icon: 'tabler:focus-auto',
            }
          : null,
        props.exifData?.Flash
          ? {
              label: $t('exif.flash.title'),
              value: localizeExif('flash', props.exifData.Flash),
              icon: 'material-symbols:flash-on-rounded',
            }
          : null,
        props.exifData?.FlashMeteringMode
          ? {
              label: $t('exif.flash.meteringMode'),
              value: localizeExif(
                'meteringMode',
                props.exifData.FlashMeteringMode,
              ),
              icon: 'material-symbols:flash-on-rounded',
            }
          : null,
        props.exifData?.SceneCaptureType
          ? {
              label: $t('exif.scene.captureType'),
              value: localizeExif(
                'sceneCaptureType',
                props.exifData.SceneCaptureType,
              ),
              icon: 'material-symbols:scene',
            }
          : null,
      ],
    },
  ]

  // 富士胶片模拟（仅富士机身有 FilmMode 标签，KVRenderer 会自动隐藏空分组）
  if (fujiRecipe.value) {
    const recipe = fujiRecipe.value
    const signedNumber = (value: number) =>
      value > 0 ? `+${value}` : `${value}`
    // 颗粒强度与尺寸都为 Off 时合并为一行
    const grainOff =
      String(recipe.GrainEffectRoughness || '') === 'Off' &&
      String(recipe.GrainEffectSize || '') === 'Off'

    sections.fujiRecipe = [
      {
        title: $t('exif.sections.filmSimulation'),
        items: [
          recipe.FilmMode
            ? {
                label: $t('exif.filmSimulation.mode'),
                value: formatFujiFilmMode(String(recipe.FilmMode)),
                icon: 'mdi:film',
              }
            : null,
          {
            label: $t('exif.filmSimulation.dynamicRange'),
            value: formatFujiDynamicRange(
              recipe.DynamicRangeSetting
                ? String(recipe.DynamicRangeSetting)
                : undefined,
              recipe.DevelopmentDynamicRange,
            ),
            icon: 'tabler:contrast',
          },
          fujiWhiteBalance.value
            ? {
                label: $t('exif.wb.title'),
                value: fujiWhiteBalance.value,
                icon: 'mdi:white-balance-auto',
              }
            : null,
          grainOff
            ? {
                label: $t('exif.filmSimulation.grainStrength'),
                value: localizeExifSafe('fujiStrength', 'Off'),
                icon: 'tabler:grain',
              }
            : null,
          !grainOff && recipe.GrainEffectRoughness
            ? {
                label: $t('exif.filmSimulation.grainStrength'),
                value: localizeExifSafe(
                  'fujiStrength',
                  String(recipe.GrainEffectRoughness),
                ),
                icon: 'tabler:grain',
              }
            : null,
          !grainOff && recipe.GrainEffectSize
            ? {
                label: $t('exif.filmSimulation.grainSize'),
                value: localizeExifSafe(
                  'fujiGrainSize',
                  String(recipe.GrainEffectSize),
                ),
                icon: 'tabler:grain',
              }
            : null,
          recipe.ColorChromeEffect
            ? {
                label: $t('exif.filmSimulation.colorChrome'),
                value: localizeExifSafe(
                  'fujiStrength',
                  String(recipe.ColorChromeEffect),
                ),
                icon: 'tabler:color-swatch',
              }
            : null,
          recipe.ColorChromeFXBlue
            ? {
                label: $t('exif.filmSimulation.colorChromeBlue'),
                value: localizeExifSafe(
                  'fujiStrength',
                  String(recipe.ColorChromeFXBlue),
                ),
                icon: 'tabler:color-swatch',
              }
            : null,
          recipe.HighlightTone
            ? {
                label: $t('exif.filmSimulation.highlightTone'),
                value: cleanExifAnnotation(String(recipe.HighlightTone)),
                icon: 'tabler:sun-high',
              }
            : null,
          recipe.ShadowTone
            ? {
                label: $t('exif.filmSimulation.shadowTone'),
                value: cleanExifAnnotation(String(recipe.ShadowTone)),
                icon: 'tabler:moon',
              }
            : null,
          recipe.Saturation
            ? {
                label: $t('exif.filmSimulation.saturation'),
                value: cleanExifAnnotation(String(recipe.Saturation)),
                icon: 'tabler:palette',
              }
            : null,
          recipe.Sharpness
            ? {
                label: $t('exif.filmSimulation.sharpness'),
                value: localizeExifSafe(
                  'fujiSharpness',
                  cleanExifAnnotation(String(recipe.Sharpness)),
                ),
                icon: 'tabler:triangle',
              }
            : null,
          typeof recipe.Clarity === 'number'
            ? {
                label: $t('exif.filmSimulation.clarity'),
                value: signedNumber(recipe.Clarity),
                icon: 'tabler:circle-plus',
              }
            : null,
        ],
      },
    ]
  }

  return sections
})

const isMobile = useMediaQuery('(max-width: 768px)')

const onMinimapClick = (photoId: string) => {
  window.open(`/globe?photoId=${photoId}`)
}

const onTagClick = (tag: string) => {
  router.push({
    path: '/',
    query: { tag },
  })
}

const onAlbumClick = (albumId: number) => {
  window.open(`/albums/${albumId}`)
}
</script>

<template>
  <motion.div
    :initial="{
      opacity: 0,
      x: isMobile ? 0 : 80,
      y: isMobile ? 20 : 0,
    }"
    :animate="{
      opacity: 1,
      x: 0,
      y: 0,
    }"
    :exit="{
      opacity: 0,
      x: isMobile ? 0 : 80,
      y: isMobile ? 20 : 0,
    }"
    :transition="{ type: 'spring', duration: 0.4, bounce: 0, delay: 0.1 }"
    class="bg-black/20 dark:bg-black/30 backdrop-blur-xl border-white/10"
    :class="{
      'fixed inset-x-2 bottom-2 max-h-[70vh] border rounded-xl z-50 flex flex-col':
        isMobile,
      'w-80 border-l': !isMobile,
    }"
  >
    <div
      class="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 shrink-0"
    >
      <div class="flex items-center gap-2 min-w-0">
        <h3 class="font-black text-white text-ellipsis line-clamp-1">
          {{ currentPhoto.title }}
        </h3>
        <UBadge
          v-if="fujiFilmMode"
          :label="fujiFilmMode"
          size="sm"
          color="neutral"
          variant="soft"
          icon="mdi:film"
          class="bg-white/10 text-white shrink-0"
        />
      </div>
      <UButton
        v-if="isMobile && onClose"
        icon="tabler:x"
        variant="ghost"
        color="neutral"
        class="text-white"
        size="sm"
        @click="onClose"
      />
    </div>

    <!-- 内容区域 -->
    <ScrollArea
      class="flex-1 min-h-0"
      :class="{ 'max-h-full': !isMobile }"
      tone="dark"
      :content-class="['p-4 space-y-4', { 'pb-16': !isMobile }]"
    >
      <!-- ① 信息芯片行 -->
      <div
        v-if="infoChips.length > 0"
        class="flex flex-wrap gap-1.5"
      >
        <span
          v-for="(chip, index) in infoChips"
          :key="index"
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/90 tabular-nums"
        >
          <Icon
            :name="chip.icon"
            class="size-3.5 opacity-75 shrink-0"
          />
          {{ chip.text }}
        </span>
      </div>

      <!-- ② 照片描述 -->
      <div
        v-if="currentPhoto.description"
        class="text-sm text-white text-justify"
      >
        {{ currentPhoto.description }}
      </div>

      <!-- ③ 标签 + 评分 -->
      <div
        v-if="
          (currentPhoto.tags && currentPhoto.tags.length > 0) ||
          currentPhoto.exif?.Rating
        "
        class="flex items-center justify-between gap-2"
      >
        <div
          v-if="currentPhoto.tags && currentPhoto.tags.length > 0"
          class="flex flex-wrap gap-1"
        >
          <UBadge
            v-for="tag in currentPhoto.tags"
            :key="tag"
            :label="tag"
            variant="soft"
            size="sm"
            color="neutral"
            class="bg-white/10 text-white cursor-pointer select-none hover:bg-white/20 transition-colors"
            @click="onTagClick(tag)"
          />
        </div>
        <RatingStars
          v-if="currentPhoto.exif?.Rating"
          :value="currentPhoto.exif.Rating"
          :size="13"
          class="shrink-0"
        />
      </div>

      <!-- ④ 拍摄参数芯片网格 -->
      <div v-if="paramCards.length > 0">
        <h4
          class="text-sm font-medium text-white uppercase tracking-wide mb-2.5"
        >
          {{ $t('exif.sections.shooting.parameters') }}
        </h4>
        <div class="grid grid-cols-2 gap-1.5">
          <div
            v-for="(card, index) in paramCards"
            :key="index"
            class="flex items-center gap-2 rounded-[10px] border px-2.5 py-2 min-w-0"
            :class="[
              card.span2 ? 'col-span-2' : '',
              'border-white/10 bg-white/5',
              card.actionable
                ? 'cursor-pointer select-none transition-colors hover:bg-white/10'
                : '',
              card.actionable && focusMarkerActive
                ? 'border-emerald-400/50 bg-emerald-400/10'
                : '',
            ]"
            :role="card.actionable ? 'button' : undefined"
            @click="card.actionable && emit('toggleFocusMarker')"
          >
            <Icon
              :name="card.icon"
              class="size-3.5 shrink-0"
              :class="
                card.actionable && focusMarkerActive
                  ? 'text-emerald-300'
                  : 'opacity-75'
              "
            />
            <div class="min-w-0 flex-1">
              <div
                class="text-[13px] font-bold text-white truncate tabular-nums leading-tight"
              >
                {{ card.value }}
              </div>
              <div class="text-[10px] text-white/45 mt-0.5">
                {{ card.label }}
              </div>
            </div>
            <Icon
              v-if="card.actionable"
              :name="focusMarkerActive ? 'tabler:eye' : 'tabler:eye-off'"
              class="size-3.5 shrink-0"
              :class="
                focusMarkerActive ? 'text-emerald-300' : 'text-white/35'
              "
            />
          </div>
        </div>
      </div>

      <!-- ⑤ 胶片模拟（仅富士） -->
      <PhotoKVRenderer
        v-if="formatedExifData.fujiRecipe"
        :data="formatedExifData.fujiRecipe"
      />

      <!-- ⑥ 直方图 + 影调占比 -->
      <div
        v-if="currentPhoto.thumbnailUrl"
        class="space-y-2"
      >
        <h4 class="text-sm font-medium text-white uppercase tracking-wide">
          {{ $t('exif.sections.histogram') }}
        </h4>
        <Histogram
          :thumbnail-url="currentPhoto.thumbnailUrl"
          show-tone-stats
          class="h-24"
        />
      </div>

      <!-- ⑦ 相机与文件 -->
      <PhotoKVRenderer
        v-if="formatedExifData.cameraFiles"
        :data="formatedExifData.cameraFiles"
      />

      <!-- ⑧ 拍摄模式 -->
      <PhotoKVRenderer
        v-if="formatedExifData.captureMode"
        :data="formatedExifData.captureMode"
      />

      <!-- ⑨ 位置 -->
      <div
        v-if="gpsCoordinates"
        class="space-y-2"
      >
        <h4 class="text-sm font-medium text-white uppercase tracking-wide">
          {{ $t('exif.sections.location') }}
        </h4>
        <PhotoMiniMap
          :photo="currentPhoto"
          :latitude="gpsCoordinates?.latitude"
          :longitude="gpsCoordinates?.longitude"
          class="cursor-pointer"
          @click="onMinimapClick(currentPhoto.id)"
        />
        <div class="flex items-start justify-between gap-3 text-xs">
          <span class="flex items-center gap-1.5 text-white/70 min-w-0">
            <Icon
              name="tabler:map-pin"
              class="size-3.5 shrink-0"
            />
            <span class="truncate">
              {{
                [currentPhoto.country, currentPhoto.city]
                  .filter(Boolean)
                  .join(' · ') || $t('exif.gps.title')
              }}
            </span>
          </span>
          <span
            v-if="gpsCoordinates?.latitude && gpsCoordinates?.longitude"
            class="tabular-nums text-white/50 text-[10px] whitespace-pre-line text-end shrink-0"
          >
            {{
              formatGPSCoordinatesMultiLine(
                gpsCoordinates.latitude,
                gpsCoordinates.longitude,
              )
            }}
          </span>
        </div>
      </div>

      <!-- ⑩ 相册 -->
      <div
        v-if="albums && albums.length > 0"
        class="mt-4"
      >
        <h4
          class="text-sm font-medium text-white/90 uppercase tracking-wide mb-2"
        >
          {{ $t('exif.sections.albums') }}
        </h4>
        <div class="space-y-2">
          <div
            v-for="album in albums"
            :key="album.id"
            class="p-3 bg-white/5 border border-white/10 rounded-lg cursor-pointer hover:bg-white/10 transition-colors"
            @click="onAlbumClick(album.id)"
          >
            <p class="text-sm text-white font-medium line-clamp-1">
              {{ album.title }}
            </p>
            <p
              v-if="album.description"
              class="text-xs text-white/60 line-clamp-1"
            >
              {{ album.description }}
            </p>
          </div>
        </div>
      </div>
    </ScrollArea>
  </motion.div>
</template>
