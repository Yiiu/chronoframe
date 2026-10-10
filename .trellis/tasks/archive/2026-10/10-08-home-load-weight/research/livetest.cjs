// 验证：首页不下载 Live Photo 视频和地图块；悬停/长按才下载并播放；打开带 GPS 的照片才加载地图
// 用法：node livetest.cjs <base> <livePhotoId> <gpsPhotoId>
// 前提：DB 中 livePhotoId 已被标为 Live Photo，video url = <base>/__livetest.webm
const { chromium } = require('playwright-core')
const [BASE, LIVE_ID, GPS_ID] = process.argv.slice(2)
const EXE = 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`) }

async function makeWebm(browser) {
  const p = await browser.newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 480
    const ctx = c.getContext('2d'); let f = 0
    const iv = setInterval(() => { ctx.fillStyle = `hsl(${(f++ * 12) % 360},70%,50%)`; ctx.fillRect(0, 0, 320, 480) }, 33)
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' })
    const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data)
    rec.start(); await new Promise((r) => setTimeout(r, 1500)); rec.stop()
    await new Promise((r) => (rec.onstop = r)); clearInterval(iv)
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer())
    let s = ''; for (const b of buf) s += String.fromCharCode(b); return btoa(s)
  })
  await p.close()
  return Buffer.from(b64, 'base64')
}

async function setup(ctx, webm, log) {
  await ctx.route('**/__livetest.webm', (route) => { log.video++; route.fulfill({ status: 200, contentType: 'video/mp4', body: webm }) })
  ctx.on('request', (r) => { if (/\/_nuxt\/.*\.js$/.test(r.url())) log.js.push(r.url().split('/').pop()) })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE })
  const webm = await makeWebm(browser)
  const fs = require('fs'); const path = require('path')
  const mapChunk = fs.readdirSync(path.join('C:/dev/chronoframe/.output/public/_nuxt')).find((f) => f.endsWith('.js') && fs.readFileSync(path.join('C:/dev/chronoframe/.output/public/_nuxt', f), 'utf8').includes('maplibregl'))
  console.log('webm bytes', webm.length, 'map chunk', mapChunk)

  // ---------- desktop ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const log = { video: 0, js: [] }; await setup(ctx, webm, log)
    const p = await ctx.newPage()
    await p.goto(BASE + '/', { waitUntil: 'load' }); await p.waitForTimeout(6000)
    check('desktop: home does not fetch live video', log.video === 0, `video requests=${log.video}`)
    check('desktop: home does not load map chunk', !log.js.includes(mapChunk), `js=${log.js.length}`)
    const card = p.locator(`[data-photo-id="${LIVE_ID}"]`).first()
    await card.scrollIntoViewIfNeeded(); await p.waitForTimeout(600)
    await card.hover(); await p.waitForTimeout(2500)
    const st = await card.evaluate((el) => { const v = el.querySelector('video'); return v ? { paused: v.paused, t: v.currentTime } : null })
    check('desktop: hover fetches video once', log.video === 1, `video requests=${log.video}`)
    check('desktop: hover plays video after load', !!st && (!st.paused || st.t > 0), JSON.stringify(st))
    await p.mouse.move(5, 5); await p.waitForTimeout(400)
    await card.hover(); await p.waitForTimeout(800)
    check('desktop: second hover reuses video', log.video === 1, `video requests=${log.video}`)
    // open GPS photo -> mini map loads
    await p.mouse.move(5, 5)
    const gps = p.locator(`[data-photo-id="${GPS_ID}"]`).first()
    await gps.scrollIntoViewIfNeeded(); await p.waitForTimeout(600)
    await gps.click(); await p.waitForTimeout(6000)
    const hasMap = await p.evaluate(() => !!document.querySelector('.maplibregl-map, .maplibregl-canvas, .mapboxgl-map'))
    check('desktop: viewer loads map chunk', log.js.includes(mapChunk), `url=${p.url()}`)
    check('desktop: mini map renders', hasMap)
    await ctx.close()
  }

  // ---------- mobile ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
    const log = { video: 0, js: [] }; await setup(ctx, webm, log)
    const p = await ctx.newPage()
    await p.goto(BASE + '/', { waitUntil: 'load' }); await p.waitForTimeout(6000)
    check('mobile: home does not fetch live video', log.video === 0, `video requests=${log.video}`)
    const card = p.locator(`[data-photo-id="${LIVE_ID}"]`).first()
    await card.scrollIntoViewIfNeeded(); await p.waitForTimeout(800)
    const box = await card.boundingBox()
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    const cdp = await ctx.newCDPSession(p)
    const urlBefore = p.url()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await p.waitForTimeout(2000)
    const st = await card.evaluate((el) => { const v = el.querySelector('video'); return v ? { paused: v.paused, t: v.currentTime } : null })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await p.waitForTimeout(1200)
    check('mobile: long press fetches video', log.video === 1, `video requests=${log.video}`)
    check('mobile: long press plays video after load', !!st && (!st.paused || st.t > 0), JSON.stringify(st))
    check('mobile: long press does not open viewer', p.url() === urlBefore, p.url())
    await card.tap(); await p.waitForTimeout(1500)
    check('mobile: plain tap opens viewer', p.url() !== urlBefore, p.url())
    await ctx.close()
  }

  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
