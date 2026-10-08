// 放大后拖动 1.5s，录 CPU profile，统计 render / getError 占用
// usage: node pan.cjs <base>
const { chromium } = require('playwright-core')
const fs = require('fs')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const cdp = await p.context().newCDPSession(p)
  await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
  const t = p.locator('[data-photo-id]').nth(1)
  await t.waitFor({ timeout: 120000 }); await p.waitForTimeout(1500)
  await t.click(); await p.waitForTimeout(4000) // 等高清图与 WebGL 就绪
  await p.mouse.dblclick(560, 450); await p.waitForTimeout(800)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start')
  await p.mouse.move(560, 450); await p.mouse.down()
  for (let i = 0; i < 90; i++) { await p.mouse.move(560 + Math.sin(i / 8) * 200, 450 + Math.cos(i / 8) * 120); await p.waitForTimeout(16) }
  await p.mouse.up()
  const { profile } = await cdp.send('Profiler.stop')
  fs.writeFileSync((process.env.OUT_DIR || __dirname) + '/pan.cpuprofile', JSON.stringify(profile))
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
