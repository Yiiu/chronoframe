import z from 'zod'

/**
 * 批量查询任务状态
 * 供前端共享轮询器一次查询所有在途任务，替代 per-task 轮询
 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)

  const { taskIds } = await readValidatedBody(
    event,
    z.object({
      taskIds: z.array(z.number().int().nonnegative()).min(1).max(500),
    }).parse,
  )

  const workerPool = globalThis.__workerPool
  if (!workerPool) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Worker pool not initialized',
    })
  }

  try {
    const results = await Promise.all(
      taskIds.map(async (taskId) => {
        const status = await workerPool.getTaskStatus(Number(taskId))
        // 查不到不整批 404：返回 null，前端视为 completed-or-gone
        return { taskId, status: status ?? null }
      }),
    )

    return { results }
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage:
        error instanceof Error ? error.message : 'Failed to get queue status',
    })
  }
})
