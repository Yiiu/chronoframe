// 统计 hero 飞行窗口内合成器实际呈现/丢弃的帧（PipelineReporter）
// usage: node ctrace.js <base> [runs=3] [cpu=1] [mobile]
const { chromium } = require('playwright-core')
const fs = require('fs')
const [BASE, RUNS = 3, CPU = 1, MODE] = process.argv.slice(2)
;(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const page = await browser.newPage(MODE === 'mobile' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : { viewport: { width: 1440, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  if (+CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +CPU })
  const out = []
  for (let i = 0; i < +RUNS; i++) {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 })
    const a = page.locator('[data-photo-id]').nth(2 + i), b = page.locator('[data-photo-id]').nth(7 + i)
    await a.waitFor({ timeout: 120000 }); await page.waitForTimeout(2000)
    await a.scrollIntoViewIfNeeded(); await page.waitForTimeout(600)
    await a.click(); await page.waitForTimeout(1500); await page.keyboard.press('Escape'); await page.waitForTimeout(1500) // 预热
    const path = (process.env.OUT_DIR || __dirname) + `/ct-${i}.json`
    await browser.startTracing(page, { path, categories: ['cc', 'viz', 'benchmark', 'devtools.timeline', 'blink.animations', 'disabled-by-default-devtools.timeline'] })
    await b.scrollIntoViewIfNeeded(); await page.waitForTimeout(600) // 避免 click 自带滚动干扰
    await b.click(); await page.waitForTimeout(700)
    await browser.stopTracing()
    const d = JSON.parse(fs.readFileSync(path)); const ev = d.traceEvents || d
    const click = ev.find((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'click')
    const t0 = click ? click.ts : 0, t1 = t0 + 450000
    const states = {}
    for (const e of ev) {
      if (e.name !== 'PipelineReporter' || e.ph !== 'b' || e.ts < t0 || e.ts > t1) continue
      const r = e.args?.frame_reporter || {}
      if (r.state === 'STATE_NO_UPDATE_DESIRED') continue
      const k = r.state.replace('STATE_', '') + (r.has_compositor_animation ? '+compAnim' : '') + (r.has_main_animation ? '+mainAnim' : '')
      states[k] = (states[k] || 0) + 1
    }
    // 动画是否跑在合成器上：Animation 事件的 compositeFailed / unsupportedProperties
    const anims = ev.filter((e) => e.name === 'Animation' && e.ts >= t0 && e.ts <= t1 && e.ph === 'b')
    const failed = ev.filter((e) => e.name === 'Animation' && e.ts >= t0 - 50000 && e.ts <= t1 && (e.args?.data?.compositeFailed || e.args?.data?.unsupportedProperties?.length))
    states.animations = anims.map((e) => e.args?.data?.name || e.args?.data?.id || '?').length
    states.compositeFailed = failed.map((e) => JSON.stringify({ name: e.args?.data?.name, failed: e.args?.data?.compositeFailed, props: e.args?.data?.unsupportedProperties }))
    out.push(states)
    console.log(`run ${i + 1}:`, JSON.stringify(states))
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
