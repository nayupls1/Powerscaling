/* POWERSCALING — visual effects: particles, damage numbers, bolts, rings, slashes, explosions, scorch marks, screen shake.
   Nothing here touches the seeded simulation: every random number is Math.random, and effects never feed back into play. */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, TAU = U.TAU;
  const MAX_PARTS = 900, MAX_NUMS = 90;
  // kill procs can fire 20 rings or blasts a frame; past this many on screen more of them only cost frame time
  const MAX_RINGS = 70, MAX_BOOMS = 60, MAX_FLARES = 36, MAX_CORPSES = 14, MAX_DECALS = 12;
  const EL_COL = { fire: '#ffb061', frost: '#9fe6ff', storm: '#ffe14d', venom: '#b8f078', steel: '#f4f6ff', void: '#dba6ff' };
  const SCORCH = '#0a0514';

  /* Particles live in flat typed arrays: no objects to allocate or collect, and the update loop stays in cache.
     A dot is a square that the renderer snaps to whole device pixels (half the cost of an anti-aliased one);
     a streak is a tapered shard drawn along its own velocity, so sparks and debris read as motion. */
  const DOT = 0, STREAK = 1;
  const pX = new Float32Array(MAX_PARTS), pY = new Float32Array(MAX_PARTS), pVX = new Float32Array(MAX_PARTS), pVY = new Float32Array(MAX_PARTS);
  const pLife = new Float32Array(MAX_PARTS), pMax = new Float32Array(MAX_PARTS), pSize = new Float32Array(MAX_PARTS);
  const pDrag = new Float32Array(MAX_PARTS), pGrav = new Float32Array(MAX_PARTS);
  const pKind = new Uint8Array(MAX_PARTS), pCol = new Uint16Array(MAX_PARTS);
  let pN = 0;
  const palette = [], palIdx = new Map();

  const nums = [], bolts = [], rings = [], slashes = [], ghosts = [], booms = [], flares = [], corpses = [], decals = [], rays = [], queue = [];
  let budget = 0; // per-frame particle allowance so mass deaths don't flood
  let cap = MAX_PARTS;
  let rich = true; // false once the renderer has traded resolution away: the purely decorative layers go first

  function part(x, y, vx, vy, life, size, color, drag, grav, kind) {
    if (pN >= cap || budget <= 0) return;
    budget--;
    let c = palIdx.get(color);
    if (c === undefined) { c = palette.length; palette.push(color); palIdx.set(color, c); }
    const i = pN++;
    pX[i] = x; pY[i] = y; pVX[i] = vx; pVY[i] = vy; pLife[i] = life; pMax[i] = life; pSize[i] = size;
    pDrag[i] = drag === undefined ? 3 : drag; pGrav[i] = grav || 0; pKind[i] = kind || DOT; pCol[i] = c;
  }
  /** n particles thrown outward; with ang they stay inside a cone of half-width spread around it */
  function burst(x, y, n, color, speed, life, size, kind, ang, spread) {
    for (let i = 0; i < n; i++) {
      const a = ang === undefined ? Math.random() * TAU : ang + (Math.random() * 2 - 1) * spread, sp = speed * (0.3 + Math.random() * 0.7);
      part(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.5 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.8), color, undefined, 0, kind);
    }
  }
  function decay(arr, dt) {
    for (let i = arr.length - 1; i >= 0; i--) {
      arr[i].life -= dt;
      if (arr[i].life <= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
    }
  }
  const seen = (o, r, v) => o.x + r > v.x0 && o.x - r < v.x1 && o.y + r > v.y0 && o.y - r < v.y1;

  const FX = {
    /** the fallen horde, flashing out: the renderer draws these from its sprite cache */
    corpses,
    /** a boss that has just died, { e, life, max }: the renderer burns its silhouette away */
    fallen: null,

    reset() {
      pN = 0;
      for (const a of [nums, bolts, rings, slashes, ghosts, booms, flares, corpses, decals, rays, queue]) a.length = 0;
      FX.fallen = null;
    },
    counts() { return { parts: pN, nums: nums.length, booms: booms.length, rings: rings.length, flares: flares.length, decals: decals.length, corpses: corpses.length }; },

    update(dt) {
      // fewer particles once the renderer has had to trade away resolution
      const det = PS.Render.detail();
      budget = Math.round(140 * det);
      cap = Math.round(MAX_PARTS * det);
      rich = det >= 0.8;
      for (let i = pN - 1; i >= 0; i--) {
        const l = pLife[i] - dt;
        if (l <= 0) {
          const j = --pN;
          if (i !== j) {
            pX[i] = pX[j]; pY[i] = pY[j]; pVX[i] = pVX[j]; pVY[i] = pVY[j]; pLife[i] = pLife[j]; pMax[i] = pMax[j]; pSize[i] = pSize[j];
            pDrag[i] = pDrag[j]; pGrav[i] = pGrav[j]; pKind[i] = pKind[j]; pCol[i] = pCol[j];
          }
          continue;
        }
        pLife[i] = l;
        pX[i] += pVX[i] * dt; pY[i] += pVY[i] * dt;
        const k = Math.max(0, 1 - pDrag[i] * dt);
        pVX[i] *= k;
        pVY[i] = pVY[i] * k + pGrav[i] * dt;
      }
      for (let i = nums.length - 1; i >= 0; i--) {
        const n = nums[i];
        n.life -= dt;
        if (n.life <= 0) { nums.splice(i, 1); continue; }
        n.y += n.vy * dt;
        n.x += n.vx * dt;
        n.vy += 90 * dt;
      }
      decay(bolts, dt); decay(rings, dt); decay(slashes, dt); decay(ghosts, dt); decay(booms, dt); decay(flares, dt); decay(decals, dt); decay(rays, dt);
      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i];
        c.life -= dt;
        if (c.life <= 0) { corpses[i] = corpses[corpses.length - 1]; corpses.pop(); continue; }
        c.x += c.vx * dt; c.y += c.vy * dt;
      }
      if (FX.fallen && (FX.fallen.life -= dt) <= 0) FX.fallen = null;
      // effects set to go off a moment from now (a dying boss keeps bursting)
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i];
        if ((q.t -= dt) > 0) continue;
        queue[i] = queue[queue.length - 1]; queue.pop();
        q.fn();
      }
      const G = PS.G;
      if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 30 - G.shake * dt * 6);
      if (G.flashA > 0) G.flashA = Math.max(0, G.flashA - dt * 1.8);
    },

    /* ------------------------------------------------------------ emitters */
    dmgNum(x, y, dmg, crit, el, dot) {
      if (!PS.Save.data.settings.dmgNums) return;
      if (nums.length >= MAX_NUMS) {
        if (dot || !crit) return;
        nums.shift();
      }
      // thin the stream out as the screen fills so numbers stay readable
      const load = nums.length / MAX_NUMS;
      if (dot && load > 0.5) return;
      if (load > 0.45 && Math.random() < load) return;
      const txt = dmg >= 10000 ? U.fmtNum(dmg) : String(Math.max(1, Math.round(dmg)));
      nums.push({
        x: x + U.frand(-10, 10), y: y + U.frand(-6, 6), vx: U.frand(-18, 18), vy: dot ? -45 : -95, text: crit ? txt + '!' : txt,
        color: crit ? '#fff06b' : (EL_COL[el] || '#ffffff'), life: dot ? 0.5 : crit ? 0.85 : 0.6, max: dot ? 0.5 : crit ? 0.85 : 0.6,
        size: dot ? 12 : crit ? 20 : 15, crit,
      });
    },
    text(x, y, text, color) {
      nums.push({ x, y, vx: 0, vy: -70, text, color: color || '#fff', life: 1, max: 1, size: 15, crit: false, label: true });
    },
    spark(x, y, color) { part(x, y, U.frand(-30, 30), U.frand(-30, 30), 0.3, 3, color, 2); },
    /** a spark that drifts upward and winks out: burning things, fire on the ground */
    ember(x, y, color) { part(x, y, U.frand(-16, 16), U.frand(-75, -30), U.frand(0.35, 0.6), 3, color, 0.6, -40); },
    /** ang: the way the blow was travelling; the sparks splash back off it */
    hitSpark(x, y, color, ang) {
      burst(x, y, 3, color, 210, 0.22, 3.2, STREAK, ang === undefined ? undefined : ang + Math.PI, 1.0);
      // a pinpoint flash while the screen is calm enough for single hits to matter
      if (flares.length < 10) FX.flare(x, y, 13, color, 0.09);
    },
    puff(x, y, color, n) {
      burst(x, y, n, color, 120, 0.5, 5);
      if (n >= 8) FX.flare(x, y, 26, color, 0.16);
    },
    /** a short flash of light that only fades (so one cached glow serves its whole life) */
    flare(x, y, r, color, dur) {
      if (flares.length >= MAX_FLARES) return;
      flares.push({ x, y, r, color, life: dur || 0.12, max: dur || 0.12 });
    },
    /** soot left on the ground, still glowing for a moment in the colour of what burned there */
    decal(x, y, r, color, dur) {
      if (!rich || decals.length >= MAX_DECALS) return;
      // blasts landing on top of each other share one mark
      for (let i = 0; i < decals.length; i++) {
        const d = decals[i], dx = d.x - x, dy = d.y - y;
        if (d.max - d.life < 0.5 && dx * dx + dy * dy < r * r * 0.5) return;
      }
      decals.push({ x, y, r, color, life: dur || 2.8, max: dur || 2.8 });
    },
    later(t, fn) { queue.push({ t, fn }); },
    death(e) {
      if (e.boss) return;
      const col = e.def.color, big = e.elite;
      // the body flashes white where it stood, sliding the way the killing blow shoved it
      if (corpses.length < MAX_CORPSES) {
        const life = big ? 0.26 : corpses.length > 6 ? 0.1 : 0.14; // briefer when the dead are many
        corpses.push({ spr: e.def.sprite, x: e.x, y: e.y, ang: e.ang, sc: e.r / e.def.r, wob: e.wob, t: PS.G.time, vx: e.kx * 0.5, vy: e.ky * 0.5, life, max: life });
      }
      const kd = e.kx * e.kx + e.ky * e.ky, dir = kd > 900 ? Math.atan2(e.ky, e.kx) : undefined;
      burst(e.x, e.y, big ? 14 : 4, col, big ? 320 : 230, 0.4, big ? 5.5 : 3.6, STREAK, dir, 1.1);
      burst(e.x, e.y, big ? 6 : 1, '#ffffff', 90, 0.45, 3);
      if (big) {
        FX.ring(e.x, e.y, e.r * 3.4, col, 0.4);
        FX.flare(e.x, e.y, e.r * 2.6, '#ffffff', 0.2);
        FX.decal(e.x, e.y, e.r * 2.2, col);
      }
    },
    bossDeath(e) {
      const col = e.def.color, x = e.x, y = e.y;
      budget += 320;
      burst(x, y, 110, col, 560, 1.2, 7, STREAK);
      burst(x, y, 50, '#ffffff', 380, 0.9, 5);
      for (let i = 0; i < 4; i++) rings.push({ x, y, r: 200 + i * 130, life: 0.5 + i * 0.15, max: 0.5 + i * 0.15, color: col, w: 8 });
      booms.push({ x, y, r: 320, life: 0.6, max: 0.6, color: col, big: true });
      FX.rays(x, y, 460, col, 14, 1.1);
      flares.push({ x, y, r: e.r * 5, color: '#ffffff', life: 0.4, max: 0.4 });
      decals.push({ x, y, r: e.r * 3.6, color: col, life: 7, max: 7 });
      FX.fallen = { e, x, y, life: 0.9, max: 0.9, painted: false };
      // the body keeps bursting while its silhouette burns away
      for (let i = 0; i < 7; i++) {
        FX.later(0.07 + i * 0.085, () => {
          const a = Math.random() * TAU, d = e.r * U.frand(0.4, 1.9);
          FX.explosion(x + Math.cos(a) * d, y + Math.sin(a) * d, U.frand(55, 100), i % 2 ? '#ffffff' : col, i % 3 === 0);
        });
      }
    },
    /** shafts of light thrown out from a point */
    rays(x, y, r, color, n, dur) {
      if (rays.length < 5) rays.push({ x, y, r, life: dur || 0.7, max: dur || 0.7, color, rot: Math.random() * TAU, n: n || 10 });
    },
    /** something tearing its way in: light is pulled to a point, then thrown back out */
    portal(x, y, r, color) {
      budget += 40;
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * TAU, d = r * U.frand(0.7, 1.3), sp = d * 2.4;
        part(x + Math.cos(a) * d, y + Math.sin(a) * d, -Math.cos(a) * sp, -Math.sin(a) * sp, 0.4, 5, i % 3 ? color : '#ffffff', 0, 0, STREAK);
      }
      rings.push({ x, y, r, life: 0.6, max: 0.6, color, w: 6 });
      FX.later(0.32, () => {
        FX.rays(x, y, r * 1.5, color, 9, 0.7);
        FX.flare(x, y, r * 0.55, '#ffffff', 0.25);
        rings.push({ x, y, r: r * 1.4, life: 0.45, max: 0.45, color: '#ffffff', w: 4 });
      });
    },
    /** power taken on: an evolution (big) or a talent */
    surge(x, y, color, big) {
      budget += 40;
      rings.push({ x, y, r: big ? 220 : 150, life: 0.5, max: 0.5, color, w: big ? 7 : 5 });
      FX.flare(x, y, big ? 100 : 70, color, 0.3);
      if (big) FX.rays(x, y, 280, color, 10, 0.7);
      for (let i = 0; i < (big ? 28 : 16); i++) {
        const a = (i / (big ? 28 : 16)) * TAU;
        part(x + Math.cos(a) * 26, y + Math.sin(a) * 26, Math.cos(a) * 90, -U.frand(140, 320), 0.8, 4, i % 2 ? color : '#ffffff', 1.5, 0, STREAK);
      }
    },
    /** a heal taken in: green light rising round the hero */
    mend(p) {
      FX.flare(p.x, p.y, 60, '#7dffa0', 0.3);
      for (let i = 0; i < 12; i++) part(p.x + U.frand(-22, 22), p.y + U.frand(-10, 18), U.frand(-12, 12), -U.frand(90, 210), U.frand(0.5, 0.8), 3.5, i % 3 ? '#7dffa0' : '#ffffff', 1.2, 0, STREAK);
    },
    /** the hero comes apart */
    heroDeath(p) {
      budget += 120;
      burst(p.x, p.y, 60, p.cls.color, 440, 1.0, 6, STREAK);
      burst(p.x, p.y, 30, '#ffffff', 260, 0.9, 4);
      rings.push({ x: p.x, y: p.y, r: 260, life: 0.6, max: 0.6, color: '#ff4d6d', w: 7 });
      rings.push({ x: p.x, y: p.y, r: 140, life: 0.4, max: 0.4, color: '#ffffff', w: 4 });
      flares.push({ x: p.x, y: p.y, r: 110, color: '#ffffff', life: 0.35, max: 0.35 });
      FX.rays(p.x, p.y, 300, '#ff4d6d', 10, 0.9);
    },
    explosion(x, y, r, color, big) {
      if (booms.length >= (big ? MAX_BOOMS * 1.5 : MAX_BOOMS)) { burst(x, y, 3, color, r * 3.2, 0.4, 4, STREAK); return; }
      booms.push({ x, y, r, life: big ? 0.42 : 0.28, max: big ? 0.42 : 0.28, color, big: !!big });
      // debris thrown clear, and a few embers left hanging in the heat
      burst(x, y, big ? 13 : 4, color, r * 3.8, 0.4, big ? 5.5 : 3.8, STREAK);
      for (let i = big ? 5 : 2; i > 0; i--) part(x + U.frand(-r, r) * 0.45, y + U.frand(-r, r) * 0.45, U.frand(-25, 25), U.frand(-60, -15), U.frand(0.5, 0.9), 3, color, 0.8, -35);
      if (r >= 55) FX.decal(x, y, Math.min(r * 0.5, big ? 110 : 75), color);
      if (big) FX.flare(x, y, r * 0.8, '#ffffff', 0.16);
    },
    ring(x, y, r, color, dur) {
      if (rings.length >= MAX_RINGS) return;
      rings.push({ x, y, r, life: dur || 0.3, max: dur || 0.3, color, w: 4 });
    },
    shatter(x, y, color) {
      burst(x, y, 7, color, 260, 0.4, 4, STREAK);
      if (rings.length < MAX_RINGS) rings.push({ x, y, r: 70, life: 0.22, max: 0.22, color, w: 3 });
    },
    frostBurst(x, y, r) {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU, sp = r * 2.6;
        part(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4, 5, i % 2 ? '#bdf0ff' : '#ffffff', 2.5, 0, STREAK);
      }
      FX.flare(x, y, r * 0.7, '#bdf0ff', 0.2);
    },
    spikes(x, y, r, color) {
      booms.push({ x, y, r, life: 0.3, max: 0.3, color, spike: true, rot: Math.random() * TAU });
      for (let i = 0; i < 3; i++) part(x + U.frand(-r, r) * 0.5, y, U.frand(-40, 40), U.frand(-200, -80), 0.4, 4, color, 1, 500);
    },
    bolt(x1, y1, x2, y2, color, w) {
      if (bolts.length > 90) return;
      const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
      const segs = Math.max(2, Math.min(9, Math.round(d / 36)));
      const nx = -dy / d, ny = dx / d;
      const pts = [x1, y1];
      for (let i = 1; i < segs; i++) {
        const t = i / segs, off = U.frand(-1, 1) * Math.min(18, d * 0.12);
        pts.push(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
      }
      pts.push(x2, y2);
      // long bolts throw one fork off a joint
      let fork = null;
      if (d > 120) {
        const j = 2 * (1 + ((Math.random() * (segs - 1)) | 0)), fx = pts[j], fy = pts[j + 1];
        const a = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -1 : 1) * U.frand(0.45, 0.95), fl = d * U.frand(0.16, 0.3);
        const ca = Math.cos(a), sa = Math.sin(a), k = U.frand(-8, 8);
        fork = [fx, fy, fx + ca * fl * 0.5 - sa * k, fy + sa * fl * 0.5 + ca * k, fx + ca * fl, fy + sa * fl];
      }
      bolts.push({ pts, fork, life: 0.16, max: 0.16, color, w: w || 2 });
      FX.flare(x2, y2, w > 2 ? 26 : 15, color, 0.12);
    },
    slash(x, y, ang, range, half, color) {
      slashes.push({ x, y, ang, range, half, life: 0.18, max: 0.18, color });
    },
    whirl(x, y, r) {
      slashes.push({ x, y, ang: PS.G.time * 14, range: r, half: 1.5, life: 0.2, max: 0.2, color: '#e8eeff' });
    },
    dashBurst(x, y, ang, color) {
      for (let i = 0; i < 8; i++) {
        const a = ang + Math.PI + U.frand(-0.6, 0.6);
        part(x, y, Math.cos(a) * U.frand(80, 260), Math.sin(a) * U.frand(80, 260), 0.35, 4, color, 3, 0, STREAK);
      }
      FX.flare(x, y, 30, color, 0.14);
    },
    ghost(p) {
      if (ghosts.length && ghosts[ghosts.length - 1].t === PS.G.frame) return;
      if (PS.G.frame % 2) return;
      ghosts.push({ x: p.x, y: p.y, aim: p.aim, face: p.face, life: 0.25, max: 0.25, color: p.cls.color, t: PS.G.frame });
    },
    hurt(p) {
      budget += 20;
      burst(p.x, p.y, 12, '#ff4d6d', 280, 0.45, 5, STREAK);
      if (rings.length < MAX_RINGS) rings.push({ x: p.x, y: p.y, r: 95, life: 0.26, max: 0.26, color: '#ff4d6d', w: 5 });
      FX.flare(p.x, p.y, 58, '#ff4d6d', 0.2);
    },
    levelUp(p) {
      budget += 60;
      rings.push({ x: p.x, y: p.y, r: 220, life: 0.5, max: 0.5, color: '#ffe9a8', w: 6 });
      rings.push({ x: p.x, y: p.y, r: 120, life: 0.35, max: 0.35, color: '#ffffff', w: 3 });
      flares.push({ x: p.x, y: p.y, r: 90, color: '#ffe9a8', life: 0.3, max: 0.3 });
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        part(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20, Math.cos(a) * 60, -U.frand(120, 300), 0.8, 4, i % 2 ? '#ffe9a8' : '#ffffff', 1.5, 0, STREAK);
      }
    },
    shake(n) {
      if (!PS.Save.data.settings.shake) return;
      const G = PS.G;
      G.shake = Math.min(18, Math.max(G.shake, n));
    },
    flash(color, a) {
      const G = PS.G;
      G.flashA = Math.max(G.flashA, a);
      G.flashCol = color;
    },

    /* ------------------------------------------------------------ drawing (world space)
       R is the renderer's side of the bargain: glow(x, y, r, color, alpha, hot) blits a cached soft light (hot: with a white
       heart) and leaves the world transform set, world() restores that transform, and scale, camL, camT, w, h map world units to device pixels. */
    drawGhosts(ctx) {
      for (const g of ghosts) {
        ctx.globalAlpha = (g.life / g.max) * 0.45;
        ctx.fillStyle = g.color;
        ctx.save();
        ctx.translate(g.x, g.y); ctx.rotate(g.aim); ctx.scale(14, 14);
        PS.Models.heroGhost(ctx);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
    /** under everything that walks: soot, then whatever is still hot */
    drawDecals(ctx, view, R) {
      if (!decals.length) return;
      for (let i = 0; i < decals.length; i++) {
        const d = decals[i];
        if (seen(d, d.r, view)) R.glow(d.x, d.y, d.r, SCORCH, Math.min(1, (d.life / d.max) * 2) * 0.5);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < decals.length; i++) {
        const d = decals[i], age = d.max - d.life;
        if (age < 0.8 && seen(d, d.r, view)) R.glow(d.x, d.y, d.r * 0.65, d.color, (1 - age / 0.8) * 0.3);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
    draw(ctx, view, R) {
      /* What sets the cost here is blend mode times bounding box: in a software rasterizer an additive stroke costs nearly
         twice a plain one, and a thin ring costs as much as its whole square. So only soft light is added ('lighter');
         every line (shock rings, bolts, slashes) is drawn bright in the ordinary blend, where it looks the same. */
      // fireballs: white-hot at the heart, holding their size (one cached sprite each) and gone before half-life
      for (let i = 0; i < booms.length; i++) {
        const b = booms[i], t = 1 - b.life / b.max;
        if (b.spike) {
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = b.color;
          for (let j = 0; j < 5; j++) {
            const a = b.rot + (j * TAU) / 5, d = b.r * 0.45, h = b.r * (0.9 - t * 0.3), w = b.r * 0.22;
            const cx = b.x + Math.cos(a) * d * (j ? 1 : 0), cy = b.y + Math.sin(a) * d * 0.5 * (j ? 1 : 0);
            ctx.beginPath();
            ctx.moveTo(cx - w, cy + 4);
            ctx.lineTo(cx + (j % 2 ? 4 : -4), cy - h);
            ctx.lineTo(cx + w, cy + 4);
            ctx.fill();
          }
          continue;
        }
        if (t >= 0.45 || !seen(b, b.r, view)) continue;
        const c = 1 - t / 0.45;
        R.glow(b.x, b.y, b.r * 0.75, b.color, c * (b.big ? 0.85 : 0.7), true);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < flares.length; i++) {
        const f = flares[i], k = f.life / f.max;
        if (seen(f, f.r, view)) R.glow(f.x, f.y, f.r, f.color, k * k);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (R.lap) R.lap('fx:glow');
      // rays: shafts of light thrown out of something that has just come apart
      for (let i = 0; i < rays.length; i++) {
        const r = rays[i], t = 1 - r.life / r.max, len = r.r * (0.3 + 0.7 * U.easeOutCubic(t));
        ctx.globalAlpha = (1 - t) * (1 - t) * 0.5;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        for (let j = 0; j < r.n; j++) {
          const a = r.rot + t * 0.35 + (j / r.n) * TAU + U.hash2(j, 3) * 0.35, l = len * (0.45 + 0.55 * U.hash2(j, 9)), w = 0.018 + 0.035 * U.hash2(j, 5);
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x + Math.cos(a - w) * l, r.y + Math.sin(a - w) * l);
          ctx.lineTo(r.x + Math.cos(a + w) * l, r.y + Math.sin(a + w) * l);
          ctx.closePath();
        }
        ctx.fill();
      }
      // the shock ring racing out of each blast: white at first, then the blast's own colour
      for (let i = 0; i < booms.length; i++) {
        const b = booms[i];
        if (b.spike || !seen(b, b.r, view)) continue;
        // gone a little before the blast is: the last frames are the widest ring and the faintest
        const t = 1 - b.life / b.max, f = 1 - t / 0.85;
        if (f <= 0) continue;
        ctx.globalAlpha = f * 0.85;
        ctx.strokeStyle = t < 0.3 ? '#ffffff' : b.color;
        ctx.lineWidth = (b.big ? 5 : 3) * f + 1;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.4 + 0.6 * U.easeOutCubic(t)), 0, TAU); ctx.stroke();
      }
      // rings; the heavy ones (and any ring on a calm screen) trail a soft echo
      const echo = rings.length < 10;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i], t = 1 - r.life / r.max, rad = r.r * U.easeOutCubic(t);
        if (!seen(r, rad, view)) continue;
        ctx.strokeStyle = r.color;
        if (echo || r.w >= 6) {
          ctx.globalAlpha = (1 - t) * 0.25;
          ctx.lineWidth = r.w * 3.2 * (1 - t) + 2;
          ctx.beginPath(); ctx.arc(r.x, r.y, rad * 0.93, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = (1 - t) * 0.95;
        ctx.lineWidth = r.w * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke();
      }
      // slashes: a crescent that sweeps open and thins to a point at both ends, with a bright cutting edge
      for (let i = 0; i < slashes.length; i++) {
        const s = slashes[i], t = 1 - s.life / s.max;
        const a0 = s.ang - s.half, a1 = a0 + s.half * 2 * Math.min(1, t * 2.2 + 0.35);
        const h = (a1 - a0) / 2, m = a0 + h, R0 = s.range;
        // the inner edge is an arc from a centre set back behind the swing, through the same two end points
        const back = R0 * (0.5 - 0.25 * t), ri = Math.sqrt(R0 * R0 + back * back + 2 * R0 * back * Math.cos(h));
        const cx = s.x - Math.cos(m) * back, cy = s.y - Math.sin(m) * back;
        const e0 = Math.atan2(s.y + Math.sin(a0) * R0 - cy, s.x + Math.cos(a0) * R0 - cx), e1 = Math.atan2(s.y + Math.sin(a1) * R0 - cy, s.x + Math.cos(a1) * R0 - cx);
        ctx.globalAlpha = (1 - t) * 0.42;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, R0, a0, a1);
        ctx.arc(cx, cy, ri, e1, e0, true);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = (1 - t) * 0.95;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5 * (1 - t) + 0.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, R0, a0, a1); ctx.stroke();
      }
      // bolts: a soft sheath and a white core, flickering as they fade
      ctx.lineJoin = 'round';
      for (let i = 0; i < bolts.length; i++) {
        const b = bolts[i], a = (b.life / b.max) * (0.7 + 0.3 * Math.random());
        const pts = b.pts, fk = b.fork;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
        if (fk) { ctx.moveTo(fk[0], fk[1]); ctx.lineTo(fk[2], fk[3]); ctx.lineTo(fk[4], fk[5]); }
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.w * 4;
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = b.w;
        ctx.stroke();
      }
      if (R.lap) R.lap('fx:lines');
      // particles, in device pixels: dots land on whole pixels, streaks taper back along their velocity
      ctx.globalCompositeOperation = 'lighter';
      const sc = R.scale, ox = R.camL, oy = R.camT, w = R.w + 8, h = R.h + 8;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      let last = -1;
      for (let i = 0; i < pN; i++) {
        const x = (pX[i] - ox) * sc, y = (pY[i] - oy) * sc;
        if (x < -8 || x > w || y < -8 || y > h) continue;
        const a = pLife[i] / pMax[i], c = pCol[i];
        ctx.globalAlpha = a;
        if (c !== last) { ctx.fillStyle = palette[c]; last = c; }
        if (pKind[i] === STREAK) {
          const vx = pVX[i], vy = pVY[i], sp = Math.sqrt(vx * vx + vy * vy);
          if (sp > 14) {
            const hw = pSize[i] * sc * (0.2 + 0.3 * a) / sp, len = (Math.min(sp * 0.085, 40) + pSize[i]) * sc / sp;
            ctx.beginPath();
            ctx.moveTo(x - vy * hw, y + vx * hw);
            ctx.lineTo(x + vy * hw, y - vx * hw);
            ctx.lineTo(x - vx * len, y - vy * len);
            ctx.fill();
            continue;
          }
        }
        const z = Math.max(1, (pSize[i] * (0.4 + 0.6 * a) * sc + 0.5) | 0);
        ctx.fillRect((x - z * 0.5) | 0, (y - z * 0.5) | 0, z, z);
      }
      R.world();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    drawNums(ctx) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      let lastFont = '';
      for (let i = 0; i < nums.length; i++) {
        const n = nums[i];
        const t = 1 - n.life / n.max;
        const pop = n.crit ? 1 + Math.max(0, 0.5 - t * 3) : 1;
        const font = `${n.label ? 700 : 800} ${Math.round(n.size * pop)}px ${PS.FONT_NUM}`;
        if (font !== lastFont) { ctx.font = font; lastFont = font; }
        ctx.globalAlpha = Math.min(1, n.life / (n.max * 0.4));
        ctx.lineWidth = n.crit ? 4 : 3;
        ctx.strokeStyle = 'rgba(12,8,28,0.85)';
        ctx.strokeText(n.text, n.x, n.y);
        ctx.fillStyle = n.color;
        ctx.fillText(n.text, n.x, n.y);
      }
      ctx.globalAlpha = 1;
    },
  };

  // condensed numerals: big numbers stay narrow enough to read in a crowd
  PS.FONT_NUM = '"Big Shoulders Display", "Arial Narrow", system-ui, sans-serif';
  PS.FX = FX;
})();
