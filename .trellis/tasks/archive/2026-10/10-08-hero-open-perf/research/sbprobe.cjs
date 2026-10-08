// 拦截 scrollHeight 读取：哪个元素、点击后多久、单次耗时（强制布局）
const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    window.__sh = []; window.__t0 = 0
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
    Object.defineProperty(Element.prototype, 'scrollHeight', { get() {
      const a = performance.now(); const v = d.get.call(this); const dur = performance.now() - a
      if (window.__t0) window.__sh.push({ at: Math.round(a - window.__t0), dur: +dur.toFixed(1), el: this === document.documentElement ? 'HTML(window-mode)' : (this.className || this.tagName).toString().slice(0, 60) })
      return v } })
  })
  const p = await ctx.newPage()
  for (let run = 0; run < 2; run++) {
    await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
    const t = p.locator('[data-photo-id]').nth(2 + run); await t.waitFor({ timeout: 120000 }); await p.waitForTimeout(2000)
    await p.evaluate(() => { window.__sh = []; window.__t0 = performance.now() })
    await t.click(); await p.waitForTimeout(1200)
    const r = await p.evaluate(() => window.__sh)
    console.log(`run ${run + 1}:`); r.filter((x) => x.at < 1200).forEach((x) => console.log(`  t=${x.at}ms dur=${x.dur}ms ${x.el}`))
  }
  await b.close()
})()
