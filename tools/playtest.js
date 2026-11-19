#!/usr/bin/env node
/* Headless balance/regression playtest. Usage: node tools/playtest.js [class|all] [minutes] [runs] [--random] [--el=fire] [--branch=0] [--tree=full]
     [--seed=abc] [--depth=3] [--mutator=flux] [--daily[=YYYY-MM-DD]]
   Drives the real game simulation with the built-in bot at max speed and prints a timeline.
   With --seed a run is reproducible: the same seed, class and flags replay the same run, frame for frame. */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
  const pos = args.filter((a) => !a.startsWith('--'));
  const clsArg = pos[0] || 'all', minutes = +(pos[1] || 13), runs = +(pos[2] || 1);
  const classes = clsArg === 'all' ? ['vanguard', 'pyromancer', 'ranger', 'reaper'] : [clsArg];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.PS && PS.Game && PS.Render);

  for (const cls of classes) {
    for (let r = 0; r < runs; r++) {
      const res = await page.evaluate(async ({ cls, minutes, flags, r }) => {
        const S = PS.Save.data;
        S.unlocked.reaper = true;
        if (flags.tree === 'full') for (const n of PS.Data.META) S.tree[n.id] = n.max; else if (!flags.keeptree) S.tree = {};
        const bot = { random: !!flags.random, element: flags.el || null, branch: flags.branch !== undefined ? +flags.branch : null, noDash: !!flags.nodash, sloppy: !!flags.sloppy };
        if (flags.afk !== undefined) bot.afkAt = +flags.afk;
        if (flags.want) bot.want = String(flags.want).split(',');
        if (flags.tomes) bot.wantTomes = String(flags.tomes).split(',');
        const opts = { bot, depth: +(flags.depth || 0), mutator: flags.mutator || undefined };
        if (flags.seed !== undefined) opts.seed = flags.seed + (r ? ':' + r : ''); // later runs of a batch get their own seed
        if (flags.daily) opts.daily = flags.daily;
        PS.Game.start(cls, opts);
        cls = PS.G.cls; // the daily rift picks the class
        PS.Game.state = 'sim'; // stop the rAF loop from stepping; we drive it
        const G = PS.G, dt = 1 / 60, out = [];
        let nextSample = 30, lastDmg = 0, lastKills = 0, maxStep = 0, t0 = performance.now(), frames = 0;
        const limit = flags.afk !== undefined ? +flags.afk + 120 : minutes * 60; // idle tests stop two minutes after letting go
        while (G.time < limit && !G.over) {
          const a = performance.now();
          PS.Bot.drive(G);
          PS.Game.step(dt);
          const b = performance.now() - a;
          if (b > maxStep) maxStep = b;
          frames++;
          if (G.time >= nextSample) {
            const p = G.player;
            out.push({ t: nextSample, lvl: p.level, hp: Math.round(p.hp) + '/' + p.stats.maxHp, en: G.enemies.length, kills: G.kills - lastKills,
              dps: Math.round((G.dmgTotal - lastDmg) / 30), hpM: +PS.Director.hpMult().toFixed(2), taken: Math.round(G.dmgTaken), gold: p.gold, relics: p.relicOrder.length,
              skills: p.skills.length, tomes: p.tomes.length, boss: G.boss ? Math.round(100 * G.boss.hp / G.boss.maxHp) + '%' : '-', bk: G.bossesKilled });
            lastDmg = G.dmgTotal; lastKills = G.kills; nextSample += 30;
          }
          if (frames % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        const p = G.player;
        const top = Object.entries(G.dmgBy).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' ' + Math.round(100 * v / G.dmgTotal) + '%');
        const rx = Object.entries(G.reactions).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v);
        const summary = { cls, seed: G.seed, depth: G.depth, mutator: G.rules.mutator, reactions: rx, hurtBy: Object.entries(G.hurtBy).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ' ' + Math.round(v)),
          time: Math.round(G.time), dead: !!G.over, level: p.level, kills: G.kills, bosses: G.bossesKilled, won: G.won, score: PS.Game.finalScore(G),
          skills: p.skills.map((s) => s.name + ' L' + s.level + (s.evolved ? '*' : '')), tomes: p.tomes.map((t) => t.id + t.level), relics: p.relicOrder.map((id) => id + (p.relics[id] > 1 ? 'x' + p.relics[id] : '')),
          talents: p.talents.join('/'), aff: JSON.stringify(p.aff), top, msPerFrame: +((performance.now() - t0) / frames).toFixed(3), maxStepMs: +maxStep.toFixed(1),
          killedBy: G.over && G.boss ? G.boss.def.name : null, bossLog: G.bossLog.map((b) => b.name + '@' + b.at + ' ' + b.took + 's').join(', '), taken: Math.round(G.dmgTaken), hp: Math.round(p.hp) + '/' + p.stats.maxHp };
        if (!G.over) PS.Game.endRun(true);
        summary.essence = G.result.essence;
        PS.Game.state = 'menu'; PS.G = null;
        return { out, summary };
      }, { cls, minutes, flags, r });
      console.log('\n=== ' + cls + ' run ' + (r + 1) + ' ===');
      if (!flags.quiet) console.table(res.out);
      console.log(JSON.stringify(res.summary, null, 1));
    }
  }
  if (errors.length) { console.log('\nERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n')); process.exitCode = 1; }
  else console.log('\nno page errors');
  await browser.close();
})();
