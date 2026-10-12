// End-to-end check of the built site against a local server (python3 -m http.server 8765 -d dist).
//   node tools/test.mjs [baseUrl]
// Uses the system Chrome through playwright-core; autoplay is allowed so playback can be tested.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pwPath = process.env.PW || '/Users/championautofinance/rahway-barbershop-site/node_modules/playwright-core';
const { chromium } = require(pwPath);
const BASE = process.argv[2] || 'http://localhost:8765';
const OUT = process.env.SHOTS || '/tmp/lel-shots';
import fs from 'fs'; fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });

async function run(viewport, tag) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [], events = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.text().startsWith('[lel]')) events.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/${tag}-home.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(overflow <= 0, `${tag}: no horizontal overflow on home (${overflow}px)`);

  await page.click('.hero-cta [data-play]');
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => { const a = document.getElementById('lel-audio'); return { p: a.paused, t: a.currentTime }; });
  ok(!st.p && st.t > 0.5, `${tag}: latest episode plays (t=${st.t.toFixed(1)})`);
  ok(await page.isVisible('#pbar'), `${tag}: sticky player visible`);

  // in-site navigation keeps audio playing
  const showLink = tag === 'desktop' ? '.nav a[href="/lease-end-minute/"]' : '.show-card[href="/lease-end-minute/"]';
  await page.click(showLink);
  await page.waitForURL('**/lease-end-minute/');
  await page.waitForTimeout(1200);
  const st2 = await page.evaluate(() => { const a = document.getElementById('lel-audio'); return { p: a.paused, t: a.currentTime, h1: document.querySelector('h1').textContent }; });
  ok(!st2.p && st2.t > st.t, `${tag}: audio kept playing across navigation (t=${st2.t.toFixed(1)}, h1="${st2.h1}")`);

  // open an episode page, play it from its waveform, check transcript sync
  await page.click('.ep-row-title');
  await page.waitForSelector('[data-episode]');
  await page.waitForTimeout(500);
  const wave = await page.$('.ep-player [data-wave]');
  await wave.scrollIntoViewIfNeeded(); await page.mouse.wheel(0, 200); await page.waitForTimeout(300);
  const box = await wave.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.waitForTimeout(1500);
  const st3 = await page.evaluate(() => { const a = document.getElementById('lel-audio'); const art = document.querySelector('[data-episode]');
    return { id: art.dataset.episode, src: a.src, t: a.currentTime, d: a.duration, on: !!document.querySelector('.tr-body p.on'), segs: document.querySelectorAll('.tr-body p[data-start]').length }; });
  ok(st3.src.includes(st3.id.split('/')[1]) && Math.abs(st3.t / st3.d - 0.5) < 0.12, `${tag}: waveform click plays this episode near 50% (${(st3.t / st3.d * 100).toFixed(0)}%)`);
  if (st3.segs) ok(st3.on, `${tag}: transcript paragraph highlighted`);
  if (st3.segs) {
    await page.click('.tr-body p:first-child .ts');
    await page.waitForTimeout(600);
    const t4 = await page.evaluate(() => document.getElementById('lel-audio').currentTime);
    ok(t4 < 3, `${tag}: transcript timestamp seeks (t=${t4.toFixed(1)})`);
  }
  await page.screenshot({ path: `${OUT}/${tag}-episode.png`, fullPage: true });

  if (tag === 'desktop') {
    await page.click('#pbar [data-act=rate]');
    ok(await page.evaluate(() => document.getElementById('lel-audio').playbackRate) === 1.25, 'desktop: speed button cycles to 1.25x');
    await page.click('#pbar [data-act=toggle]');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById('lel-audio').paused), 'desktop: bar pause works');
    // reload restores position
    const pos = await page.evaluate(() => document.getElementById('lel-audio').currentTime);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ vis: !document.getElementById('pbar').hidden, t: document.getElementById('lel-audio').currentTime || 0 }));
    ok(r.vis, `desktop: player restored after reload (saved ~${pos.toFixed(0)}s)`);
    // back button returns to show page via popstate
    await page.goBack(); await page.waitForTimeout(800);
    ok(page.url().endsWith('/lease-end-minute/'), 'desktop: back button works');
    // ask form validation (no submit to the real endpoint)
    await page.goto(BASE + '/ask/', { waitUntil: 'networkidle' });
    await page.click('#ask-form button[type=submit]');
    ok((await page.textContent('.ask-status')).includes('Please'), 'desktop: ask form validates empty input');
    await page.screenshot({ path: `${OUT}/${tag}-ask.png`, fullPage: true });
  } else {
    await page.click('.menu-btn');
    ok(await page.isVisible('#mnav a[href="/about/"]'), 'mobile: menu opens');
    for (const p of ['/', '/keys-or-keep/', '/about/', '/ask/']) {
      await page.goto(BASE + p, { waitUntil: 'networkidle' });
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(o <= 0, `mobile: no horizontal overflow on ${p} (${o}px)`);
      await page.screenshot({ path: `${OUT}/mobile${p.replace(/\//g, '_')}.png`, fullPage: true });
    }
  }
  const evNames = [...new Set(events.map(e => e.split(' ')[1]))];
  ok(['page_view', 'audio_start', 'audio_play', 'audio_progress', 'audio_seek'].every(n => evNames.includes(n)), `${tag}: analytics events fired: ${evNames.join(', ')}`);
  ok(errors.length === 0, `${tag}: no JS errors ${errors.join(' | ')}`);
  await ctx.close();
}
await run({ width: 1366, height: 860 }, 'desktop');
await run({ width: 390, height: 844 }, 'mobile');
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
