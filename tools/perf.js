#!/usr/bin/env node
/* Frame-cost profiler. Plays a real run with the bot (simulation only, at full speed) and, at each checkpoint,
   renders a burst of real frames, timing simulation, canvas draw (per layer) and HUD update.
   Usage: node tools/perf.js [class] [checkpoints in seconds, comma separated] [--frames=120] [--tree=full] [--seed=1]
   Numbers are from headless Chromium (software raster), so compare runs against each other, not against a real GPU. */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
  const pos = args.filter((a) => !a.startsWith('--'));
  const cls = pos[0] || 'pyromancer';
  const checkpoints = (pos[1] || '60,240,420,600,780').split(',').map(Number);
  const frames = +(flags.frames || 120);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const url = flags.url || 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(url);
  await page.waitForFunction(() => window.PS && PS.Game && PS.Render && PS.Save.ready !== false);
  const rows = await page.evaluate(async ({ cls, checkpoints, frames, flags }) => {
    // deterministic run so before/after comparisons see the same fight; the page's own rAF loop is parked so it can't draw (and roll dice) in between
    PS.Game.loop = function () {};
    let s = +(flags.seed || 1) >>> 0;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const S = PS.Save.data;
    S.unlocked.reaper = true;
    if (flags.tree === 'full') for (const n of PS.Data.META) S.tree[n.id] = n.max; else S.tree = {};
    PS.Game.start(cls, { bot: {} });
    PS.Game.state = 'sim';
    const G = PS.G, dt = 1 / 60, out = [];
    for (const cp of checkpoints) {
      let n = 0;
      while (G.time < cp && !G.over) { PS.Bot.drive(G); PS.Game.step(dt); if (++n % 3000 === 0) await new Promise((r) => setTimeout(r, 0)); }
      if (G.over) break;
      PS.Render.prof = {};
      let sim = 0, draw = 0, hud = 0, worst = 0;
      for (let i = 0; i < frames; i++) {
        G.rdt = dt;
        const a = performance.now();
        PS.Bot.drive(G); PS.Game.step(dt);
        const b = performance.now();
        PS.Render.draw(G);
        const c = performance.now();
        PS.UI.updateHud(dt);
        const d = performance.now();
        sim += b - a; draw += c - b; hud += d - c;
        if (d - a > worst) worst = d - a;
        if (G.over) break;
      }
      const prof = PS.Render.prof; PS.Render.prof = null;
      // second pass without the per-layer flushes, for a clean total (one flush per frame so raster work is counted)
      let clean = 0;
      const cx = document.getElementById('game').getContext('2d');
      for (let i = 0; i < frames; i++) {
        const a = performance.now();
        PS.Bot.drive(G); PS.Game.step(dt); PS.Render.draw(G); PS.UI.updateHud(dt);
        cx.getImageData(0, 0, 1, 1);
        clean += performance.now() - a;
        if (G.over) break;
        if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      const f = (v) => +(v / frames).toFixed(2);
      const zk = {}; for (const z of G.zones) zk[z.kind] = (zk[z.kind] || 0) + 1;
      const row = { t: cp, en: G.enemies.length, nProj: G.projs.length, nZone: G.zones.length, eb: G.eprojs.length, pk: G.pickups.length, nFx: PS.FX.counts().parts, boss: G.bossesKilled,
        simMs: f(sim), drawMs: f(draw), hudMs: f(hud), worstMs: +worst.toFixed(1), frameMs: f(clean) };
      for (const k in prof) row[k] = f(prof[k]);
      row.zk = JSON.stringify(zk); out.push(row);
    }
    return out;
  }, { cls, checkpoints, frames, flags });
  if (flags.json) console.log(JSON.stringify(rows, null, 1)); else console.table(rows);
  if (errors.length) { console.log('ERRORS\n' + errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})();
