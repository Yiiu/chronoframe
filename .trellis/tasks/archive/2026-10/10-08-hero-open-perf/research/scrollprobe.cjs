// 打开查看器时谁在滚动页面：记录 scrollTo/scrollBy/scrollIntoView/scrollTop 写入（带调用栈）与 scrollY 变化
const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    window.__sl = []; window.__t0 = 0
    const L = (m) => window.__t0 && window.__sl.push(Math.round(performance.now() - window.__t0) + ' ' + m)
    const st = () => (new Error().stack || '').split('\n').slice(2, 6).map((s) => s.trim().replace(/https?:\/\/[^/]+/, '')).join(' | ')
    for (const [obj, name] of [[window, 'scrollTo'], [window, 'scrollBy'], [Element.prototype, 'scrollIntoView'], [Element.prototype, 'scrollTo']]) {
      const o = obj[name]; obj[name] = function (...a) { L(`${name}(${JSON.stringify(a).slice(0, 80)}) scrollY=${Math.round(scrollY)} @ ${st()}`); return o.apply(this, a) }
    }
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
    Object.defineProperty(Element.prototype, 'scrollTop', { get: d.get, set(v) { if (this === document.documentElement || this === document.body) L(`set scrollTop=${v} @ ${st()}`); d.set.call(this, v) } })
    addEventListener('scroll', () => L(`scroll event scrollY=${Math.round(scrollY)}`), true)
  })
  const p = await ctx.newPage()
  await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
  const t = p.locator('[data-photo-id]').nth(+(process.argv[3] || 10))
  await t.waitFor({ timeout: 120000 }); await p.waitForTimeout(1500)
  await t.scrollIntoViewIfNeeded(); await p.waitForTimeout(800)
  console.log('scrollY before click', await p.evaluate(() => scrollY))
  await p.evaluate(() => { window.__sl = []; window.__t0 = performance.now() })
  await t.click(); await p.waitForTimeout(1500)
  console.log((await p.evaluate(() => window.__sl)).slice(0, 25).join('\n'))
  await b.close()
})()
