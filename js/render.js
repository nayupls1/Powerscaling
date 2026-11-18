/* POWERSCALING — canvas renderer: ground, props, entities, projectiles, telegraphs, screen overlays */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, TAU = U.TAU;

  const VIEW_H = 800;     // world units visible vertically
  const MIN_VIEW_W = 760; // never show less than this horizontally (portrait phones)

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
  let vignette = null;

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
  function drawGlow(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
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
  function tilePattern(i) {
    if (!tiles[i]) tiles[i] = ctx.createPattern(makeTile(BIOMES[i], 1337 + i * 77), 'repeat');
    return tiles[i];
  }
  function drawGround(G) {
    const t = G.time / 180;
    const bi = Math.min(BIOMES.length - 1, Math.floor(t));
    const into = (t - Math.floor(t)) * 180; // seconds into this biome
    const offX = -((camL * scale) % (512 * scale)), offY = -((camT * scale) % (512 * scale));
    const fill = (idx, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.setTransform(scale, 0, 0, scale, offX, offY);
      ctx.fillStyle = tilePattern(idx);
      ctx.fillRect(-512, -512, W / scale + 1024, H / scale + 1024);
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

  /* ------------------------------------------------------------------ enemy sprites (drawn facing +x) */
  const eye = (g, x, y, r, col) => {
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  };
  const ART = {
    imp(g, r, col) {
      g.fillStyle = '#5e1626';
      g.beginPath(); g.moveTo(r * 0.2, -r * 0.5); g.lineTo(r * 1.15, -r * 0.95); g.lineTo(r * 0.75, -r * 0.2); g.fill();
      g.beginPath(); g.moveTo(r * 0.2, r * 0.5); g.lineTo(r * 1.15, r * 0.95); g.lineTo(r * 0.75, r * 0.2); g.fill();
      body(g, r, col);
      eye(g, r * 0.45, -r * 0.32, r * 0.2, '#ffe14d'); eye(g, r * 0.45, r * 0.32, r * 0.2, '#ffe14d');
    },
    bat(g, r, col) {
      g.fillStyle = '#4a2a8a';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(0, 0); g.quadraticCurveTo(-r * 0.2, s * r * 1.5, -r * 1.1, s * r * 1.7);
        g.quadraticCurveTo(-r * 0.6, s * r * 0.8, -r * 0.9, s * r * 0.3); g.closePath(); g.fill();
      }
      body(g, r * 0.7, col);
      eye(g, r * 0.3, -r * 0.22, r * 0.16, '#ff6b9a'); eye(g, r * 0.3, r * 0.22, r * 0.16, '#ff6b9a');
    },
    spitter(g, r, col) {
      body(g, r, col);
      g.fillStyle = '#2c5a1c';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-r * 0.45 + (i % 2) * r * 0.4, (i < 2 ? -1 : 1) * r * 0.45, r * 0.16, 0, TAU); g.fill(); }
      g.fillStyle = '#16300e'; g.beginPath(); g.arc(r * 0.6, 0, r * 0.38, 0, TAU); g.fill();
      g.fillStyle = '#b6ff5a'; g.beginPath(); g.arc(r * 0.6, 0, r * 0.18, 0, TAU); g.fill();
    },
    slime(g, r, col) {
      g.globalAlpha = 0.85; body(g, r, col); g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-r * 0.2, -r * 0.4, r * 0.35, r * 0.2, -0.5, 0, TAU); g.fill();
      eye(g, r * 0.4, -r * 0.25, r * 0.15, '#0c2a28'); eye(g, r * 0.4, r * 0.25, r * 0.15, '#0c2a28');
    },
    slimelet(g, r, col) { ART.slime(g, r, col); },
    hound(g, r, col) {
      g.fillStyle = col;
      g.beginPath(); g.ellipse(-r * 0.1, 0, r * 1.15, r * 0.72, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(r * 0.5, -r * 0.5); g.lineTo(r * 1.5, 0); g.lineTo(r * 0.5, r * 0.5); g.fill();
      outline(g, () => { g.ellipse(-r * 0.1, 0, r * 1.15, r * 0.72, 0, 0, TAU); });
      g.fillStyle = '#6e1f12';
      g.beginPath(); g.moveTo(r * 0.1, -r * 0.6); g.lineTo(-r * 0.3, -r * 1.1); g.lineTo(-r * 0.3, -r * 0.5); g.fill();
      g.beginPath(); g.moveTo(r * 0.1, r * 0.6); g.lineTo(-r * 0.3, r * 1.1); g.lineTo(-r * 0.3, r * 0.5); g.fill();
      eye(g, r * 0.6, -r * 0.25, r * 0.14, '#ffe14d'); eye(g, r * 0.6, r * 0.25, r * 0.14, '#ffe14d');
    },
    brute(g, r, col) {
      g.fillStyle = col;
      g.beginPath(); g.roundRect(-r * 0.95, -r * 0.95, r * 1.9, r * 1.9, r * 0.5); g.fill();
      outline(g, () => { g.roundRect(-r * 0.95, -r * 0.95, r * 1.9, r * 1.9, r * 0.5); });
      g.fillStyle = '#4d1f16';
      g.beginPath(); g.ellipse(-r * 0.1, -r * 0.85, r * 0.55, r * 0.3, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(-r * 0.1, r * 0.85, r * 0.55, r * 0.3, 0, 0, TAU); g.fill();
      g.fillStyle = '#f0e2c0';
      g.beginPath(); g.moveTo(r * 0.7, -r * 0.45); g.lineTo(r * 1.2, -r * 0.6); g.lineTo(r * 0.8, -r * 0.2); g.fill();
      g.beginPath(); g.moveTo(r * 0.7, r * 0.45); g.lineTo(r * 1.2, r * 0.6); g.lineTo(r * 0.8, r * 0.2); g.fill();
      eye(g, r * 0.5, -r * 0.25, r * 0.12, '#ff9a4d'); eye(g, r * 0.5, r * 0.25, r * 0.12, '#ff9a4d');
    },
    bloater(g, r, col) {
      body(g, r, col);
      g.fillStyle = '#efe38a';
      const spots = [[-0.4, -0.4, 0.22], [0.1, 0.5, 0.26], [-0.5, 0.25, 0.16], [0.35, -0.35, 0.2], [-0.05, -0.05, 0.14]];
      for (const s of spots) { g.beginPath(); g.arc(s[0] * r, s[1] * r, s[2] * r, 0, TAU); g.fill(); }
      eye(g, r * 0.62, -r * 0.2, r * 0.1, '#3a2f08'); eye(g, r * 0.62, r * 0.2, r * 0.1, '#3a2f08');
    },
    wraith(g, r, col) {
      g.globalAlpha = 0.8;
      g.fillStyle = col;
      g.beginPath();
      g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
      g.quadraticCurveTo(-r * 0.6, r * 0.7, -r * 2.1, r * 0.25);
      g.quadraticCurveTo(-r * 1.2, 0, -r * 2.1, -r * 0.25);
      g.quadraticCurveTo(-r * 0.6, -r * 0.7, 0, -r);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#1b2748'; g.beginPath(); g.arc(r * 0.2, 0, r * 0.55, 0, TAU); g.fill();
      eye(g, r * 0.4, -r * 0.2, r * 0.13, '#ffffff'); eye(g, r * 0.4, r * 0.2, r * 0.13, '#ffffff');
    },
    hexer(g, r, col) {
      g.fillStyle = col;
      g.beginPath(); g.moveTo(r * 1.1, 0); g.lineTo(0, -r); g.lineTo(-r * 1.1, 0); g.lineTo(0, r); g.closePath(); g.fill();
      outline(g, () => { g.moveTo(r * 1.1, 0); g.lineTo(0, -r); g.lineTo(-r * 1.1, 0); g.lineTo(0, r); g.closePath(); });
      g.fillStyle = '#3a1436'; g.beginPath(); g.arc(0, 0, r * 0.5, 0, TAU); g.fill();
      g.fillStyle = '#ff9be6'; g.beginPath(); g.arc(r * 0.15, 0, r * 0.22, 0, TAU); g.fill();
    },
    knight(g, r, col) {
      body(g, r, col);
      g.fillStyle = '#2b3048'; g.beginPath(); g.arc(0, 0, r * 0.62, 0, TAU); g.fill();
      g.fillStyle = '#ff5a6e'; g.fillRect(r * 0.15, -r * 0.4, r * 0.18, r * 0.8);
      g.strokeStyle = '#aeb6d6'; g.lineWidth = r * 0.26; g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, r * 1.12, -0.75, 0.75); g.stroke();
    },
    boss0(g, r, col) {
      g.fillStyle = '#5a1d12';
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * 0.55 + (i / 7) * Math.PI * 0.9;
        g.beginPath(); g.moveTo(Math.cos(a - 0.14) * r * 0.85, Math.sin(a - 0.14) * r * 0.85);
        g.lineTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3); g.lineTo(Math.cos(a + 0.14) * r * 0.85, Math.sin(a + 0.14) * r * 0.85); g.fill();
      }
      ART.brute(g, r * 0.95, col);
      g.fillStyle = '#f0e2c0';
      g.beginPath(); g.moveTo(r * 0.3, -r * 0.8); g.quadraticCurveTo(r * 1.3, -r * 1.25, r * 1.5, -r * 0.45); g.quadraticCurveTo(r * 1.0, -r * 0.8, r * 0.55, -r * 0.55); g.fill();
      g.beginPath(); g.moveTo(r * 0.3, r * 0.8); g.quadraticCurveTo(r * 1.3, r * 1.25, r * 1.5, r * 0.45); g.quadraticCurveTo(r * 1.0, r * 0.8, r * 0.55, r * 0.55); g.fill();
    },
    boss1(g, r) {
      g.strokeStyle = '#3b6a22'; g.lineWidth = r * 0.12; g.lineCap = 'round';
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const bx = -r * 0.6 + i * r * 0.4;
        g.beginPath(); g.moveTo(bx, s * r * 0.5); g.lineTo(bx - r * 0.1, s * r * 1.15); g.lineTo(bx + r * 0.25, s * r * 1.45); g.stroke();
      }
      g.fillStyle = '#4f9a2d'; g.beginPath(); g.ellipse(-r * 0.35, 0, r * 0.95, r * 0.8, 0, 0, TAU); g.fill();
      outline(g, () => { g.ellipse(-r * 0.35, 0, r * 0.95, r * 0.8, 0, 0, TAU); });
      g.fillStyle = '#c8ff8a';
      for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(-r * 0.9 + i * r * 0.28, (i % 2 ? 1 : -1) * r * 0.3, r * 0.14, 0, TAU); g.fill(); }
      g.fillStyle = '#6fc23c'; g.beginPath(); g.arc(r * 0.55, 0, r * 0.52, 0, TAU); g.fill();
      for (const s of [-1, 1]) { eye(g, r * 0.75, s * r * 0.2, r * 0.13, '#1a0d24'); eye(g, r * 0.55, s * r * 0.38, r * 0.09, '#1a0d24'); }
      g.fillStyle = '#f0e2c0';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(r * 0.95, s * r * 0.12); g.lineTo(r * 1.4, s * r * 0.28); g.lineTo(r * 1.0, s * r * 0.36); g.fill(); }
    },
    boss2(g, r) {
      g.fillStyle = '#1c3a52';
      g.beginPath(); g.moveTo(r * 0.6, 0); g.quadraticCurveTo(0, -r * 1.3, -r * 1.3, -r * 0.9); g.lineTo(-r * 1.0, 0); g.lineTo(-r * 1.3, r * 0.9); g.quadraticCurveTo(0, r * 1.3, r * 0.6, 0); g.fill();
      g.fillStyle = '#2f6a8f'; g.beginPath(); g.arc(0, 0, r * 0.75, 0, TAU); g.fill();
      outline(g, () => { g.arc(0, 0, r * 0.75, 0, TAU); });
      g.fillStyle = '#e8f6ff'; g.beginPath(); g.arc(r * 0.15, 0, r * 0.42, 0, TAU); g.fill();
      eye(g, r * 0.3, -r * 0.15, r * 0.11, '#0b2233'); eye(g, r * 0.3, r * 0.15, r * 0.11, '#0b2233');
      g.fillStyle = '#ffe14d';
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(-r * 0.25, i * r * 0.17 - r * 0.07); g.lineTo(-r * 0.75, i * r * 0.22); g.lineTo(-r * 0.25, i * r * 0.17 + r * 0.07); g.fill(); }
    },
    boss3(g, r) {
      g.fillStyle = '#3a1259';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(-r * 0.2, s * r * 0.4);
        g.quadraticCurveTo(-r * 0.3, s * r * 1.7, -r * 1.5, s * r * 1.5);
        g.quadraticCurveTo(-r * 0.9, s * r * 1.1, -r * 1.2, s * r * 0.7);
        g.quadraticCurveTo(-r * 0.7, s * r * 0.7, -r * 0.8, s * r * 0.25); g.closePath(); g.fill();
      }
      g.fillStyle = '#6a2aa8'; g.beginPath(); g.arc(0, 0, r * 0.85, 0, TAU); g.fill();
      outline(g, () => { g.arc(0, 0, r * 0.85, 0, TAU); });
      g.fillStyle = '#1a0828';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(r * 0.2, s * r * 0.6); g.quadraticCurveTo(r * 1.2, s * r * 1.3, r * 1.55, s * r * 0.35); g.quadraticCurveTo(r * 1.0, s * r * 0.75, r * 0.5, s * r * 0.4); g.fill();
      }
      eye(g, r * 0.42, 0, r * 0.2, '#ffe14d');
      eye(g, r * 0.35, -r * 0.38, r * 0.12, '#ff6bd6'); eye(g, r * 0.35, r * 0.38, r * 0.12, '#ff6bd6');
      g.fillStyle = '#1a0828'; g.beginPath(); g.ellipse(r * 0.45, 0, r * 0.06, r * 0.16, 0, 0, TAU); g.fill();
    },
  };
  function body(g, r, col) {
    g.fillStyle = col;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    outline(g, () => { g.arc(0, 0, r, 0, TAU); });
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath(); g.arc(-r * 0.25, -r * 0.3, r * 0.5, 0, TAU); g.fill();
  }
  function outline(g, path) {
    g.strokeStyle = 'rgba(10,6,22,0.75)';
    g.lineWidth = 2;
    g.beginPath(); path(); g.stroke();
  }
  function buildSprite(key, r, col) {
    const K = 2; // supersample
    const size = Math.ceil(r * 5.2);
    const img = mk(size * K, size * K), g = img.getContext('2d');
    g.setTransform(K, 0, 0, K, (size * K) / 2, (size * K) / 2);
    ART[key](g, r, col);
    const tint = (color, alpha) => {
      const c = mk(img.width, img.height), cg = c.getContext('2d');
      cg.drawImage(img, 0, 0);
      cg.globalCompositeOperation = 'source-atop';
      cg.globalAlpha = alpha;
      cg.fillStyle = color;
      cg.fillRect(0, 0, c.width, c.height);
      return c;
    };
    return { img, white: tint('#ffffff', 0.92), ice: tint('#9fe6ff', 0.6), size };
  }
  function buildSprites() {
    const defs = PS.Enemies.DEFS;
    for (const id in defs) SPR[id] = buildSprite(id, defs[id].r, defs[id].color);
    for (const b of PS.Bosses.DEFS) SPR[b.sprite] = buildSprite(b.sprite, b.r, b.color);
  }

  /* ------------------------------------------------------------------ layers */
  function drawZones(G) {
    const t = G.time;
    for (const z of G.zones) {
      if (!visible(z.x, z.y, z.r + 20)) continue;
      const fade = Math.min(1, z.life / 0.4, z.age / 0.2);
      const k = z.kind;
      if (k === 'poison' || k === 'pool') {
        ctx.globalAlpha = 0.3 * fade;
        ctx.fillStyle = '#5fb82e';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.6 * fade;
        ctx.strokeStyle = '#b8f078'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.94 + 0.04 * Math.sin(t * 5 + z.x)), 0, TAU); ctx.stroke();
        ctx.fillStyle = '#c8ff8a';
        for (let i = 0; i < 3; i++) {
          const a = t * 0.9 + i * 2.1 + z.y, d = z.r * (0.25 + 0.2 * i);
          ctx.beginPath(); ctx.arc(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 3 + Math.sin(t * 4 + i) * 1.5, 0, TAU); ctx.fill();
        }
      } else if (k === 'fire') {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(z.x, z.y, z.r * 1.25, '#ff5a1f', 0.5 * fade * (0.8 + 0.2 * Math.sin(t * 13 + z.x)));
        drawGlow(z.x, z.y, z.r * 0.7, '#ffd06b', 0.35 * fade);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.5 * fade;
        ctx.strokeStyle = '#ff9a4d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
      } else if (k === 'blizzard') {
        ctx.globalAlpha = 0.22 * fade;
        ctx.fillStyle = '#9fe6ff';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.7 * fade;
        ctx.strokeStyle = '#e8f9ff'; ctx.lineWidth = 2;
        ctx.setLineDash([10, 12]); ctx.lineDashOffset = -t * 40;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      } else if (k === 'rift' || k === 'implode') {
        ctx.globalAlpha = 0.55 * fade;
        ctx.fillStyle = '#12061f';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r * 0.45, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(z.x, z.y, z.r, '#7a2fd6', 0.4 * fade);
        ctx.strokeStyle = '#dba6ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.8 * fade;
        for (let i = 0; i < 3; i++) {
          const a = -t * 4 + (i * TAU) / 3, rr = z.r * (0.35 + 0.22 * i);
          ctx.beginPath(); ctx.arc(z.x, z.y, rr, a, a + 1.6); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      } else if (k === 'arrows') {
        ctx.globalAlpha = 0.16 * fade;
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
        ctx.globalAlpha = 0.16 + 0.1 * t;
        ctx.fillStyle = h.color;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.35 + 0.3 * t;
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
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!visible(e.x, e.y, e.r * 2.6)) continue;
      const spr = SPR[e.def.sprite];
      const sc = e.r / e.def.r;
      const wob = e.freezeT > 0 ? 0 : Math.sin(t * 9 + e.wob) * 0.06;
      const img = e.flash > 0 ? spr.white : e.freezeT > 0 ? spr.ice : spr.img;
      ctx.globalAlpha = e.spawnT > 0 ? Math.max(0.15, 1 - e.spawnT / 0.35) : 1;
      spriteTf(e.x, e.y, e.ang, sc * (1 + wob), sc * (1 - wob));
      ctx.drawImage(img, -spr.size / 2, -spr.size / 2, spr.size, spr.size);
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

  function drawMinions(G) {
    const t = G.time;
    for (const m of G.minions) {
      if (!visible(m.x, m.y, 40)) continue;
      const fade = Math.min(1, m.life / 1.5);
      if (m.kind === 'familiar') {
        const by = Math.sin(m.bob) * 3;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(m.x, m.y + by, 26, '#c06bff', 0.6);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f3e6ff'; ctx.beginPath(); ctx.arc(m.x, m.y + by, 8, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7a2fd6'; ctx.beginPath(); ctx.arc(m.x + Math.cos(m.ang) * 3, m.y + by + Math.sin(m.ang) * 3, 4.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#12061f'; ctx.beginPath(); ctx.arc(m.x + Math.cos(m.ang) * 4, m.y + by + Math.sin(m.ang) * 4, 2, 0, TAU); ctx.fill();
        continue;
      }
      const king = m.kind === 'knight', r = m.r;
      ctx.globalAlpha = 0.28 * fade; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(m.x, m.y + r * 0.6, r, r * 0.45, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(m.x, m.y, r * 2.4, '#a35cff', 0.3 * fade);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = fade;
      ctx.fillStyle = king ? '#3b2a5c' : '#e9e4d6';
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = king ? '#c06bff' : 'rgba(10,6,22,0.75)'; ctx.lineWidth = 2; ctx.stroke();
      const ex = Math.cos(m.ang), ey = Math.sin(m.ang);
      ctx.fillStyle = king ? '#ff6bd6' : '#3a1259';
      ctx.beginPath(); ctx.arc(m.x + ex * r * 0.4 - ey * r * 0.3, m.y + ey * r * 0.4 + ex * r * 0.3, r * 0.18, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(m.x + ex * r * 0.4 + ey * r * 0.3, m.y + ey * r * 0.4 - ex * r * 0.3, r * 0.18, 0, TAU); ctx.fill();
      // weapon swipe
      const sw = m.ang - 0.9 + m.swing * 1.8;
      ctx.strokeStyle = king ? '#e3b8ff' : '#cfc8b4'; ctx.lineWidth = king ? 4 : 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(m.x + Math.cos(sw) * r * 0.8, m.y + Math.sin(sw) * r * 0.8); ctx.lineTo(m.x + Math.cos(sw) * (r + (king ? 18 : 12)), m.y + Math.sin(sw) * (r + (king ? 18 : 12))); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(G) {
    const p = G.player, cls = p.cls, t = G.time;
    const x = p.x, y = p.y, r = p.r;
    // inferno aura
    if (p.auraR > 0) {
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(x, y, p.auraR * 1.15, '#ff5a1f', 0.22 + 0.05 * Math.sin(t * 9));
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
    drawGlow(x, y, 44, cls.color, 0.28);
    ctx.globalCompositeOperation = 'source-over';
    // blink while invulnerable after a hit
    const blink = p.hurtFlash > 0 || (p.inv > 0 && p.dashT <= 0 && Math.floor(t * 18) % 2 === 0);
    ctx.globalAlpha = blink ? 0.55 : 1;
    const bobY = p.moving ? Math.sin(p.walk) * 1.5 : 0;
    const ax = Math.cos(p.aim), ay = Math.sin(p.aim);

    // cloak behind (opposite of aim)
    ctx.fillStyle = shade(cls.color, -0.45);
    ctx.beginPath();
    ctx.moveTo(x - ay * r * 0.9, y + ax * r * 0.9 + bobY);
    ctx.quadraticCurveTo(x - ax * r * 2.0 + Math.sin(t * 6) * 2, y - ay * r * 2.0 + bobY, x + ay * r * 0.9, y - ax * r * 0.9 + bobY);
    ctx.closePath(); ctx.fill();
    // body
    ctx.fillStyle = p.hurtFlash > 0 ? '#ffffff' : cls.color;
    ctx.beginPath(); ctx.arc(x, y + bobY, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(10,6,22,0.8)'; ctx.lineWidth = 2; ctx.stroke();
    // shoulders
    ctx.fillStyle = shade(cls.color, -0.25);
    ctx.beginPath(); ctx.arc(x - ay * r * 0.85, y + ax * r * 0.85 + bobY, r * 0.42, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + ay * r * 0.85, y - ax * r * 0.85 + bobY, r * 0.42, 0, TAU); ctx.fill();
    // head
    ctx.fillStyle = cls.accent;
    ctx.beginPath(); ctx.arc(x + ax * r * 0.15, y + ay * r * 0.15 + bobY, r * 0.55, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(10,6,22,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();

    // weapon
    const id = cls.id;
    ctx.lineCap = 'round';
    if (id === 'vanguard') {
      const a = p.aim + 0.9 - p.swing * 1.9 + (p.whirlT > 0 ? t * 22 : 0);
      const hx = x + Math.cos(a) * r * 0.9, hy = y + Math.sin(a) * r * 0.9 + bobY;
      ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 8, hy + Math.sin(a) * 8); ctx.stroke();
      ctx.strokeStyle = '#e8eeff'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * 8, hy + Math.sin(a) * 8); ctx.lineTo(hx + Math.cos(a) * 36, hy + Math.sin(a) * 36); ctx.stroke();
      ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * 8 - Math.sin(a) * 6, hy + Math.sin(a) * 8 + Math.cos(a) * 6); ctx.lineTo(hx + Math.cos(a) * 8 + Math.sin(a) * 6, hy + Math.sin(a) * 8 - Math.cos(a) * 6); ctx.stroke();
    } else if (id === 'pyromancer') {
      const hx = x + ax * r * 0.6 - ay * r * 0.8, hy = y + ay * r * 0.6 + ax * r * 0.8 + bobY;
      const tx = hx + ax * (24 + p.swing * 4), ty = hy + ay * (24 + p.swing * 4);
      ctx.strokeStyle = '#6a4a2e'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(hx - ax * 10, hy - ay * 10); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(tx, ty, 16 + p.swing * 10, '#ff7a3d', 0.9);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffd06b'; ctx.beginPath(); ctx.arc(tx, ty, 4, 0, TAU); ctx.fill();
    } else if (id === 'ranger') {
      const bx = x + ax * r * 1.1, by = y + ay * r * 1.1 + bobY;
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(bx - ax * 10, by - ay * 10, 17, p.aim - 1.15, p.aim + 1.15); ctx.stroke();
      ctx.strokeStyle = 'rgba(241,231,207,0.8)'; ctx.lineWidth = 1.2;
      const s1x = bx - ax * 10 + Math.cos(p.aim - 1.15) * 17, s1y = by - ay * 10 + Math.sin(p.aim - 1.15) * 17;
      const s2x = bx - ax * 10 + Math.cos(p.aim + 1.15) * 17, s2y = by - ay * 10 + Math.sin(p.aim + 1.15) * 17;
      const pull = 6 * (1 - p.swing);
      ctx.beginPath(); ctx.moveTo(s1x, s1y); ctx.lineTo(bx - ax * (3 + pull), by - ay * (3 + pull)); ctx.lineTo(s2x, s2y); ctx.stroke();
    } else if (id === 'reaper') {
      const a = p.aim + 0.5 - p.swing * 1.2;
      const hx = x + Math.cos(a) * r * 0.5 - ay * r * 0.7, hy = y + Math.sin(a) * r * 0.5 + ax * r * 0.7 + bobY;
      const tx = hx + Math.cos(a) * 30, ty = hy + Math.sin(a) * 30;
      ctx.strokeStyle = '#3a2a4a'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(hx - Math.cos(a) * 12, hy - Math.sin(a) * 12); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = '#e3b8ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(tx - Math.cos(a) * 2 + Math.cos(a + 1.57) * 14, ty - Math.sin(a) * 2 + Math.sin(a + 1.57) * 14, 15, a - 1.9, a - 0.5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
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
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = amt < 0 ? 1 + amt : 1, add = amt > 0 ? amt * 255 : 0;
    r = Math.min(255, r * f + add) | 0; g = Math.min(255, g * f + add) | 0; b = Math.min(255, b * f + add) | 0;
    return `rgb(${r},${g},${b})`;
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
      if (k === 'fireball' || k === 'spore') continue;
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
        ctx.globalAlpha = 0.14 + 0.16 * t;
        ctx.fillStyle = '#ff7a3d';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.7;
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
    const mark = (x, y, color, icon) => {
      if (visible(x, y, -30)) return;
      const cx = W / 2, cy = H / 2;
      const a = Math.atan2(y - p.y, x - p.x);
      const pad = 46 * dpr;
      const kx = (W / 2 - pad) / Math.abs(Math.cos(a) || 1e-6), ky = (H / 2 - pad) / Math.abs(Math.sin(a) || 1e-6);
      const k = Math.min(kx, ky);
      const sx = cx + Math.cos(a) * k, sy = cy + Math.sin(a) * k;
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
    for (const k of G.pickups) {
      if (k.kind === 'chest' || k.kind === 'bosschest') mark(k.x, k.y, '#c77dff', 'chest');
      else if (k.kind === 'heal') mark(k.x, k.y, '#ff5a7a', 'heart');
      else if (k.kind === 'magnet') mark(k.x, k.y, '#8ad1ff', 'magnet');
    }
    if (G.boss) mark(G.boss.x, G.boss.y, '#ff4d6d', 'skull');
    for (const e of G.enemies) if (e.elite) mark(e.x, e.y, '#ff9a4d', 'skull');
    ctx.globalAlpha = 1;
  }
  function drawOverlays(G) {
    const p = G.player;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!vignette || vignette.width !== 256) {
      vignette = mk(256, 256);
      const g = vignette.getContext('2d');
      const gr = g.createRadialGradient(128, 128, 60, 128, 128, 180);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(6,3,16,0.72)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(vignette, 0, 0, W, H);
    // low health / hurt
    const low = p.hp / p.stats.maxHp;
    let red = p.hurtFlash > 0 ? p.hurtFlash * 1.6 : 0;
    if (low < 0.3 && p.hp > 0) red = Math.max(red, (0.3 - low) * 1.6 * (0.7 + 0.3 * Math.sin(G.time * 7)));
    if (red > 0) {
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(255,40,70,0)');
      gr.addColorStop(1, `rgba(255,40,70,${Math.min(0.6, red)})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    if (G.flashA > 0) {
      ctx.globalAlpha = Math.min(0.7, G.flashA);
      ctx.fillStyle = G.flashCol || '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------------ public */
  const Render = {
    BIOMES,
    init(cv) {
      canvas = cv;
      ctx = canvas.getContext('2d', { alpha: false });
      buildSprites();
      this.resize();
      window.addEventListener('resize', () => this.resize());
    },
    resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth || window.innerWidth, ch = canvas.clientHeight || window.innerHeight;
      W = Math.max(1, Math.round(cw * dpr));
      H = Math.max(1, Math.round(ch * dpr));
      canvas.width = W; canvas.height = H;
      scale = Math.min(H / VIEW_H, W / MIN_VIEW_W);
      if (PS.G) { PS.G.viewW = W / scale; PS.G.viewH = H / scale; }
    },
    viewSize() { return { w: W / scale, h: H / scale }; },
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
      const sh = G.shake;
      const sx = sh ? (Math.random() - 0.5) * sh * 2 : 0, sy = sh ? (Math.random() - 0.5) * sh * 2 : 0;
      const vw = W / scale, vh = H / scale;
      G.viewW = vw; G.viewH = vh;
      camL = G.cam.x - vw / 2 + sx; camT = G.cam.y - vh / 2 + sy;
      view.x0 = camL; view.y0 = camT; view.x1 = camL + vw; view.y1 = camT + vh;

      ctx.globalCompositeOperation = 'source-over';
      drawGround(G);
      worldTf();
      drawZones(G);
      drawHazards(G);
      drawProps(G);
      drawPickups(G);
      drawMinions(G);
      drawEnemies(G);
      worldTf();
      drawStrikes(G);
      drawPlayer(G);
      drawOrbits(G);
      drawProjs(G);
      drawBallZones(G);
      PS.FX.draw(ctx, view);
      drawEBullets(G);
      PS.FX.drawNums(ctx);
      drawOverlays(G);
      drawIndicators(G);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    /** idle backdrop behind the menus */
    drawIdle(t) {
      if (!ctx) return;
      const fake = { time: t * 6 };
      camL = t * 18; camT = t * 9;
      view.x0 = camL; view.y0 = camT; view.x1 = camL + W / scale; view.y1 = camT + H / scale;
      ctx.globalCompositeOperation = 'source-over';
      drawGround(fake);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#0d0920';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    },
  };

  PS.Render = Render;
})();
