#!/usr/bin/env node
/* Overtime check. Overtime is meant to ramp until it ends the run, whatever the build: this plays the careful bot with
   the full skill tree for up to 30 minutes and fails if any run is still alive at the end. A run that never dies means
   something has started feeding the hero as fast as the horde grows (a hit sized to enemy health that procs copy, map
   events handing out relics without limit). Usage: node tools/overtime.js [classes, comma separated] [--seeds=a,b] */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const args = process.argv.slice(2);
  const pos = args.filter((a) => !a.startsWith('--'));
  const seeds = ((args.find((a) => a.startsWith('--seeds=')) || '--seeds=ot1,ot2').slice(8)).split(',');
  const LIMIT = 1800;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.PS && PS.Game && PS.Render);
  const classes = pos[0] ? pos[0].split(',') : ['ranger', 'pyromancer', 'frostwarden'];
  let bad = 0;
  for (const cls of classes) {
    for (const seed of seeds) {
      const r = await page.evaluate(async ({ cls, seed, LIMIT }) => {
        const S = PS.Save.data;
        for (const id of PS.Data.CLASS_IDS) S.unlocked[id] = true;
        for (const n of PS.Data.META) S.tree[n.id] = n.max;
        PS.Game.start(cls, { bot: {}, seed });
        PS.Game.state = 'sim';
        const G = PS.G;
        let frames = 0;
        while (G.time < LIMIT && !G.over) {
          PS.Bot.drive(G); PS.Game.step(1 / 60);
          if (++frames % 3000 === 0) await new Promise((res) => setTimeout(res, 0));
        }
        const out = { time: Math.round(G.time), dead: !!G.over, level: G.player.level, bosses: G.bossesKilled, won: G.won };
        if (!G.over) PS.Game.endRun(true);
        PS.Game.state = 'menu'; PS.G = null;
        return out;
      }, { cls, seed, LIMIT });
      const mm = Math.floor(r.time / 60) + ':' + String(r.time % 60).padStart(2, '0');
      if (!r.dead) bad++;
      console.log((r.dead ? 'fell   ' : 'ALIVE  ') + cls.padEnd(13) + seed.padEnd(6) + mm + '  level ' + r.level + '  bosses ' + r.bosses + (r.won ? '' : '  (never beat the Rift Lord)'));
    }
  }
  if (errors.length) { console.log('\nERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n')); bad++; }
  console.log(bad ? '\novertime did not end every run' : '\novertime ended every run');
  process.exitCode = bad ? 1 : 0;
  await browser.close();
})();
