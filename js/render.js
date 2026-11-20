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
  let shakeT = 0;

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  /** a soft disc of light; hot gives it a white heart, for fireballs */
  function glow(color, hot) {
    const key = hot ? color + '!' : color;
    let g = glows[key];
    if (g) return g;
    g = mk(64, 64);
    const c = g.getContext('2d');
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, hot ? '#ffffff' : color);
    if (hot) gr.addColorStop(0.2, '#ffffff');
    gr.addColorStop(hot ? 0.5 : 0.35, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.9;
    c.fillStyle = gr;
    c.fillRect(0, 0, 64, 64);
    glows[key] = g;
    return g;
  }
  /* Soft glows are the biggest fill cost late in a run: dozens of zone, aura and projectile glows, each hundreds of pixels
     wide. Magnifying the 64px gradient that far takes the slow filtered path, so big glows use a copy cached at their
     on-screen size (radius steps of ~2.5%) and are blitted 1:1 on whole device pixels, about three times cheaper. */
  const sized = new Map();
  function drawGlow(x, y, r, color, alpha, hot) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    const px = r * scale;
    if (px < 40 || px > 480) { ctx.drawImage(glow(color, hot), x - r, y - r, r * 2, r * 2); return; }
    const q = Math.round(Math.log(px) * 40), key = (hot ? '!' : '') + color + q;
    let g = sized.get(key);
    if (!g) {
      const R = Math.round(Math.exp(q / 40));
      g = mk(R * 2, R * 2);
      g.getContext('2d').drawImage(glow(color, hot), 0, 0, R * 2, R * 2);
      if (sized.size > 200) sized.delete(sized.keys().next().value); // oldest first; the working set is small
      sized.set(key, g);
    }
    const h = g.width / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(g, Math.round((x - camL) * scale - h), Math.round((y - camT) * scale - h));
    worldTf();
  }
  /** what the effects layer (js/fx.js) needs from the renderer; the camera fields are refreshed every frame */
  const fxApi = { glow: drawGlow, world: worldTf, scale: 1, camL: 0, camT: 0, w: 0, h: 0, lap: null };
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
  /* Lingering zones are discs a few hundred pixels across, and some builds keep dozens down at once. Filling and outlining
     each one was two path draws the size of its bounding square. Instead each kind is painted once per on-screen size
     (a body that deepens toward the rim, then the rim) and blitted 1:1, which is cheaper and no longer flat. */
  // the hero's own ground effects: soft-edged washes with a faint rim, so they never read as the hard red discs of the rift
  const ZONE_STYLE = {
    poison:   { rgb: '95,184,46',   a0: 0.06, a1: 0.22, rim: '#b8f078', ra: 0.28 },
    fire:     { rgb: '255,106,42',  a0: 0.2,  a1: 0.07, rim: '#ff9a4d', ra: 0.25 },
    blizzard: { rgb: '159,230,255', a0: 0.04, a1: 0.15, rim: '#e8f9ff', ra: 0.25 },
    arrows:   { rgb: '241,231,207', a0: 0.02, a1: 0.11, rim: '#f1e7cf', ra: 0.3 },
  };
  const zoneSpr = new Map();
  let zonePx = 0; // pixels held by the cache, which is trimmed oldest first
  function drawZoneDisc(kind, x, y, r, alpha) {
    const st = ZONE_STYLE[kind], px = r * scale;
    ctx.globalAlpha = alpha;
    if (px < 14 || px > 420) {
      // too small to matter or too big to cache: the plain way
      ctx.fillStyle = `rgba(${st.rgb},${(st.a0 + st.a1) / 2})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = alpha * st.ra;
      ctx.strokeStyle = st.rim; ctx.lineWidth = 2; ctx.stroke();
      return;
    }
    const q = Math.round(Math.log(px) * 40), key = kind + q;
    let c = zoneSpr.get(key);
    if (!c) {
      const R = Math.round(Math.exp(q / 40)), n = (R + 2) * 2, m = n / 2, lw = Math.max(1.5, 2 * scale);
      c = mk(n, n);
      const g = c.getContext('2d'), gr = g.createRadialGradient(m, m, 0, m, m, R);
      gr.addColorStop(0, `rgba(${st.rgb},${st.a0})`);
      gr.addColorStop(0.7, `rgba(${st.rgb},${st.a0 * 0.6 + st.a1 * 0.4})`);
      gr.addColorStop(1, `rgba(${st.rgb},${st.a1})`);
      g.fillStyle = gr;
      g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
      g.globalAlpha = st.ra; g.strokeStyle = st.rim; g.lineWidth = lw;
      g.beginPath(); g.arc(m, m, R - lw / 2, 0, TAU); g.stroke();
      zoneSpr.set(key, c);
      zonePx += n * n;
      while (zonePx > 5e6 && zoneSpr.size > 1) {
        const old = zoneSpr.keys().next().value;
        zonePx -= zoneSpr.get(old).width ** 2;
        zoneSpr.delete(old);
      }
    }
    const h = c.width / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c, Math.round((x - camL) * scale - h), Math.round((y - camT) * scale - h));
    worldTf();
  }
  function drawZones(G) {
    const t = G.time, own = PS.Save.data.settings.subtleFx ? 0.5 : 1; // "Subtle own effects" in Settings
    let riftGlows = 8, embers = 3;
    for (const z of G.zones) {
      if (!visible(z.x, z.y, z.r + 20)) continue;
      // a late build's zones cover half the screen: the bigger the wash, the thinner it is painted, so the floor stays readable
      const fade = Math.min(1, z.life / 0.4, z.age / 0.2) * own * (z.r > 150 ? Math.max(0.42, 150 / z.r) : 1);
      const k = z.kind;
      if (k === 'poison' || k === 'pool') {
        drawZoneDisc('poison', z.x, z.y, z.r, fade);
        // bubbles wandering the pool
        ctx.globalAlpha = 0.5 * fade;
        ctx.fillStyle = '#c8ff8a';
        for (let i = 0; i < 3; i++) {
          const a = t * 0.9 + i * 2.1 + z.y, d = z.r * (0.25 + 0.2 * i);
          ctx.beginPath(); ctx.arc(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 3 + Math.sin(t * 4 + i) * 1.5, 0, TAU); ctx.fill();
        }
      } else if (k === 'fire') {
        drawZoneDisc('fire', z.x, z.y, z.r, fade * (0.8 + 0.2 * Math.sin(t * 13 + z.x)));
        // embers lift off the flames; a few a frame across every fire on screen
        if (embers > 0 && Math.random() < 0.35) {
          embers--;
          const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * z.r * 0.85;
          PS.FX.ember(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, Math.random() < 0.5 ? '#ff9a4d' : '#ffd08a');
        }
      } else if (k === 'blizzard') {
        drawZoneDisc('blizzard', z.x, z.y, z.r, fade);
        // the wind: three short arcs running round the rim, and snow driven across
        ctx.globalAlpha = 0.75 * fade;
        ctx.strokeStyle = '#e8f9ff'; ctx.lineWidth = 2.5;
        for (let i = 0; i < 3; i++) {
          const a = t * 1.6 + (i * TAU) / 3;
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r - 5, a, a + 0.5); ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) {
          const ph = (t * 0.8 + i * 0.37) % 1, a = i * 2.4 + Math.floor(t * 0.8 + i * 0.37) * 1.7, d = z.r * (0.15 + 0.7 * U.hash2(i, 3));
          ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.75 * fade;
          ctx.fillRect(z.x + Math.cos(a) * d + (ph - 0.5) * 70, z.y + Math.sin(a) * d + (ph - 0.5) * 40, 2.5, 2.5);
        }
      } else if (k === 'rift' || k === 'implode') {
        ctx.globalAlpha = 0.4 * fade;
        ctx.fillStyle = '#12061f';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r * 0.45, 0, TAU); ctx.fill();
        // a rift glow covers the whole zone and implosions stack by the dozen: only a few long-lived rifts get one
        if (k === 'rift' && riftGlows-- > 0) {
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(z.x, z.y, z.r, '#7a2fd6', 0.22 * fade);
          ctx.globalCompositeOperation = 'source-over';
        }
        // the arms are bright lines: the ordinary blend shows them the same for half the cost of adding them
        ctx.strokeStyle = '#dba6ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.85 * fade;
        for (let i = 0; i < 3; i++) {
          const a = -t * 4 + (i * TAU) / 3, rr = z.r * (0.35 + 0.22 * i);
          ctx.beginPath(); ctx.arc(z.x, z.y, rr, a, a + 1.6); ctx.stroke();
        }
      } else if (k === 'arrows') {
        drawZoneDisc('arrows', z.x, z.y, z.r, fade);
        ctx.strokeStyle = '#f1e7cf'; ctx.lineWidth = 2.5;
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
      const fade = Math.min(1, z.life / 0.4) * (PS.Save.data.settings.subtleFx ? 0.5 : 1);
      drawGlow(z.x, z.y, 46, '#ffe14d', 0.9 * fade, true);
      ctx.globalAlpha = 0.09 * fade; // the orb's reach, barely there: a screenful of these read as circles to be dodged
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // the one colour reserved for what hurts the hero: nothing the hero casts is drawn in it
  const DANGER_COLORS = { red: '#ff2f4e', pink: '#ff4fd8', white: '#f4f4ff' }, DANGER_INK = '#2a0410';
  let DANGER_HOT = '#ffffff'; // the flash just before a blast lands (gold when the danger colour is already white)
  let DANGER = DANGER_COLORS.red; // picked in Settings (Danger colour), read at the top of every hazard pass

  function drawHazards(G) {
    const few = G.hazards.length <= 12;
    DANGER = DANGER_COLORS[PS.Save.data.settings.danger] || DANGER_COLORS.red;
    DANGER_HOT = DANGER === DANGER_COLORS.white ? '#ffd35c' : '#ffffff';
    for (const h of G.hazards) {
      if (h.kind === 'circle') {
        if (!visible(h.x, h.y, h.r + 8)) continue;
        const t = Math.min(1, h.t / h.delay), hot = t > 0.8;
        // Everything that will hurt the hero wears the same colours, whoever cast it: a red disc with a core that fills
        // as the blast comes due, inside a heavy dark-backed rim of marching dashes that turns white just before it lands.
        ctx.globalAlpha = 0.13 + 0.07 * t;
        ctx.fillStyle = DANGER;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.22 + 0.28 * t;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r * t, 0, TAU); ctx.fill();
        if (few) {
          // the dark backing costs a stroke apiece: worth it while there are a handful, not when a boss carpets the floor
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = DANGER_INK; ctx.lineWidth = 7;
          ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = hot ? DANGER_HOT : DANGER; ctx.lineWidth = 3.5;
        ctx.setLineDash([13, 7]); ctx.lineDashOffset = -G.time * 46;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      } else if (h.kind === 'beam') {
        const live = h.t >= h.delay;
        const x2 = h.x + Math.cos(h.ang) * h.len, y2 = h.y + Math.sin(h.ang) * h.len;
        ctx.lineCap = 'round';
        if (!live) {
          const t = h.t / h.delay;
          ctx.globalAlpha = 0.18 + 0.2 * t;
          ctx.strokeStyle = DANGER; ctx.lineWidth = h.w;
          ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = t > 0.8 ? DANGER_HOT : DANGER; ctx.lineWidth = 2 + 3 * t;
          ctx.setLineDash([13, 7]); ctx.lineDashOffset = -G.time * 46;
          ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.setLineDash([]);
        } else if (!h.harmless) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = DANGER; ctx.lineWidth = h.w * (1.1 + 0.15 * Math.sin(G.time * 40));
          ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = h.w * 0.4;
          ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (h.kind === 'ring') {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = DANGER_INK; ctx.lineWidth = h.thick + 5;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.rad, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = DANGER; ctx.lineWidth = h.thick;
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

  const PROP_MARK = { chest: ['#ffcf5c', 'chest'], shrine: ['#ffe9a8', 'spark'], altar: ['#f06be0', 'blood'], breach: ['#c06bff', 'rift'], forge: ['#ffb061', 'anvil'], merchant: ['#ffd35c', 'coin'] };

  function drawProps(G) {
    const p = G.player, t = G.time;
    for (const pr of G.props) {
      if (pr.dead || !visible(pr.x, pr.y, pr.r + 30)) continue;
      if (pr.kind === 'chest' && pr.cursed) {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(pr.x, pr.y, 60, '#a35cff', 0.4 + 0.12 * Math.sin(t * 4 + pr.bob));
        ctx.globalCompositeOperation = 'source-over';
        drawChest(pr.x, pr.y, 1, true);
        ctx.font = `800 14px ${PS.FONT_NUM}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(12,8,28,0.9)';
        ctx.strokeText('Guarded, free', pr.x, pr.y - 34);
        ctx.fillStyle = '#e3b8ff';
        ctx.fillText('Guarded, free', pr.x, pr.y - 34);
      } else if (pr.kind === 'chest') {
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
      } else if (pr.kind === 'merchant') {
        const leaving = pr.life < 12;
        ctx.globalAlpha = leaving ? 0.25 + 0.25 * Math.sin(t * 8) : 0.5;
        ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 2;
        ctx.setLineDash([8, 10]); ctx.lineDashOffset = t * 20;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (pr.charge > 0) {
          ctx.globalAlpha = 0.9; ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, -Math.PI / 2, -Math.PI / 2 + pr.charge * TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(pr.x + 16, pr.y - 26, 46, '#ffd35c', 0.45 + 0.12 * Math.sin(t * 4));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 16, 26, 8, 0, 0, TAU); ctx.fill();
        // a hooded figure beside a heaped pack, a lantern on a pole
        ctx.fillStyle = '#6a4a2c';
        ctx.beginPath(); ctx.roundRect(pr.x - 24, pr.y - 6, 22, 22, 6); ctx.fill();
        ctx.fillStyle = '#8a6238';
        ctx.beginPath(); ctx.roundRect(pr.x - 21, pr.y - 16, 16, 12, 5); ctx.fill();
        ctx.fillStyle = '#3d3157';
        ctx.beginPath(); ctx.moveTo(pr.x - 2, pr.y + 16); ctx.lineTo(pr.x + 2, pr.y - 12); ctx.quadraticCurveTo(pr.x + 9, pr.y - 22, pr.x + 15, pr.y - 12); ctx.lineTo(pr.x + 19, pr.y + 16); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#16102a';
        ctx.beginPath(); ctx.ellipse(pr.x + 9, pr.y - 9, 4.5, 5, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#b9b2a0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pr.x + 19, pr.y + 14); ctx.lineTo(pr.x + 19, pr.y - 30); ctx.lineTo(pr.x + 14, pr.y - 30); ctx.stroke();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath(); ctx.roundRect(pr.x + 10, pr.y - 30, 8, 10, 2); ctx.fill();
      } else if (pr.kind === 'forge') {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffb061'; ctx.lineWidth = 2;
        ctx.setLineDash([8, 10]); ctx.lineDashOffset = t * 20;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (pr.charge > 0) {
          ctx.globalAlpha = 0.9; ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, -Math.PI / 2, -Math.PI / 2 + pr.charge * TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(pr.x, pr.y - 8, 60, '#ff9a3d', 0.4 + 0.18 * Math.sin(t * 6));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 15, 26, 8, 0, 0, TAU); ctx.fill();
        // an anvil: foot, waist, and a face with a horn to one side
        ctx.fillStyle = '#3a3448';
        ctx.beginPath(); ctx.roundRect(pr.x - 18, pr.y + 4, 36, 11, 3); ctx.fill();
        ctx.fillStyle = '#4c455e';
        ctx.fillRect(pr.x - 9, pr.y - 8, 18, 13);
        ctx.fillStyle = '#6b6384';
        ctx.beginPath(); ctx.moveTo(pr.x - 20, pr.y - 20); ctx.lineTo(pr.x + 16, pr.y - 20); ctx.lineTo(pr.x + 30, pr.y - 14); ctx.lineTo(pr.x + 16, pr.y - 8); ctx.lineTo(pr.x - 20, pr.y - 8); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(10,6,22,0.75)'; ctx.lineWidth = 2; ctx.stroke();
        // the work on it, glowing
        ctx.fillStyle = '#ffd08a';
        ctx.fillRect(pr.x - 10, pr.y - 24 - Math.sin(t * 6) * 0.6, 16, 4);
      } else if (pr.kind === 'altar') {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#f3d9c8'; ctx.lineWidth = 2;
        ctx.setLineDash([3, 9]); ctx.lineDashOffset = -t * 14;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (pr.charge > 0) {
          ctx.globalAlpha = 0.95; ctx.lineWidth = 5; ctx.strokeStyle = '#ffd0d8';
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, -Math.PI / 2, -Math.PI / 2 + pr.charge * TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(pr.x, pr.y - 10, 62, '#d94be0', 0.35 + 0.15 * Math.sin(t * 3.1));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 15, 28, 9, 0, 0, TAU); ctx.fill();
        // a squat slab on two steps, its bowl alight (violet, not red: red is the rift's danger colour)
        ctx.fillStyle = '#2a2038';
        ctx.beginPath(); ctx.roundRect(pr.x - 26, pr.y + 4, 52, 12, 3); ctx.fill();
        ctx.fillStyle = '#3b2d4f';
        ctx.beginPath(); ctx.roundRect(pr.x - 19, pr.y - 6, 38, 12, 3); ctx.fill();
        ctx.fillStyle = '#54406e';
        ctx.beginPath(); ctx.moveTo(pr.x - 22, pr.y - 6); ctx.lineTo(pr.x - 16, pr.y - 20); ctx.lineTo(pr.x + 16, pr.y - 20); ctx.lineTo(pr.x + 22, pr.y - 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e052c8';
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y - 20, 12, 4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffc6f5';
        const fl = 5 + 2 * Math.sin(t * 9 + pr.x);
        ctx.beginPath(); ctx.moveTo(pr.x - 5, pr.y - 21); ctx.quadraticCurveTo(pr.x - 2, pr.y - 28 - fl, pr.x + 1, pr.y - 34 - fl); ctx.quadraticCurveTo(pr.x + 6, pr.y - 27, pr.x + 5, pr.y - 21); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(10,6,22,0.75)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pr.x - 22, pr.y - 6); ctx.lineTo(pr.x - 16, pr.y - 20); ctx.lineTo(pr.x + 16, pr.y - 20); ctx.lineTo(pr.x + 22, pr.y - 6); ctx.closePath(); ctx.stroke();
      } else if (pr.kind === 'breach') {
        const act = pr.active, pulse = 0.5 + 0.5 * Math.sin(t * (act ? 7 : 2.4));
        ctx.globalAlpha = act ? 0.8 : 0.5;
        ctx.strokeStyle = '#c06bff'; ctx.lineWidth = act ? 3 : 2;
        ctx.setLineDash([14, 10]); ctx.lineDashOffset = t * (act ? 60 : 18);
        ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (act) {
          // the timer burns down around the rim
          ctx.globalAlpha = 0.95; ctx.lineWidth = 5; ctx.strokeStyle = pr.left < 7 ? '#ff5a7a' : '#ffffff';
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, -Math.PI / 2, -Math.PI / 2 + Math.min(1, pr.left / pr.total) * TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(pr.x, pr.y, 80, '#a35cff', 0.3 + 0.2 * pulse);
        ctx.globalCompositeOperation = 'source-over';
        // the tear itself: a jagged dark slit with a bright edge
        const h = 34 + 4 * pulse, w = 9 + 3 * pulse;
        ctx.fillStyle = '#12061f';
        ctx.beginPath();
        ctx.moveTo(pr.x, pr.y - h); ctx.lineTo(pr.x + w, pr.y - h * 0.35); ctx.lineTo(pr.x + w * 0.4, pr.y); ctx.lineTo(pr.x + w * 1.1, pr.y + h * 0.4); ctx.lineTo(pr.x, pr.y + h);
        ctx.lineTo(pr.x - w, pr.y + h * 0.3); ctx.lineTo(pr.x - w * 0.4, pr.y - h * 0.05); ctx.lineTo(pr.x - w * 1.1, pr.y - h * 0.45);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#e3b8ff'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
        const label = !act ? 'Breach' : pr.mode === 'champion' ? 'Slay the champion' : pr.mode === 'hold' ? 'Hold ' + Math.ceil(pr.need - pr.got) + 's' : pr.got + ' / ' + pr.need;
        ctx.font = `800 ${act ? 20 : 14}px ${PS.FONT_NUM}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(12,8,28,0.9)';
        ctx.strokeText(label, pr.x, pr.y - h - 16);
        ctx.fillStyle = act && pr.left < 7 ? '#ff8a9a' : '#e3b8ff';
        ctx.fillText(label, pr.x, pr.y - h - 16);
        if (act && pr.mode === 'hold') {
          // how much of the stand is done, as a wash that fills the ring
          ctx.globalAlpha = 0.14; ctx.fillStyle = '#c06bff';
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r * Math.sqrt(pr.got / pr.need), 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        }
        if (act) {
          const tl = Math.ceil(pr.left) + 's';
          ctx.font = `700 13px ${PS.FONT_NUM}`;
          ctx.strokeText(tl, pr.x, pr.y + h + 14);
          ctx.fillText(tl, pr.x, pr.y + h + 14);
        }
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
  /* Gems and coins lie about by the hundred. Each tier is painted once at the screen's scale (a cut stone with a dark
     edge, so it reads over fire as well as over flagstones) and blitted on whole pixels. */
  const pickSpr = [];
  let pickScale = 0;
  function pickSprite(i) {
    if (pickScale !== scale) { pickSpr.length = 0; pickScale = scale; }
    let c = pickSpr[i];
    if (c) return c;
    const half = Math.ceil(13 * scale) + 1;
    c = pickSpr[i] = mk(half * 2, half * 2);
    const g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, half, half);
    if (i < 4) {
      const s = 5 + i * 1.6, w = s * 0.72;
      const stone = (k) => { g.beginPath(); g.moveTo(0, -s * k); g.lineTo(w * k, 0); g.lineTo(0, s * k); g.lineTo(-w * k, 0); g.closePath(); };
      g.fillStyle = 'rgba(10,6,22,0.6)'; stone(1.28); g.fill();
      g.fillStyle = GEM_COL[i]; stone(1); g.fill();
      // the lit upper facets, and the lower right one in shade
      g.fillStyle = 'rgba(255,255,255,0.65)';
      g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.3, -s * 0.1); g.lineTo(-s * 0.3, -s * 0.1); g.closePath(); g.fill();
      g.fillStyle = 'rgba(10,6,22,0.22)';
      g.beginPath(); g.moveTo(0, s); g.lineTo(w, 0); g.lineTo(s * 0.3, -s * 0.1); g.lineTo(0, s * 0.25); g.closePath(); g.fill();
    } else {
      g.fillStyle = 'rgba(10,6,22,0.55)'; g.beginPath(); g.arc(0, 0, 7.6, 0, TAU); g.fill();
      g.fillStyle = '#ffcf5c'; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
      g.strokeStyle = '#a8731a'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#fff3c4'; g.fillRect(-1, -3, 2, 6);
    }
    return c;
  }
  function drawPickups(G) {
    const t = G.time, list = G.pickups;
    let rest = 0;
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < list.length; i++) {
      const k = list[i], xp = k.kind === 'xp';
      if (!xp && k.kind !== 'gold') { rest++; continue; }
      if (!visible(k.x, k.y, 30)) continue;
      const c = pickSprite(xp ? (k.val < 3 ? 0 : k.val < 12 ? 1 : k.val < 60 ? 2 : 3) : 4), h = c.width / 2;
      ctx.drawImage(c, Math.round((k.x - camL) * scale - h), Math.round((k.y + Math.sin(t * 4 + k.x * 0.05) * 2 - camT) * scale - h));
    }
    worldTf();
    if (!rest) return;
    for (const k of list) {
      if (k.kind === 'xp' || k.kind === 'gold' || !visible(k.x, k.y, 30)) continue;
      const bob = Math.sin(t * 4 + k.x * 0.05) * 2;
      if (k.kind.endsWith('chest')) {
        const boss = k.kind !== 'chest';
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(k.x, k.y, boss ? 90 : 60, boss ? '#c06bff' : '#ffcf5c', 0.5 + 0.15 * Math.sin(t * 5));
        ctx.globalCompositeOperation = 'source-over';
        drawChest(k.x, k.y + bob, boss ? 1.25 : 1, boss);
      } else {
        // health is green on the field: red is the rift's, and a red orb this size would read as a bullet
        const col = k.kind === 'heal' ? '#7dffa0' : k.kind === 'magnet' ? '#8ad1ff' : '#ffffff';
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

  /** a ring of n small square dots, turning slowly: the cheap way to show a reach */
  function dotRing(x, y, r, color, n, turn) {
    if (!visible(x, y, r + 4)) return;
    ctx.fillStyle = color; ctx.globalAlpha = 0.55;
    for (let i = 0; i < n; i++) {
      const a = turn + (i * TAU) / n;
      ctx.fillRect(x + Math.cos(a) * r - 1.5, y + Math.sin(a) * r - 1.5, 3, 3);
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
      const sc = (e.r / e.def.r) * (1 + e.hop * 0.4); // a leaping toad swells toward the camera
      const frozen = e.freezeT > 0;
      const wob = frozen ? 0 : Math.sin(t * 9 + e.wob) * 0.035;
      // each enemy runs its walk cycle from its own offset; frozen ones hold a pose
      const fr = spr.frames[frozen ? e.id % N : ((t * spr.rate + e.wob) * N | 0) % N];
      // small enemies pop white when hit; elites only tint so their art stays readable under sustained fire
      const flash = e.flash > 0;
      const img = flash && !e.big ? tinted(fr, 'white') : frozen ? tinted(fr, 'ice') : fr.img;
      ctx.globalAlpha = e.spawnT > 0 ? Math.max(0.15, 1 - e.spawnT / 0.35) : 1;
      spriteTf(e.x, e.y - e.hop * 34, e.ang, sc * (1 + wob), sc * (1 - wob));
      ctx.drawImage(img, spr.x, spr.y, spr.w, spr.h);
      if (flash && e.big) { ctx.globalAlpha = 0.4; ctx.drawImage(tinted(fr, 'white'), spr.x, spr.y, spr.w, spr.h); }
    }
    ctx.globalAlpha = 1;
    worldTf();
    // status pips and elite health bars
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!visible(e.x, e.y, e.r * 2)) continue;
      if (e.burnT > 0 && Math.random() < 0.12) PS.FX.ember(e.x + U.frand(-e.r, e.r), e.y - e.r * 0.3, '#ff9a4d');
      if (e.poisStacks > 0 && Math.random() < 0.06) PS.FX.spark(e.x + U.frand(-e.r, e.r), e.y - e.r * 0.5, '#8fe04a');
      if (e.shockT > 0 && Math.random() < 0.05) PS.FX.spark(e.x + U.frand(-e.r, e.r), e.y + U.frand(-e.r, e.r), '#ffe14d');
      if (e.chillT > 0 && e.freezeT <= 0) {
        ctx.globalAlpha = 0.35; ctx.fillStyle = '#9fe6ff';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.9, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      if (e.def.hoard) {
        // how long before it slips away, as a ring that empties
        ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, e.life / 15)); ctx.stroke(); ctx.globalAlpha = 1;
      }
      // Reach rings and ward marks are drawn as a few square dots, not dashed arcs: in the software rasterizer a thin ring
      // costs as much as its whole bounding square, and a warder can mark half the horde.
      if (e.affixes && (e.affixes.includes('warding') || e.affixes.includes('grasping'))) {
        const gr = e.affixes.includes('grasping');
        dotRing(e.x, e.y, gr ? 330 : 150, gr ? '#ff7ad9' : '#bff3ff', gr ? 44 : 28, t * (gr ? 0.08 : 0.06));
      }
      if (e.def.ward) {
        dotRing(e.x, e.y, e.def.ward.r * (e.elite ? 1.3 : 1), '#bff3ff', 28, t * 0.06);
      } else if (e.wardT > t) {
        // warded: a pale bar over the enemy
        ctx.fillStyle = '#bff3ff'; ctx.globalAlpha = 0.85;
        ctx.fillRect(e.x - 5, e.y - e.r - 7, 10, 2.5); ctx.globalAlpha = 1;
      }
      if (e.markT > 0) {
        ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, t * 3, t * 3 + 4.2); ctx.stroke();
      }
      if (e.exposeT > 0) {
        ctx.strokeStyle = '#c06bff'; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 8, -t * 2, -t * 2 + TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      if (e.elite) {
        const w = e.r * 2.2, f = Math.max(0, e.hp / e.maxHp);
        if (e.hp < e.maxHp || e.shieldMax > 0) {
          ctx.fillStyle = 'rgba(12,8,28,0.8)'; ctx.fillRect(e.x - w / 2 - 1, e.y - e.r - 13, w + 2, 6);
          ctx.fillStyle = '#ffcf5c'; ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w * f, 4);
        }
        if (e.shield > 0) {
          // the Shielded barrier: its own bar above the health bar, and a ring that thins as it breaks
          ctx.fillStyle = '#7fc8ff'; ctx.fillRect(e.x - w / 2, e.y - e.r - 17, w * (e.shield / e.shieldMax), 3);
          ctx.strokeStyle = '#7fc8ff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.35 + 0.45 * (e.shield / e.shieldMax);
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
        }
        if (e.affixes) {
          // the affix name over the elite, in the first affix's colour
          ctx.font = '700 11px "Hanken Grotesk", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
          const label = e.affixes.map((id) => PS.Data.AFFIXES[id].name).join(' ');
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,8,28,0.85)'; ctx.strokeText(label, e.x, e.y - e.r - 22);
          ctx.fillStyle = PS.Data.AFFIXES[e.affixes[0]].color; ctx.fillText(label, e.x, e.y - e.r - 22);
        }
      }
    }
  }

  function drawCorpses(G) {
    // the freshly dead: their last pose in white, swelling as it fades
    const dead = PS.FX.corpses, N = M.FRAMES;
    if (dead.length) {
      for (let i = 0; i < dead.length; i++) {
        const c = dead[i], spr = SPR[c.spr];
        if (!spr || !visible(c.x, c.y, 80)) continue;
        const k = c.life / c.max, grow = c.sc * (1.3 - 0.3 * k);
        ctx.globalAlpha = k * 0.85;
        spriteTf(c.x, c.y, c.ang, grow, grow);
        ctx.drawImage(tinted(spr.frames[((c.t * spr.rate + c.wob) * N | 0) % N], 'white'), spr.x, spr.y, spr.w, spr.h);
      }
    }
    ctx.globalAlpha = 1;
    worldTf();
    if (PS.FX.fallen) drawFallen(G.time);
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

  /** a boss that has just died: its silhouette, painted once in near-white, swells and burns away over the blasts */
  function drawFallen(t) {
    const f = PS.FX.fallen, e = f.e, def = e.def;
    if (!f.painted || f.scale !== scale) {
      f.painted = true; f.scale = scale;
      M.tint('#ffffff', 0.82);
      drawLive('fallen', f.x, f.y, e.ang, e.r, e.r, 2.25, 0, (g) => M.enemy(g, def.sprite, t * (M.RATE[def.sprite] || 1), def.color, M.ink(e.r), e.bs));
      M.tint(null, 0);
    }
    const k = f.life / f.max, grow = 1 + 0.4 * (1 - k) * (1 - k);
    const R = Math.ceil(2.25 * e.r * scale) + 2, n = R * 2;
    const px = (f.x - camL) * scale, py = (f.y - camT) * scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = k * k;
    ctx.drawImage(scratch.fallen.cv, 0, 0, n, n, px - R * grow, py - R * grow, n * grow, n * grow);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    worldTf();
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
      // the hero's own aura: a soft solid edge (marching dashes belong to the rift's danger zones)
      ctx.globalAlpha = 0.4; ctx.strokeStyle = '#ff9a4d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, p.auraR, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (p.breathT > 0) {
      // Frost Breath: a soft wedge of cold with no hard edge, brighter toward the mouth
      p.breathT -= G.rdt || 0.016;
      const k = Math.min(1, p.breathT / 0.2), a0 = p.aim - p.breathHalf, a1 = p.aim + p.breathHalf;
      ctx.fillStyle = '#bdf0ff';
      for (const [f, al] of [[1, 0.07], [0.72, 0.07], [0.42, 0.09]]) {
        ctx.globalAlpha = al * k * (0.85 + 0.15 * Math.sin(t * 30 + f * 9));
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, p.breathR * f, a0, a1); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (p.miasmaR > 0) {
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(x, y, p.miasmaR * 1.1, '#5fb82e', 0.13 + 0.04 * Math.sin(t * 5));
      ctx.globalAlpha = 0.35; ctx.strokeStyle = '#b8f078'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, p.miasmaR, 0, TAU); ctx.stroke();
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
    drawHeroBars(G, p, x, y);
  }

  /* Health and dash charges ride under the hero's feet, where the eye already is in a fight: nobody should have to
     look away to a corner of the screen to learn whether the next dodge is ready. Draw-side state only. */
  const bars = { G: null, ghost: 1, full: 9, charges: 0, flash: 0 };
  function drawHeroBars(G, p, x, y) {
    const s = p.stats, r = p.r, dt = G.rdt || 0, maxC = s.dashCharges;
    if (bars.G !== G) { bars.G = G; bars.ghost = 1; bars.full = 9; bars.charges = p.dashCharges; bars.flash = 0; }
    if (PS.Save.data.settings.heroBars === false) {
      // switched off: plain dash pips
      for (let i = 0; i < maxC; i++) {
        ctx.fillStyle = i < p.dashCharges ? '#ffffff' : 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.arc(x + (i - (maxC - 1) / 2) * 9, y + r + 12, 2.6, 0, TAU); ctx.fill();
      }
      return;
    }
    const W = 42, back = 'rgba(10,6,22,0.82)';
    let yy = y + r * 1.5 + 6;
    // health: touch keeps its own bar clear of the thumbs, so this one is for mouse and gamepad
    if (!PS.Input.touch) {
      const f = U.clamp(p.hp / s.maxHp, 0, 1), H = 4.5, x0 = x - W / 2;
      bars.full = f < 0.995 ? 0 : bars.full + dt;
      bars.ghost = f >= bars.ghost ? f : Math.max(f, bars.ghost - dt * 0.55); // the chunk just lost lingers, then drains
      const a = bars.full > 1.2 ? 0.4 : 1; // steps back at full health
      ctx.globalAlpha = a;
      ctx.fillStyle = back; ctx.fillRect(x0 - 1.5, yy - 1.5, W + 3, H + 3);
      if (bars.ghost > f) { ctx.fillStyle = '#ffe9c9'; ctx.fillRect(x0, yy, W * bars.ghost, H); }
      const low = f < 0.3;
      ctx.fillStyle = low && Math.sin(G.time * 12) > 0 ? '#ffb3bd' : '#f0405c';
      ctx.fillRect(x0, yy, W * f, H);
      ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#fff'; ctx.fillRect(x0, yy, W * f, 1.2);
      ctx.globalAlpha = 1;
      yy += H + 3.5;
    }
    // dash: one segment per charge, and the one recharging fills as it comes back
    if (p.dashCharges > bars.charges) bars.flash = 0.35;
    bars.charges = p.dashCharges;
    if (bars.flash > 0) bars.flash -= dt;
    const gap = 2.5, sw = Math.min(14, (W - gap * (maxC - 1)) / maxC), total = maxC * sw + gap * (maxC - 1), h = 3.2;
    const prog = p.dashCharges < maxC ? 1 - U.clamp(p.dashRecharge / s.dashCd, 0, 1) : 0;
    for (let i = 0; i < maxC; i++) {
      const sx = x - total / 2 + i * (sw + gap);
      ctx.fillStyle = back; ctx.fillRect(sx - 1.2, yy - 1.2, sw + 2.4, h + 2.4);
      if (i < p.dashCharges) { ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, yy, sw, h); }
      else {
        ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(sx, yy, sw, h);
        if (i === p.dashCharges) { ctx.fillStyle = '#7fa6ff'; ctx.fillRect(sx, yy, sw * prog, h); }
      }
    }
    if (bars.flash > 0 && p.dashCharges > 0) {
      // a charge just came back: the segment flares so it registers without being looked at
      const k = bars.flash / 0.35, e = (1 - k) * 5, sx = x - total / 2 + (p.dashCharges - 1) * (sw + gap);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k * 0.9; ctx.fillStyle = '#cfe0ff';
      ctx.fillRect(sx - e, yy - e, sw + e * 2, h + e * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    // a class resource, when a talent gives the hero one (Frenzy, the Capacitor): a thin meter that flares when full
    const m = p.cls.meter && p.cls.meter(p);
    if (m) {
      yy += h + 3; const mh = 2.6, x0 = x - W / 2, v = U.clamp(m.v, 0, 1), full = v >= 1;
      ctx.fillStyle = back; ctx.fillRect(x0 - 1.2, yy - 1.2, W + 2.4, mh + 2.4);
      ctx.fillStyle = full && Math.sin(G.time * 14) > 0 ? '#ffffff' : m.color;
      ctx.fillRect(x0, yy, W * v, mh);
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

  // a streak behind the slim, fast shots (the fat ones already carry a glow and shed sparks): half-width in world units,
  // and a colour where the shot's own is too pale
  const TRAILS = { arrow: { w: 2.2 }, bolt: { w: 3 }, missile: { w: 3 }, shard: { w: 2.6, col: '#6fd8ff' } };
  function drawProjs(G) {
    const list = G.projs;
    // trails first, in the ordinary blend: a long diagonal sliver is cheap there and costly as added light
    if (list.length < 160) { // past that the screen is all shots anyway
      let lastCol = '';
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < list.length; i++) {
        const p = list[i], tr = TRAILS[p.kind];
        if (!tr || !visible(p.x, p.y, 40)) continue;
        const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (sp < 60) continue;
        const w = (tr.w * p.size) / sp, len = (Math.min(56, Math.max(18, sp * 0.085)) * p.size) / sp, col = tr.col || p.color;
        if (col !== lastCol) { ctx.fillStyle = col; lastCol = col; }
        ctx.beginPath();
        ctx.moveTo(p.x - p.vy * w, p.y + p.vx * w);
        ctx.lineTo(p.x + p.vy * w, p.y - p.vx * w);
        ctx.lineTo(p.x - p.vx * len, p.y - p.vy * len);
        ctx.fill();
      }
    }
    // glows in one additive pass
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!visible(p.x, p.y, 40)) continue;
      const k = p.kind;
      // one sprite with its white heart built in, where there used to be a glow and a core on top of it
      if (k === 'fireball') drawGlow(p.x, p.y, 26 * p.size, '#ff5a1f', 1, true);
      else if (k === 'reflect') drawGlow(p.x, p.y, 22, '#8fd0ff', 1, true);
      else if (k === 'bolt' || k === 'missile') { drawGlow(p.x, p.y, 16, p.color, 0.9); }
      else if (k === 'spore') { drawGlow(p.x, p.y, 15, '#8fe04a', 0.8); }
      else if (k === 'shard') { drawGlow(p.x, p.y, 15, '#6fd8ff', 0.55); }
      else if (k === 'scythe') { drawGlow(p.x, p.y, 36 * p.size, p.color, 0.4); }
      else if (k === 'wave') { drawGlow(p.x, p.y, 40 * p.size, p.color === '#fff' ? '#bcd0ff' : p.color, 0.4); }
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
        ctx.strokeStyle = p.color; ctx.lineWidth = 6; ctx.lineCap = 'round';
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
        // the hero's own strike: a thin aiming reticle with four ticks, never a filling disc (those are the rift's)
        const rr = s.r * (1.2 - 0.2 * t);
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = '#ffe2b8'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 8]);
        ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.45; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), sn = Math.sin(a);
          ctx.moveTo(s.x + c * rr * 0.86, s.y + sn * rr * 0.86); ctx.lineTo(s.x + c * rr * 1.08, s.y + sn * rr * 1.08);
        }
        ctx.stroke();
        // falling rock
        const fy = s.y - (1 - t) * 520, fx = s.x + (1 - t) * 170;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(fx, fy, 30 + s.r * 0.18, '#ff5a1f', 1, true);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }

  /* Enemy bullets are the one thing on screen that must never be lost, and bosses fire them by the hundred. Each colour
     and size is painted once (dark rim, body, white core, and a halo of its own light) and then blitted on whole pixels:
     one draw a bullet where there were three path fills. */
  const bulletSpr = new Map();
  function bulletSprite(color, r) {
    const px = Math.max(2, Math.round(r * scale)), key = color + px;
    let c = bulletSpr.get(key);
    if (c) return c;
    const half = Math.ceil(px * 2.5) + 1, rim = Math.max(1.5, 2.5 * scale);
    c = mk(half * 2, half * 2);
    const g = c.getContext('2d');
    g.globalAlpha = 0.6;
    g.drawImage(glow(color), 0, 0, half * 2, half * 2);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(12,4,18,0.85)';
    g.beginPath(); g.arc(half, half, px + rim, 0, TAU); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(half, half, px, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(half, half, px * 0.45, 0, TAU); g.fill();
    if (bulletSpr.size > 48) bulletSpr.clear(); // a resize leaves the old sizes behind
    bulletSpr.set(key, c);
    return c;
  }
  function drawEBullets(G) {
    const list = G.eprojs;
    if (!list.length) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // every hostile bullet wears the danger colour, whoever fired it; a bullet the hero has turned is drawn elsewhere, in blue
    const col = Render.dangerColor();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!visible(b.x, b.y, 24)) continue;
      const c = bulletSprite(col, b.r), h = c.width / 2;
      ctx.drawImage(c, Math.round((b.x - camL) * scale - h), Math.round((b.y - camT) * scale - h));
    }
    worldTf();
  }

  /* Drifting motes over the field: dust, embers or snow by biome. Stateless (each one's place is a function of time),
     wrapped around the view, and drawn as pixel-snapped squares in device space, so the whole layer is a few dozen fills. */
  const MOTES = [
    { col: '#b9a8ff', vx: 7, vy: -10, n: 26, sz: 2.1 },   // Ashen Threshold: violet dust
    { col: '#ff9a4d', vx: 16, vy: -48, n: 34, sz: 2.3 },  // Cinder Wastes: embers rising
    { col: '#dff6ff', vx: -38, vy: 56, n: 40, sz: 2.1 },  // Frozen Deep: snow on the wind
    { col: '#d08bff', vx: -9, vy: -18, n: 30, sz: 2.5 },  // The Abyss: spores
    { col: '#ffe08a', vx: 11, vy: -13, n: 30, sz: 2.1 },  // Beyond the Rift: gold dust
  ];
  function drawMotes(G) {
    if (Render.detail() < 0.8) return;
    const m = MOTES[G.biome || 0], t = G.time;
    const tw = view.x1 - view.x0 + 60, th = view.y1 - view.y0 + 60;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = m.col;
    for (let i = 0; i < m.n; i++) {
      // nearer motes are bigger and slide past faster than the ground
      const near = 1 + U.hash2(i, 21) * 0.5;
      let x = U.hash2(i, 11) * tw + (m.vx * t + Math.sin(t * 0.7 + i * 1.9) * 16) * near - camL * near;
      let y = U.hash2(i, 17) * th + m.vy * t * near - camT * near;
      x = ((x % tw) + tw) % tw - 30; y = ((y % th) + th) % th - 30;
      ctx.globalAlpha = 0.14 + 0.3 * (0.5 + 0.5 * Math.sin(t * (1.4 + U.hash2(i, 5) * 2) + i));
      const z = Math.max(1, Math.round(m.sz * near * scale));
      ctx.fillRect((x * scale) | 0, (y * scale) | 0, z, z);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    worldTf();
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
    // a chest the hero cannot pay for is not worth an arrow: fewer markers, each one meaning something to do
    const afford = p.gold >= PS.Director.chestPrice();
    for (const pr of G.props) if (!pr.dead && (pr.kind !== 'chest' || pr.cursed || afford)) { const m = PROP_MARK[pr.kind]; mark(pr.x, pr.y, pr.cursed ? '#c77dff' : m[0], m[1]); }
    const hoarder = PS.Director.hoarder;
    if (hoarder && !hoarder.dead) mark(hoarder.x, hoarder.y, '#ffd35c', 'coin');
    // only the nearest heal/magnet is worth pointing at, and heals only when hurt
    let heal = null, hd = 1e12, mag = null, md = 1e12;
    for (const k of G.pickups) {
      if (k.kind.endsWith('chest')) mark(k.x, k.y, '#c77dff', 'chest');
      else if (k.kind === 'heal' || k.kind === 'magnet') {
        const d = U.dist2(k.x, k.y, p.x, p.y);
        if (k.kind === 'heal') { if (d < hd) { hd = d; heal = k; } }
        else if (d < md) { md = d; mag = k; }
      }
    }
    if (heal && p.hp < p.stats.maxHp * 0.65) mark(heal.x, heal.y, '#7dffa0', 'heart');
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
    /** the colour everything hostile is drawn in (Settings, Danger colour) */
    dangerColor() { return DANGER_COLORS[PS.Save.data.settings.danger] || DANGER_COLORS.red; },
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
      // a few sines out of step with each other: a rattle the eye can follow, where fresh noise every frame only blurs
      shakeT += G.rdt;
      const sx = sh ? (Math.sin(shakeT * 71) * 0.62 + Math.sin(shakeT * 113 + 1.7) * 0.38) * sh : 0;
      const sy = sh ? (Math.sin(shakeT * 83 + 0.9) * 0.62 + Math.sin(shakeT * 127 + 4.1) * 0.38) * sh : 0;
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
      fxApi.scale = scale; fxApi.camL = camL; fxApi.camT = camT; fxApi.w = W; fxApi.h = H; fxApi.lap = prof ? lap : null;
      drawGround(G); lap('ground');
      worldTf();
      PS.FX.drawDecals(ctx, view, fxApi); lap('decals');
      drawZones(G);
      lap('zones');
      drawHazards(G);
      drawProps(G); lap('hazards+props');
      drawPickups(G); lap('pickups');
      drawMinions(G);
      drawEnemies(G); lap('enemies');
      drawCorpses(G); lap('corpses');
      worldTf();
      drawStrikes(G);
      drawOrbits(G);
      drawProjs(G);
      drawBallZones(G); lap('projs');
      PS.FX.draw(ctx, view, fxApi);
      drawMotes(G); lap('fx:parts');
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
