import { WorkerPool } from '../services/pipeline-queue'
import { resolvePipelineWorkerCount } from '../utils/pipeline-config'

export default defineNitroPlugin(async (_nitroApp) => {
  const _logger = logger.dynamic('queue')

  const workerCount = resolvePipelineWorkerCount()
  _logger.info(`Pipeline worker count: ${workerCount}`)

  const workerPool = new WorkerPool(
    {
      workerCount,
      intervalMs: 1500,
      intervalOffset: 300,
      enableLoadBalancing: true,
      statsReportInterval: 60000 * 10,
    },
    _logger,
  )
  await workerPool.start()

  globalThis.__workerPool = workerPool

  const exitHandler = async () => {
    _logger.info('Shutting down worker pool...')
    await workerPool.stop()
    process.exit(0)
  }

  process.on('SIGINT', exitHandler)
  process.on('SIGTERM', exitHandler)

  // 每 5 分钟进行一次负载均衡检查
  setInterval(
    async () => {
      try {
        await workerPool.rebalance()
      } catch (error) {
        _logger.error('Rebalance failed:', error)
      }
    },
    5 * 60 * 1000,
  )
})
