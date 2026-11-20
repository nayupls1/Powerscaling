#!/usr/bin/env node
/* Seed check, in two parts. The script: a careful and a careless player on one seed must meet the same hordes, elites,
   tides and breach trials in the same order. And the replay: plays a seed, then a different run, then the first seed again in the same page, and fails unless the two
   plays of the seed match exactly: anything a run leaves behind (a module variable, a Director field that reset()
   forgets) shows up here as a difference. Usage: node tools/determinism.js [minutes] [--seed=abc] */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const args = process.argv.slice(2);
  const minutes = +(args.find((a) => !a.startsWith('--')) || 9);
  const seed = (args.find((a) => a.startsWith('--seed=')) || '--seed=det').slice(7);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.PS && PS.Game && PS.Render);
  const classes = await page.evaluate(() => PS.Data.CLASS_IDS);
  let bad = 0;
  for (const cls of classes) {
    const res = await page.evaluate(({ cls, seed, minutes, other }) => {
      for (const id of PS.Data.CLASS_IDS) PS.Save.data.unlocked[id] = true;
      const play = (c, s, opts) => {
        PS.Game.start(c, Object.assign({ bot: {}, seed: s }, opts));
        PS.Game.state = 'sim';
        const G = PS.G, p = G.player;
        while (G.time < minutes * 60 && !G.over) { PS.Bot.drive(G); PS.Game.step(1 / 60); }
        const sig = [G.frame, G.kills, Math.round(G.dmgTotal), Math.round(G.dmgTaken), p.level, p.gold, Math.round(p.x), Math.round(p.y),
          p.relicOrder.join(), p.skills.map((k) => k.id + k.level).join(), p.pacts.join(), G.breaches, G.hoarders, PS.Director.lastTide].join('|');
        if (!G.over) PS.Game.endRun(true);
        PS.Game.state = 'menu'; PS.G = null;
        return sig;
      };
      const a = play(cls, seed);
      play(other, seed + ':between', { depth: 3, mutator: 'parade' }); // something as different as possible in between
      const b = play(cls, seed);
      // the script: a careless player on the same seed must meet the same hordes, elites, tides and breach trials, in order
      const script = (bot) => {
        PS.Game.start(cls, { bot, seed });
        PS.Game.state = 'sim';
        const G = PS.G;
        // kept alive, so that a careless player's script is as long as a careful one's and all of it is compared
        while (G.time < minutes * 60 && !G.over) { PS.Bot.drive(G); PS.Game.step(1 / 60); G.player.hp = G.player.stats.maxHp; }
        const sc = G.script;
        if (!G.over) PS.Game.endRun(true);
        PS.Game.state = 'menu'; PS.G = null;
        return sc;
      };
      const s1 = script({}), s2 = script({ sloppy: true, random: true });
      const drift = [];
      for (const k of ['horde', 'elite', 'tide', 'breach']) {
        const x = s1[k] || [], y = s2[k] || [], n = Math.min(x.length, y.length);
        for (let i = 0; i < n; i++) if (x[i] !== y[i]) { drift.push(`${k} ${i + 1}: ${x[i]} / ${y[i]}`); break; }
      }
      return { a, b, drift, counts: ['horde', 'elite', 'tide', 'breach'].map((k) => (s1[k] || []).length + '/' + (s2[k] || []).length).join(' ') };
    }, { cls, seed, minutes, other: classes[(classes.indexOf(cls) + 1) % classes.length] });
    const same = res.a === res.b;
    if (!same) bad++;
    if (res.drift.length) bad++;
    console.log((same ? 'same   ' : 'DIFFERS') + ' ' + cls.padEnd(13) + (res.drift.length ? ' SCRIPT DRIFTS: ' + res.drift.join('; ') : ' script holds (hordes, elites, tides, breaches compared: ' + res.counts + ')') + (same ? '' : '\n  first  ' + res.a + '\n  again  ' + res.b));
  }
  if (errors.length) { console.log('\nERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n')); bad++; }
  console.log(bad ? '\nseeded runs are not reproducible' : '\nevery class replays its seed exactly');
  process.exitCode = bad ? 1 : 0;
  await browser.close();
})();
