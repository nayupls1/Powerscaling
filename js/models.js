/* POWERSCALING — character models: the horde, bosses, heroes and minions, as top-down vector art.
   Everything is drawn facing +x in unit space, where 1 is the model's collision radius, and takes a looping phase
   (0..1) for its walk cycle. The renderer caches the horde as animation frames; bosses, heroes and minions are few
   enough to draw live, so they animate smoothly and stay sharp at any resolution. */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const TAU = Math.PI * 2, PI = Math.PI;
  const INK = '#150b26', BONE = '#f3e6c8', WHITE = '#ffffff';

  /* ------------------------------------------------------------------ colour */
  const mixed = new Map();
  let tintCol = null, tintK = 0;
  /** blend two #rrggbb colours */
  function mix(a, b, k) {
    const key = a + b + ((k * 48) | 0);
    let v = mixed.get(key);
    if (v) return v;
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const ch = (s) => { const p = (x >> s) & 255, q = (y >> s) & 255; return Math.round(p + (q - p) * k); };
    v = '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
    mixed.set(key, v);
    return v;
  }
  const lite = (c, k) => mix(c, WHITE, k), dark = (c, k) => mix(c, INK, k);
  /** every colour passes through here on its way to the canvas, so a whole model can be tinted (hit flash, materialising) */
  const T = (c) => (tintCol ? mix(c, tintCol, tintK) : c);
  function rgba(c, a) {
    const n = parseInt(T(c).slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ------------------------------------------------------------------ drawing helpers */
  /** a domed fill, lit from straight above so it still reads when the model turns */
  function vol(g, x, y, rad, col, fx, fy) {
    const gr = g.createRadialGradient(x + (fx || 0), y + (fy || 0), rad * 0.08, x, y, rad);
    gr.addColorStop(0, T(lite(col, 0.3)));
    gr.addColorStop(0.55, T(col));
    gr.addColorStop(1, T(dark(col, 0.42)));
    return gr;
  }
  /** fill the current path and ink its outline */
  function F(g, style, lw) {
    g.fillStyle = typeof style === 'string' && style[0] === '#' ? T(style) : style;
    g.fill();
    if (lw) { g.lineWidth = lw; g.strokeStyle = T(INK); g.lineJoin = 'round'; g.stroke(); }
  }
  /** stroke the current path */
  function S(g, col, w, a) {
    g.strokeStyle = a === undefined ? T(col) : rgba(col, a);
    g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.stroke();
  }
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  function poly(g, pts) {
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
  }
  /** an inked limb: 4 numbers for a straight one, 6 for a curve through a control point, more for a jointed one */
  function limb(g, p, w, col, lw) {
    g.beginPath(); g.moveTo(p[0], p[1]);
    if (p.length === 6) g.quadraticCurveTo(p[2], p[3], p[4], p[5]);
    else for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    S(g, INK, w + lw * 2);
    S(g, col, w);
  }
  /** a straight tapered spike from a base point */
  function spike(g, x, y, ang, len, w, col, lw) {
    const c = Math.cos(ang), s = Math.sin(ang);
    poly(g, [x - s * w, y + c * w, x + c * len, y + s * len, x + s * w, y - c * w]);
    F(g, col, lw);
  }
  /** a curved horn: base, control point, tip */
  function horn(g, x0, y0, cx, cy, x1, y1, w, col, lw) {
    let nx = -(cy - y0), ny = cx - x0;
    const n = Math.hypot(nx, ny) || 1;
    nx = (nx / n) * w; ny = (ny / n) * w;
    g.beginPath(); g.moveTo(x0 + nx, y0 + ny);
    g.quadraticCurveTo(cx + nx * 0.7, cy + ny * 0.7, x1, y1);
    g.quadraticCurveTo(cx - nx * 0.7, cy - ny * 0.7, x0 - nx, y0 - ny);
    g.closePath();
    F(g, col, lw);
  }
  /** a light source: soft halo, bright disc, hot core */
  function glowDot(g, x, y, rad, col, halo) {
    const R = rad * (halo || 2);
    const gr = g.createRadialGradient(x, y, rad * 0.4, x, y, R);
    gr.addColorStop(0, rgba(col, 0.6)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
    g.fillStyle = T(col); g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    g.fillStyle = T(lite(col, 0.75)); g.beginPath(); g.arc(x, y, rad * 0.5, 0, TAU); g.fill();
  }
  /** a pair of glowing eyes, with slit pupils if asked */
  function eyes(g, x, y, rad, col, slit) {
    for (const s of [-1, 1]) {
      glowDot(g, x, s * y, rad, col, 1.7);
      if (slit) { ell(g, x + rad * 0.15, s * y, rad * 0.28, rad * 0.8); F(g, INK); }
    }
  }
  /** a glowing line along the current path */
  function glowLine(g, col, w) {
    S(g, col, w * 3.2, 0.22);
    S(g, col, w * 1.8, 0.45);
    S(g, lite(col, 0.55), w);
  }
  /** a wobbling blob outline */
  function blob(g, x, y, rad, lobes, amp, phase) {
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * TAU, r = rad * (1 + amp * Math.sin(lobes * a + phase) + amp * 0.5 * Math.sin((lobes + 2) * a - phase));
      if (i) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
  }

  /* ------------------------------------------------------------------ the horde */
  const ART = {
    imp(g, ph, col, lw) {
      const a = ph * TAU, sw = Math.sin(a), dk = dark(col, 0.42);
      // whip tail with a spade tip
      const ty = sw * 0.4;
      limb(g, [-0.7, 0, -1.0, -ty * 0.9, -1.24, ty], 0.17, dk, lw);
      poly(g, [-1.2, ty - 0.19, -1.58, ty * 1.3, -1.2, ty + 0.19]); F(g, dk, lw);
      // stubby wings folded along the back
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(-0.05, s * 0.55);
        g.quadraticCurveTo(-0.4, s * (1.3 + sw * 0.06), -1.12, s * (1.08 + sw * 0.08));
        g.lineTo(-0.82, s * 0.74); g.lineTo(-1.02, s * 0.5); g.lineTo(-0.5, s * 0.42); g.closePath();
        F(g, dark(col, 0.6), lw);
      }
      // arms clawing forward, alternating
      for (const s of [-1, 1]) {
        const rx = 0.9 + s * sw * 0.2;
        limb(g, [0.0, s * 0.68, 0.5, s * 1.0, rx, s * 0.7], 0.25, dk, lw);
        for (const c of [-0.4, 0.4]) spike(g, rx + 0.08, s * 0.7 + c * 0.2, c * 0.6 - s * 0.25, 0.3, 0.08, BONE, lw * 0.6);
      }
      ell(g, -0.25, 0, 0.8, 0.76); F(g, vol(g, -0.25, 0, 0.8, dark(col, 0.15)), lw);
      ell(g, 0.28, 0, 0.66, 0.64); F(g, vol(g, 0.28, 0, 0.66, col), lw);
      for (const s of [-1, 1]) horn(g, 0.12, s * 0.5, 0.5, s * 1.08, 1.12, s * 0.8, 0.17, BONE, lw);
      eyes(g, 0.6, 0.27, 0.14, '#ffe14d', true);
      for (const s of [-1, 1]) spike(g, 0.86, s * 0.1, 0, 0.16, 0.05, WHITE, 0);
    },
    bat(g, ph, col, lw) {
      const a = ph * TAU, f = 0.5 + 0.5 * Math.sin(a); // 0 folded, 1 spread
      const mem = dark(col, 0.5), span = 1.0 + 0.8 * f, swp = (1 - f) * 0.5;
      for (const s of [-1, 1]) {
        // membrane: leading edge out to the tip, then two scallops back to the body
        const tip = [0.4 - swp, s * span], k1 = [-0.48 - swp * 0.8, s * span * 0.72], k2 = [-0.92 - swp * 0.4, s * span * 0.36];
        g.beginPath(); g.moveTo(0.3, s * 0.2);
        g.quadraticCurveTo(1.0 - swp * 0.4, s * span * 0.55, tip[0], tip[1]);
        g.quadraticCurveTo(-0.02 - swp, s * span * 0.9, k1[0], k1[1]);
        g.quadraticCurveTo(-0.5 - swp * 0.5, s * span * 0.5, k2[0], k2[1]);
        g.quadraticCurveTo(-0.6, s * 0.24, -0.74, s * 0.1);
        g.closePath();
        F(g, mem, lw);
        // finger bones
        g.beginPath();
        for (const q of [tip, k1, k2]) { g.moveTo(0.2, s * 0.26); g.lineTo(q[0], q[1]); }
        S(g, lite(col, 0.12), lw * 0.9);
      }
      ell(g, -0.12, 0, 0.62, 0.5); F(g, vol(g, -0.12, 0, 0.62, dark(col, 0.1)), lw);
      for (const s of [-1, 1]) { poly(g, [0.3, s * 0.16, 1.0, s * 0.58, 0.52, s * 0.52]); F(g, col, lw); poly(g, [0.48, s * 0.3, 0.84, s * 0.52, 0.56, s * 0.46]); F(g, '#ff9ab8'); }
      ell(g, 0.4, 0, 0.44, 0.42); F(g, vol(g, 0.4, 0, 0.44, lite(col, 0.08)), lw);
      eyes(g, 0.6, 0.18, 0.11, '#ff6b9a');
      for (const s of [-1, 1]) spike(g, 0.8, s * 0.07, 0, 0.17, 0.045, WHITE, 0);
    },
    spitter(g, ph, col, lw) {
      const a = ph * TAU, pu = 0.5 + 0.5 * Math.sin(a), dk = dark(col, 0.45);
      // four stubby legs, diagonal pairs moving together
      for (let i = 0; i < 2; i++) for (const s of [-1, 1]) {
        const st = Math.sin(a + (i ? PI : 0) + (s > 0 ? 0 : PI)) * 0.16, bx = i ? -0.5 : 0.3;
        limb(g, [bx, s * 0.6, bx + 0.08 + st, s * 0.96], 0.28, dk, lw);
        ell(g, bx + 0.12 + st, s * 1.0, 0.2, 0.13); F(g, dk, lw);
      }
      ell(g, -0.08, 0, 0.96, 0.9); F(g, vol(g, -0.08, 0, 0.96, col), lw);
      // spore sacs swelling on its back
      const sacs = [[-0.55, -0.38, 0.2], [-0.6, 0.3, 0.24], [-0.12, -0.56, 0.17], [-0.1, 0.52, 0.19], [-0.32, -0.02, 0.22]];
      for (let i = 0; i < sacs.length; i++) {
        const q = sacs[i], k = 0.9 + 0.2 * (0.5 + 0.5 * Math.sin(a + i * 1.3));
        ell(g, q[0], q[1], q[2] * k, q[2] * k); F(g, vol(g, q[0], q[1], q[2] * k, mix(col, '#d8ff7a', 0.6)), lw * 0.7);
      }
      // snout: a muscular tube around a glowing throat
      ell(g, 0.7, 0, 0.44 + pu * 0.04, 0.42 + pu * 0.05); F(g, vol(g, 0.7, 0, 0.46, dk), lw);
      ell(g, 0.78, 0, 0.26 + pu * 0.05, 0.25 + pu * 0.05); F(g, '#14260a');
      glowDot(g, 0.8, 0, 0.12 + pu * 0.06, '#c8ff5a', 2);
      for (const s of [-1, 1]) { ell(g, 0.26, s * 0.56, 0.16, 0.16); F(g, '#f1ffd0', lw * 0.7); ell(g, 0.31, s * 0.56, 0.07, 0.09); F(g, INK); }
    },
    slime(g, ph, col, lw, small) {
      const a = ph * TAU;
      g.globalAlpha = 0.35; blob(g, 0, 0, 1.04, 5, 0.04, -a); F(g, dark(col, 0.35)); g.globalAlpha = 1;
      blob(g, 0, 0, 0.94, 3, 0.055, a);
      const gr = g.createRadialGradient(-0.1, 0, 0.1, 0, 0, 1);
      gr.addColorStop(0, rgba(lite(col, 0.45), 0.95)); gr.addColorStop(0.6, rgba(col, 0.9)); gr.addColorStop(1, rgba(dark(col, 0.4), 0.95));
      F(g, gr, lw);
      // the cores it will split into, drifting inside the jelly
      const n = small ? 1 : 3;
      for (let i = 0; i < n; i++) {
        const ang = (i * TAU) / 3 + 2.6 + Math.sin(a + i) * 0.2, d = small ? 0.12 : 0.44;
        const x = Math.cos(ang) * d - 0.12, y = Math.sin(ang) * d, cr = small ? 0.34 : 0.25;
        g.globalAlpha = 0.8; ell(g, x, y, cr, cr); F(g, vol(g, x, y, cr, dark(col, 0.45))); g.globalAlpha = 1;
        ell(g, x - cr * 0.3, y - cr * 0.3, cr * 0.3, cr * 0.22); F(g, rgba(WHITE, 0.4));
      }
      for (const b of [[0.1, -0.62, 0.07], [-0.55, 0.5, 0.06], [0.3, 0.7, 0.05]]) { ell(g, b[0], b[1], b[2], b[2]); F(g, rgba(WHITE, 0.45)); }
      // wet gloss
      g.beginPath(); g.ellipse(-0.3, -0.5, 0.36, 0.16, -0.5, 0, TAU); F(g, rgba(WHITE, 0.4));
      for (const s of [-1, 1]) { ell(g, 0.52, s * 0.27, 0.15, 0.17); F(g, '#0c2a28'); ell(g, 0.57, s * 0.27 - 0.05, 0.05, 0.05); F(g, WHITE); }
    },
    slimelet(g, ph, col, lw) { ART.slime(g, ph, col, lw, true); },
    hound(g, ph, col, lw) {
      const a = ph * TAU, sw = Math.sin(a), dk = dark(col, 0.48);
      limb(g, [-1.0, 0, -1.3, sw * 0.18, -1.56, sw * 0.4], 0.2, dk, lw);
      // gallop: forelegs reach while the hind legs drive
      for (const s of [-1, 1]) {
        const fr = Math.sin(a + (s > 0 ? 0 : 0.9)), rr = Math.sin(a + PI + (s > 0 ? 0 : 0.9));
        limb(g, [0.4, s * 0.36, 0.64 + fr * 0.3, s * 0.7], 0.22, dk, lw);
        ell(g, 0.7 + fr * 0.3, s * 0.74, 0.17, 0.12); F(g, dk, lw);
        limb(g, [-0.62, s * 0.32, -0.72 + rr * 0.3, s * 0.66], 0.24, dk, lw);
        ell(g, -0.68 + rr * 0.3, s * 0.7, 0.18, 0.12); F(g, dk, lw);
      }
      ell(g, -0.55, 0, 0.62, 0.46); F(g, vol(g, -0.55, 0, 0.62, dark(col, 0.14)), lw);
      ell(g, 0.15, 0, 0.72, 0.6); F(g, vol(g, 0.15, 0, 0.72, col), lw);
      for (let i = 0; i < 4; i++) spike(g, 0.42 - i * 0.36, 0, PI, 0.26, 0.09, dark(col, 0.65), lw * 0.6);
      // wedge head
      g.beginPath(); g.moveTo(0.58, -0.42); g.quadraticCurveTo(1.25, -0.4, 1.64, -0.11); g.lineTo(1.64, 0.11);
      g.quadraticCurveTo(1.25, 0.4, 0.58, 0.42); g.closePath();
      F(g, vol(g, 0.95, 0, 0.7, lite(col, 0.06)), lw);
      for (const s of [-1, 1]) {
        poly(g, [0.86, s * 0.33, 0.32, s * 0.8, 0.54, s * 0.28]); F(g, dk, lw);
        spike(g, 1.42, s * 0.2, s * 0.9, 0.15, 0.05, WHITE, 0);
        spike(g, 1.22, s * 0.3, s * 1.1, 0.13, 0.05, WHITE, 0);
      }
      ell(g, 1.6, 0, 0.09, 0.12); F(g, INK);
      eyes(g, 1.02, 0.22, 0.085, '#ffe14d');
    },
    brute(g, ph, col, lw) {
      const a = ph * TAU, sw = Math.sin(a), dk = dark(col, 0.45), iron = '#5d5670';
      for (const s of [-1, 1]) { ell(g, s * sw * 0.36 - 0.05, s * 0.42, 0.4, 0.26); F(g, dk, lw); }
      // arms like tree trunks, swinging in turn
      for (const s of [-1, 1]) {
        const fx = 0.74 - s * sw * 0.22;
        limb(g, [-0.1, s * 0.84, 0.44, s * 1.06, fx, s * 0.8], 0.46, dark(col, 0.18), lw);
        ell(g, fx + 0.1, s * 0.78, 0.35, 0.33); F(g, vol(g, fx + 0.1, s * 0.78, 0.35, lite(col, 0.08)), lw);
        for (const c of [-1, 0, 1]) { ell(g, fx + 0.36, s * 0.78 + c * 0.17, 0.07, 0.07); F(g, BONE, lw * 0.5); }
      }
      ell(g, -0.16, 0, 0.72, 0.98); F(g, vol(g, -0.16, 0, 0.98, col), lw);
      // matted hide down the back, and the straps holding its plates on
      ell(g, -0.42, 0, 0.34, 0.6); F(g, dark(col, 0.25));
      g.beginPath(); g.moveTo(-0.78, -0.34); g.lineTo(0.1, 0.5); g.moveTo(-0.78, 0.34); g.lineTo(0.1, -0.5); S(g, dark(col, 0.62), 0.08);
      // iron shoulder plates, each with a bone spike
      for (const s of [-1, 1]) {
        spike(g, -0.14, s * 0.98, s * PI / 2, 0.36, 0.11, BONE, lw * 0.7);
        ell(g, -0.14, s * 0.8, 0.36, 0.3); F(g, vol(g, -0.14, s * 0.8, 0.36, iron), lw);
        ell(g, -0.14, s * 0.8, 0.06, 0.06); F(g, lite(iron, 0.5));
      }
      ell(g, 0.36, 0, 0.47, 0.45); F(g, vol(g, 0.36, 0, 0.47, lite(col, 0.12)), lw);
      g.beginPath(); g.arc(0.32, 0, 0.38, -0.95, 0.95); S(g, dark(col, 0.55), 0.12); // brow
      for (const s of [-1, 1]) horn(g, 0.66, s * 0.3, 1.02, s * 0.5, 1.16, s * 0.14, 0.11, BONE, lw * 0.8);
      eyes(g, 0.64, 0.16, 0.08, '#ff9a4d');
    },
    bloater(g, ph, col, lw) {
      const a = ph * TAU, pu = 0.5 + 0.5 * Math.sin(a), k = 0.95 + pu * 0.05, dk = dark(col, 0.45);
      for (const s of [-1, 1]) {
        limb(g, [0.5, s * 0.6, 0.7 + s * Math.sin(a) * 0.1, s * 0.92], 0.18, dk, lw);
        limb(g, [-0.5, s * 0.62, -0.66 - s * Math.sin(a) * 0.1, s * 0.94], 0.2, dk, lw);
      }
      // a head squeezed out of the front
      ell(g, 0.92 * k, 0, 0.28, 0.32); F(g, vol(g, 0.92, 0, 0.3, dark(col, 0.2)), lw);
      for (const s of [-1, 1]) { ell(g, 1.04 * k, s * 0.14, 0.06, 0.07); F(g, INK); }
      // skin stretched over the gas, lit from inside
      ell(g, 0, 0, k, k);
      const gr = g.createRadialGradient(0, 0, 0.05, 0, 0, k);
      gr.addColorStop(0, T(mix(col, '#fff6b0', 0.55 + pu * 0.3))); gr.addColorStop(0.6, T(col)); gr.addColorStop(1, T(dark(col, 0.4)));
      F(g, gr, lw);
      g.beginPath();
      g.moveTo(-0.7, -0.5); g.quadraticCurveTo(-0.2, -0.2, 0.1, -0.85);
      g.moveTo(-0.85, 0.2); g.quadraticCurveTo(-0.3, 0.3, -0.1, 0.9);
      g.moveTo(0.3, 0.1); g.quadraticCurveTo(0.6, 0.3, 0.7, 0.62);
      S(g, dark(col, 0.5), 0.05, 0.6);
      const boils = [[-0.42, -0.42, 0.22], [0.1, 0.5, 0.26], [-0.52, 0.26, 0.16], [0.36, -0.36, 0.2], [-0.05, -0.05, 0.14], [0.5, 0.12, 0.11]];
      for (let i = 0; i < boils.length; i++) {
        const q = boils[i], bk = k * (0.9 + 0.25 * (0.5 + 0.5 * Math.sin(a + i * 2)));
        ell(g, q[0] * k, q[1] * k, q[2] * bk * 1.2, q[2] * bk * 1.2); F(g, rgba(dark(col, 0.45), 0.7));
        ell(g, q[0] * k, q[1] * k, q[2] * bk, q[2] * bk); F(g, vol(g, q[0] * k, q[1] * k, q[2] * bk, '#f7ec9c', -q[2] * 0.3, -q[2] * 0.3));
      }
    },
    wraith(g, ph, col, lw) {
      const a = ph * TAU;
      // tattered shroud, fading out behind
      const tail = (i) => [-2.05 + Math.abs(i) * 0.4, i * 0.56 + Math.sin(a + i * 1.4) * 0.2];
      const t0 = tail(-1), t1 = tail(0), t2 = tail(1);
      const gr = g.createLinearGradient(0.4, 0, -2.1, 0);
      gr.addColorStop(0, rgba(col, 0.95)); gr.addColorStop(0.5, rgba(dark(col, 0.2), 0.7)); gr.addColorStop(1, rgba(dark(col, 0.3), 0));
      g.beginPath(); g.moveTo(0.2, -0.9);
      g.quadraticCurveTo(-0.9, -1.0, t0[0], t0[1]);
      g.quadraticCurveTo(-1.2, -0.45, -1.1, -0.26);
      g.quadraticCurveTo(-1.5, -0.12, t1[0], t1[1]);
      g.quadraticCurveTo(-1.5, 0.12, -1.1, 0.26);
      g.quadraticCurveTo(-1.2, 0.45, t2[0], t2[1]);
      g.quadraticCurveTo(-0.9, 1.0, 0.2, 0.9);
      g.closePath();
      g.fillStyle = gr; g.fill();
      S(g, lite(col, 0.5), lw * 0.7, 0.35);
      // reaching arms with long fingers
      for (const s of [-1, 1]) {
        const hx = 1.12 + Math.sin(a + s) * 0.1;
        g.beginPath(); g.moveTo(0.15, s * 0.72); g.quadraticCurveTo(0.7, s * 1.0, hx, s * 0.66); S(g, dark(col, 0.25), 0.2);
        g.beginPath();
        for (const c of [-0.45, 0, 0.45]) { g.moveTo(hx, s * 0.66); g.lineTo(hx + 0.3 * Math.cos(c - s * 0.3), s * 0.66 + 0.3 * Math.sin(c - s * 0.3)); }
        S(g, lite(col, 0.4), 0.07);
      }
      ell(g, 0.12, 0, 0.84, 0.82); F(g, vol(g, 0.12, 0, 0.84, col), lw * 0.8);
      ell(g, 0.4, 0, 0.5, 0.54); F(g, '#0d1430');
      eyes(g, 0.6, 0.2, 0.1, '#eaf6ff');
    },
    mortar(g, ph, col, lw) {
      const a = ph * TAU, pu = 0.5 + 0.5 * Math.sin(a), dk = dark(col, 0.5), iron = '#4a4258';
      for (let i = 0; i < 2; i++) for (const s of [-1, 1]) {
        const st = Math.sin(a + (i ? PI : 0) + (s > 0 ? 0 : PI)) * 0.14, bx = i ? -0.5 : 0.4;
        limb(g, [bx, s * 0.7, bx + st, s * 1.08], 0.3, dk, lw);
      }
      ell(g, 0.92, 0, 0.36, 0.38); F(g, vol(g, 0.92, 0, 0.38, lite(col, 0.15)), lw);
      eyes(g, 1.08, 0.17, 0.07, '#fff0a0');
      // plated shell
      ell(g, -0.05, 0, 1, 0.94); F(g, vol(g, -0.05, 0, 1, col), lw);
      g.beginPath();
      for (let i = 0; i < 6; i++) { const q = (i * TAU) / 6 + 0.52; g.moveTo(-0.05 + Math.cos(q) * 0.56, Math.sin(q) * 0.56); g.lineTo(-0.05 + Math.cos(q) * 0.98, Math.sin(q) * 0.92); }
      S(g, dark(col, 0.6), 0.07);
      for (let i = 0; i < 6; i++) { const q = (i * TAU) / 6; ell(g, -0.05 + Math.cos(q) * 0.78, Math.sin(q) * 0.75, 0.07, 0.07); F(g, lite(col, 0.45), lw * 0.5); }
      // the mortar on its back, seen down the barrel
      ell(g, -0.05, 0, 0.58, 0.58); F(g, vol(g, -0.05, 0, 0.58, iron), lw);
      ell(g, 0.02, 0, 0.36, 0.36); F(g, '#140b10', lw * 0.7);
      glowDot(g, 0.02, 0, 0.13 + pu * 0.08, '#ffb04d', 2.2);
    },
    hexer(g, ph, col, lw) {
      const a = ph * TAU, br = Math.sin(a) * 0.04, dk = dark(col, 0.55), gold = '#ffd36b';
      // star mantle
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const q = (i * TAU) / 8, rad = i % 2 ? 0.6 - br : (i === 0 ? 1.22 : 1.1) + br;
        if (i) g.lineTo(Math.cos(q) * rad, Math.sin(q) * rad); else g.moveTo(rad, 0);
      }
      g.closePath(); F(g, vol(g, 0, 0, 1.15, col), lw);
      g.beginPath();
      for (let i = 0; i < 4; i++) { const q = (i * TAU) / 4; g.moveTo(Math.cos(q) * 0.5, Math.sin(q) * 0.5); g.lineTo(Math.cos(q) * 1.0, Math.sin(q) * 1.0); }
      S(g, dk, 0.06, 0.7);
      for (let i = 0; i < 4; i++) { const q = (i * TAU) / 4, d = 0.86 + br; poly(g, [Math.cos(q) * d + 0.1, Math.sin(q) * d, Math.cos(q) * d, Math.sin(q) * d + 0.1, Math.cos(q) * d - 0.1, Math.sin(q) * d, Math.cos(q) * d, Math.sin(q) * d - 0.1]); F(g, gold, lw * 0.5); }
      ell(g, 0.04, 0, 0.54, 0.54); F(g, vol(g, 0.04, 0, 0.54, dk), lw);
      // one unblinking eye
      g.beginPath(); g.moveTo(-0.12, 0); g.quadraticCurveTo(0.16, -0.34, 0.5, 0); g.quadraticCurveTo(0.16, 0.34, -0.12, 0); g.closePath(); F(g, '#ffe3f7', lw * 0.6);
      glowDot(g, 0.22, 0, 0.15, '#ff7ad9', 2);
      ell(g, 0.24, 0, 0.045, 0.13); F(g, INK);
      // three hex motes in orbit, one for each bolt of its burst
      for (let i = 0; i < 3; i++) { const q = a / 3 + (i * TAU) / 3; glowDot(g, Math.cos(q) * 1.06, Math.sin(q) * 1.06, 0.11, '#ff9be6', 1.9); }
    },
    knight(g, ph, col, lw) {
      const a = ph * TAU, sw = Math.sin(a), dk = dark(col, 0.5), red = '#ff5a6e', steel = lite(col, 0.25);
      // tattered cape
      g.beginPath(); g.moveTo(-0.2, -0.72); g.quadraticCurveTo(-0.9, -0.8, -1.26, -0.5 + sw * 0.08);
      g.lineTo(-1.06, -0.2 + sw * 0.1); g.lineTo(-1.34, 0.05 + sw * 0.12); g.lineTo(-1.06, 0.3 + sw * 0.1); g.lineTo(-1.26, 0.55 + sw * 0.08);
      g.quadraticCurveTo(-0.9, 0.8, -0.2, 0.72); g.closePath(); F(g, '#4a1a2e', lw);
      for (const s of [-1, 1]) { ell(g, s * sw * 0.34 + 0.05, s * 0.38, 0.32, 0.2); F(g, dk, lw); }
      // sword, held low on the right
      limb(g, [0, 0.76, 0.34, 0.96], 0.28, dk, lw);
      g.save(); g.translate(0.34, 0.96); g.rotate(-0.2 + sw * 0.05);
      sword(g, 1.12, 0.15, '#dfe6ff', red, '#2b2338', lw);
      g.restore();
      ell(g, -0.05, 0, 0.6, 0.88); F(g, vol(g, -0.05, 0, 0.88, col), lw);
      for (const s of [-1, 1]) {
        spike(g, -0.05, s * 0.96, s * PI / 2, 0.26, 0.09, steel, lw * 0.7);
        ell(g, -0.05, s * 0.76, 0.36, 0.28); F(g, vol(g, -0.05, s * 0.76, 0.36, steel), lw);
      }
      // tower shield carried in front
      g.beginPath(); g.arc(0.02, 0, 1.12, -0.95, 0.42); S(g, INK, 0.3 + lw * 2); S(g, steel, 0.3);
      g.beginPath(); g.arc(0.02, 0, 1.12, -0.8, 0.27); S(g, dark(col, 0.25), 0.12);
      ell(g, 0.02 + Math.cos(-0.27) * 1.12, Math.sin(-0.27) * 1.12, 0.1, 0.1); F(g, red, lw * 0.6);
      ell(g, 0.12, 0, 0.48, 0.46); F(g, vol(g, 0.12, 0, 0.48, steel), lw);
      g.beginPath(); g.arc(0.12, 0, 0.34, -0.7, 0.7); S(g, INK, 0.16);
      g.beginPath(); g.arc(0.12, 0, 0.34, -0.55, 0.55); glowLine(g, red, 0.05);
      limb(g, [0.16, 0, -0.56, 0], 0.1, red, lw * 0.8);
    },

    /* ---------------------------------------------------------------- bosses (st: { rage }) */
    boss0(g, ph, col, lw, st) {
      const a = ph * TAU, sw = Math.sin(a), hot = st && st.rage ? '#ffe36b' : '#ffa53d';
      const dk = dark(col, 0.5), iron = '#4f485f', bone = BONE, boneDk = '#c9b28a';
      // fan of back spines
      for (let i = 0; i < 7; i++) {
        const q = PI + (i - 3) * 0.3;
        spike(g, Math.cos(q) * 0.62 - 0.15, Math.sin(q) * 0.9, q, 0.46 + (i % 2) * 0.1 + sw * 0.02, 0.11, boneDk, lw);
      }
      for (const s of [-1, 1]) { ell(g, s * sw * 0.3 - 0.1, s * 0.44, 0.44, 0.28); F(g, dk, lw); }
      // arms and spiked fists, pumping in turn
      for (const s of [-1, 1]) {
        const fx = 0.84 - s * sw * 0.16;
        limb(g, [-0.1, s * 0.95, 0.42, s * 1.24, fx, s * 0.98], 0.5, dark(col, 0.22), lw);
        g.save(); g.translate(fx - 0.22, s * 1.08); g.rotate(s * -0.55);
        g.beginPath(); g.roundRect(-0.14, -0.3, 0.28, 0.6, 0.08); F(g, vol(g, 0, 0, 0.34, iron), lw);
        g.restore();
        for (const c of [-1, 0, 1]) spike(g, fx + 0.34, s * 0.94 + c * 0.2, c * 0.3, 0.3, 0.09, bone, lw * 0.8);
        ell(g, fx + 0.12, s * 0.94, 0.38, 0.36); F(g, vol(g, fx + 0.12, s * 0.94, 0.38, lite(col, 0.04)), lw);
      }
      ell(g, -0.16, 0, 0.72, 1.0); F(g, vol(g, -0.16, 0, 1.0, col), lw);
      // molten cracks across the back
      g.beginPath();
      g.moveTo(-0.72, -0.2); g.lineTo(-0.45, -0.34); g.lineTo(-0.3, -0.1); g.lineTo(-0.02, -0.22);
      g.moveTo(-0.3, -0.1); g.lineTo(-0.38, 0.2); g.lineTo(-0.12, 0.34); g.lineTo(-0.2, 0.6);
      g.moveTo(-0.38, 0.2); g.lineTo(-0.66, 0.36);
      glowLine(g, hot, 0.03 + 0.012 * sw);
      // shoulder plates crowned with bone
      for (const s of [-1, 1]) {
        for (const c of [-1, 0, 1]) spike(g, -0.14 + c * 0.22, s * 1.02, s * PI / 2 + c * 0.45 * s, 0.44, 0.11, bone, lw);
        ell(g, -0.14, s * 0.84, 0.42, 0.34); F(g, vol(g, -0.14, s * 0.84, 0.42, iron), lw);
        for (const c of [-1, 1]) { ell(g, -0.14 + c * 0.22, s * 0.84, 0.045, 0.045); F(g, lite(iron, 0.5)); }
      }
      ell(g, 0.36, 0, 0.47, 0.45); F(g, vol(g, 0.36, 0, 0.47, lite(col, 0.06)), lw);
      // skull plate
      g.beginPath(); g.moveTo(0.1, -0.28); g.quadraticCurveTo(0.5, -0.44, 0.84, -0.17); g.lineTo(0.9, 0);
      g.lineTo(0.84, 0.17); g.quadraticCurveTo(0.5, 0.44, 0.1, 0.28); g.closePath(); F(g, vol(g, 0.45, 0, 0.5, bone), lw);
      for (const s of [-1, 1]) { ell(g, 0.6, s * 0.16, 0.13, 0.1, s * 0.4); F(g, INK); }
      eyes(g, 0.62, 0.16, 0.06, hot);
      ell(g, 0.82, 0, 0.04, 0.06); F(g, INK);
      // great horns
      for (const s of [-1, 1]) {
        horn(g, 0.24, s * 0.44, 0.74, s * 1.14, 1.34, s * 0.66, 0.22, bone, lw);
        spike(g, 0.8, s * 0.22, s * 0.3, 0.26, 0.07, bone, lw * 0.8);
      }
    },
    boss1(g, ph, col, lw, st) {
      const a = ph * TAU, sw = Math.sin(a), chit = '#4f9a2d', dk = dark(chit, 0.5), hot = st && st.rage ? '#ffe36b' : '#c8ff8a';
      // eight jointed legs, alternating in fours
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const gait = Math.sin(a + (i % 2 ? PI : 0) + (s > 0 ? 0 : PI)) * 0.16;
        const q = 0.62 + i * 0.6, q2 = q - 0.1 + gait;
        const bx = 0.26 - i * 0.12, kx = bx + Math.cos(q) * 0.82, ky = 0.3 + Math.sin(q) * 0.82;
        const fx = 0.1 + Math.cos(q2) * 1.66, fy = Math.sin(q2) * 1.66;
        limb(g, [kx, s * ky, fx, s * fy], 0.07, dk, lw);
        limb(g, [bx, s * 0.3, kx, s * ky], 0.12, dark(chit, 0.3), lw);
        ell(g, kx, s * ky, 0.08, 0.08); F(g, chit, lw * 0.7);
      }
      // swollen abdomen
      ell(g, -0.78, 0, 0.86, 0.72); F(g, vol(g, -0.78, 0, 0.86, chit), lw);
      g.save(); ell(g, -0.78, 0, 0.86, 0.72); g.clip();
      for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(-0.2 - i * 0.3, 0, 0.06, 0.9, 0, 0, TAU); F(g, rgba(dk, 0.45)); }
      g.restore();
      // egg sacs, pulsing down both flanks
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const k = 0.085 + 0.03 * (0.5 + 0.5 * Math.sin(a + i * 1.6));
        glowDot(g, -0.36 - i * 0.3, s * (0.4 - (i === 3 ? 0.14 : 0)), k, hot, 2);
      }
      // glassy wings folded back
      for (const s of [-1, 1]) {
        g.beginPath(); g.ellipse(-0.55, s * (0.32 + sw * 0.03), 0.8, 0.2, s * (0.22 + sw * 0.04), 0, TAU);
        F(g, rgba('#e6ffd0', 0.22)); S(g, '#e6ffd0', lw * 0.6, 0.5);
      }
      ell(g, 0.1, 0, 0.46, 0.5); F(g, vol(g, 0.1, 0, 0.5, dark(chit, 0.2)), lw);
      // antennae
      for (const s of [-1, 1]) limb(g, [0.8, s * 0.26, 1.2, s * (0.7 + sw * 0.06), 1.62, s * (0.62 + sw * 0.12)], 0.045, dk, lw * 0.6);
      // mandibles working open and shut
      const op = 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(a * 2));
      for (const s of [-1, 1]) horn(g, 0.86, s * 0.24, 1.3, s * (0.36 + op), 1.46, s * (0.02 + op * 0.6), 0.1, BONE, lw);
      ell(g, 0.62, 0, 0.42, 0.44); F(g, vol(g, 0.62, 0, 0.44, lite(chit, 0.18)), lw);
      for (const s of [-1, 1]) {
        for (const e of [[0.8, 0.2, 0.11], [0.62, 0.34, 0.075], [0.92, 0.07, 0.05]]) {
          ell(g, e[0], s * e[1], e[2], e[2]); F(g, '#2a0a1e', lw * 0.5);
          ell(g, e[0] + e[2] * 0.3, s * e[1] - e[2] * 0.3, e[2] * 0.3, e[2] * 0.3); F(g, st && st.rage ? '#ff6b6b' : '#ff9be6');
        }
      }
    },
    boss2(g, ph, col, lw, st) {
      const a = ph * TAU, sw = Math.sin(a), robe = '#1c3a52', robeLt = '#2f6a8f', bone = '#e8f6ff', gold = '#ffd84d';
      const zap = st && st.rage ? '#ffffff' : '#bff0ff';
      // rune circle turning under it
      g.beginPath(); g.arc(0, 0, 1.42, 0, TAU); S(g, col, 0.03, 0.4);
      for (let i = 0; i < 12; i++) {
        const q = a / 12 + (i * TAU) / 12, d = 1.42;
        if (i % 2) { g.beginPath(); g.arc(0, 0, 1.3, q - 0.12, q + 0.12); S(g, col, 0.04, 0.6); }
        else { const x = Math.cos(q) * d, y = Math.sin(q) * d; poly(g, [x + 0.07, y, x, y + 0.07, x - 0.07, y, x, y - 0.07]); F(g, rgba(lite(col, 0.4), 0.9)); }
      }
      // robe train, five tatters
      g.beginPath(); g.moveTo(0.15, -0.86);
      g.quadraticCurveTo(-0.8, -1.2, -1.5, -0.95 + sw * 0.05);
      for (let i = 0; i < 5; i++) {
        const y = -0.95 + i * 0.475, w = Math.sin(a + i * 1.1) * 0.07;
        g.lineTo(-1.5 - (i % 2 ? 0.16 : 0) + w, y + w);
        if (i < 4) g.lineTo(-1.12, y + 0.24);
      }
      g.quadraticCurveTo(-0.8, 1.2, 0.15, 0.86); g.closePath();
      const gr = g.createLinearGradient(0, 0, -1.6, 0);
      gr.addColorStop(0, T(robeLt)); gr.addColorStop(1, T(dark(robe, 0.35)));
      F(g, gr, lw);
      g.beginPath(); g.moveTo(-0.5, -0.6); g.lineTo(-1.25, -0.5); g.moveTo(-0.6, 0); g.lineTo(-1.3, 0); g.moveTo(-0.5, 0.6); g.lineTo(-1.25, 0.5); S(g, dark(robe, 0.5), 0.05, 0.7);
      // sleeves, bone hands, a storm cupped in each
      for (const s of [-1, 1]) {
        const hx = 1.0 + Math.sin(a + s * 0.8) * 0.05, hy = s * 0.9;
        g.beginPath(); g.moveTo(-0.1, s * 0.5); g.quadraticCurveTo(0.3, s * 1.25, hx - 0.2, hy + s * 0.16);
        g.lineTo(hx - 0.14, hy - s * 0.14); g.quadraticCurveTo(0.4, s * 0.7, 0.2, s * 0.4); g.closePath(); F(g, robeLt, lw);
        g.beginPath();
        for (const c of [-0.6, -0.2, 0.2, 0.6]) { g.moveTo(hx - 0.14, hy); g.lineTo(hx + 0.12 * Math.cos(c * 1.4), hy + 0.2 * Math.sin(c * 1.4) + s * 0.02); }
        S(g, INK, 0.07 + lw); S(g, bone, 0.05);
        glowDot(g, hx + 0.2, hy, 0.14 + 0.03 * sw, zap, 2.6);
        // forks of lightning jumping off the orb
        const fk = Math.floor(ph * 8) + (s > 0 ? 3 : 0);
        g.beginPath();
        for (let j = 0; j < 2; j++) {
          const q = (fk * 2.4 + j * 2.1) % TAU;
          let x = hx + 0.2, y = hy;
          g.moveTo(x, y);
          for (let n = 1; n <= 3; n++) { x += Math.cos(q + Math.sin(fk * 7 + n * 3 + j) * 0.9) * 0.15; y += Math.sin(q + Math.sin(fk * 7 + n * 3 + j) * 0.9) * 0.15; g.lineTo(x, y); }
        }
        glowLine(g, zap, 0.025);
      }
      ell(g, -0.02, 0, 0.74, 0.84); F(g, vol(g, -0.02, 0, 0.84, robeLt), lw);
      // gilded collar
      g.beginPath(); g.arc(0.1, 0, 0.6, PI * 0.55, PI * 1.45); S(g, INK, 0.12 + lw * 2); S(g, gold, 0.12);
      // crown of spikes behind the skull
      for (let i = -2; i <= 2; i++) {
        const q = PI + i * 0.42;
        spike(g, 0.16 + Math.cos(q) * 0.38, Math.sin(q) * 0.38, q, i === 0 ? 0.52 : 0.4, 0.09, gold, lw);
        if (i % 2 === 0) glowDot(g, 0.16 + Math.cos(q) * 0.5, Math.sin(q) * 0.5, 0.045, col, 2);
      }
      // skull
      ell(g, 0.2, 0, 0.44, 0.41); F(g, vol(g, 0.2, 0, 0.44, bone), lw);
      for (const s of [-1, 1]) { ell(g, 0.36, s * 0.16, 0.13, 0.11, s * 0.3); F(g, '#0b2233'); }
      eyes(g, 0.38, 0.16, 0.055, zap);
      poly(g, [0.5, 0, 0.42, 0.04, 0.42, -0.04]); F(g, '#0b2233');
      g.beginPath(); for (let i = -2; i <= 2; i++) { g.moveTo(0.57, i * 0.06); g.lineTo(0.64, i * 0.06); } S(g, '#0b2233', 0.02);
    },
    boss3(g, ph, col, lw, st) {
      const a = ph * TAU, fl = Math.sin(a), body = '#6a2aa8', wing = '#3a1259', hornC = '#1d0c2e';
      const rift = st && st.rage ? '#ffb0f0' : '#ff6bd6';
      // the rift turning behind it
      for (let i = 0; i < 12; i++) {
        const q = a / 12 + (i * TAU) / 12, d = 1.7;
        g.save(); g.translate(Math.cos(q) * d - 0.25, Math.sin(q) * d); g.rotate(q + PI / 2);
        poly(g, i % 2 ? [0.12, 0, 0, 0.04, -0.12, 0, 0, -0.04] : [0.22, 0, 0, 0.07, -0.22, 0, 0, -0.07]); F(g, rgba(rift, i % 2 ? 0.5 : 0.8));
        g.restore();
      }
      // barbed tail
      const ty = fl * 0.3;
      limb(g, [-0.7, 0, -1.2, -ty, -1.62, ty], 0.16, dark(body, 0.4), lw);
      poly(g, [-1.56, ty - 0.18, -1.98, ty * 1.3, -1.56, ty + 0.18]); F(g, hornC, lw);
      // wings: three fingers of membrane, beating slowly
      for (const s of [-1, 1]) {
        const t1 = [-0.3 - fl * 0.1, s * (1.78 + fl * 0.08)], t2 = [-1.18 - fl * 0.05, s * (1.5 + fl * 0.1)], t3 = [-1.52, s * (0.84 + fl * 0.06)];
        g.beginPath(); g.moveTo(-0.05, s * 0.4);
        g.quadraticCurveTo(0.32, s * 1.3, t1[0], t1[1]);
        g.quadraticCurveTo(-0.62, s * 1.34, t2[0], t2[1]);
        g.quadraticCurveTo(-1.08, s * 1.02, t3[0], t3[1]);
        g.quadraticCurveTo(-1.0, s * 0.62, -0.82, s * 0.22);
        g.closePath();
        const gr = g.createLinearGradient(0, 0, -1.2, s * 1.6);
        gr.addColorStop(0, T(lite(wing, 0.14))); gr.addColorStop(1, T(dark(wing, 0.3)));
        F(g, gr, lw);
        g.beginPath();
        g.moveTo(-0.1, s * 0.46); g.quadraticCurveTo(0.2, s * 1.2, t1[0], t1[1]);
        g.moveTo(-0.1, s * 0.46); g.lineTo(t2[0], t2[1]);
        g.moveTo(-0.1, s * 0.46); g.lineTo(t3[0], t3[1]);
        S(g, lite(body, 0.12), 0.05);
        spike(g, t1[0], t1[1], s * 1.2, 0.2, 0.05, BONE, lw * 0.7);
      }
      // clawed arms
      for (const s of [-1, 1]) {
        const hx = 0.98 + s * fl * 0.06;
        limb(g, [0.1, s * 0.66, 0.6, s * 1.0, hx, s * 0.68], 0.24, lite(body, 0.06), lw);
        for (const c of [-0.5, 0, 0.5]) spike(g, hx + 0.04, s * 0.68 + c * 0.12, c * 0.6 - s * 0.35, 0.3, 0.055, BONE, lw * 0.7);
      }
      ell(g, -0.05, 0, 0.84, 0.82); F(g, vol(g, -0.05, 0, 0.84, body), lw);
      // carapace plates
      g.beginPath();
      for (const d of [0.34, 0.6]) { g.moveTo(-0.05 + Math.cos(2.0) * d * 1.3, Math.sin(2.0) * d * 1.3); g.arc(-0.05, 0, d * 1.3, 2.0, TAU - 2.0); }
      S(g, dark(body, 0.5), 0.04, 0.8);
      // the rift showing through the cracks
      g.beginPath();
      g.moveTo(-0.7, -0.1); g.lineTo(-0.48, 0.06); g.lineTo(-0.3, -0.12); g.lineTo(-0.1, 0.04);
      g.moveTo(-0.48, 0.06); g.lineTo(-0.52, 0.36); g.moveTo(-0.3, -0.12); g.lineTo(-0.24, -0.42);
      glowLine(g, rift, 0.028 + 0.01 * fl);
      for (const s of [-1, 1]) for (const c of [0, 1]) spike(g, -0.1 - c * 0.3, s * 0.74, s * (PI / 2 + 0.3 + c * 0.3), 0.3, 0.08, hornC, lw * 0.8);
      ell(g, 0.42, 0, 0.5, 0.48); F(g, vol(g, 0.42, 0, 0.5, lite(body, 0.1)), lw);
      // horns
      for (const s of [-1, 1]) {
        horn(g, 0.26, s * 0.46, 0.9, s * 1.42, 1.58, s * 0.74, 0.27, hornC, lw);
      }
      // three eyes
      ell(g, 0.62, 0, 0.2, 0.2); F(g, INK);
      glowDot(g, 0.62, 0, 0.17, '#ffe14d', 2.2);
      ell(g, 0.65, 0, 0.05, 0.15); F(g, INK);
      eyes(g, 0.52, 0.34, 0.085, rift);
      for (const s of [-1, 1]) spike(g, 0.88, s * 0.12, 0, 0.16, 0.045, BONE, 0);
    },
  };
  /** walk cycles per second */
  const RATE = { imp: 2.3, bat: 3.1, spitter: 1.6, slime: 1.1, slimelet: 1.7, hound: 2.6, brute: 1.25, bloater: 1.1, wraith: 1.3, mortar: 1.6, hexer: 0.9, knight: 1.6,
    boss0: 0.95, boss1: 1.5, boss2: 0.8, boss3: 0.75 };

  /** a sword along +x from the hand at the origin */
  function sword(g, len, w, blade, guard, grip, lw) {
    limb(g, [-0.12, 0, 0.36, 0], w * 0.7, grip, lw);
    poly(g, [0.42, -w, len - w * 2.2, -w * 0.8, len, 0, len - w * 2.2, w * 0.8, 0.42, w]);
    F(g, blade, lw);
    g.beginPath(); g.moveTo(0.5, 0); g.lineTo(len - w * 2.6, 0); S(g, dark(blade, 0.22), w * 0.35);
    limb(g, [0.4, -w * 2.3, 0.4, w * 2.3], w * 0.75, guard, lw);
  }

  /* ------------------------------------------------------------------ heroes
     o: t, wk (stride), sw (swing 0..1), col, acc, lw, and glow(g, x, y, r, col, alpha) to ask for an additive light */
  function feet(g, wk, col, lw) {
    for (const s of [-1, 1]) { ell(g, s * wk * 0.42 + 0.05, s * 0.36, 0.34, 0.2); F(g, col, lw); }
  }
  /** a hood seen from above: round at the brow, drawn back to a point */
  function hood(g, x, rad, tipX, tipY, fill, lw) {
    g.beginPath(); g.arc(x, 0, rad, -PI * 0.6, PI * 0.6);
    g.quadraticCurveTo(x - rad * 0.9, rad * 0.85, tipX, tipY);
    g.quadraticCurveTo(x - rad * 0.9, -rad * 0.85, x + rad * Math.cos(PI * 0.6), -rad * Math.sin(PI * 0.6));
    g.closePath(); F(g, fill, lw);
  }
  const HERO = {
    vanguard(g, o) {
      const { t, wk, sw, col, acc, lw } = o, steel = '#b4bfd8', sdk = dark(steel, 0.45), sway = Math.sin(t * 5) * 0.07;
      g.beginPath(); g.moveTo(-0.25, -0.7); g.quadraticCurveTo(-1.2, -0.74 + sway, -1.58, -0.34 + sway * 2);
      g.lineTo(-1.38, 0 + sway * 2); g.lineTo(-1.58, 0.34 + sway * 2); g.quadraticCurveTo(-1.2, 0.74 + sway, -0.25, 0.7); g.closePath();
      F(g, dark(col, 0.3), lw);
      feet(g, wk, '#3b3550', lw);
      // shield on the off arm
      limb(g, [0, -0.72, 0.52, -0.74], 0.3, sdk, lw);
      g.save(); g.translate(0.74, -0.6); g.rotate(-0.42);
      g.beginPath(); g.roundRect(-0.15, -0.64, 0.3, 1.28, 0.14); F(g, vol(g, 0, 0, 0.7, steel), lw);
      g.beginPath(); g.roundRect(-0.05, -0.46, 0.12, 0.92, 0.06); F(g, col);
      ell(g, 0.02, 0, 0.1, 0.12); F(g, acc, lw * 0.6);
      g.restore();
      // sword arm
      const a = 0.95 - sw * 1.9, hx = Math.cos(a) * 0.86, hy = Math.sin(a) * 0.86;
      limb(g, [0, 0.72, hx, hy], 0.3, sdk, lw);
      g.save(); g.translate(hx, hy); g.rotate(a);
      sword(g, 2.75, 0.19, '#eef2ff', '#ffd36b', '#5a4a3a', lw);
      g.restore();
      ell(g, hx, hy, 0.2, 0.2); F(g, steel, lw);
      ell(g, -0.05, 0, 0.6, 0.84); F(g, vol(g, -0.05, 0, 0.84, steel), lw);
      g.beginPath(); g.roundRect(-0.62, -0.17, 0.5, 0.34, 0.1); F(g, col); // tabard down the back
      for (const s of [-1, 1]) {
        ell(g, -0.04, s * 0.74, 0.36, 0.28); F(g, vol(g, -0.04, s * 0.74, 0.36, dark(steel, 0.1)), lw);
        g.beginPath(); g.arc(-0.04, s * 0.74, 0.2, s > 0 ? 0.3 : PI + 0.3, s > 0 ? PI - 0.3 : TAU - 0.3); S(g, col, 0.07);
      }
      ell(g, 0.12, 0, 0.54, 0.52); F(g, vol(g, 0.12, 0, 0.54, steel), lw);
      g.beginPath(); g.arc(0.12, 0, 0.4, -0.75, 0.75); S(g, INK, 0.13);
      limb(g, [0.4, 0, -0.3, 0, -0.98, sway * 4], 0.15, col, lw);
    },
    pyromancer(g, o) {
      const { t, wk, sw, col, acc, lw } = o, fl = Math.sin(t * 6) * 0.07, robeDk = mix(col, '#4a0f1f', 0.6), hat = mix(col, '#3a0d22', 0.72);
      // robe train with a hem of flames
      g.beginPath(); g.moveTo(-0.2, -0.72);
      g.quadraticCurveTo(-1.0, -0.98, -1.5, -0.66 + fl);
      g.lineTo(-1.2, -0.32 + fl); g.lineTo(-1.82, fl * 2.5); g.lineTo(-1.2, 0.32 - fl); g.lineTo(-1.5, 0.66 - fl);
      g.quadraticCurveTo(-1.0, 0.98, -0.2, 0.72); g.closePath();
      const gr = g.createLinearGradient(-0.4, 0, -1.8, 0);
      gr.addColorStop(0, T(robeDk)); gr.addColorStop(0.6, T(col)); gr.addColorStop(1, T(acc));
      F(g, gr, lw);
      feet(g, wk, '#3a1a22', lw);
      // staff, with a fire held in its crook
      const tx = 2.0 + sw * 0.3, ty = 0.76;
      limb(g, [0, 0.72, 0.56, 0.84], 0.28, robeDk, lw);
      limb(g, [-0.7, 0.9, tx - 0.2, ty + 0.02], 0.13, '#7a5230', lw);
      ell(g, tx - 0.16, ty + 0.02, 0.15, 0.15); F(g, acc, lw);
      ell(g, 0.56, 0.84, 0.17, 0.17); F(g, '#f0c9a0', lw);
      o.glow(g, tx, ty, 1.15 + sw * 0.7, '#ff7a3d', 0.9);
      const fk = 0.17 + Math.sin(t * 17) * 0.025 + sw * 0.05;
      ell(g, tx, ty, fk, fk); F(g, '#ffd06b');
      ell(g, tx, ty, fk * 0.5, fk * 0.5); F(g, '#fff6d8');
      // casting hand
      const cx = 0.92 + sw * 0.25, cy = -0.6;
      limb(g, [0, -0.7, 0.5, -0.9, cx, cy], 0.26, robeDk, lw);
      ell(g, cx, cy, 0.16, 0.16); F(g, '#f0c9a0', lw);
      o.glow(g, cx + 0.2, cy, 0.5 + sw * 0.4, '#ff7a3d', 0.7);
      ell(g, cx + 0.2, cy, 0.08 + Math.sin(t * 13) * 0.02, 0.08); F(g, '#ffe9a8');
      ell(g, -0.05, 0, 0.6, 0.84); F(g, vol(g, -0.05, 0, 0.84, col), lw);
      g.beginPath(); g.arc(-0.05, 0, 0.5, PI * 0.62, PI * 1.38); S(g, acc, 0.08);
      // wide-brimmed hat, its point flopped back
      ell(g, 0.1, 0, 0.72, 0.7); F(g, vol(g, 0.1, 0, 0.72, hat), lw);
      hood(g, 0.1, 0.4, -0.98, 0.18 + fl * 3, vol(g, -0.1, 0, 0.7, lite(hat, 0.16)), lw);
      g.beginPath(); g.arc(0.1, 0, 0.4, -PI * 0.6, PI * 0.6); S(g, acc, 0.1);
      poly(g, [0.6, 0, 0.5, 0.09, 0.4, 0, 0.5, -0.09]); F(g, '#fff6d8', lw * 0.6);
    },
    ranger(g, o) {
      const { t, wk, sw, col, acc, lw } = o, fl = Math.sin(t * 6) * 0.07, cloak = mix(col, '#1c4a2c', 0.5), leather = '#8a5a2b', wood = '#a8713a';
      // long cloak with a swallow tail
      g.beginPath(); g.moveTo(-0.2, -0.66); g.quadraticCurveTo(-1.1, -0.82, -1.78, -0.42 + fl);
      g.lineTo(-1.28, fl * 2); g.lineTo(-1.78, 0.42 - fl); g.quadraticCurveTo(-1.1, 0.82, -0.2, 0.66); g.closePath();
      F(g, dark(cloak, 0.25), lw);
      feet(g, wk, '#3d2a1a', lw);
      // quiver slung across the back
      g.save(); g.translate(-0.5, 0.34); g.rotate(-0.55);
      for (const c of [-0.1, 0, 0.1]) { limb(g, [-0.4, c, -0.72, c * 1.6], 0.045, acc, lw * 0.5); poly(g, [-0.66, c * 1.6 - 0.07, -0.86, c * 1.8, -0.66, c * 1.6 + 0.07]); F(g, '#ff7a5a', lw * 0.5); }
      g.beginPath(); g.roundRect(-0.45, -0.18, 0.9, 0.36, 0.1); F(g, vol(g, 0, 0, 0.5, leather), lw);
      g.restore();
      // bow arm, bow, string and the nocked arrow
      const pull = 0.5 * (1 - sw), nx = 0.92 - pull;
      limb(g, [0.02, -0.66, 0.9, -0.52, 1.56, -0.06], 0.24, cloak, lw);
      g.beginPath(); g.moveTo(0.92, -1.08); g.lineTo(nx, 0); g.lineTo(0.92, 1.08); S(g, '#f6eedb', 0.035);
      if (sw < 0.55) {
        limb(g, [nx, 0, nx + 1.5, 0], 0.06, acc, lw * 0.6);
        poly(g, [nx + 1.72, 0, nx + 1.44, -0.11, nx + 1.44, 0.11]); F(g, WHITE, lw * 0.6);
        poly(g, [nx - 0.02, 0, nx - 0.14, -0.1, nx + 0.14, -0.1, nx + 0.22, 0, nx + 0.14, 0.1, nx - 0.14, 0.1]); F(g, '#ff7a5a', lw * 0.5);
      }
      g.beginPath(); g.arc(0.4, 0, 1.2, -1.12, 1.12); S(g, INK, 0.14 + lw * 2); S(g, wood, 0.14);
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0.92, s * 1.08); g.lineTo(0.72, s * 1.2); S(g, INK, 0.1 + lw * 2); S(g, wood, 0.1); }
      g.beginPath(); g.arc(0.4, 0, 1.2, -0.16, 0.16); S(g, leather, 0.2);
      ell(g, 1.58, -0.04, 0.16, 0.16); F(g, '#5a3a22', lw);
      limb(g, [0.02, 0.66, -0.1 - pull * 0.3, 0.74, nx, 0.06], 0.24, cloak, lw);
      ell(g, nx, 0.05, 0.15, 0.15); F(g, '#5a3a22', lw);
      ell(g, -0.05, 0, 0.58, 0.8); F(g, vol(g, -0.05, 0, 0.8, cloak), lw);
      // hood
      hood(g, 0.12, 0.5, -0.84, fl * 2.5, vol(g, 0, 0, 0.8, col), lw);
      g.beginPath(); g.arc(0.14, 0, 0.36, -1.0, 1.0); g.closePath(); F(g, dark(col, 0.72));
      g.beginPath(); g.moveTo(-0.3, 0); g.lineTo(-0.72, fl * 2); S(g, dark(col, 0.3), 0.05, 0.7);
    },
    stormcaller(g, o) {
      const { t, wk, sw, col, acc, lw } = o, fl = Math.sin(t * 6) * 0.07, coat = mix(col, '#12224a', 0.62), coatDk = dark(coat, 0.3), brass = '#d9a441', skin = '#f0c9a0';
      // a long coat split into two tails that whip about
      g.beginPath(); g.moveTo(-0.2, -0.7);
      g.quadraticCurveTo(-0.95, -0.92, -1.72, -0.6 + fl * 2);
      g.lineTo(-1.1, -0.2 + fl); g.lineTo(-0.9, 0); g.lineTo(-1.1, 0.2 - fl); g.lineTo(-1.72, 0.6 - fl * 2);
      g.quadraticCurveTo(-0.95, 0.92, -0.2, 0.7); g.closePath();
      F(g, coatDk, lw);
      g.beginPath(); g.moveTo(-0.5, -0.5); g.lineTo(-1.5, -0.56 + fl * 2); g.moveTo(-0.5, 0.5); g.lineTo(-1.5, 0.56 - fl * 2); S(g, col, 0.045, 0.6);
      feet(g, wk, '#1c2440', lw);
      // two brass rods rise from the back, a spark hopping between their tips
      for (const s of [-1, 1]) {
        limb(g, [-0.42, s * 0.3, -1.0, s * 0.62], 0.075, brass, lw * 0.8);
        ell(g, -1.02, s * 0.63, 0.11, 0.11); F(g, lite(brass, 0.3), lw * 0.7);
      }
      const zz = Math.sin(t * 23) * 0.12;
      g.beginPath(); g.moveTo(-1.02, -0.63); g.lineTo(-1.14 + zz, -0.2); g.lineTo(-0.94 - zz, 0.16); g.lineTo(-1.02, 0.63); glowLine(g, acc, 0.035);
      // both hands thrown forward, the lash gathering between them
      const reach = 0.98 + sw * 0.3, gap = 0.5 - sw * 0.16;
      for (const s of [-1, 1]) {
        limb(g, [0, s * 0.7, 0.52, s * 0.86, reach, s * gap], 0.25, coat, lw);
        ell(g, reach - 0.18, s * (gap + 0.07), 0.2, 0.17); F(g, brass, lw * 0.8); // gauntlet cuff
        ell(g, reach, s * gap, 0.16, 0.16); F(g, skin, lw);
      }
      o.glow(g, reach + 0.12, 0, 0.9 + sw * 0.9, col, 0.85);
      const j = Math.sin(t * 31) * 0.1, k = Math.cos(t * 27) * 0.1;
      g.beginPath(); g.moveTo(reach + 0.06, -gap); g.lineTo(reach + 0.3 + j, -gap * 0.4); g.lineTo(reach + 0.08 + k, 0); g.lineTo(reach + 0.32 - j, gap * 0.4); g.lineTo(reach + 0.06, gap);
      glowLine(g, '#ffffff', 0.04 + sw * 0.03);
      const orb = 0.1 + sw * 0.1 + Math.sin(t * 15) * 0.02;
      ell(g, reach + 0.18, 0, orb, orb); F(g, acc);
      // body, with a bolt stitched down the back of the coat
      ell(g, -0.05, 0, 0.6, 0.84); F(g, vol(g, -0.05, 0, 0.84, coat), lw);
      poly(g, [-0.16, -0.2, -0.36, 0.02, -0.25, 0.02, -0.42, 0.24, -0.5, 0.0, -0.39, 0.0, -0.3, -0.2]); F(g, acc, lw * 0.5);
      // a high winged collar
      for (const s of [-1, 1]) {
        poly(g, [0.2, s * 0.3, 0.05, s * 0.86, -0.42, s * 1.04, -0.22, s * 0.5]); F(g, vol(g, -0.1, s * 0.7, 0.5, lite(coat, 0.14)), lw);
        g.beginPath(); g.moveTo(0.05, s * 0.86); g.lineTo(-0.42, s * 1.04); S(g, brass, 0.06);
      }
      // bare head: swept-back white hair and a brass circlet
      ell(g, 0.14, 0, 0.44, 0.42); F(g, vol(g, 0.14, 0, 0.44, '#e9f6ff'), lw);
      g.beginPath(); g.moveTo(0.02, -0.4); g.quadraticCurveTo(-0.5, -0.3 + fl, -0.74, -0.06 + fl * 3); g.quadraticCurveTo(-0.44, 0.02, -0.7, 0.2 + fl * 3); g.quadraticCurveTo(-0.4, 0.34, 0.02, 0.4); g.closePath();
      F(g, '#ffffff', lw);
      g.beginPath(); g.arc(0.14, 0, 0.44, -1.15, 1.15); S(g, brass, 0.085);
      poly(g, [0.64, 0, 0.55, 0.08, 0.46, 0, 0.55, -0.08]); F(g, col, lw * 0.6);
    },
    reaper(g, o) {
      const { t, sw, col, acc, lw } = o, fl = Math.sin(t * 5) * 0.08, shroud = '#2e1a4a', pale = acc; // it floats: no stride
      // shroud in tatters, thinning to nothing
      g.beginPath(); g.moveTo(-0.15, -0.72); g.quadraticCurveTo(-1.0, -1.0, -1.7, -0.76 + fl);
      g.lineTo(-1.3, -0.42 + fl); g.lineTo(-2.0, -0.2 + fl * 2); g.lineTo(-1.4, fl); g.lineTo(-2.0, 0.25 - fl * 2); g.lineTo(-1.3, 0.45 - fl); g.lineTo(-1.7, 0.78 - fl);
      g.quadraticCurveTo(-1.0, 1.0, -0.15, 0.72); g.closePath();
      const gr = g.createLinearGradient(-0.5, 0, -2.0, 0);
      gr.addColorStop(0, T(shroud)); gr.addColorStop(1, rgba(col, 0.25));
      g.fillStyle = gr; g.fill(); S(g, INK, lw, 0.7);
      g.beginPath(); g.moveTo(-0.6, -0.4); g.lineTo(-1.5, -0.46 + fl); g.moveTo(-0.7, 0.04); g.lineTo(-1.6, fl); g.moveTo(-0.6, 0.44); g.lineTo(-1.5, 0.5 - fl); S(g, col, 0.04, 0.5);
      // scythe
      const a = 0.42 - sw * 1.2, hx = Math.cos(a) * 0.5, hy = Math.sin(a) * 0.5 + 0.66;
      limb(g, [0, 0.7, hx, hy], 0.26, shroud, lw);
      g.save(); g.translate(hx, hy); g.rotate(a);
      limb(g, [-0.9, 0, 2.2, 0], 0.12, '#5a4670', lw);
      g.beginPath(); g.moveTo(2.2, 0.08); g.quadraticCurveTo(2.36, -1.0, 1.0, -1.5);
      g.quadraticCurveTo(1.8, -0.9, 1.82, 0.08); g.closePath();
      F(g, vol(g, 1.9, -0.5, 1.2, pale), lw);
      g.beginPath(); g.moveTo(2.24, 0); g.quadraticCurveTo(2.36, -1.0, 1.0, -1.5); glowLine(g, col, 0.03);
      ell(g, 0, 0, 0.14, 0.14); F(g, '#efe6ff', lw);
      ell(g, 0.9, 0, 0.14, 0.14); F(g, '#efe6ff', lw);
      g.restore();
      limb(g, [0, -0.7, 0.55, -0.7, hx + Math.cos(a) * 0.9, hy + Math.sin(a) * 0.9], 0.24, shroud, lw);
      ell(g, hx + Math.cos(a) * 0.9, hy + Math.sin(a) * 0.9, 0.14, 0.14); F(g, '#efe6ff', lw);
      ell(g, -0.05, 0, 0.6, 0.84); F(g, vol(g, -0.05, 0, 0.84, lite(shroud, 0.12)), lw);
      g.beginPath(); g.arc(-0.05, 0, 0.52, PI * 0.6, PI * 1.4); S(g, col, 0.07);
      hood(g, 0.12, 0.52, -0.9, fl * 2.5, vol(g, 0, 0, 0.85, lite(shroud, 0.2)), lw);
      g.beginPath(); g.arc(0.12, 0, 0.52, -PI * 0.6, PI * 0.6); S(g, col, 0.06);
      g.beginPath(); g.arc(0.14, 0, 0.37, -1.05, 1.05); g.closePath(); F(g, '#0a0514');
      eyes(g, 0.36, 0.14, 0.06, pale);
    },
  };

  /* ------------------------------------------------------------------ minions (o: ph walk phase 0..1, sw swing 0..1, lw) */
  const MINION = {
    skeleton(g, o) {
      const { ph, sw, lw } = o, bone = '#ece6d6', bdk = '#a79d8c', wk = Math.sin(ph * TAU);
      for (const s of [-1, 1]) { ell(g, s * wk * 0.36, s * 0.34, 0.26, 0.15); F(g, bdk, lw); }
      const a = -0.9 + sw * 1.8, hx = Math.cos(a) * 0.9, hy = Math.sin(a) * 0.9;
      limb(g, [0, 0.62, hx, hy], 0.13, bone, lw);
      g.save(); g.translate(hx, hy); g.rotate(a);
      sword(g, 1.5, 0.13, '#cfc8b4', '#8a6a4a', '#5a4a3a', lw);
      g.restore();
      limb(g, [0, -0.62, 0.5, -0.86, 0.8, -0.56], 0.13, bone, lw);
      // rib cage
      ell(g, -0.12, 0, 0.46, 0.72); F(g, vol(g, -0.12, 0, 0.72, bdk), lw);
      g.beginPath(); g.moveTo(-0.5, 0); g.lineTo(0.2, 0);
      for (const c of [-0.3, 0, 0.3]) { g.moveTo(-0.12 + c, -0.5); g.lineTo(-0.12 + c, 0.5); }
      S(g, bone, 0.09);
      for (const s of [-1, 1]) { ell(g, -0.05, s * 0.66, 0.2, 0.18); F(g, bone, lw); }
      ell(g, 0.22, 0, 0.54, 0.5); F(g, vol(g, 0.22, 0, 0.54, bone), lw);
      for (const s of [-1, 1]) { ell(g, 0.44, s * 0.19, 0.15, 0.13, s * 0.3); F(g, '#1d0f2e'); }
      eyes(g, 0.46, 0.19, 0.055, '#c06bff');
      g.beginPath(); for (const c of [-0.12, 0, 0.12]) { g.moveTo(0.66, c); g.lineTo(0.74, c); } S(g, '#1d0f2e', 0.035);
    },
    knight(g, o) {
      const { ph, sw, lw } = o, arm = '#3b2a5c', trim = '#c06bff', wk = Math.sin(ph * TAU), fl = Math.cos(ph * TAU) * 0.07;
      g.beginPath(); g.moveTo(-0.2, -0.68); g.quadraticCurveTo(-1.0, -0.8, -1.5, -0.5 + fl);
      g.lineTo(-1.22, -0.16 + fl); g.lineTo(-1.6, 0.1 - fl); g.lineTo(-1.22, 0.34 - fl); g.lineTo(-1.46, 0.6 - fl);
      g.quadraticCurveTo(-1.0, 0.8, -0.2, 0.68); g.closePath(); F(g, '#1f1233', lw);
      for (const s of [-1, 1]) { ell(g, s * wk * 0.36, s * 0.36, 0.3, 0.18); F(g, '#1f1233', lw); }
      const a = -0.9 + sw * 1.8, hx = Math.cos(a) * 0.88, hy = Math.sin(a) * 0.88;
      limb(g, [0, 0.7, hx, hy], 0.26, arm, lw);
      g.save(); g.translate(hx, hy); g.rotate(a);
      sword(g, 2.0, 0.17, '#e3b8ff', trim, '#1f1233', lw);
      g.beginPath(); g.moveTo(0.6, 0); g.lineTo(1.6, 0); glowLine(g, trim, 0.025);
      g.restore();
      limb(g, [0, -0.7, 0.5, -0.86, 0.82, -0.52], 0.26, arm, lw);
      ell(g, -0.05, 0, 0.58, 0.84); F(g, vol(g, -0.05, 0, 0.84, arm), lw);
      for (const s of [-1, 1]) {
        spike(g, -0.05, s * 1.0, s * PI / 2, 0.3, 0.09, lite(arm, 0.3), lw * 0.7);
        ell(g, -0.05, s * 0.76, 0.4, 0.32); F(g, vol(g, -0.05, s * 0.76, 0.4, lite(arm, 0.12)), lw);
        g.beginPath(); g.ellipse(-0.05, s * 0.76, 0.24, 0.18, 0, 0, TAU); S(g, trim, 0.06);
      }
      for (const s of [-1, 1]) horn(g, 0.1, s * 0.34, 0.3, s * 0.86, 0.82, s * 0.7, 0.1, '#e3b8ff', lw * 0.8);
      ell(g, 0.14, 0, 0.46, 0.44); F(g, vol(g, 0.14, 0, 0.46, lite(arm, 0.14)), lw);
      g.beginPath(); g.arc(0.14, 0, 0.32, -0.7, 0.7); S(g, INK, 0.14);
      g.beginPath(); g.arc(0.14, 0, 0.32, -0.5, 0.5); glowLine(g, '#ff6bd6', 0.04);
    },
    /** an arcane eye; unit space is 8 world units */
    familiar(g, o) {
      const { ph, lw } = o;
      // spirit flame trailing behind
      for (let i = 0; i < 3; i++) { const k = 1 - i * 0.28, x = -0.7 - i * 0.62, y = Math.sin(ph * TAU + i * 1.2) * 0.22; ell(g, x, y, 0.5 * k, 0.4 * k); F(g, rgba('#c06bff', 0.5 * k)); }
      // crystal shards in orbit
      for (let i = 0; i < 3; i++) {
        const q = (ph * TAU) / 3 + (i * TAU) / 3, x = Math.cos(q) * 1.75, y = Math.sin(q) * 1.75;
        g.save(); g.translate(x, y); g.rotate(q);
        poly(g, [0.34, 0, 0, 0.17, -0.34, 0, 0, -0.17]); F(g, '#e3b8ff', lw);
        g.restore();
      }
      ell(g, 0, 0, 1, 1); F(g, vol(g, 0, 0, 1, '#f3e6ff'), lw);
      ell(g, 0.34, 0, 0.56, 0.56); F(g, vol(g, 0.34, 0, 0.56, '#8a3fe6'), lw * 0.7);
      ell(g, 0.44, 0, 0.14, 0.4); F(g, '#12061f');
      ell(g, 0.2, -0.26, 0.14, 0.1); F(g, rgba(WHITE, 0.8));
    },
  };

  /* ------------------------------------------------------------------ public */
  const M = {
    ART, RATE,
    /** horde frames per walk cycle */
    FRAMES: 8,
    /** ink width in unit space for a model of radius r world units */
    ink(r) { return Math.min(3, Math.max(1.3, r * 0.11)) / r; },
    /** tint everything drawn until cleared: k 0..1 toward a #rrggbb colour */
    tint(col, k) { tintCol = k > 0 ? col : null; tintK = k; },
    /** draw one horde or boss model; the context is already scaled so 1 is its radius */
    enemy(g, key, ph, col, lw, st) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      ART[key](g, ph, col, lw, st);
    },
    /** draws the hero and returns the lights it carries, in the hero's unit space */
    hero(g, p, t, lw) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      const lights = [];
      HERO[p.cls.id](g, { t, wk: p.moving ? Math.sin(p.walk) : 0, sw: p.swing, col: p.cls.color, acc: p.cls.accent, lw,
        glow(gg, x, y, r, col, a) { if (!tintCol) lights.push({ x, y, r, col, a }); } });
      return lights;
    },
    /** the hero's outline for dash afterimages; context already placed, turned and scaled */
    heroGhost(g) {
      g.beginPath(); g.moveTo(-0.2, -0.7); g.quadraticCurveTo(-1.2, -0.7, -1.6, 0); g.quadraticCurveTo(-1.2, 0.7, -0.2, 0.7); g.closePath();
      g.moveTo(0.57, 0); g.ellipse(-0.05, 0, 0.62, 0.9, 0, 0, TAU);
      g.fill();
    },
    /** kind: skeleton, knight or familiar (whose unit is 8 world units) */
    minion(g, kind, ph, swing, lw) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      MINION[kind](g, { ph, sw: swing, lw });
    },
  };
  PS.Models = M;
})();
