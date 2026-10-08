// 查看器内切换照片后：画廊是否居中新照片；关闭后是否飞回新照片缩略图并恢复
const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => { window.__calls = []; const o = window.scrollTo; window.scrollTo = function (...a) { window.__calls.push(JSON.stringify(a)); return o.apply(this, a) } })
  const p = await ctx.newPage()
  await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
  const t = p.locator('[data-photo-id]').nth(+(process.argv[3] || 3)); await t.waitFor({ timeout: 120000 }); await p.waitForTimeout(1500)
  await t.scrollIntoViewIfNeeded(); await p.waitForTimeout(600)
  await t.click(); await p.waitForTimeout(1500)
  const opened = p.url(); await p.evaluate(() => (window.__calls = []))
  for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(700) }
  const navUrl = p.url(); const calls = await p.evaluate(() => window.__calls)
  const id = navUrl.split('/').pop()
  await p.keyboard.press('Escape')
  // 关闭过程中采样：覆盖层是否飞向新照片缩略图
  const samples = []
  for (let i = 0; i < 12; i++) { samples.push(await p.evaluate((id) => { const ov = [...document.querySelectorAll('img')].find((x) => x.className.includes('z-[70]')); const th = document.querySelector(`[data-photo-id="${id}"]`); const r = th?.getBoundingClientRect(); return { ov: ov && getComputedStyle(ov).display !== 'none' ? [ov.style.left, ov.style.top, ov.style.width].map(parseFloat).map(Math.round) : null, thumb: r ? [r.left, r.top, r.width].map(Math.round) : null, vis: th ? getComputedStyle(th).visibility : 'missing' } }, id)); await p.waitForTimeout(50) }
  await p.waitForTimeout(1000)
  const final = await p.evaluate((id) => { const th = document.querySelector(`[data-photo-id="${id}"]`); const r = th?.getBoundingClientRect(); return { vis: th ? getComputedStyle(th).visibility : 'missing', inView: r ? r.top >= 0 && r.bottom <= innerHeight : false } }, id)
  console.log(JSON.stringify({ opened, navUrl, windowScrollCallsDuringNav: calls.length, lastCall: calls[calls.length - 1] }))
  console.log('close samples (overlay box vs new thumb box):'); samples.filter((s) => s.ov).slice(-4).forEach((s) => console.log('  ', JSON.stringify(s)))
  console.log('final', JSON.stringify(final))
  await b.close()
})()
