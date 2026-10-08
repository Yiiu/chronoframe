// prefers-reduced-motion 下打开照片：照片像素是否可见、直方图/地图是否开始
const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await p.goto(process.argv[2] + '/', { waitUntil: 'load', timeout: 120000 })
  const t = p.locator('[data-photo-id]').nth(1); await t.waitFor({ timeout: 120000 }); await p.waitForTimeout(1500)
  await t.click(); await p.waitForTimeout(4000)
  const r = await p.evaluate(() => {
    const slide = document.querySelector('.swiper-slide-active') || document.querySelector('.swiper-slide')
    const hidden = slide ? [...slide.querySelectorAll('img, canvas')].map((e) => getComputedStyle(e).opacity + '/' + getComputedStyle(e).visibility) : []
    const hist = [...document.querySelectorAll('h4')].find((h) => /histogram|直方图/i.test(h.textContent))
    const histCanvas = hist?.parentElement?.querySelector('canvas')
    return { url: location.pathname, slideMedia: hidden, histogramDrawn: !!histCanvas, mapCanvas: !!document.querySelector('.maplibregl-canvas, .mapboxgl-canvas') }
  })
  console.log(JSON.stringify(r))
  await p.screenshot({ path: (process.env.OUT_DIR || __dirname) + '/reduced.png' })
  await b.close()
})()
