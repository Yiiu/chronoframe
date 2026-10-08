// 打开富士照片、开启对焦点，滚轮放大前后对焦点位置是否随画面变化
const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []; p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(process.argv[2] + '/DSCF2291', { waitUntil: 'load', timeout: 180000 })
  // 信息面板里"对焦"卡片（AF-S/AF-C 等），点击开关对焦点标记
  const card = p.getByText(/AF-[SC]/).first(); await card.waitFor({ timeout: 180000 }); await p.waitForTimeout(3000)
  await card.click(); await p.waitForTimeout(800)
  const marker = () => p.evaluate(() => { const m = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('-translate-x-1/2') && d.className.includes('-translate-y-1/2') && d.querySelector('.rounded-full')); if (!m) return null; const r = m.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round) })
  const before = await marker()
  await p.mouse.move(560, 400)
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(120) }
  await p.waitForTimeout(800)
  const after = await marker()
  console.log(JSON.stringify({ before, after, moved: JSON.stringify(before) !== JSON.stringify(after), errors: errs }))
  await b.close()
})()
