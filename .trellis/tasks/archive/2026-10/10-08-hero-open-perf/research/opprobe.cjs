// 拦截 offsetParent 读取（motion-v isHidden）：哪些元素、点击后何时、单次耗时
const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    window.__op = []; window.__t0 = 0
    const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { get() {
      const a = performance.now(); const v = d.get.call(this); const dur = performance.now() - a
      if (window.__t0) {
        const anc = []; let e = this; for (let i = 0; i < 4 && e; i++, e = e.parentElement) anc.push((e.className?.toString?.() || e.tagName).split(' ').slice(0, 3).join('.'))
        window.__op.push({ at: Math.round(a - window.__t0), dur: +dur.toFixed(1), el: anc.join(' < ') })
      }
      return v } })
    const gcs = window.getComputedStyle
    window.getComputedStyle = function (el, ...rest) {
      const cs = gcs.call(this, el, ...rest)
      // 读 position 才真正触发样式重算：包一层计时
      return new Proxy(cs, { get(t, k) { if (k !== 'position') { const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v }
        const b = performance.now(); const v = t.position; const dur = performance.now() - b
        if (window.__t0) { const anc = []; let e = el; for (let i = 0; i < 4 && e; i++, e = e.parentElement) anc.push((e.className?.toString?.() || e.tagName).split(' ').slice(0, 3).join('.'))
          window.__op.push({ at: Math.round(b - window.__t0), dur: +dur.toFixed(1), el: 'GCS.position ' + anc.join(' < ') }) }
        return v } }) }
  })
  const p = await ctx.newPage()
  await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
  const a = p.locator('[data-photo-id]').nth(+(process.argv[3] || 2)), t = p.locator('[data-photo-id]').nth(+(process.argv[4] || 6))
  await a.waitFor({ timeout: 120000 }); await p.waitForTimeout(1500)
  await a.scrollIntoViewIfNeeded(); await p.waitForTimeout(600)
  await a.click(); await p.waitForTimeout(1500); await p.keyboard.press('Escape'); await p.waitForTimeout(1500) // 预热
  await t.scrollIntoViewIfNeeded(); await p.waitForTimeout(600)
  await p.evaluate(() => { window.__op = []; window.__t0 = performance.now() })
  await t.click(); await p.waitForTimeout(1200)
  const r = await p.evaluate(() => window.__op)
  const groups = {}
  for (const x of r) { const k = x.el; (groups[k] ||= { n: 0, ms: 0, first: x.at, last: x.at }); groups[k].n++; groups[k].ms += x.dur; groups[k].last = x.at }
  console.log(`offsetParent reads: ${r.length}, total ${r.reduce((s, x) => s + x.dur, 0).toFixed(1)}ms`)
  Object.entries(groups).sort((x, y) => y[1].ms - x[1].ms).slice(0, 15).forEach(([k, g]) => console.log(`${g.ms.toFixed(1).padStart(6)}ms x${String(g.n).padEnd(3)} t=${g.first}-${g.last}  ${k.slice(0, 150)}`))
  await b.close()
})()
