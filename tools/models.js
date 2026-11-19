#!/usr/bin/env node
/* Model sheet. Draws every character model (heroes, minions, enemies, an elite, bosses) with the real renderer, one per
   labelled cell, and writes a PNG, so art changes can be compared side by side.
   Usage: node tools/models.js [--out=models.png] [--zoom=3] [--t=2.4] [--root=<repo dir>] [--scene] [--frames=N --dt=0.05]
     --scene    a staged fight (hero ringed by the roster) instead of the sheet
     --frames   write N numbered PNGs with time advancing --dt apiece, for an animation
   Needs Node and Playwright with Chromium. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
  const zoom = +(flags.zoom || 3);
  const root = path.resolve(flags.root || path.join(__dirname, '..'));
  const out = path.resolve(flags.out || 'models.png');
  const frames = +(flags.frames || 1), dt = +(flags.dt || 0.05);
  const browser = await chromium.launch();
  // the renderer caps the device pixel ratio at 2 and shows 720 world units vertically, so this viewport gives `zoom` px per unit
  const page = await browser.newPage({ viewport: { width: Math.round(640 * zoom), height: 360 * zoom }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForFunction(() => window.PS && PS.Game && PS.Render && PS.Save.ready !== false);

  await page.evaluate(() => {
    PS.Game.loop = function () {};
    let s = 7;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    PS.Save.data.unlocked.reaper = true;
    PS.Save.data.tree = {};
    PS.Save.save = function () {};
    window.MS = {
      /** a quiet run with nothing in it; the hero stands at the origin aiming along +x */
      stage(cls, t) {
        PS.Game.start(cls, { bot: {} });
        PS.Game.state = 'sim';
        const G = PS.G, p = G.player;
        G.time = t; G.rdt = 0; // rdt 0 pins the camera where we put it
        p.x = 0; p.y = 0; p.aim = 0; p.aimX = 200; p.aimY = 0;
        p.walk = t * 11; p.moving = true; p.inv = 0; p.hurtFlash = 0;
        G.enemies.length = 0; G.minions.length = 0; G.props.length = 0; G.pickups.length = 0;
        PS.FX.reset();
        return G;
      },
      enemy(G, id, x, y, ang, elite) {
        const e = PS.Enemies.spawn(id, x, y, elite ? { elite: true } : null);
        e.spawnT = 0; e.ang = ang || 0; e.wob = ((G.enemies.length - 1) * 1.7) % 6.28;
        return e;
      },
      boss(G, i, x, y, ang) {
        const def = PS.Bosses.DEFS[i];
        const e = PS.Enemies.spawn(def, x, y, {});
        e.spawnT = 0; e.ang = ang || 0; e.wob = 0; e.bs = { t: 9, n: 0 };
        return e;
      },
      minion(G, kind, x, y, ang, i) {
        const m = PS.Combat.minion({ x, y, kind, r: kind === 'knight' ? 15 : 11, dmg: 1, life: 99, seat: i || 0 });
        m.ang = ang || 0; m.bob = G.time * 5 + (i || 0);
        return m;
      },
      draw(G, cx, cy) {
        G.cam.x = cx; G.cam.y = cy;
        G.frame += 2; // the boss is repainted every other frame
        PS.Render.draw(G);
        return document.getElementById('game');
      },
    };
  });

  const save = (dataUrl, file) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const t0 = +(flags.t || 2.4);

  for (let f = 0; f < frames; f++) {
    const t = t0 + f * dt;
    const file = frames > 1 ? out.replace(/\.png$/, '') + '-' + String(f).padStart(3, '0') + '.png' : out;
    const res = await page.evaluate(({ t, zoom, scene, walk }) => {
      const cv = document.getElementById('game');
      const Z = cv.height / 720; // device px per world unit
      const R = PS.Enemies.DEFS;
      if (scene) {
        // a staged fight: the hero in the middle, the roster closing in from every side, one boss
        const G = MS.stage(scene === true ? 'vanguard' : scene, t);
        const ids = Object.keys(R);
        let k = 0;
        for (const ring of [{ d: 150, n: 9 }, { d: 235, n: 14 }, { d: 320, n: 18 }]) {
          for (let i = 0; i < ring.n; i++, k++) {
            const a = (i / ring.n) * 6.283 + ring.d * 0.01, d = ring.d + ((k * 37) % 30) - 15 - (walk ? (t * 20) % 40 : 0);
            MS.enemy(G, ids[(k * 7) % ids.length], Math.cos(a) * d, Math.sin(a) * d, a + Math.PI, k === 12);
          }
        }
        MS.boss(G, 0, -330, -150, 0.45);
        MS.minion(G, 'skeleton', 48, 44, 0.6, 0); MS.minion(G, 'knight', -50, 46, 2.4, 1); MS.minion(G, 'familiar', 30, -44, 0, 2);
        const c = MS.draw(G, 0, 0);
        return { url: c.toDataURL('image/png') };
      }
      const cells = [];
      for (const cls of Object.keys(PS.Data.CLASSES)) cells.push({ kind: 'hero', id: cls, label: PS.Data.CLASSES[cls].name, size: 120 });
      for (const m of ['skeleton', 'knight', 'familiar']) cells.push({ kind: 'minion', id: m, label: { skeleton: 'Skeleton', knight: 'Death Knight', familiar: 'Familiar' }[m], size: 90 });
      for (const id in R) cells.push({ kind: 'enemy', id, label: R[id].name, size: 90 });
      cells.push({ kind: 'enemy', id: 'imp', elite: true, label: 'Elite Rift Imp', size: 90 });
      PS.Bosses.DEFS.forEach((b, i) => cells.push({ kind: 'boss', id: i, label: b.name + ' ' + b.title, size: 230 }));

      // lay the cells out in rows, wrapping at 760 world units; bosses start a row of their own
      const pad = 10, labelH = 26;
      let x = pad, y = pad, rowH = 0;
      const maxW = 760 * Z + 9 * pad;
      for (const c of cells) {
        const w = c.size * Z;
        if (x + w + pad > maxW + 1 || (c.kind === 'boss' && cells[cells.indexOf(c) - 1].kind !== 'boss')) { x = pad; y += rowH + pad; rowH = 0; }
        c.x = x; c.y = y; c.w = w; c.h = w + labelH;
        x += w + pad; rowH = Math.max(rowH, c.h);
      }
      const sheet = document.createElement('canvas');
      sheet.width = maxW; sheet.height = y + rowH + pad;
      const g = sheet.getContext('2d');
      g.fillStyle = '#0d0920'; g.fillRect(0, 0, sheet.width, sheet.height);
      g.font = '600 15px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let G = MS.stage('vanguard', t);
      for (const c of cells) {
        let cx = 1000, cy = 0; // models stand well away from the hero so each cell holds exactly one
        if (c.kind === 'hero') { G = MS.stage(c.id, t); cx = 0; cy = 0; }
        else {
          G.enemies.length = 0; G.minions.length = 0;
          if (c.kind === 'enemy') MS.enemy(G, c.id, cx, cy, 0, c.elite).wob = c.id === 'bat' ? 0.9 : 0; // wings spread
          else if (c.kind === 'boss') MS.boss(G, c.id, cx, cy, 0);
          else MS.minion(G, c.id, cx, cy, 0, 0);
        }
        const src = MS.draw(G, cx, cy);
        g.drawImage(src, src.width / 2 - c.w / 2, src.height / 2 - c.w / 2, c.w, c.w, c.x, c.y, c.w, c.w);
        g.fillStyle = '#1a1433'; g.fillRect(c.x, c.y + c.w, c.w, labelH);
        g.fillStyle = '#efe8d8'; g.fillText(c.label, c.x + c.w / 2, c.y + c.w + labelH / 2 + 1);
      }
      return { url: sheet.toDataURL('image/png'), cells: cells.map((c) => ({ label: c.label, x: c.x, y: c.y, w: c.w, h: c.h })) };
    }, { t, zoom, scene: flags.scene || false, walk: !!flags.walk });
    save(res.url, file);
    if (res.cells && f === 0) fs.writeFileSync(out.replace(/\.png$/, '') + '.json', JSON.stringify(res.cells));
  }
  console.log('wrote ' + out + (frames > 1 ? ' (' + frames + ' frames)' : ''));
  if (errors.length) { console.log('ERRORS\n' + errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})();
