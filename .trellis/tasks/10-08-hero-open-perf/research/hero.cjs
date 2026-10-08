// Hero 动画：打开后在不同时刻快速关闭，逐帧记录覆盖层 / 网格缩略图状态
const { chromium } = require('playwright-core')
const BASE = process.argv[2]
const MOBILE = process.argv[3] === 'mobile'
const OUT = process.env.OUT_DIR || __dirname

const tracer = () => {
  // 在页面里每帧采样
  window.__trace = []
  window.__tracing = true
  const overlay = [...document.querySelectorAll('img')].find((i) => i.className.includes('z-[70]'))
  const id = window.__heroId
  const item = document.querySelector(`[data-photo-id="${id}"]`)
  const loop = () => {
    if (!window.__tracing) return
    const ocs = overlay && getComputedStyle(overlay)
    const r = overlay?.getBoundingClientRect()
    window.__trace.push({
      t: Math.round(performance.now()),
      path: location.pathname,
      ovDisplay: ocs?.display,
      ovOpacity: ocs ? +(+ocs.opacity).toFixed(2) : null,
      ovRect: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null,
      itemVis: item ? getComputedStyle(item).visibility : 'missing',
      viewer: !!document.querySelector('[data-hero-viewport]'),
      bodyOverflow: document.body.style.overflow,
    })
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  })
  const ctx = await browser.newContext(
    MOBILE
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
      : { viewport: { width: 1440, height: 900 } },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 160)) })

  const target = page.locator('[data-photo-id]').nth(1)
  let rect0, id
  const fresh = async () => {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 })
    await target.waitFor({ timeout: 120000 })
    await page.waitForTimeout(1500)
    id = await target.getAttribute('data-photo-id')
    await page.evaluate((id) => (window.__heroId = id), id)
    rect0 = await target.boundingBox()
  }

  const open = async () => (MOBILE ? target.tap() : target.click())
  const closeBy = {
    escape: () => page.keyboard.press('Escape'),
    back: () => page.goBack(),
  }

  const scenarios = []
  for (const method of MOBILE ? ['back'] : ['escape', 'back'])
    for (const d of [0, 30, 100, 200, 300, 400, 500, 650, 1200]) scenarios.push({ name: `${method}@${d}ms`, steps: [['open'], ['wait', d], ['close', method]] })
  if (!MOBILE) {
    scenarios.push({ name: 'reopen-mid-exit', steps: [['open'], ['wait', 600], ['close', 'escape'], ['wait', 150], ['open'], ['wait', 900], ['close', 'escape']] })
    scenarios.push({ name: 'reopen-mid-entry-close', steps: [['open'], ['wait', 100], ['close', 'escape'], ['wait', 60], ['open'], ['wait', 60], ['close', 'escape']] })
    scenarios.push({ name: 'double-escape', steps: [['open'], ['wait', 200], ['close', 'escape'], ['close', 'escape']] })
  }

  const report = []
  for (const sc of scenarios) {
    await fresh()
    await page.evaluate(tracer)
    for (const [op, arg] of sc.steps) {
      if (op === 'open') await target.click({ timeout: 3000, force: true }).catch((e) => errors.push(`[${sc.name}] open failed: ${e.message.split('\n')[0]}`))
      else if (op === 'wait') await page.waitForTimeout(arg)
      else await closeBy[arg]().catch((e) => errors.push(`[${sc.name}] close failed: ${e.message.split('\n')[0]}`))
    }
    await page.waitForTimeout(1500)
    const trace = await page.evaluate(() => { window.__tracing = false; return window.__trace })
    if (!trace) { report.push({ name: sc.name, frames: 0, issues: ['PAGE RELOADED (trace lost)'] }); continue }
    const last = trace[trace.length - 1]
    const rect1 = await target.boundingBox()
    const issues = []
    if (last.path !== '/') issues.push('final path ' + last.path)
    if (last.viewer) issues.push('viewer still mounted')
    if (last.ovDisplay !== 'none') issues.push(`overlay still displayed (opacity ${last.ovOpacity})`)
    if (last.itemVis !== 'visible') issues.push('grid thumb ' + last.itemVis)
    if (last.bodyOverflow) issues.push('body overflow=' + last.bodyOverflow)
    if (JSON.stringify(rect0) !== JSON.stringify(rect1)) issues.push(`thumb moved ${JSON.stringify(rect0)} -> ${JSON.stringify(rect1)}`)
    // 帧内异常：缩略图隐藏但覆盖层不可见（网格出现空洞），且查看器不在
    const holes = trace.filter((f) => f.itemVis === 'hidden' && (f.ovDisplay === 'none' || f.ovOpacity < 0.05) && !f.viewer)
    if (holes.length) issues.push(`hole frames: ${holes.length}`)
    // 关闭后覆盖层突然跳位（相邻帧中心位移 > 300px 且都可见）
    let jumps = 0
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1], b = trace[i]
      if (a.ovDisplay === 'block' && b.ovDisplay === 'block' && a.ovOpacity > 0.5 && b.ovOpacity > 0.5 && a.ovRect && b.ovRect) {
        const dx = (b.ovRect[0] + b.ovRect[2] / 2) - (a.ovRect[0] + a.ovRect[2] / 2)
        const dy = (b.ovRect[1] + b.ovRect[3] / 2) - (a.ovRect[1] + a.ovRect[3] / 2)
        if (Math.hypot(dx, dy) > 300) jumps++
      }
    }
    if (jumps) issues.push(`overlay jump frames: ${jumps}`)
    report.push({ name: sc.name, frames: trace.length, issues })
    if (issues.length) {
      await page.screenshot({ path: `${OUT}/hero-${MOBILE ? 'm-' : ''}${sc.name}.png` })
      require('fs').writeFileSync(`${OUT}/hero-${MOBILE ? 'm-' : ''}${sc.name}.json`, JSON.stringify(trace, null, 0).replace(/\},\{/g, '},\n{'))
    }
  }

  for (const r of report) console.log(`${r.issues.length ? 'FAIL' : 'ok  '} ${r.name.padEnd(24)} frames=${r.frames} ${r.issues.join('; ')}`)
  console.log('\nconsole/page errors:', errors.length ? '\n  ' + [...new Set(errors)].join('\n  ') : 'none')
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
