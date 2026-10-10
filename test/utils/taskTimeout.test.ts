import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TaskTimeoutError,
  resolvePipelineTaskTimeoutMs,
  withTimeout,
} from '../../server/utils/task-timeout'

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves with the value when the promise settles in time', async () => {
    const p = withTimeout(Promise.resolve(42), 1000, 'too slow')
    await expect(p).resolves.toBe(42)
  })

  it('passes through the original rejection', async () => {
    const p = withTimeout(Promise.reject(new Error('boom')), 1000, 'too slow')
    await expect(p).rejects.toThrow('boom')
  })

  it('rejects with TaskTimeoutError when the promise never settles', async () => {
    // 复现线上故障：S3 请求挂起，Promise 永不 resolve
    const p = withTimeout(new Promise(() => {}), 1000, 'Task 286 timed out')
    const assertion = expect(p).rejects.toThrow(TaskTimeoutError)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    await expect(p).rejects.toThrow('Task 286 timed out')
  })

  it('clears its timer once the promise settles', async () => {
    await withTimeout(Promise.resolve('ok'), 1000, 'too slow')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disables the timeout when ms <= 0', async () => {
    const p = withTimeout(Promise.resolve('ok'), 0, 'too slow')
    expect(vi.getTimerCount()).toBe(0)
    await expect(p).resolves.toBe('ok')
  })
})

describe('resolvePipelineTaskTimeoutMs', () => {
  // 用 '' 而非 undefined，避免读到默认参数里的 process.env
  it('defaults to 10 minutes', () => {
    expect(resolvePipelineTaskTimeoutMs('')).toBe(600_000)
    expect(resolvePipelineTaskTimeoutMs('abc')).toBe(600_000)
    expect(resolvePipelineTaskTimeoutMs('-5')).toBe(600_000)
  })

  it('accepts a positive value in ms', () => {
    expect(resolvePipelineTaskTimeoutMs('120000')).toBe(120_000)
  })

  it('treats "0" as disabled', () => {
    expect(resolvePipelineTaskTimeoutMs('0')).toBe(0)
  })
})
