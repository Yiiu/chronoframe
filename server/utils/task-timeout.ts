export class TaskTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskTimeoutError'
  }
}

/**
 * 给 Promise 加超时上限；ms <= 0 表示不限时。
 * 注意：超时只是不再等待，并不会取消底层操作。
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> => {
  if (!(ms > 0)) return promise

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TaskTimeoutError(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 从环境变量解析单个队列任务的总超时（毫秒）。
 * - 默认 600_000（10 分钟），兜底任何未设超时的挂起，避免 worker 被永久占住
 * - "0" 表示关闭；非法值回落默认
 */
export const resolvePipelineTaskTimeoutMs = (
  raw: string | undefined = process.env.CFRAME_PIPELINE_TASK_TIMEOUT_MS,
): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (parsed === 0) return 0
  if (!Number.isFinite(parsed) || parsed < 0) return 600_000
  return parsed
}
