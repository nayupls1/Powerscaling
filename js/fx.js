/* POWERSCALING — visual effects: particles, damage numbers, bolts, rings, slashes, screen shake */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, TAU = U.TAU;
  const MAX_PARTS = 900, MAX_NUMS = 90;
  // kill procs can fire 20 rings or blasts a frame; past this many on screen more of them only cost frame time
  const MAX_RINGS = 70, MAX_BOOMS = 60;
  const EL_COL = { fire: '#ffb061', frost: '#9fe6ff', storm: '#ffe14d', venom: '#b8f078', steel: '#f4f6ff', void: '#dba6ff' };

  let parts = [], nums = [], bolts = [], rings = [], slashes = [], ghosts = [], booms = [];
  let budget = 0; // per-frame particle allowance so mass deaths don't flood
  let cap = MAX_PARTS;

  function part(x, y, vx, vy, life, size, color, drag, grav) {
    if (parts.length >= cap || budget <= 0) return;
    budget--;
    parts.push({ x, y, vx, vy, life, max: life, size, color, drag: drag === undefined ? 3 : drag, grav: grav || 0 });
  }
  function burst(x, y, n, color, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = speed * (0.3 + Math.random() * 0.7);
      part(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.5 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.8), color);
    }
  }

  const FX = {
    reset() { parts = []; nums = []; bolts = []; rings = []; slashes = []; ghosts = []; booms = []; },
    counts() { return { parts: parts.length, nums: nums.length }; },

    update(dt) {
      // fewer particles once the renderer has had to trade away resolution
      const det = PS.Render.detail();
      budget = Math.round(140 * det);
      cap = Math.round(MAX_PARTS * det);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vy *= k;
        p.vy += p.grav * dt;
      }
      for (let i = nums.length - 1; i >= 0; i--) {
        const n = nums[i];
        n.life -= dt;
        if (n.life <= 0) { nums.splice(i, 1); continue; }
        n.y += n.vy * dt;
        n.x += n.vx * dt;
        n.vy += 90 * dt;
      }
      const decay = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          arr[i].life -= dt;
          if (arr[i].life <= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
        }
      };
      decay(bolts); decay(rings); decay(slashes); decay(ghosts); decay(booms);
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
        x: x + U.rand(-10, 10), y: y + U.rand(-6, 6), vx: U.rand(-18, 18), vy: dot ? -45 : -95, text: crit ? txt + '!' : txt,
        color: crit ? '#fff06b' : (EL_COL[el] || '#ffffff'), life: dot ? 0.5 : crit ? 0.85 : 0.6, max: dot ? 0.5 : crit ? 0.85 : 0.6,
        size: dot ? 12 : crit ? 20 : 15, crit,
      });
    },
    text(x, y, text, color) {
      nums.push({ x, y, vx: 0, vy: -70, text, color: color || '#fff', life: 1, max: 1, size: 15, crit: false, label: true });
    },
    spark(x, y, color) { part(x, y, U.rand(-30, 30), U.rand(-30, 30), 0.3, 3, color, 2); },
    hitSpark(x, y, color) { burst(x, y, 3, color, 160, 0.22, 3); },
    puff(x, y, color, n) { burst(x, y, n, color, 120, 0.5, 5); },
    death(e) {
      const n = e.boss ? 0 : e.elite ? 16 : 5;
      burst(e.x, e.y, n, e.def.color, e.elite ? 260 : 170, 0.45, e.elite ? 6 : 4);
      if (n) part(e.x, e.y, 0, 0, 0.18, e.r * 1.6, '#ffffff', 0);
      if (e.elite) FX.ring(e.x, e.y, e.r * 3, e.def.color, 0.35);
    },
    bossDeath(e) {
      budget += 300;
      burst(e.x, e.y, 120, e.def.color, 520, 1.2, 8);
      burst(e.x, e.y, 60, '#ffffff', 380, 0.9, 5);
      for (let i = 0; i < 4; i++) rings.push({ x: e.x, y: e.y, r: 200 + i * 130, life: 0.5 + i * 0.15, max: 0.5 + i * 0.15, color: e.def.color, w: 8 });
      booms.push({ x: e.x, y: e.y, r: 320, life: 0.6, max: 0.6, color: e.def.color, big: true });
    },
    explosion(x, y, r, color, big) {
      if (booms.length >= (big ? MAX_BOOMS * 1.5 : MAX_BOOMS)) { burst(x, y, 3, color, r * 3.2, 0.4, 4); return; }
      booms.push({ x, y, r, life: big ? 0.42 : 0.28, max: big ? 0.42 : 0.28, color, big: !!big });
      burst(x, y, big ? 18 : 6, color, r * 3.2, 0.4, big ? 6 : 4);
    },
    ring(x, y, r, color, dur) {
      if (rings.length >= MAX_RINGS) return;
      rings.push({ x, y, r, life: dur || 0.3, max: dur || 0.3, color, w: 4 });
    },
    shatter(x, y, color) { burst(x, y, 7, color, 240, 0.4, 4); if (rings.length < MAX_RINGS) rings.push({ x, y, r: 70, life: 0.22, max: 0.22, color, w: 3 }); },
    frostBurst(x, y, r) {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU, sp = r * 2.6;
        part(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4, 5, i % 2 ? '#bdf0ff' : '#ffffff', 2.5);
      }
    },
    spikes(x, y, r, color) {
      booms.push({ x, y, r, life: 0.3, max: 0.3, color, spike: true, rot: Math.random() * TAU });
      for (let i = 0; i < 3; i++) part(x + U.rand(-r, r) * 0.5, y, U.rand(-40, 40), U.rand(-200, -80), 0.4, 4, color, 1, 500);
    },
    bolt(x1, y1, x2, y2, color, w) {
      if (bolts.length > 90) return;
      const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
      const segs = Math.max(2, Math.min(9, Math.round(d / 36)));
      const nx = -dy / d, ny = dx / d;
      const pts = [x1, y1];
      for (let i = 1; i < segs; i++) {
        const t = i / segs, off = U.rand(-1, 1) * Math.min(18, d * 0.12);
        pts.push(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
      }
      pts.push(x2, y2);
      bolts.push({ pts, life: 0.16, max: 0.16, color, w: w || 2 });
      part(x2, y2, 0, 0, 0.12, 12, color, 0);
    },
    slash(x, y, ang, range, half, color) {
      slashes.push({ x, y, ang, range, half, life: 0.18, max: 0.18, color });
    },
    whirl(x, y, r) {
      slashes.push({ x, y, ang: PS.G.time * 14, range: r, half: 1.5, life: 0.2, max: 0.2, color: '#e8eeff' });
    },
    dashBurst(x, y, ang, color) {
      for (let i = 0; i < 8; i++) {
        const a = ang + Math.PI + U.rand(-0.6, 0.6);
        part(x, y, Math.cos(a) * U.rand(80, 260), Math.sin(a) * U.rand(80, 260), 0.35, 4, color, 3);
      }
    },
    ghost(p) {
      if (ghosts.length && ghosts[ghosts.length - 1].t === PS.G.frame) return;
      if (PS.G.frame % 2) return;
      ghosts.push({ x: p.x, y: p.y, aim: p.aim, face: p.face, life: 0.25, max: 0.25, color: p.cls.color, t: PS.G.frame });
    },
    hurt(p) {
      budget += 20;
      burst(p.x, p.y, 12, '#ff4d6d', 260, 0.45, 5);
    },
    levelUp(p) {
      budget += 60;
      rings.push({ x: p.x, y: p.y, r: 220, life: 0.5, max: 0.5, color: '#ffe9a8', w: 6 });
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        part(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20, Math.cos(a) * 60, -U.rand(120, 300), 0.8, 4, i % 2 ? '#ffe9a8' : '#ffffff', 1.5);
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

    /* ------------------------------------------------------------ drawing (world space) */
    drawGhosts(ctx) {
      for (const g of ghosts) {
        ctx.globalAlpha = (g.life / g.max) * 0.45;
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.arc(g.x, g.y, 14, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    draw(ctx, view) {
      ctx.globalCompositeOperation = 'lighter';
      // explosions
      for (const b of booms) {
        const t = 1 - b.life / b.max;
        if (b.spike) {
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = b.color;
          for (let i = 0; i < 5; i++) {
            const a = b.rot + (i * TAU) / 5, d = b.r * 0.45, h = b.r * (0.9 - t * 0.3), w = b.r * 0.22;
            const cx = b.x + Math.cos(a) * d * (i ? 1 : 0), cy = b.y + Math.sin(a) * d * 0.5 * (i ? 1 : 0);
            ctx.beginPath();
            ctx.moveTo(cx - w, cy + 4);
            ctx.lineTo(cx + (i % 2 ? 4 : -4), cy - h);
            ctx.lineTo(cx + w, cy + 4);
            ctx.fill();
          }
          continue;
        }
        const r = b.r * (0.35 + 0.65 * U.easeOutCubic(t));
        ctx.globalAlpha = (1 - t) * (b.big ? 0.3 : 0.2);
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
        ctx.globalAlpha = (1 - t) * 0.7;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = (b.big ? 4 : 2.5) * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.stroke();
      }
      // rings
      for (const r of rings) {
        const t = 1 - r.life / r.max;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.w * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r * U.easeOutCubic(t), 0, TAU); ctx.stroke();
      }
      // slashes
      for (const s of slashes) {
        const t = 1 - s.life / s.max;
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.fillStyle = s.color;
        const a0 = s.ang - s.half, a1 = s.ang - s.half + s.half * 2 * Math.min(1, t * 2.2 + 0.35);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.range, a0, a1);
        ctx.arc(s.x, s.y, s.range * (0.62 + t * 0.25), a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      // bolts
      ctx.lineJoin = 'round';
      for (const b of bolts) {
        const a = b.life / b.max;
        const pts = b.pts;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.w * 4;
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = b.w;
        ctx.stroke();
      }
      // particles
      const x0 = view.x0 - 20, x1 = view.x1 + 20, y0 = view.y0 - 20, y1 = view.y1 + 20;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        const a = p.life / p.max;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        const s = p.size * (0.4 + 0.6 * a);
        ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
      }
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
