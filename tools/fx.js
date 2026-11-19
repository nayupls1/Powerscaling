#!/usr/bin/env node
/* Effect sheet. Sets off each visual effect on an empty field with the real renderer and lays its life out as a strip of
   frames, one effect per row, so a change to js/fx.js can be compared side by side.
   Usage: node tools/fx.js [--out=fx.png] [--only=explosion,death] [--times=0.02,0.06,0.12,0.2,0.32,0.5] [--cell=260]
                           [--biome=0] [--root=<repo dir>]
     --only   a comma separated list of rows (see ROWS below); default all
     --times  seconds after the effect starts for each column
     --root   draw another checkout's effects with this tool, for a before/after pair
   Needs Node and Playwright with Chromium. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
  const root = path.resolve(flags.root || path.join(__dirname, '..'));
  const out = path.resolve(flags.out || 'fx.png');
  const times = String(flags.times || '0.02,0.06,0.12,0.2,0.32,0.5').split(',').map(Number);
  const cell = +(flags.cell || 260);
  const browser = await chromium.launch();
  // 780 px tall shows 720 world units: about the scale of the game in a 1280x800 window
  const page = await browser.newPage({ viewport: { width: 780, height: 780 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')));
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForFunction(() => window.PS && PS.Game && PS.Render && PS.Save.ready !== false);

  const res = await page.evaluate(({ times, cell, only, biome }) => {
    PS.Game.loop = function () {};
    let s = 7;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    PS.Save.data.unlocked.reaper = true;
    PS.Save.data.tree = {};
    PS.Save.save = function () {};
    const FX = PS.FX, TAU = Math.PI * 2;
    const enemy = (G, id, elite) => { const e = PS.Enemies.spawn(id, 0, 0, elite ? { elite: true } : null); e.spawnT = 0; e.ang = 0.5; e.kx = 180; e.ky = 60; return e; };
    const gone = (G, e) => { e.dead = true; G.enemies.length = 0; };
    // each row: span is how many world units the cell shows; emit sets the effect off at the origin
    const ROWS = {
      hit: { span: 120, emit() { for (let i = 0; i < 3; i++) FX.hitSpark(-30 + i * 30, (i - 1) * 16, ['#ffb061', '#9fe6ff', '#dba6ff'][i], 0); } },
      death: { span: 200, emit(G) { for (const [id, x, y] of [['imp', -50, -40], ['brute', 30, 30], ['bat', 50, -50]]) { const e = enemy(G, id); e.x = x; e.y = y; FX.death(e); gone(G, e); } } },
      elite: { span: 260, emit(G) { const e = enemy(G, 'hound', true); FX.death(e); gone(G, e); } },
      explosion: { span: 260, emit() { FX.explosion(-45, 0, 70, '#ffb061'); FX.explosion(55, 20, 50, '#c06bff'); } },
      bigboom: { span: 400, emit() { FX.explosion(0, 0, 150, '#ff7a3d', true); } },
      ring: { span: 300, emit() { FX.ring(0, 0, 120, '#bdf0ff', 0.3); } },
      shatter: { span: 200, emit() { FX.shatter(0, 0, '#bdf0ff'); } },
      frost: { span: 400, emit() { FX.ring(0, 0, 150, '#9fe6ff', 0.4); FX.frostBurst(0, 0, 150); } },
      bolt: { span: 400, emit() { FX.bolt(-20, -180, 0, 60, '#ffe14d', 3); FX.bolt(0, 60, 130, 10, '#fff3a8'); FX.bolt(0, 60, -120, 90, '#fff3a8'); } },
      slash: { span: 260, emit() { FX.slash(-30, 20, -0.5, 105, 1.0, '#e8eeff'); } },
      whirl: { span: 300, emit() { FX.whirl(0, 0, 120); } },
      spikes: { span: 200, emit() { FX.spikes(0, 20, 60, '#d9dfef'); } },
      puff: { span: 200, emit() { FX.puff(0, 0, '#8fe04a', 12); } },
      dash: { span: 200, emit() { FX.dashBurst(0, 0, 0, '#7fb8ff'); } },
      hurt: { span: 260, emit(G) { FX.hurt({ x: 0, y: 0 }, 10); } },
      levelup: { span: 500, emit() { FX.levelUp({ x: 0, y: 0 }); } },
      boss: { span: 720, emit(G) { const def = PS.Bosses.DEFS[0], e = PS.Enemies.spawn(def, 0, 0, {}); e.spawnT = 0; e.ang = 0.4; e.bs = { t: 9, n: 0 }; FX.bossDeath(e); gone(G, e); } },
      // newer effects: skipped when --root points at a checkout that does not have them
      portal: { span: 500, needs: 'portal', emit() { FX.portal(0, 0, 150, '#ff5a3d'); } },
      surge: { span: 500, needs: 'surge', emit() { FX.surge(0, 0, '#ffb061', true); } },
      mend: { span: 200, needs: 'mend', emit() { FX.mend({ x: 0, y: 0 }); } },
      herodeath: { span: 600, needs: 'heroDeath', emit(G) { FX.heroDeath({ x: 0, y: 0, cls: G.player.cls }); } },
    };
    const names = (only ? only.split(',') : Object.keys(ROWS)).filter((n) => ROWS[n] && (!ROWS[n].needs || FX[ROWS[n].needs]));
    const cv = document.getElementById('game'), Z = cv.height / 720, labelW = 78;
    const sheet = document.createElement('canvas');
    sheet.width = labelW + times.length * (cell + 4) + 4; sheet.height = names.length * (cell + 4) + 4 + 18;
    const g = sheet.getContext('2d');
    g.fillStyle = '#0d0920'; g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '600 13px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#efe8d8';
    times.forEach((t, c) => { g.textAlign = 'center'; g.fillText(t.toFixed(2) + ' s', labelW + c * (cell + 4) + cell / 2, 10); });
    names.forEach((name, r) => {
      const row = ROWS[name];
      PS.Game.start('vanguard', { bot: {} });
      PS.Game.state = 'sim';
      const G = PS.G, p = G.player;
      G.time = biome * 180 + 12; G.rdt = 0;
      p.x = 4000; p.y = 4000; // the hero stands well clear of the stage
      G.enemies.length = 0; G.props.length = 0; G.pickups.length = 0;
      FX.reset();
      FX.update(0); // sets the frame's particle budget
      row.emit(G);
      let at = 0;
      times.forEach((t, c) => {
        // step in sixtieths so drag and gravity integrate as they do in play
        while (at < t - 1e-6) { const dt = Math.min(1 / 60, t - at); FX.update(dt); G.time += dt; at += dt; }
        G.cam.x = 0; G.cam.y = 0; G.frame += 2;
        PS.Render.draw(G);
        const src = row.span * Z, x = labelW + c * (cell + 4), y = 20 + r * (cell + 4);
        g.drawImage(cv, cv.width / 2 - src / 2, cv.height / 2 - src / 2, src, src, x, y, cell, cell);
      });
      g.textAlign = 'left'; g.fillStyle = '#efe8d8';
      g.fillText(name, 8, 20 + r * (cell + 4) + cell / 2);
    });
    PS.Game.state = 'menu'; PS.G = null;
    return { url: sheet.toDataURL('image/png'), rows: names };
  }, { times, cell, only: flags.only || '', biome: +(flags.biome || 0) });
  fs.writeFileSync(out, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log('wrote ' + out + ' (' + res.rows.join(', ') + ')');
  if (errors.length) { console.log('ERRORS\n' + errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})();
