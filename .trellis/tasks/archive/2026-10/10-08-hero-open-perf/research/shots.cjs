// 飞行中截图（打开/关闭各取几个时刻）+ 前进键在飞回途中重新打开
const { chromium } = require('playwright-core')
const OUT = process.env.OUT_DIR || __dirname
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const ov = () => p.evaluate(() => { const o = [...document.querySelectorAll('img')].find((x) => x.className.includes('z-[70]')); const r = o.getBoundingClientRect(); return { display: getComputedStyle(o).display, op: getComputedStyle(o).opacity, rect: [r.left, r.top, r.width, r.height].map(Math.round), natural: [o.naturalWidth, o.naturalHeight] } })
  await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
  const t = p.locator('[data-photo-id]').nth(1); await t.waitFor({ timeout: 120000 }); await p.waitForTimeout(1500)
  const id = await t.getAttribute('data-photo-id')
  // 打开：飞行中截图
  await t.click()
  for (const ms of [80, 200, 330]) { await p.waitForTimeout(ms === 80 ? 80 : ms === 200 ? 120 : 130); await p.screenshot({ path: `${OUT}/open-${ms}.png` }); console.log(`open ~${ms}ms`, JSON.stringify(await ov())) }
  await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/open-settled.png` })
  // 关闭：飞行中截图
  await p.keyboard.press('Escape')
  for (const ms of [120, 260]) { await p.waitForTimeout(ms === 120 ? 120 : 140); await p.screenshot({ path: `${OUT}/close-${ms}.png` }); console.log(`close ~${ms}ms`, JSON.stringify(await ov())) }
  await p.waitForTimeout(1200); await p.screenshot({ path: `${OUT}/close-landed.png` })
  // 前进键在飞回途中重新打开（无 pendingHero）
  await p.waitForTimeout(500)
  await t.click(); await p.waitForTimeout(1500)
  await p.goBack(); await p.waitForTimeout(150); await p.goForward(); await p.waitForTimeout(1500)
  const s = await p.evaluate((id) => { const th = document.querySelector(`[data-photo-id="${id}"]`); return { url: location.pathname, viewer: !!document.querySelector('[data-hero-viewport]'), thumb: th ? getComputedStyle(th).visibility : 'missing' } }, id)
  console.log('back+forward mid-exit:', JSON.stringify(s), 'overlay', JSON.stringify(await ov()))
  await p.screenshot({ path: `${OUT}/forward-reopen.png` })
  await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  console.log('after closing again:', JSON.stringify(await ov()), 'thumb', await p.evaluate((id) => getComputedStyle(document.querySelector(`[data-photo-id="${id}"]`)).visibility, id))
  await b.close()
})()
