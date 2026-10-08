// 在飞行结束附近（380–470ms）按 Esc 关闭，统计缩略图卡在 hidden 的次数，并记录覆盖层事件顺序
// usage: node landrace.cjs <base> [reps=2]
const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    window.__ev = []; window.__t0 = 0
    const L = (m) => window.__t0 && window.__ev.push(Math.round(performance.now() - window.__t0) + ' ' + m)
    document.addEventListener('keydown', (e) => e.key === 'Escape' && L('ESC'), true)
    const ready = () => {
      const ov = [...document.querySelectorAll('img')].find((i) => i.className.includes('z-[70]'))
      if (!ov) return setTimeout(ready, 200)
      let last = ''
      new MutationObserver(() => { const s = ov.style; const k = `display=${s.display} op=${s.opacity} box=${parseInt(s.left)},${parseInt(s.top)},${parseInt(s.width)}x${parseInt(s.height)}`; if (k !== last) { last = k; L('overlay ' + k) } }).observe(ov, { attributes: true, attributeFilter: ['style', 'src'] })
      const oa = ov.animate.bind(ov); ov.animate = (kf, o) => { L('overlay.animate ' + JSON.stringify(Object.keys(kf[0] || kf))); return oa(kf, o) }
    }
    addEventListener('load', ready)
    const watchThumb = () => { const id = window.__heroId; const el = id && document.querySelector(`[data-photo-id="${id}"]`); if (el && !el.__w) { el.__w = 1; new MutationObserver(() => L('thumb visibility=' + (el.style.visibility || 'visible'))).observe(el, { attributes: true, attributeFilter: ['style'] }) } }
    setInterval(watchThumb, 50)
  })
  const p = await ctx.newPage()
  let stuck = 0, n = 0
  for (let d = 380; d <= 470; d += 10) for (let r = 0; r < (+process.argv[3] || 2); r++) {
    await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
    const t = p.locator('[data-photo-id]').nth(1); await t.waitFor({ timeout: 120000 }); await p.waitForTimeout(1200)
    const id = await t.getAttribute('data-photo-id')
    await p.evaluate((id) => { window.__heroId = id; window.__ev = []; window.__t0 = performance.now() }, id)
    await p.waitForTimeout(100)
    await t.click({ force: true }); await p.evaluate(() => window.__ev.push(Math.round(performance.now() - window.__t0) + ' CLICK-returned'))
    await p.waitForTimeout(d); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    const vis = await t.evaluate((el) => getComputedStyle(el).visibility); n++
    if (vis === 'hidden') { stuck++; console.log(`STUCK at d=${d}ms:\n  ` + (await p.evaluate(() => window.__ev)).join('\n  ')) }
  }
  console.log(`stuck ${stuck}/${n}`)
  await b.close()
})()
