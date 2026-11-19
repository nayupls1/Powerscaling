#!/usr/bin/env node
/* Exercise every code path at once: each class with all talents, every relic at max stacks and every skill (evolved),
   every reaction, every elite affix and every horde pattern, under a different daily mutator each pass and at Rift Depth
   10 on every second one. Runs for a few minutes, drawing frames along the way, and fails on any page error or
   non-finite number.
   Usage: node tools/stress.js [minutes] */
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const minutes = +(process.argv[2] || 4);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.PS && PS.Game && PS.Render);
  let pass = 0;
  for (const cls of ['vanguard', 'pyromancer', 'ranger', 'reaper', 'stormcaller']) {
    for (const half of [0, 1]) {
      const res = await page.evaluate(async ({ cls, half, minutes, pass }) => {
        PS.Save.data.unlocked.reaper = true;
        for (const n of PS.Data.META) PS.Save.data.tree[n.id] = n.max;
        const mutator = Object.keys(PS.Data.MUTATORS)[pass % Object.keys(PS.Data.MUTATORS).length];
        PS.Game.start(cls, { bot: {}, seed: 'stress' + pass, depth: half ? PS.Data.DEPTH_MAX : 0, mutator });
        PS.Game.state = 'sim';
        const G = PS.G, p = G.player;
        p.talents = [3, 3, 3];
        for (const id in PS.Data.RELICS) for (let i = 0; i < Math.min(3, PS.Data.RELICS[id].max); i++) p.addRelic(id);
        for (const id in PS.Data.TOMES) p.addTome(id, 2);
        // six generic skills per pass (nine per half), all evolved, so every skill behaviour runs
        const ids = PS.Skills.poolIds().filter((_, i) => (i % 2) === half);
        for (const id of ids) { const k = p.addSkill(id); k.level = PS.Skills.MAX_LEVEL; k.evolved = true; PS.Skills.rebuild(k); }
        p.skills[0].level = PS.Skills.MAX_LEVEL; PS.Skills.rebuild(p.skills[0]);
        for (const id in PS.Data.PACTS) p.addPact(id); // every pact, prices and all
        G.queue.length = 0;
        p.recalc(); p.hp = p.stats.maxHp;
        G.time = 170; // jump straight to the first boss
        let n = 0, bad = null, rxN = 0;
        const limit = G.time + minutes * 60;
        const affixes = PS.Data.AFFIX_IDS, hordes = ['ring', 'stampede', 'pincer', 'wall'], rx = Object.values(PS.Data.REACTIONS);
        const spawnAt = [200, 240, 280, 320, 360];
        while (G.time < limit && !G.over) {
          PS.Bot.drive(G); PS.Game.step(1 / 60);
          if (spawnAt.length && G.time > spawnAt[0] && !G.boss) { PS.Bosses.spawn(5 - spawnAt.length, 0); spawnAt.shift(); }
          if (n % 240 === 0) {
            // every elite affix in turn (two at a time), every horde pattern, and every reaction on whatever is nearest
            const k = n / 240, pos = PS.Director.ringPos(-200);
            PS.Enemies.spawn('hound', pos.x, pos.y, { elite: true, affixes: [affixes[k % affixes.length], affixes[(k + 3) % affixes.length]] });
            if (k % 5 === 0) { const q = PS.Director.ringPos(-300), h = PS.Enemies.spawn('hoarder', q.x, q.y); h.life = k % 10 ? 15 : 0.5; h.dripAt = h.maxHp * 0.8; }
            for (const id of ['toad', 'toad', 'warder']) { const q = PS.Director.ringPos(-260); PS.Enemies.spawn(id, q.x, q.y, { elite: id === 'warder' && k % 3 === 0 }); }
            if (k % 4 === 0) PS.Director.horde(9, hordes[(k / 4) % hordes.length]);
            // a breach under the hero's feet, so it wakes at once
            if (k % 6 === 1 && !PS.Director.breach) G.props.push({ kind: 'breach', x: p.x, y: p.y, r: 150, dead: false, t: 0, charge: 0, bob: 0, active: false, need: 0, got: 0, left: 0, out: 0, acc: 0 });
            for (let i = 0; i < 3; i++) {
              const t = PS.Combat.nearest(p.x, p.y, 700);
              if (t) { PS.Combat.react(t, rx[rxN++ % rx.length]); }
            }
          }
          if (n % 600 === 0) {
            p.hurt(5); // exercise on-hurt hooks
            if (!isFinite(p.hp) || !isFinite(p.x) || !isFinite(p.dm) || !isFinite(G.dmgTotal)) { bad = 'player NaN'; break; }
            for (const e of G.enemies) if (!isFinite(e.hp) || !isFinite(e.x) || !isFinite(e.y)) { bad = 'enemy NaN ' + e.def.id; break; }
            for (const pr of G.projs) if (!isFinite(pr.x) || !isFinite(pr.dmg)) { bad = 'proj NaN ' + pr.kind + ' ' + pr.src; break; }
            if (bad) break;
          }
          if (n % 20 === 0) { G.rdt = 1 / 60; PS.Render.draw(G); } // the renderer too: every model, tint and pose
          if (++n % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        const out = { cls, half, mutator, depth: G.depth, rx: Object.keys(G.reactions).length, t: Math.round(G.time), over: G.over, bad, kills: G.kills, bosses: G.bossesKilled, hp: Math.round(p.hp), sources: Object.keys(G.dmgBy).length,
          arrays: [G.enemies.length, G.projs.length, G.zones.length, G.minions.length, G.pickups.length, G.hazards.length, G.eprojs.length].join('/') };
        if (!G.over) PS.Game.endRun(true);
        PS.Game.state = 'menu'; PS.G = null;
        return out;
      }, { cls, half, minutes, pass: pass++ });
      console.log(JSON.stringify(res));
      if (res.bad) process.exitCode = 1;
    }
  }
  if (errors.length) { console.log('\nERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n')); process.exitCode = 1; }
  else console.log('no page errors');
  await browser.close();
})();
