#!/usr/bin/env node
/* Power-curve report: plays many headless runs with the bot and averages, per time bucket, how strong the hero is relative to the rift.
   Usage: node tools/curve.js [class|all] [minutes] [runs per class] [--sloppy] [--tree=full|half|arm:might|m1,m2|-a5] [--bucket=60] [--workers=4] [--json=out.json]
     [--seed=abc] [--depth=3] [--mutator=flux] [--noreact]
   With --seed every run gets its own seed derived from it (seed:class:run), so the whole report is reproducible.

   Columns (averaged over the runs still alive at that time):
     alive  share of runs still going          lvl   hero level         sk/evo  skills held / evolved     tl  tome levels   rel  relics
     ttk    seconds from an enemy's first wound to its death (normal enemies only): low = shredding, high = a fight
     ettk   seconds from an elite's first wound to its death: a clean single-target read of hero power vs. the rift
     fill   enemies alive as a share of the director's target population: low = the hero clears faster than the rift spawns
     cap    raw damage per second (overkill included) / (horde toughness x spawn rate): the hero's clearing headroom
     hurt   damage taken in the bucket as % of max health     low   lowest health seen in the bucket, % of max
     near   enemies within 250 px on average (crowd pressure)  en   enemies alive   hpM  horde toughness multiplier */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
  const pos = args.filter((a) => !a.startsWith('--'));
  const clsArg = pos[0] || 'all', minutes = +(pos[1] || 13), runs = +(pos[2] || 3);
  const classes = clsArg === 'all' ? ['vanguard', 'pyromancer', 'ranger', 'reaper'] : clsArg.split(',');
  const bucket = +(flags.bucket || 60), workers = +(flags.workers || 4);
  const jobs = [];
  for (const cls of classes) for (let r = 0; r < runs; r++) jobs.push({ cls, r });

  const browser = await chromium.launch();
  const errors = [];
  const results = [];
  async function worker() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
    await page.waitForFunction(() => window.PS && PS.Game && PS.Render);
    while (jobs.length) {
      const job = jobs.shift();
      const res = await page.evaluate(runOne, { cls: job.cls, minutes, flags, bucket, r: job.r });
      results.push(res);
      process.stderr.write('.');
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker));
  process.stderr.write('\n');
  await browser.close();

  const report = {};
  for (const cls of classes.concat(classes.length > 1 ? ['ALL'] : [])) {
    const rs = results.filter((r) => cls === 'ALL' || r.cls === cls);
    const nb = Math.ceil((minutes * 60) / bucket);
    const rows = [];
    for (let b = 0; b < nb; b++) {
      const live = rs.map((r) => r.buckets[b]).filter(Boolean);
      if (!live.length) break;
      const avg = (k, d) => +(live.reduce((a, x) => a + (x[k] || 0), 0) / live.length).toFixed(d === undefined ? 1 : d);
      const nz = (k, d) => { const v = live.map((x) => x[k]).filter((x) => x > 0); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(d) : '-'; };
      rows.push({ t: fmt((b + 1) * bucket), alive: Math.round((100 * live.length) / rs.length) + '%', lvl: avg('lvl', 0), sk: avg('sk'), evo: avg('evo'), tl: avg('tl', 0), rel: avg('rel', 0),
        ttk: avg('ttk', 2), ettk: nz('ettk', 1), fill: avg('fill', 2), cap: avg('cap', 1), hurt: avg('hurt', 0), low: avg('low', 0), near: avg('near', 0), en: avg('en', 0), hpM: avg('hpM', 1) });
    }
    const deaths = rs.filter((r) => r.dead).map((r) => r.time).sort((a, b) => a - b);
    const bossT = [0, 1, 2, 3].map((i) => { const v = rs.map((r) => r.bossTook[i]).filter((x) => x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) + 's(' + v.length + ')' : '-'; });
    report[cls] = { rows, deaths, bossT, won: rs.filter((r) => r.won).length, n: rs.length, lvl: Math.round(rs.reduce((a, r) => a + r.level, 0) / rs.length) };
    const rxS = Math.round((100 * rs.reduce((a, r) => a + r.rxShare, 0)) / rs.length), rxN = Math.round(rs.reduce((a, r) => a + r.rxN, 0) / rs.length);
    console.log(`\n=== ${cls}  runs ${rs.length}  won ${report[cls].won}  deaths at [${deaths.map(fmt).join(' ')}]  boss fights ${bossT.join(' ')}  final lvl ${report[cls].lvl}  reactions ${rxN} (${rxS}% of damage)`);
    if (!flags.quiet) console.table(rows);
  }
  if (flags.json) fs.writeFileSync(flags.json, JSON.stringify({ flags, minutes, runs, report, results }, null, 1));
  if (errors.length) { console.log('\nERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n')); process.exitCode = 1; }

  function fmt(s) { return Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0'); }
})();

/* runs inside the page */
async function runOne({ cls, minutes, flags, bucket, r }) {
  const S = PS.Save.data;
  S.unlocked.reaper = true;
  S.tree = {};
  // --tree=full | half | arm:<might|vitality|fortune|mastery> | <node id>,<node id>... (maxed) | -<node id>,... (full tree minus those)
  const tree = String(flags.tree || '');
  for (const n of PS.Data.META) {
    if (tree === 'full') S.tree[n.id] = n.max;
    else if (tree === 'half') S.tree[n.id] = Math.floor(n.max / 2);
    else if (tree.startsWith('arm:')) S.tree[n.id] = tree.slice(4).split('+').includes(n.arm) ? n.max : 0;
    else if (tree.startsWith('-')) S.tree[n.id] = tree.slice(1).split(',').includes(n.id) ? 0 : n.max;
    else if (tree) S.tree[n.id] = tree.split(',').includes(n.id) ? n.max : 0;
  }
  const bot = { sloppy: !!flags.sloppy, random: !!flags.random, element: flags.el || null };
  PS.Game.start(cls, { bot, depth: +(flags.depth || 0), mutator: flags.mutator || undefined, seed: flags.seed !== undefined ? flags.seed + ':' + cls + ':' + r : undefined });
  PS.Game.state = 'sim';
  const G = PS.G, C = PS.Combat, dt = 1 / 60;
  const origTag = C.tag;
  if (flags.noreact) C.tag = () => {}; // A/B: the same runs with reactions switched off
  // instrument: first wound and hit count per enemy, time to kill
  const origDamage = C.damage, origKill = C.kill;
  let acc = null;
  const fresh = () => ({ ttkSum: 0, hitSum: 0, n: 0, eSum: 0, eN: 0, raw: 0, inflow: 0, fillSum: 0, low: 1, nearSum: 0, nearN: 0 });
  acc = fresh();
  C.damage = function (e, dmg, o) {
    if (!e.dead && !(o && o.dot)) { if (e._fw === undefined) e._fw = G.time; e._hits = (e._hits || 0) + 1; }
    const d = origDamage.call(C, e, dmg, o);
    if (!e.boss) acc.raw += d || 0;
    return d;
  };
  C.kill = function (e, o) {
    const was = e.dead;
    origKill.call(C, e, o);
    if (!was && e.dead && !e.big) { acc.ttkSum += G.time - (e._fw !== undefined ? e._fw : G.time); acc.hitSum += e._hits || 1; acc.n++; }
    if (!was && e.dead && e.elite) { acc.eSum += G.time - (e._fw !== undefined ? e._fw : G.time); acc.eN++; }
  };
  const buckets = [];
  let next = bucket, lastTaken = 0, frames = 0;
  const limit = minutes * 60;
  try {
    while (G.time < limit && !G.over) {
      PS.Bot.drive(G);
      PS.Game.step(dt);
      const p = G.player;
      const f = p.hp / p.stats.maxHp;
      if (f < acc.low) acc.low = Math.max(0, f);
      if ((frames++ & 7) === 0) {
        let n = 0; G.grid.query(p.x, p.y, 250, () => { n++; }); acc.nearSum += n; acc.nearN++;
        acc.fillSum += G.enemies.length / Math.max(1, PS.Director.targetCount());
      }
      // 14 is roughly the average base health of what the director spawns
      acc.inflow += PS.Director.hpMult() * PS.Director.spawnRate() * 14 * dt;
      if (G.time >= next) {
        buckets.push({
          lvl: p.level, sk: p.skills.length, evo: p.skills.filter((k) => k.evolved).length, tl: p.tomes.reduce((a, t) => a + t.level, 0), rel: p.relicOrder.length,
          ttk: acc.n ? acc.ttkSum / acc.n : 0, hits: acc.n ? acc.hitSum / acc.n : 0, ettk: acc.eN ? acc.eSum / acc.eN : 0, fill: acc.nearN ? acc.fillSum / acc.nearN : 0,
          cap: acc.inflow ? acc.raw / acc.inflow : 0, hurt: (100 * (G.dmgTaken - lastTaken)) / p.stats.maxHp, low: 100 * acc.low,
          near: acc.nearN ? acc.nearSum / acc.nearN : 0, en: G.enemies.length, hpM: PS.Director.hpMult(),
        });
        lastTaken = G.dmgTaken; acc = fresh(); next += bucket;
      }
      if (frames % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally { C.damage = origDamage; C.kill = origKill; C.tag = origTag; }
  const p = G.player;
  const rxDmg = Object.values(PS.Data.REACTIONS).reduce((a, x) => a + (G.dmgBy[x.name] || 0), 0);
  const out = { cls, time: Math.round(G.time), dead: !!G.over, won: G.won, level: p.level, buckets, bossTook: G.bossLog.map((b) => b.took),
    rxShare: G.dmgTotal ? rxDmg / G.dmgTotal : 0, rxN: Object.values(G.reactions).reduce((a, b) => a + b, 0),
    skills: p.skills.map((s) => s.name + ' L' + s.level), relics: p.relicOrder.length, talents: p.talents.join('/') };
  if (!G.over) PS.Game.endRun(true);
  PS.Game.state = 'menu'; PS.G = null;
  return out;
}
