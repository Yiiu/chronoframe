// Hero 打开/关闭的帧时间与长任务测量
// usage: node perf.js <base> [cpuThrottle=1] [desktop|mobile] [profile]
const { chromium } = require('playwright-core')
const fs = require('fs')
const BASE = process.argv[2]
const CPU = +(process.argv[3] || 1)
const MOBILE = process.argv[4] === 'mobile'
const PROFILE = process.argv[5] === 'profile'
const RUNS = 5

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0 }

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'].slice(0, 0), // 保持 vsync，测真实 60Hz 节奏
  })
  const ctx = await browser.newContext(
    MOBILE
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
      : { viewport: { width: 1440, height: 900 } },
  )
  await ctx.addInitScript(() => {
    window.__lt = []
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push({ start: e.startTime, dur: e.duration }))).observe({ type: 'longtask', buffered: true })
    } catch {}
    window.__startFrames = () => {
      window.__frames = []; window.__rec = true
      const loop = (t) => { if (!window.__rec) return; window.__frames.push(t); requestAnimationFrame(loop) }
      requestAnimationFrame(loop)
    }
    window.__stopFrames = () => { window.__rec = false; return window.__frames }
  })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })

  const measure = async (label, action, windowMs) => {
    const t0 = await page.evaluate(() => { window.__startFrames(); return performance.now() })
    await action()
    await page.waitForTimeout(windowMs)
    const frames = await page.evaluate(() => window.__stopFrames())
    const lt = await page.evaluate((t0) => window.__lt.filter((e) => e.start + e.dur >= t0), t0)
    const deltas = frames.slice(1).map((t, i) => t - frames[i])
    const dropped = deltas.reduce((n, d) => n + Math.max(0, Math.round(d / 16.67) - 1), 0)
    return {
      label,
      firstFrame: frames.length ? Math.round(frames[0] - t0) : null,
      frames: frames.length,
      p50: +pct(deltas, 50).toFixed(1),
      p95: +pct(deltas, 95).toFixed(1),
      max: +Math.max(0, ...deltas).toFixed(1),
      dropped,
      longTasks: lt.length,
      longTaskMs: Math.round(lt.reduce((s, e) => s + e.dur, 0)),
      worstLT: Math.round(Math.max(0, ...lt.map((e) => e.dur))),
    }
  }

  const results = []
  for (let i = 0; i < RUNS; i++) {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 })
    const target = page.locator('[data-photo-id]').nth(1 + i) // 每轮换一张，避免缓存掩盖首开成本
    await target.waitFor({ timeout: 120000 })
    await page.waitForTimeout(2000)
    // 先滚到可见并等滚动事件处理完：否则 click 会先滚动，页面在飞行中响应滚动（如回到顶部按钮挂载），真实用户不会遇到
    await target.scrollIntoViewIfNeeded(); await page.waitForTimeout(600)
    await page.evaluate(() => (window.__lt = []))
    if (PROFILE && i === RUNS - 1) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start') }
    results.push(await measure('open', () => target.click(), 900))
    if (PROFILE && i === RUNS - 1) { const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync((process.env.OUT_DIR || __dirname) + '/open.cpuprofile', JSON.stringify(profile)) }
    await page.waitForTimeout(1500) // 等高清图/WebGL 就绪
    results.push(await measure('close', () => page.keyboard.press('Escape'), 900))
    // 同一页面再开一张：热启动（组件和依赖已加载、编译）
    await page.waitForTimeout(1200)
    const t2 = page.locator('[data-photo-id]').nth(6 + i)
    await t2.scrollIntoViewIfNeeded(); await page.waitForTimeout(600)
    await page.evaluate(() => (window.__lt = []))
    if (PROFILE && i === RUNS - 1) { await cdp.send('Profiler.start') }
    results.push(await measure('open-warm', () => t2.click(), 900))
    if (PROFILE && i === RUNS - 1) { const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync((process.env.OUT_DIR || __dirname) + '/open-warm.cpuprofile', JSON.stringify(profile)) }
    await page.waitForTimeout(1500)
    results.push(await measure('close-warm', () => page.keyboard.press('Escape'), 900))
  }

  for (const kind of ['open', 'close', 'open-warm', 'close-warm']) {
    const rs = results.filter((r) => r.label === kind)
    const med = (k) => pct(rs.map((r) => r[k]), 50)
    console.log(`${kind.padEnd(10)} cpu=${CPU}x ${MOBILE ? 'mobile' : 'desktop'} | 首帧 ${med('firstFrame')}ms | 帧间隔 p50 ${med('p50')} p95 ${med('p95')} max ${med('max')}ms | 掉帧 ${med('dropped')} | 长任务 ${med('longTasks')} 个 共 ${med('longTaskMs')}ms 最长 ${med('worstLT')}ms`)
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
