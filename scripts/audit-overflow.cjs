// Overflow check: opens every screen of ?demo at phone and tablet widths and lists any control that
// wraps or spills out of its box, or a page that scrolls sideways. Prints "clean" when there are none.
// Needs Playwright with Chromium. With `npm run dev` running in app/:  node scripts/audit-overflow.cjs

// Visit every screen at narrow widths and report controls that wrap or spill out of their box.
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}); const errs=[];
 const check = (p, where) => p.evaluate((where) => {
   const out = [];
   const vw = document.documentElement.clientWidth;
   if (document.documentElement.scrollWidth > vw + 1) out.push(`${where}: PAGE scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
   for (const el of document.querySelectorAll('button, select, .btn, .badge, .chip, .seg, .stat, .hchip, .vd, .theirs')) {
     const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
     const cs = getComputedStyle(el);
     const name = (el.className || el.tagName) + ' "' + (el.textContent||'').trim().replace(/\s+/g,' ').slice(0,30) + '"';
     // a one-line control that grew taller than its line, or whose text is cut
     const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
     if (el.matches('button,select,.btn,.badge,.chip,.stat,.vd,.theirs') && el.scrollHeight > el.clientHeight + 2 && cs.overflowY !== 'auto') out.push(`${where}: content taller than box ${name}`);
     if (el.matches('button,select,.btn') && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible') out.push(`${where}: text spills sideways ${name}`);
     // sticks out past the screen edge, unless inside something that scrolls sideways
     let sc = el.parentElement, inScroller = false;
     while (sc) { const o = getComputedStyle(sc).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { inScroller = true; break; } sc = sc.parentElement; }
     if (!inScroller && (r.right > vw + 1 || r.left < -1)) out.push(`${where}: off screen ${name}`);
   }
   return out;
 }, where);
 const all = new Set();
 for (const w of [320, 360, 414, 768]) {
  const p = await b.newPage({ viewport:{width:w,height:800} }); p.on('pageerror', e=>errs.push(e.message));
  await p.goto((process.argv[2] ?? 'http://localhost:5173/stoop/') + '?demo'); await p.waitForTimeout(1200);
  const go = async (sel) => { await p.click(sel); await p.waitForTimeout(700); };
  for (const r of await check(p, `${w} feed`)) all.add(r);
  await go('[data-action="feedview"][data-v="map"]'); for (const r of await check(p, `${w} map`)) all.add(r);
  const t = await p.$('[data-action="maplist"]'); if (t) { await t.click(); await p.waitForTimeout(500); for (const r of await check(p, `${w} map+list`)) all.add(r); }
  await go('[data-action="feedview"][data-v="list"]');
  await go('.card[data-open]'); for (const r of await check(p, `${w} sheet`)) all.add(r); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await go('nav.tabs [data-v="pipeline"]'); for (const r of await check(p, `${w} pipeline`)) all.add(r);
  await go('nav.tabs [data-v="criteria"]'); for (const r of await check(p, `${w} criteria`)) all.add(r);
  await go('[data-action="tab"][data-v="settings"]'); { for (const r of await check(p, `${w} settings`)) all.add(r); }
  await p.close(); }
 console.log([...all].join('\n') || 'clean'); console.log(errs); await b.close(); })();
