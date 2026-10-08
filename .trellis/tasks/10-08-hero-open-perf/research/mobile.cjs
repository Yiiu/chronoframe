const { chromium } = require('playwright-core')
const BASE = process.argv[2] || 'http://localhost:9607'
const OUT = process.env.OUT_DIR || __dirname

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  })
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const page = await ctx.newPage()
  const reqs = []
  page.on('request', (r) => {
    const u = r.url()
    if (/\.(jpe?g|png|webp|heic|avif)(\?|$)/i.test(u) || /\/storage\/|\/photos?\//.test(u)) reqs.push(u)
  })
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })
  const cdp = await ctx.newCDPSession(page)

  const touch = async (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
  const swipe = async (x0, y0, x1, y1, steps = 12) => {
    await touch('touchStart', [[x0, y0]])
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]])
      await page.waitForTimeout(16)
    }
    await touch('touchEnd', [])
  }
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []) }

  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 })
  await page.locator('.cursor-pointer.select-none').first().click({ timeout: 120000 })
  await page.waitForTimeout(4000)
  const url0 = page.url()
  console.log('opened', url0)
  await page.screenshot({ path: OUT + '/m0-open.png' })

  // 1. 原始大小时左滑翻页
  await swipe(320, 420, 60, 420)
  await page.waitForTimeout(2500)
  const url1 = page.url()
  console.log('after swipe at 1x:', url1, url1 !== url0 ? 'NAVIGATED' : 'NOT navigated')

  // 2. 双击放大，然后拖动
  await tap(195, 420); await page.waitForTimeout(80); await tap(195, 420)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: OUT + '/m1-zoomed.png' })
  const before = await page.screenshot()
  await swipe(300, 420, 100, 420)
  await page.waitForTimeout(1200)
  const after = await page.screenshot({ path: OUT + '/m2-dragged.png' })
  const url2 = page.url()
  console.log('after drag when zoomed:', url2 === url1 ? 'stayed on photo' : 'NAVIGATED (bad)', '| image moved:', !before.equals(after))

  // 3. 请求统计
  const counts = {}
  for (const u of reqs) counts[u] = (counts[u] || 0) + 1
  const dup = Object.entries(counts).filter(([, c]) => c > 1)
  console.log('image requests:', reqs.length, 'unique:', Object.keys(counts).length)
  console.log('duplicates:', dup.length ? dup.map(([u, c]) => `${c}x ${u.slice(-90)}`).join('\n  ') : 'none')
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
