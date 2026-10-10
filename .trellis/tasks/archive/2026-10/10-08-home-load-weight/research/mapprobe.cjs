const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/a1103/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const cdp = await p.context().newCDPSession(p); await cdp.send('Network.enable')
  cdp.on('Network.requestWillBeSent', (e) => {
    if (!/Bpdr_boz|CIHFt0Ko/.test(e.request.url)) return
    const st = e.initiator.stack; const fr = st && (st.callFrames[0] || (st.parent && st.parent.callFrames[0]))
    console.log(e.request.url.split('/').pop(), 'type=', e.type, 'initiator=', e.initiator.type, e.initiator.url || '', fr ? `${fr.url.split('/').pop()}:${fr.functionName}` : '', 'prio=', e.request.initialPriority)
  })
  await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForTimeout(6000)
  const links = await p.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /globe|map/.test(h)))
  console.log('map-ish links on page:', links)
  await b.close()
})()
