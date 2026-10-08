// 把 hero 飞行动画暂停在 25/50/75% 截图（确定性检查拉伸/模糊/跳变），打开与关闭各一组
const { chromium } = require('playwright-core')
const OUT = process.env.OUT_DIR || __dirname
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  await p.addInitScript(() => {
    // 新建的飞行动画（只动 transform）一出现就暂停在 0
    const orig = Element.prototype.animate
    Element.prototype.animate = function (kf, opts) {
      const a = orig.call(this, kf, opts)
      if (this.className?.toString().includes('z-[70]') && JSON.stringify(kf).includes('transform')) { a.pause(); a.currentTime = 0; window.__flight = a; window.__flightEl = this }
      return a
    }
  })
  await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
  const t = p.locator('[data-photo-id]').nth(1); await t.waitFor({ timeout: 120000 }); await p.waitForTimeout(1500)
  const grab = async (tag) => {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const info = await p.evaluate((f) => { const a = window.__flight; if (!a) return null; a.currentTime = 420 * f - (f === 1 ? 1 : 0); const r = window.__flightEl.getBoundingClientRect(); const cs = getComputedStyle(window.__flightEl); return { rect: [r.left, r.top, r.width, r.height].map((x) => +x.toFixed(1)), aspect: +(r.width / r.height).toFixed(4), op: cs.opacity, display: cs.display } }, f)
      await p.waitForTimeout(120)
      await p.screenshot({ path: `${OUT}/${tag}-${Math.round(f * 100)}.png` })
      console.log(tag, f, JSON.stringify(info))
    }
    await p.evaluate(() => { window.__flight?.play(); window.__flight = null })
  }
  await t.click(); await p.waitForFunction(() => !!window.__flight, null, { timeout: 10000 }); await grab('open')
  await p.waitForTimeout(2500)
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !!window.__flight, null, { timeout: 10000 }); await grab('close')
  await p.waitForTimeout(1500)
  await b.close()
})()
