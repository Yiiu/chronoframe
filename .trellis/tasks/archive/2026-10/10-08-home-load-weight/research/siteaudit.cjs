// 线上站点加载分析：导航计时、LCP、按类型的资源体积、最大资源、图片是否超尺寸下载
const { chromium } = require('playwright-core')
const BASE = process.argv[2]
const MOBILE = process.argv[3] === 'mobile'
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const ctx = await b.newContext(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 3 } : { viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    window.__lcp = []
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lcp.push({ t: Math.round(e.startTime), size: e.size, url: (e.url || '').split('/').slice(-1)[0], el: e.element ? e.element.tagName : '' }))).observe({ type: 'largest-contentful-paint', buffered: true })
  })
  const t0 = Date.now()
  await p.goto(BASE, { waitUntil: 'load', timeout: 120000 })
  await p.waitForTimeout(8000)
  const r = await p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const res = performance.getEntriesByType('resource')
    const byType = {}
    for (const e of res) {
      const k = e.initiatorType === 'xmlhttprequest' ? 'fetch' : e.initiatorType
      byType[k] ||= { n: 0, transfer: 0, decoded: 0 }
      byType[k].n++; byType[k].transfer += e.transferSize; byType[k].decoded += e.decodedBodySize
    }
    const top = [...res].sort((a, b) => b.transferSize - a.transferSize).slice(0, 12).map((e) => ({ kb: Math.round(e.transferSize / 1024), decodedKb: Math.round(e.decodedBodySize / 1024), ms: Math.round(e.duration), proto: e.nextHopProtocol, url: e.name.replace(location.origin, '').slice(0, 90) }))
    const protos = {}; for (const e of res) protos[e.nextHopProtocol] = (protos[e.nextHopProtocol] || 0) + 1
    const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0).map((i) => { const r = i.getBoundingClientRect(); const dpr = devicePixelRatio; return { natural: `${i.naturalWidth}x${i.naturalHeight}`, shown: `${Math.round(r.width * dpr)}x${Math.round(r.height * dpr)}`, ratio: +(i.naturalWidth / (r.width * dpr)).toFixed(2), src: i.currentSrc.split('/').slice(-1)[0].slice(0, 50) } })
    const oversized = imgs.filter((i) => i.ratio > 1.6)
    const fonts = res.filter((e) => e.initiatorType === 'css' || /\.(woff2?|ttf|otf)(\?|$)/.test(e.name)).map((e) => ({ kb: Math.round(e.transferSize / 1024), url: e.name.split('/').slice(-1)[0].slice(0, 60) }))
    return {
      timing: { ttfb: Math.round(nav.responseStart), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), htmlKb: Math.round(nav.transferSize / 1024) },
      lcp: window.__lcp.slice(-1)[0],
      totals: { requests: res.length, transferKb: Math.round(res.reduce((s, e) => s + e.transferSize, 0) / 1024) },
      byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { n: v.n, kb: Math.round(v.transfer / 1024) }])),
      protocols: protos,
      top,
      images: { visible: imgs.length, oversized: oversized.length, sample: oversized.slice(0, 5) },
      fonts,
    }
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
