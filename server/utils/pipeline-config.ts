/**
 * 从环境变量解析并发 worker 数量。
 * - 默认 2（针对 1–2GB 机器；此前硬编码为 5）
 * - 非法/缺省回落 2；上限 16 防止误配
 */
export const resolvePipelineWorkerCount = (
  raw: string | undefined = process.env.CFRAME_PIPELINE_WORKER_COUNT,
): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 2
  return Math.min(parsed, 16)
}

/**
 * 从环境变量解析 sharp 允许的最大输入像素数。
 * - 默认 500_000_000（500MP，足够宽松，正常照片不受影响）
 * - 目的：替换当前的 limitInputPixels:false，堵住病态超大图导致的 OOM
 */
export const resolveMaxInputPixels = (
  raw: string | undefined = process.env.CFRAME_MAX_INPUT_PIXELS,
): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 500_000_000
  return parsed
}
