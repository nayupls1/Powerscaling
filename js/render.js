/* POWERSCALING — canvas renderer: ground, props, entities, projectiles, telegraphs, screen overlays */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, TAU = U.TAU, M = PS.Models;

  const VIEW_H = 720;     // world units visible vertically
  const MIN_VIEW_W = 700; // never show less than this horizontally (portrait phones)

  const BIOMES = [
    { name: 'Ashen Threshold', base: '#1c1838', hi: '#2b2554', lo: '#141029', accent: '#8a7bff' },
    { name: 'Cinder Wastes',   base: '#2a1722', hi: '#42222c', lo: '#1c0e16', accent: '#ff7a3d' },
    { name: 'Frozen Deep',     base: '#122430', hi: '#1b3a4b', lo: '#0b1820', accent: '#6fd8ff' },
    { name: 'The Abyss',       base: '#211033', hi: '#3a1b52', lo: '#150a22', accent: '#c06bff' },
    { name: 'Beyond the Rift', base: '#2b2413', hi: '#45391a', lo: '#1b160a', accent: '#ffcf5c' },
  ];

  let canvas, ctx, W = 0, H = 0, dpr = 1, scale = 1;
  let camL = 0, camT = 0; // world coords of the screen's top-left
  const view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const tiles = [], SPR = {}, glows = {};
  const RES_STEPS = [1, 0.85, 0.7, 0.6, 0.5];
  const auto = { ema: 16, slow: 0, fast: 0, cool: 0, ceil: 1, raisedAt: -1e9 };

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function glow(color) {
    let g = glows[color];
    if (g) return g;
    g = mk(64, 64);
    const c = g.getContext('2d');
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, color);
    gr.addColorStop(0.35, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.9;
    c.fillStyle = gr;
    c.fillRect(0, 0, 64, 64);
    glows[color] = g;
    return g;
  }
  /* Soft glows are the biggest fill cost late in a run: dozens of zone, aura and projectile glows, each hundreds of pixels
     wide. Magnifying the 64px gradient that far takes the slow filtered path, so big glows use a copy cached at their
     on-screen size (radius steps of ~2.5%) and are blitted 1:1 on whole device pixels, about three times cheaper. */
  const sized = new Map();
  function drawGlow(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    const px = r * scale;
    if (px < 40 || px > 480) { ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2); return; }
    const q = Math.round(Math.log(px) * 40), key = color + q;
    let g = sized.get(key);
    if (!g) {
      const R = Math.round(Math.exp(q / 40));
      g = mk(R * 2, R * 2);
      g.getContext('2d').drawImage(glow(color), 0, 0, R * 2, R * 2);
      if (sized.size > 200) sized.delete(sized.keys().next().value); // oldest first; the working set is small
      sized.set(key, g);
    }
    const h = g.width / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(g, Math.round((x - camL) * scale - h), Math.round((y - camT) * scale - h));
    worldTf();
  }
  /** glow in raw canvas pixels (screen space), for the menu backdrop */
  function drawGlowPx(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2);
  }

  /* ------------------------------------------------------------------ ground */
  function makeTile(b, seed) {
    const S = 512, c = mk(S, S), g = c.getContext('2d');
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    g.fillStyle = b.base;
    g.fillRect(0, 0, S, S);
    // flagstones, offset rows, each slab a slightly different tone
    const sz = 64;
    for (let row = 0; row < S / sz; row++) {
      for (let col = 0; col < S / sz; col++) {
        const x = col * sz + (row % 2 ? sz / 2 : 0), y = row * sz;
        const t = rnd();
        g.fillStyle = t < 0.5 ? b.hi : b.lo;
        g.globalAlpha = 0.10 + rnd() * 0.22;
        for (const ox of [0, -S]) {
          g.beginPath();
          g.roundRect(x + ox + 2, y + 2, sz - 4, sz - 4, 7);
          g.fill();
        }
        if (rnd() < 0.09) {
          // faint rune mark
          g.globalAlpha = 0.16;
          g.strokeStyle = b.accent;
          g.lineWidth = 2;
          const cx = (x + sz / 2) % S, cy = y + sz / 2;
          g.beginPath();
          g.arc(cx, cy, 12, 0, TAU);
          g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy);
          g.moveTo(cx, cy - 8); g.lineTo(cx, cy + 8);
          g.stroke();
        }
      }
    }
    // speckle
    for (let i = 0; i < 900; i++) {
      g.globalAlpha = 0.05 + rnd() * 0.12;
      g.fillStyle = rnd() < 0.5 ? b.hi : '#000';
      const r = 1 + rnd() * 2.5;
      g.fillRect(rnd() * S, rnd() * S, r, r);
    }
    // cracks
    g.strokeStyle = b.lo;
    g.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      g.globalAlpha = 0.5;
      let x = 40 + rnd() * (S - 80), y = 40 + rnd() * (S - 80);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 34; y += (rnd() - 0.5) * 34; g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
    return c;
  }
  /** ground tile pre-scaled to device pixels so the full-screen fill is a plain 1:1 blit */
  let tilePx = 512;
  function tilePattern(i) {
    const t = tiles[i];
    if (t && t.px === tilePx) return t.pat;
    const base = t ? t.base : makeTile(BIOMES[i], 1337 + i * 77);
    const c = mk(tilePx, tilePx);
    c.getContext('2d').drawImage(base, 0, 0, tilePx, tilePx);
    tiles[i] = { base, px: tilePx, pat: ctx.createPattern(c, 'repeat') };
    return tiles[i].pat;
  }
  function drawGround(G) {
    const t = G.time / 180;
    const bi = Math.min(BIOMES.length - 1, Math.floor(t));
    const into = (t - Math.floor(t)) * 180; // seconds into this biome
    const k = tilePx / 512;
    const offX = -Math.round((((camL * k) % tilePx) + tilePx) % tilePx), offY = -Math.round((((camT * k) % tilePx) + tilePx) % tilePx);
    const fill = (idx, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.setTransform(1, 0, 0, 1, offX, offY);
      ctx.fillStyle = tilePattern(idx);
      ctx.fillRect(0, 0, W + tilePx, H + tilePx);
    };
    if (bi > 0 && into < 5 && t < BIOMES.length) { fill(bi - 1, 1); fill(bi, into / 5); }
    else fill(bi, 1);
    ctx.globalAlpha = 1;
    G.biome = bi;

    // scattered decor, deterministic per world cell
    worldTf();
    const acc = BIOMES[bi].accent;
    const cs = 230;
    const cx0 = Math.floor(view.x0 / cs) - 1, cx1 = Math.floor(view.x1 / cs) + 1;
    const cy0 = Math.floor(view.y0 / cs) - 1, cy1 = Math.floor(view.y1 / cs) + 1;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const h = U.hash2(cx, cy);
        if (h > 0.42) continue;
        const x = cx * cs + U.hash2(cx + 91, cy) * cs, y = cy * cs + U.hash2(cx, cy + 57) * cs;
        const kind = h < 0.12 ? 0 : h < 0.26 ? 1 : h < 0.34 ? 2 : 3;
        const sz = 0.7 + U.hash2(cx + 7, cy + 13) * 0.8;
        drawDecor(kind, x, y, sz, acc, cx * 31 + cy);
      }
    }
  }
  function drawDecor(kind, x, y, sz, acc, seed) {
    if (kind === 0) {
      // crystal cluster
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(x, y, 46 * sz, acc, 0.16);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * 11 * sz, hgt = (22 + ((seed + i * 5) % 3) * 8) * sz, w = 7 * sz;
        ctx.fillStyle = i === 1 ? acc : 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(x + ox - w, y + 6);
        ctx.lineTo(x + ox + (i - 1) * 4, y - hgt);
        ctx.lineTo(x + ox + w, y + 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(x, y + 7, 22 * sz, 6 * sz, 0, 0, TAU); ctx.fill();
    } else if (kind === 1) {
      // rubble
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y + 5, 24 * sz, 9 * sz, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (let i = 0; i < 4; i++) {
        const a = seed + i * 1.7;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * 12 * sz, y + Math.sin(a) * 6 * sz, (6 + (i % 3) * 3) * sz, (5 + (i % 2) * 2) * sz, a, 0, TAU);
        ctx.fill();
      }
    } else if (kind === 2) {
      // bones
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#e8e2d0';
      ctx.lineWidth = 3 * sz;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = seed * 0.7 + i * 2.1;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 14 * sz, y + Math.sin(a) * 9 * sz);
        ctx.lineTo(x - Math.cos(a) * 10 * sz, y - Math.sin(a) * 7 * sz);
        ctx.stroke();
      }
    } else {
      // rune ring
      ctx.globalAlpha = 0.13;
      ctx.strokeStyle = acc;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 34 * sz, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 24 * sz, 0.4, TAU - 0.9); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ transforms */
  function worldTf() {
    ctx.setTransform(scale, 0, 0, scale, -camL * scale, -camT * scale);
  }
  function spriteTf(x, y, rot, sx, sy) {
    const c = Math.cos(rot), s = Math.sin(rot);
    ctx.setTransform(c * sx * scale, s * sx * scale, -s * sy * scale, c * sy * scale, (x - camL) * scale, (y - camT) * scale);
  }
  function visible(x, y, r) {
    return x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;
  }

  /* ------------------------------------------------------------------ horde sprites
     The art lives in js/models.js. Each horde type is cached as a strip of walk-cycle frames, supersampled for the screen
     it will be drawn on; bosses, heroes and minions are drawn live. */
  let sprK = 0;
  /** n frames of a model of radius r world units; draw(g, f) paints frame f in unit space */
  function buildFrames(n, r, draw) {
    const K = sprK;
    const size = Math.ceil(r * 5.2), px = size * K, c = px / 2;
    const raw = [];
    // the art canvas is generous so nothing clips; crop every frame to the box that holds the whole cycle's opaque pixels,
    // so each enemy blit (hundreds a frame late in a run) only touches pixels that can show something
    let x0 = px, y0 = px, x1 = 0, y1 = 0, readable = true;
    for (let f = 0; f < n; f++) {
      const cv = mk(px, px), g = cv.getContext('2d');
      g.setTransform(K * r, 0, 0, K * r, c, c);
      draw(g, f);
      raw.push(cv);
      try {
        const d = g.getImageData(0, 0, px, px).data;
        for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
          if (d[(y * px + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      } catch (e) { readable = false; /* tainted or unsupported: keep the full canvas */ }
    }
    if (!readable || x1 < x0) { x0 = 0; y0 = 0; x1 = px - 1; y1 = px - 1; }
    x0 = Math.max(0, x0 - K); y0 = Math.max(0, y0 - K); x1 = Math.min(px - 1, x1 + K); y1 = Math.min(px - 1, y1 + K);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const frames = raw.map((cv) => {
      const img = mk(w, h);
      img.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, w, h);
      return { img, white: null, ice: null };
    });
    // x, y, w, h: where a frame sits around the model's origin, in world units
    return { frames, x: (x0 - c) / K, y: (y0 - c) / K, w: w / K, h: h / K };
  }
  /** a flat-colour copy of a frame, made the first time it is needed */
  function tinted(fr, which) {
    if (fr[which]) return fr[which];
    const c = mk(fr.img.width, fr.img.height), cg = c.getContext('2d');
    cg.drawImage(fr.img, 0, 0);
    cg.globalCompositeOperation = 'source-atop';
    cg.globalAlpha = which === 'white' ? 0.92 : 0.6;
    cg.fillStyle = which === 'white' ? '#ffffff' : '#9fe6ff';
    cg.fillRect(0, 0, c.width, c.height);
    return (fr[which] = c);
  }
  const SWING = 5; // poses across a minion's weapon swing
  function buildSprites() {
    const defs = PS.Enemies.DEFS, N = M.FRAMES;
    for (const id in defs) {
      const d = defs[id], lw = M.ink(d.r);
      SPR[id] = buildFrames(N, d.r, (g, f) => M.enemy(g, id, f / N, d.color, lw));
      SPR[id].rate = M.RATE[id] || 1.5;
    }
    // the Reaper's dead: a walk cycle, then the swing poses
    for (const m of [['skeleton', 11], ['knight', 15]]) {
      SPR['m_' + m[0]] = buildFrames(N + SWING, m[1], (g, f) => M.minion(g, m[0], f < N ? f / N : 0, f < N ? 0 : 1 - (f - N) / SWING, 1.5 / m[1]));
    }
    SPR.m_familiar = buildFrames(N, 8, (g, f) => M.minion(g, 'familiar', f / N, 0, 1.4 / 8));
  }

  /* The hero and the boss are drawn fresh, but into a scratch canvas of their own that is then blitted. Their shading uses
     gradients, and a single gradient fill on the main canvas knocks Chromium's software rasterizer off its fast path for
     the ground pattern for the rest of the session (about 2 ms a frame). It also lets a whole model fade as one piece. */
  const scratch = {};
  /** who: which scratch canvas; ext: the model's reach in its own units; sx, sy: world units per model unit;
      draw(g) paints it facing +x, or pass null to blit what is already there */
  function drawLive(who, x, y, rot, sx, sy, ext, alpha, draw) {
    const R = Math.ceil(ext * Math.max(sx, sy) * scale) + 2, n = R * 2;
    const sc = scratch[who] || (scratch[who] = { cv: mk(n, n), g: null });
    if (sc.cv.width < n) { sc.cv.width = sc.cv.height = n; }
    const g = sc.g || (sc.g = sc.cv.getContext('2d'));
    // keep the model's sub-pixel position inside the scratch so the blit can land on whole device pixels
    const px = (x - camL) * scale, py = (y - camT) * scale, ix = Math.floor(px), iy = Math.floor(py);
    if (draw) {
      const c = Math.cos(rot), sn = Math.sin(rot);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, n, n);
      g.setTransform(c * sx * scale, sn * sx * scale, -sn * sy * scale, c * sy * scale, R + px - ix, R + py - iy);
      draw(g);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sc.cv, 0, 0, n, n, ix - R, iy - R, n, n);
    ctx.globalAlpha = 1;
    worldTf();
  }

  /* ------------------------------------------------------------------ layers */
  function drawZones(G) {
    const t = G.time;
    let riftGlows = 8;
    for (const z of G.zones) {
      if (!visible(z.x, z.y, z.r + 20)) continue;
      const fade = Math.min(1, z.life / 0.4, z.age / 0.2);
      const k = z.kind;
      if (k === 'poison' || k === 'pool') {
        ctx.globalAlpha = 0.13 * fade;
        ctx.fillStyle = '#5fb82e';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.5 * fade;
        ctx.strokeStyle = '#b8f078'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.94 + 0.04 * Math.sin(t * 5 + z.x)), 0, TAU); ctx.stroke();
        ctx.fillStyle = '#c8ff8a';
        for (let i = 0; i < 3; i++) {
          const a = t * 0.9 + i * 2.1 + z.y, d = z.r * (0.25 + 0.2 * i);
          ctx.beginPath(); ctx.arc(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 3 + Math.sin(t * 4 + i) * 1.5, 0, TAU); ctx.fill();
        }
      } else if (k === 'fire') {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(z.x, z.y, z.r * 1.15, '#ff6a2a', 0.3 * fade * (0.8 + 0.2 * Math.sin(t * 13 + z.x)));
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.5 * fade;
        ctx.strokeStyle = '#ff9a4d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
      } else if (k === 'blizzard') {
        ctx.globalAlpha = 0.09 * fade;
        ctx.fillStyle = '#9fe6ff';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.7 * fade;
        ctx.strokeStyle = '#e8f9ff'; ctx.lineWidth = 2;
        ctx.setLineDash([10, 12]); ctx.lineDashOffset = -t * 40;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      } else if (k === 'rift' || k === 'implode') {
        ctx.globalAlpha = 0.4 * fade;
        ctx.fillStyle = '#12061f';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r * 0.45, 0, TAU); ctx.fill();
        // a rift glow covers the whole zone and implosions stack by the dozen: only a few long-lived rifts get one
        ctx.globalCompositeOperation = 'lighter';
        if (k === 'rift' && riftGlows-- > 0) drawGlow(z.x, z.y, z.r, '#7a2fd6', 0.22 * fade);
        ctx.strokeStyle = '#dba6ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.8 * fade;
        for (let i = 0; i < 3; i++) {
          const a = -t * 4 + (i * TAU) / 3, rr = z.r * (0.35 + 0.22 * i);
          ctx.beginPath(); ctx.arc(z.x, z.y, rr, a, a + 1.6); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      } else if (k === 'arrows') {
        ctx.globalAlpha = 0.07 * fade;
        ctx.fillStyle = '#f1e7cf';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.7 * fade;
        ctx.strokeStyle = '#f1e7cf'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 9; i++) {
          const ph = (t * 3.5 + i * 0.37) % 1;
          const a = i * 2.4 + Math.floor(t * 3.5 + i * 0.37) * 1.3, d = z.r * (0.15 + 0.8 * U.hash2(i, Math.floor(t * 3.5 + i * 0.37)));
          const x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d;
          ctx.globalAlpha = (1 - ph) * fade;
          ctx.beginPath(); ctx.moveTo(x + 14 * (1 - ph), y - 60 * (1 - ph)); ctx.lineTo(x + 5 * (1 - ph), y - 22 * (1 - ph)); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }
  function drawBallZones(G) {
    ctx.globalCompositeOperation = 'lighter';
    for (const z of G.zones) {
      if (z.kind !== 'ball' || !visible(z.x, z.y, z.r)) continue;
      const fade = Math.min(1, z.life / 0.4);
      drawGlow(z.x, z.y, 46, '#ffe14d', 0.7 * fade);
      drawGlow(z.x, z.y, 20, '#ffffff', fade);
      ctx.globalAlpha = 0.25 * fade;
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHazards(G) {
    for (const h of G.hazards) {
      if (h.kind === 'circle') {
        const t = Math.min(1, h.t / h.delay);
        // a clear rim and a filling core show the timing without hiding what is underneath
        ctx.globalAlpha = 0.1 + 0.06 * t;
        ctx.fillStyle = h.color;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.2 + 0.25 * t;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r * t, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = t > 0.8 ? '#ffffff' : h.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
      } else if (h.kind === 'beam') {
        const live = h.t >= h.delay;
        const x2 = h.x + Math.cos(h.ang) * h.len, y2 = h.y + Math.sin(h.ang) * h.len;
        ctx.lineCap = 'round';
        if (!live) {
          const t = h.t / h.delay;
          ctx.globalAlpha = 0.18 + 0.2 * t;
          ctx.strokeStyle = h.color; ctx.lineWidth = h.w;
          ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = t > 0.8 ? '#ffffff' : h.color; ctx.lineWidth = 2 + 3 * t;
          ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(x2, y2); ctx.stroke();
        } else if (!h.harmless) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = h.color; ctx.lineWidth = h.w * (1.1 + 0.15 * Math.sin(G.time * 40));
          ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = h.w * 0.4;
          ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (h.kind === 'ring') {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = h.color; ctx.lineWidth = h.thick;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.rad, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.rad, 0, TAU); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // charger wind-up lines
    ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const e of G.enemies) {
      if (e.def.ai === 'charger' && e.state === 1 && !e.dead) {
        ctx.globalAlpha = 0.25 + 0.5 * (1 - e.st / 0.55);
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.dx * 200, e.y + e.dy * 200); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawProps(G) {
    const p = G.player, t = G.time;
    for (const pr of G.props) {
      if (pr.dead || !visible(pr.x, pr.y, 90)) continue;
      if (pr.kind === 'chest') {
        const cost = PS.Director.chestPrice(), can = p.gold >= cost;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(pr.x, pr.y, 56, can ? '#ffcf5c' : '#7a6a9a', 0.35 + 0.1 * Math.sin(t * 3 + pr.bob));
        ctx.globalCompositeOperation = 'source-over';
        drawChest(pr.x, pr.y, 1, false);
        ctx.font = `800 15px ${PS.FONT_NUM}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(12,8,28,0.9)';
        ctx.strokeText(cost + ' gold', pr.x, pr.y - 34);
        ctx.fillStyle = can ? '#ffd35c' : '#ff8a8a';
        ctx.fillText(cost + ' gold', pr.x, pr.y - 34);
      } else if (pr.kind === 'shrine') {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2;
        ctx.setLineDash([8, 10]); ctx.lineDashOffset = t * 20;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (pr.charge > 0) {
          ctx.globalAlpha = 0.9; ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, -Math.PI / 2, -Math.PI / 2 + pr.charge * TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(pr.x, pr.y - 14, 60, '#ffe9a8', 0.4 + 0.15 * Math.sin(t * 2.5));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 14, 22, 8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8b83a8';
        ctx.beginPath(); ctx.moveTo(pr.x - 15, pr.y + 14); ctx.lineTo(pr.x - 9, pr.y - 30); ctx.lineTo(pr.x, pr.y - 42); ctx.lineTo(pr.x + 9, pr.y - 30); ctx.lineTo(pr.x + 15, pr.y + 14); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath(); ctx.moveTo(pr.x, pr.y - 26); ctx.lineTo(pr.x + 6, pr.y - 14); ctx.lineTo(pr.x, pr.y - 2); ctx.lineTo(pr.x - 6, pr.y - 14); ctx.closePath(); ctx.fill();
      }
    }
  }
  function drawChest(x, y, s, boss) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 13 * s, 22 * s, 7 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = boss ? '#7a2fd6' : '#8a5a2b';
    ctx.beginPath(); ctx.roundRect(x - 18 * s, y - 10 * s, 36 * s, 24 * s, 4 * s); ctx.fill();
    ctx.fillStyle = boss ? '#a35cff' : '#a8733a';
    ctx.beginPath(); ctx.roundRect(x - 18 * s, y - 16 * s, 36 * s, 12 * s, [8 * s, 8 * s, 0, 0]); ctx.fill();
    ctx.fillStyle = '#ffcf5c';
    ctx.fillRect(x - 18 * s, y - 5 * s, 36 * s, 3 * s);
    ctx.fillRect(x - 4 * s, y - 8 * s, 8 * s, 10 * s);
    ctx.strokeStyle = 'rgba(10,6,22,0.75)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - 18 * s, y - 16 * s, 36 * s, 30 * s, 5 * s); ctx.stroke();
  }

  const GEM_COL = ['#5db4ff', '#6fe08a', '#c77dff', '#ffb43d'];
  function drawPickups(G) {
    const t = G.time;
    for (const k of G.pickups) {
      if (!visible(k.x, k.y, 30)) continue;
      const bob = Math.sin(t * 4 + k.x * 0.05) * 2;
      if (k.kind === 'xp') {
        const tier = k.val < 3 ? 0 : k.val < 12 ? 1 : k.val < 60 ? 2 : 3;
        const s = 5 + tier * 1.6;
        ctx.fillStyle = GEM_COL[tier];
        ctx.beginPath(); ctx.moveTo(k.x, k.y - s + bob); ctx.lineTo(k.x + s * 0.72, k.y + bob); ctx.lineTo(k.x, k.y + s + bob); ctx.lineTo(k.x - s * 0.72, k.y + bob); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath(); ctx.moveTo(k.x, k.y - s + bob); ctx.lineTo(k.x + s * 0.3, k.y - s * 0.1 + bob); ctx.lineTo(k.x - s * 0.3, k.y - s * 0.1 + bob); ctx.closePath(); ctx.fill();
      } else if (k.kind === 'gold') {
        ctx.fillStyle = '#ffcf5c';
        ctx.beginPath(); ctx.arc(k.x, k.y + bob, 6, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#a8731a'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff3c4'; ctx.fillRect(k.x - 1, k.y - 3 + bob, 2, 6);
      } else if (k.kind === 'chest' || k.kind === 'bosschest') {
        const boss = k.kind === 'bosschest';
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(k.x, k.y, boss ? 90 : 60, boss ? '#c06bff' : '#ffcf5c', 0.5 + 0.15 * Math.sin(t * 5));
        ctx.globalCompositeOperation = 'source-over';
        drawChest(k.x, k.y + bob, boss ? 1.25 : 1, boss);
      } else {
        const col = k.kind === 'heal' ? '#ff5a7a' : k.kind === 'magnet' ? '#8ad1ff' : '#ffffff';
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(k.x, k.y, 30, col, 0.5);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(12,8,28,0.8)';
        ctx.beginPath(); ctx.arc(k.x, k.y + bob, 12, 0, TAU); ctx.fill();
        PS.Icons.draw(ctx, k.kind === 'heal' ? 'heart' : k.kind === 'magnet' ? 'magnet' : 'bomb', k.x, k.y + bob, 17, col);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawEnemies(G) {
    const list = G.enemies, t = G.time;
    // shadows first
    worldTf();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!visible(e.x, e.y, e.r * 2)) continue;
      ctx.moveTo(e.x + e.r, e.y + e.r * 0.55);
      ctx.ellipse(e.x, e.y + e.r * 0.55, e.r * 0.95, e.r * 0.45, 0, 0, TAU);
    }
    ctx.fill();
    // elite auras
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.big && visible(e.x, e.y, e.r * 3)) drawGlow(e.x, e.y, e.r * (e.boss ? 2.4 : 2.6), e.boss ? e.def.color : '#ffcf5c', 0.35 + 0.1 * Math.sin(t * 5));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const N = M.FRAMES;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!visible(e.x, e.y, e.r * 2.6)) continue;
      if (e.boss) { drawBoss(e, t, G.frame); continue; }
      const spr = SPR[e.def.sprite];
      const sc = e.r / e.def.r;
      const frozen = e.freezeT > 0;
      const wob = frozen ? 0 : Math.sin(t * 9 + e.wob) * 0.035;
      // each enemy runs its walk cycle from its own offset; frozen ones hold a pose
      const fr = spr.frames[frozen ? e.id % N : ((t * spr.rate + e.wob) * N | 0) % N];
      // small enemies pop white when hit; elites only tint so their art stays readable under sustained fire
      const flash = e.flash > 0;
      const img = flash && !e.big ? tinted(fr, 'white') : frozen ? tinted(fr, 'ice') : fr.img;
      ctx.globalAlpha = e.spawnT > 0 ? Math.max(0.15, 1 - e.spawnT / 0.35) : 1;
      spriteTf(e.x, e.y, e.ang, sc * (1 + wob), sc * (1 - wob));
      ctx.drawImage(img, spr.x, spr.y, spr.w, spr.h);
      if (flash && e.big) { ctx.globalAlpha = 0.4; ctx.drawImage(tinted(fr, 'white'), spr.x, spr.y, spr.w, spr.h); }
    }
    ctx.globalAlpha = 1;
    worldTf();
    // status pips and elite health bars
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!visible(e.x, e.y, e.r * 2)) continue;
      if (e.burnT > 0 && Math.random() < 0.12) PS.FX.spark(e.x + U.rand(-e.r, e.r), e.y - e.r * 0.5, '#ff9a4d');
      if (e.poisStacks > 0 && Math.random() < 0.06) PS.FX.spark(e.x + U.rand(-e.r, e.r), e.y - e.r * 0.5, '#8fe04a');
      if (e.shockT > 0 && Math.random() < 0.05) PS.FX.spark(e.x + U.rand(-e.r, e.r), e.y + U.rand(-e.r, e.r), '#ffe14d');
      if (e.chillT > 0 && e.freezeT <= 0) {
        ctx.globalAlpha = 0.35; ctx.fillStyle = '#9fe6ff';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.9, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      if (e.markT > 0) {
        ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, t * 3, t * 3 + 4.2); ctx.stroke();
      }
      if (e.elite && e.hp < e.maxHp) {
        const w = e.r * 2.2, f = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(12,8,28,0.8)'; ctx.fillRect(e.x - w / 2 - 1, e.y - e.r - 13, w + 2, 6);
        ctx.fillStyle = '#ffcf5c'; ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w * f, 4);
      }
    }
  }

  /** bosses are drawn live: one on screen at a time, and it deserves smooth motion at full resolution.
      The art is repainted every other frame (30 poses a second is plenty) and blitted on the frames between. */
  const bossPaint = { id: 0, frame: -9, scale: 0 };
  function drawBoss(e, t, frame) {
    const def = e.def, breathe = Math.sin(t * 2.6) * 0.015;
    let sc = e.r, alpha = 1;
    if (e.spawnT > 0) {
      // stepping out of the rift: a silhouette in its own colour that resolves into the creature
      const q = Math.min(1, e.spawnT / 1.1);
      sc *= 1 - q * 0.22;
      alpha = 1 - q * 0.45;
      M.tint(def.color, q);
    } else if (e.flash > 0) M.tint('#ffffff', 0.4);
    const ph = t * (M.RATE[def.sprite] || 1), lw = M.ink(e.r);
    const fresh = bossPaint.id !== e.id || bossPaint.scale !== scale || frame - bossPaint.frame >= 2 || frame < bossPaint.frame;
    if (fresh) { bossPaint.id = e.id; bossPaint.frame = frame; bossPaint.scale = scale; }
    drawLive('boss', e.x, e.y, e.ang, sc * (1 + breathe), sc * (1 - breathe), 2.25, alpha, fresh ? (g) => M.enemy(g, def.sprite, ph, def.color, lw, e.bs) : null);
    M.tint(null, 0);
  }

  function drawMinions(G) {
    const N = M.FRAMES;
    for (const m of G.minions) {
      if (!visible(m.x, m.y, 40)) continue;
      const fade = Math.min(1, m.life / 1.5);
      const spr = SPR['m_' + m.kind];
      let my = m.y, fr;
      if (m.kind === 'familiar') {
        my += Math.sin(m.bob) * 3;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(m.x, my, 26, '#c06bff', 0.6);
        ctx.globalCompositeOperation = 'source-over';
        fr = spr.frames[(m.bob * 0.3 * N | 0) % N];
      } else {
        const r = m.r;
        ctx.globalAlpha = 0.28 * fade; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(m.x, m.y + r * 0.6, r, r * 0.45, 0, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(m.x, m.y, r * 2.4, '#a35cff', 0.3 * fade);
        ctx.globalCompositeOperation = 'source-over';
        // mid-swing it holds a swing pose, otherwise it walks
        fr = spr.frames[m.swing > 0.04 ? N + Math.min(SWING - 1, (1 - m.swing) * SWING | 0) : (m.bob * 0.32 * N | 0) % N];
      }
      ctx.globalAlpha = fade;
      spriteTf(m.x, my, m.ang, 1, 1);
      ctx.drawImage(fr.img, spr.x, spr.y, spr.w, spr.h);
      worldTf();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(G) {
    const p = G.player, cls = p.cls, t = G.time;
    const x = p.x, y = p.y, r = p.r;
    // inferno aura
    if (p.auraR > 0) {
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(x, y, p.auraR * 1.15, '#ff5a1f', 0.14 + 0.04 * Math.sin(t * 9));
      ctx.globalAlpha = 0.6; ctx.strokeStyle = '#ff9a4d'; ctx.lineWidth = 2.5;
      ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 60;
      ctx.beginPath(); ctx.arc(x, y, p.auraR, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'source-over';
    }
    PS.FX.drawGhosts(ctx);
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.7, r * 1.05, r * 0.45, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(x, y, 52, cls.color, 0.4);
    ctx.globalCompositeOperation = 'source-over';
    // a steady ground ring keeps the hero findable in a crowd
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(10,6,22,0.7)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.55, r * 1.55, r * 0.95, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.55, r * 1.55, r * 0.95, 0, 0, TAU); ctx.stroke();
    // blink while invulnerable after a hit, and flash white on the hit itself
    const blink = p.hurtFlash > 0 || (p.inv > 0 && p.dashT <= 0 && Math.floor(t * 18) % 2 === 0);
    if (p.hurtFlash > 0) M.tint('#ffffff', 0.85);
    const bobY = p.moving ? Math.sin(p.walk * 2) * 0.8 : 0;
    // the whole hero turns with the aim, and spins outright during a whirlwind
    const rot = p.aim + (p.whirlT > 0 ? t * 22 : 0);
    let lights = null;
    drawLive('hero', x, y + bobY, rot, r, r, 3.9, blink ? 0.55 : 1, (g) => { lights = M.hero(g, p, t, 1.6 / r); });
    M.tint(null, 0);
    // what the hero carries that glows (a staff's fire) is added on top, in world space
    if (lights) {
      const c = Math.cos(rot), sn = Math.sin(rot);
      ctx.globalCompositeOperation = 'lighter';
      for (const l of lights) drawGlow(x + (c * l.x - sn * l.y) * r, y + bobY + (sn * l.x + c * l.y) * r, l.r * r, l.col, l.a);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    // Ward: an expanding dome while it is up, and a faint arc when it is ready again
    if (p.wardT > 0) {
      const t = 1 - p.wardT / 0.35, rr = p.wardR * (0.45 + 0.55 * U.easeOutCubic(t));
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(x, y, rr * 1.15, '#5fb8ff', 0.35 * (1 - t));
      ctx.globalAlpha = 0.95 * (1 - t * 0.6);
      ctx.strokeStyle = '#dff3ff'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#5fb8ff'; ctx.lineWidth = 2;
      ctx.setLineDash([16, 12]); ctx.lineDashOffset = -G.time * 300;
      ctx.beginPath(); ctx.arc(x, y, rr * 0.82, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else if (p.wardCd <= 0) {
      ctx.globalAlpha = 0.5; ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 11, p.aim - 0.7, p.aim + 0.7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // barrier
    if (p.barrier) {
      ctx.globalAlpha = 0.7; ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r + 9 + Math.sin(t * 5), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // frenzy / buff ring
    if (p.frenzy > 0) {
      ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + (p.frenzy / p.frenzyMax) * TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // dash pips under the feet
    const maxC = p.stats.dashCharges;
    for (let i = 0; i < maxC; i++) {
      ctx.fillStyle = i < p.dashCharges ? '#ffffff' : 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.arc(x + (i - (maxC - 1) / 2) * 9, y + r + 12, 2.6, 0, TAU); ctx.fill();
    }
  }
  function drawOrbits(G) {
    for (const o of G.orbits) {
      if (o.kind === 'iceorb') {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(o.x, o.y, o.r * 2.4, '#6fd8ff', 0.7);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e8f9ff'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.7, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#6fd8ff'; ctx.lineWidth = 2; ctx.stroke();
      } else {
        spriteTf(o.x, o.y, o.a, 1, 1);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e8eeff';
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (i * TAU) / 4;
          ctx.lineTo(Math.cos(a) * o.r * 1.25, Math.sin(a) * o.r * 1.25);
          ctx.lineTo(Math.cos(a + 0.6) * o.r * 0.42, Math.sin(a + 0.6) * o.r * 0.42);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(10,6,22,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
        worldTf();
      }
    }
  }

  function drawProjs(G) {
    const list = G.projs;
    // glows in one additive pass
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!visible(p.x, p.y, 40)) continue;
      const k = p.kind;
      if (k === 'fireball') { drawGlow(p.x, p.y, 26 * p.size, '#ff5a1f', 0.85); drawGlow(p.x, p.y, 12 * p.size, '#ffe9a8', 1); }
      else if (k === 'reflect') { drawGlow(p.x, p.y, 22, '#8fd0ff', 0.95); drawGlow(p.x, p.y, 9, '#ffffff', 1); }
      else if (k === 'bolt' || k === 'missile') { drawGlow(p.x, p.y, 16, p.color, 0.9); }
      else if (k === 'spore') { drawGlow(p.x, p.y, 15, '#8fe04a', 0.8); }
      else if (k === 'shard') { drawGlow(p.x, p.y, 15, '#6fd8ff', 0.55); }
      else if (k === 'scythe') { drawGlow(p.x, p.y, 36 * p.size, p.color, 0.4); }
      else if (k === 'wave') { drawGlow(p.x, p.y, 40, '#bcd0ff', 0.4); }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!visible(p.x, p.y, 40)) continue;
      const k = p.kind;
      if (k === 'fireball' || k === 'spore' || k === 'reflect') continue;
      spriteTf(p.x, p.y, p.rot, p.size, p.size);
      if (k === 'arrow') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(6, 0); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(3, -4); ctx.lineTo(3, 4); ctx.closePath(); ctx.fill();
      } else if (k === 'shard') {
        ctx.fillStyle = '#e8f9ff';
        ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-3, -4.5); ctx.lineTo(-11, 0); ctx.lineTo(-3, 4.5); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#6fd8ff'; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (k === 'bolt') {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(7, 0); ctx.stroke();
      } else if (k === 'missile') {
        ctx.fillStyle = '#f3e6ff';
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -4); ctx.lineTo(-3, 0); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
      } else if (k === 'glaive') {
        ctx.fillStyle = '#e8eeff';
        ctx.beginPath(); ctx.arc(0, 0, 16, -2.3, 2.3); ctx.arc(7, 0, 12.5, 2.0, -2.0, true); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(10,6,22,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (k === 'blade') {
        ctx.fillStyle = '#e8eeff';
        ctx.beginPath();
        for (let j = 0; j < 4; j++) {
          const a = (j * TAU) / 4;
          ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
          ctx.lineTo(Math.cos(a + 0.6) * 5, Math.sin(a + 0.6) * 5);
        }
        ctx.closePath(); ctx.fill();
      } else if (k === 'scythe') {
        ctx.strokeStyle = '#f3e6ff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, 0, 20, -1.9, 1.0); ctx.stroke();
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 20, -1.9, 1.0); ctx.stroke();
        ctx.strokeStyle = '#3a2a4a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(Math.cos(1.0) * 20, Math.sin(1.0) * 20); ctx.lineTo(-10, 4); ctx.stroke();
      } else if (k === 'wave') {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.globalAlpha = Math.min(1, p.life * 4);
        ctx.beginPath(); ctx.arc(-22, 0, 36, -0.85, 0.85); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (k === 'flask') {
        ctx.fillStyle = '#8fe04a';
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d9c8a0'; ctx.fillRect(-2.5, -11, 5, 6);
        ctx.strokeStyle = 'rgba(10,6,22,0.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.stroke();
      }
    }
    worldTf();
  }

  function drawStrikes(G) {
    for (const s of G.strikes) {
      const t = Math.min(1, s.t / s.delay);
      if (s.kind === 'meteor') {
        ctx.globalAlpha = 0.05 + 0.1 * t;
        ctx.fillStyle = '#ff7a3d';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = '#ffb061'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1.25 - 0.25 * t), 0, TAU); ctx.stroke();
        // falling rock
        const fy = s.y - (1 - t) * 520, fx = s.x + (1 - t) * 170;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(fx, fy, 30 + s.r * 0.18, '#ff5a1f', 0.9);
        drawGlow(fx, fy, 14 + s.r * 0.08, '#fff3c4', 1);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawEBullets(G) {
    const list = G.eprojs;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!visible(b.x, b.y, 20)) continue;
      ctx.fillStyle = 'rgba(12,4,18,0.85)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2.5, 0, TAU); ctx.fill();
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU); ctx.fill();
    }
  }

  /* ------------------------------------------------------------------ screen-space overlays */
  function drawIndicators(G) {
    const p = G.player;
    const narrow = W / dpr < 760, short = H / dpr < 520;
    const safe = { l: (narrow ? 84 : 128) * dpr, r: W - 48 * dpr, t: (short ? 62 : narrow ? 92 : 104) * dpr, b: H - (short ? 100 : narrow ? 190 : 132) * dpr };
    const mark = (x, y, color, icon) => {
      if (visible(x, y, -30)) return;
      const cx = W / 2, cy = H / 2;
      const a = Math.atan2(y - p.y, x - p.x);
      // project onto the edge of a safe rectangle that sits inside the HUD (tracker on the left, bars below, clock above)
      const ca = Math.cos(a), sa = Math.sin(a);
      const kx = ca > 0 ? (safe.r - cx) / ca : ca < 0 ? (safe.l - cx) / ca : 1e9;
      const ky = sa > 0 ? (safe.b - cy) / sa : sa < 0 ? (safe.t - cy) / sa : 1e9;
      const k = Math.min(kx, ky);
      const sx = cx + ca * k, sy = cy + sa * k;
      ctx.setTransform(dpr, 0, 0, dpr, sx, sy);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = 'rgba(16,10,34,0.85)';
      ctx.beginPath(); ctx.arc(0, 0, 17, 0, TAU); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 26, Math.sin(a) * 26);
      ctx.lineTo(Math.cos(a + 0.5) * 18, Math.sin(a + 0.5) * 18);
      ctx.lineTo(Math.cos(a - 0.5) * 18, Math.sin(a - 0.5) * 18);
      ctx.closePath(); ctx.fill();
      PS.Icons.draw(ctx, icon, 0, 0, 18, color);
    };
    for (const pr of G.props) if (!pr.dead) mark(pr.x, pr.y, pr.kind === 'chest' ? '#ffcf5c' : '#ffe9a8', pr.kind === 'chest' ? 'chest' : 'spark');
    // only the nearest heal/magnet is worth pointing at, and heals only when hurt
    let heal = null, hd = 1e12, mag = null, md = 1e12;
    for (const k of G.pickups) {
      if (k.kind === 'chest' || k.kind === 'bosschest') mark(k.x, k.y, '#c77dff', 'chest');
      else if (k.kind === 'heal' || k.kind === 'magnet') {
        const d = U.dist2(k.x, k.y, p.x, p.y);
        if (k.kind === 'heal') { if (d < hd) { hd = d; heal = k; } }
        else if (d < md) { md = d; mag = k; }
      }
    }
    if (heal && p.hp < p.stats.maxHp * 0.65) mark(heal.x, heal.y, '#ff5a7a', 'heart');
    if (mag) mark(mag.x, mag.y, '#8ad1ff', 'magnet');
    if (G.boss) mark(G.boss.x, G.boss.y, '#ff4d6d', 'skull');
    for (const e of G.enemies) if (e.elite) mark(e.x, e.y, '#ff9a4d', 'skull');
    ctx.globalAlpha = 1;
  }
  // vignette, hurt pulse and flashes are DOM layers: the compositor blends them for free
  let elHurt = null, elFlash = null, lastRed = -1, lastFlash = -1, lastFlashCol = '';
  function drawOverlays(G) {
    const p = G.player;
    if (!elHurt) { elHurt = document.getElementById('fxHurt'); elFlash = document.getElementById('fxFlash'); }
    const low = p.hp / p.stats.maxHp;
    let red = p.hurtFlash > 0 ? p.hurtFlash * 1.6 : 0;
    if (low < 0.3 && p.hp > 0) red = Math.max(red, (0.3 - low) * 1.6 * (0.7 + 0.3 * Math.sin(G.time * 7)));
    red = Math.round(Math.min(0.6, red) * 50) / 50;
    if (red !== lastRed) { lastRed = red; elHurt.style.opacity = red; }
    const fl = Math.round(Math.min(0.7, Math.max(0, G.flashA)) * 50) / 50;
    if (fl !== lastFlash) { lastFlash = fl; elFlash.style.opacity = fl; }
    if (fl > 0 && G.flashCol !== lastFlashCol) { lastFlashCol = G.flashCol; elFlash.style.background = G.flashCol; }
  }
  function clearOverlays() {
    if (elHurt) { elHurt.style.opacity = 0; elFlash.style.opacity = 0; lastRed = 0; lastFlash = 0; }
  }

  /* ------------------------------------------------------------------ public */
  const Render = {
    BIOMES,
    prof: null, // set to {} to collect per-layer draw timings (ms)
    init(cv) {
      canvas = cv;
      ctx = canvas.getContext('2d', { alpha: false });
      this.resize();
      window.addEventListener('resize', () => this.resize());
    },
    /* Resolution scaling. 'high' renders at the device pixel ratio (capped at 2), 'low' at 70% of it, and 'auto' starts high
       and steps the backing resolution down while frames run long, then back up once there is headroom again. */
    quality: 'auto',
    res: 1,
    setQuality(q) {
      this.quality = q === 'high' || q === 'low' ? q : 'auto';
      this.res = this.quality === 'low' ? 0.7 : 1;
      auto.ema = 16; auto.slow = 0; auto.fast = 0; auto.ceil = 1;
      this.resize();
    },
    /** real (unclamped) frame interval in ms, fed by the main loop while a run is being played */
    frameTime(ms) {
      if (this.quality !== 'auto' || !(ms > 0) || ms > 250) return; // tab switches and hitches are not load
      auto.ema += (ms - auto.ema) * 0.05;
      if (auto.cool > 0) { auto.cool -= ms; return; }
      if (auto.ema > 22) {
        // sustained below ~45 fps: drop a step; a step that had to be undone soon after caps how high we climb back
        if ((auto.slow += ms) > 1500 && this.res > RES_STEPS[RES_STEPS.length - 1]) {
          if (performance.now() - auto.raisedAt < 6000) auto.ceil = this.res - 0.01;
          this.res = RES_STEPS.find((r) => r < this.res - 0.01) || this.res;
          auto.slow = 0; auto.fast = 0; auto.cool = 2000; auto.ema = 16;
          this.resize();
        }
      } else auto.slow = Math.max(0, auto.slow - ms);
      if (auto.ema < 17.5 && this.res < 1) {
        const up = RES_STEPS.slice().reverse().find((r) => r > this.res + 0.01 && r <= auto.ceil);
        if (up && (auto.fast += ms) > 8000) {
          this.res = up; auto.fast = 0; auto.cool = 2000; auto.raisedAt = performance.now();
          this.resize();
        }
      } else auto.fast = 0;
    },
    /** effects budget: 1 at full quality, less once auto has had to give up resolution */
    detail() { return this.quality === 'low' ? 0.6 : this.res >= 0.85 ? 1 : this.res >= 0.7 ? 0.8 : 0.6; },
    resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2) * this.res;
      const cw = canvas.clientWidth || window.innerWidth, ch = canvas.clientHeight || window.innerHeight;
      W = Math.max(1, Math.round(cw * dpr));
      H = Math.max(1, Math.round(ch * dpr));
      canvas.width = W; canvas.height = H;
      scale = Math.min(H / VIEW_H, W / MIN_VIEW_W);
      tilePx = Math.max(64, Math.round(512 * scale));
      // horde sprites are supersampled 2x, or 3x on screens dense enough to show the difference; never rebuilt downward
      const k = scale > 2.3 ? 3 : 2;
      if (k > sprK) { sprK = k; buildSprites(); }
      if (PS.G) { PS.G.viewW = W / scale; PS.G.viewH = H / scale; }
    },
    viewSize() { return { w: W / scale, h: H / scale }; },
    width() { return W * 10000 + H; },
    drawnW: 0,
    /** convert a client (CSS px) position into world coordinates */
    toWorld(cx, cy) {
      const rect = canvas.getBoundingClientRect();
      return { x: camL + ((cx - rect.left) * dpr) / scale, y: camT + ((cy - rect.top) * dpr) / scale };
    },
    draw(G) {
      const p = G.player;
      // camera: follow with a little look-ahead toward the aim point, plus shake
      const lookX = U.clamp((p.aimX - p.x) * 0.12, -70, 70), lookY = U.clamp((p.aimY - p.y) * 0.12, -50, 50);
      const tx = p.x + (G.ctrl && G.ctrl.autoAim ? 0 : lookX), ty = p.y + (G.ctrl && G.ctrl.autoAim ? 0 : lookY);
      const k = Math.min(1, G.rdt * 7);
      G.cam.x += (tx - G.cam.x) * k;
      G.cam.y += (ty - G.cam.y) * k;
      const sh = PS.Game.state === 'play' ? G.shake : 0; // no jitter behind menus and cards
      const sx = sh ? (Math.random() - 0.5) * sh * 2 : 0, sy = sh ? (Math.random() - 0.5) * sh * 2 : 0;
      const vw = W / scale, vh = H / scale;
      G.viewW = vw; G.viewH = vh;
      camL = G.cam.x - vw / 2 + sx; camT = G.cam.y - vh / 2 + sy;
      view.x0 = camL; view.y0 = camT; view.x1 = camL + vw; view.y1 = camT + vh;

      ctx.globalCompositeOperation = 'source-over';
      const prof = Render.prof;
      let t0 = prof ? performance.now() : 0;
      const lap = (name) => {
        if (!prof) return;
        ctx.getImageData(0, 0, 1, 1); // force the rasterizer to flush so timings are attributed correctly
        const t1 = performance.now();
        prof[name] = (prof[name] || 0) + t1 - t0;
        t0 = t1;
      };
      drawGround(G); lap('ground');
      worldTf();
      drawZones(G);
      lap('zones');
      drawHazards(G);
      drawProps(G); lap('hazards+props');
      drawPickups(G); lap('pickups');
      drawMinions(G);
      drawEnemies(G); lap('enemies');
      worldTf();
      drawStrikes(G);
      drawOrbits(G);
      drawProjs(G);
      drawBallZones(G); lap('projs');
      PS.FX.draw(ctx, view); lap('fx');
      drawPlayer(G); // above the effects so you never lose yourself in your own fireworks
      drawEBullets(G); lap('player+bullets');
      PS.FX.drawNums(ctx); lap('nums');
      drawOverlays(G); lap('overlays');
      drawIndicators(G); lap('indicators');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.drawnW = W * 10000 + H;
    },
    /** idle backdrop behind the menus */
    clearOverlays,
    drawIdle(t) {
      if (!ctx) return;
      clearOverlays();
      const fake = { time: t * 6 };
      camL = t * 18; camT = t * 9;
      view.x0 = camL; view.y0 = camT; view.x1 = camL + W / scale; view.y1 = camT + H / scale;
      ctx.globalCompositeOperation = 'source-over';
      drawGround(fake);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#0d0920';
      ctx.fillRect(0, 0, W, H);
      // slow embers drifting up behind the menus
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 46; i++) {
        const sp = 0.03 + U.hash2(i, 3) * 0.05;
        const ph = (t * sp + U.hash2(i, 7)) % 1;
        const x = (U.hash2(i, 11) + Math.sin(t * 0.4 + i) * 0.02) * W, y = (1 - ph) * (H + 80) - 40;
        const r = (5 + U.hash2(i, 5) * 16) * dpr;
        drawGlowPx(x, y, r, i % 3 ? '#ff7a3d' : '#9b6bff', Math.sin(ph * Math.PI) * 0.5);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
  };

  PS.Render = Render;
})();
