/* POWERSCALING — autoplayer used for automated playtests and balance runs (enable with ?bot=1 or PS.Game.start(cls, {bot:{}})) */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U;

  const PRIORITY = { evolve: 100, talent: 90, relic: 50, boon: 50, skill: 40, skillup: 34, tome: 28, over: 12, heal: 2, gold: 1 };

  const Bot = {
    /** writes movement/aim/dash/ability decisions into G.ctrl */
    drive(G) {
      const p = G.player, c = G.ctrl, cfg = G.bot;
      if (cfg.sloppy) {
        // a distracted human: slow to react, sometimes blind to danger, drifts a little
        c.dash = false; c.ability = false;
        if (G.time < (cfg.until || 0)) return;
        cfg.until = G.time + 0.22 + Math.random() * 0.25;
        cfg.blind = Math.random() < 0.45;
      }
      let fx = 0, fy = 0;
      let nearest = null, nd = 1e9, close = 0;

      // repel from enemies, weighted by proximity and size
      G.grid.query(p.x, p.y, 260, (e) => {
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
        const gap = Math.max(8, d - e.r - p.r);
        const w = (e.boss ? 5 : e.elite ? 2.5 : 1) * 1800 / (gap * gap);
        fx += (dx / d) * w; fy += (dy / d) * w;
        if (gap < 70) close++;
        if (d < nd) { nd = d; nearest = e; }
      });
      if (!nearest) nearest = PS.Combat.nearest(p.x, p.y, 700);

      // dodge bullets and telegraphs
      let danger = false;
      const blind = cfg.sloppy && cfg.blind;
      for (const b of blind ? [] : G.eprojs) {
        const dx = p.x - b.x, dy = p.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > 170 * 170) continue;
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const along = (dx * b.vx + dy * b.vy) / sp;
        if (along < 0) continue; // moving away
        const px = dx - (b.vx / sp) * along, py = dy - (b.vy / sp) * along;
        const miss = Math.hypot(px, py);
        if (miss < 34) {
          const side = miss > 0.5 ? 1 / miss : 1;
          fx += (miss > 0.5 ? px * side : -b.vy / sp) * 3.2;
          fy += (miss > 0.5 ? py * side : b.vx / sp) * 3.2;
          if (along < 60) danger = true;
        }
      }
      for (const h of blind ? [] : G.hazards) {
        if (h.kind === 'circle') {
          const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy) || 1;
          if (d < h.r + 40) { const w = 6 * (1 + h.t / h.delay); fx += (dx / d) * w; fy += (dy / d) * w; if (h.t > h.delay - 0.25) danger = true; }
        } else if (h.kind === 'beam' && !h.harmless || h.kind === 'beam' && h.harmless) {
          const x2 = h.x + Math.cos(h.ang) * h.len, y2 = h.y + Math.sin(h.ang) * h.len;
          if (U.segCircle(h.x, h.y, x2, y2, p.x, p.y, h.w * 0.5 + 60)) {
            const nx = -Math.sin(h.ang), ny = Math.cos(h.ang);
            const side = (p.x - h.x) * nx + (p.y - h.y) * ny >= 0 ? 1 : -1;
            fx += nx * side * 7; fy += ny * side * 7;
            if (h.t > h.delay - 0.2) danger = true;
          }
        } else if (h.kind === 'ring') {
          const d = Math.hypot(p.x - h.x, p.y - h.y);
          if (Math.abs(d - h.rad) < 60 && d > h.rad) danger = true;
        }
      }

      // attraction: pickups, chests, shrines — only when not crowded
      const calm = close < 3;
      let goal = null, gd = 1e9;
      const consider = (x, y, bonus) => {
        const d = Math.hypot(x - p.x, y - p.y) - bonus;
        if (d < gd) { gd = d; goal = { x, y }; }
      };
      if (calm) {
        let n = 0;
        for (const k of G.pickups) {
          if (k.pull) continue;
          if (k.kind === 'xp') { if (++n % 3 === 0) consider(k.x, k.y, 0); }
          else if (k.kind === 'heal') consider(k.x, k.y, p.hp < p.stats.maxHp * 0.6 ? 500 : -200);
          else consider(k.x, k.y, 350);
        }
        for (const pr of G.props) {
          if (pr.dead) continue;
          if (pr.kind === 'chest' && p.gold >= PS.Director.chestPrice()) consider(pr.x, pr.y, 300);
          if (pr.kind === 'shrine') consider(pr.x, pr.y, 200);
        }
      }
      if (goal) {
        const dx = goal.x - p.x, dy = goal.y - p.y, d = Math.hypot(dx, dy) || 1;
        const w = calm ? 2.2 : 0.6;
        fx += (dx / d) * w; fy += (dy / d) * w;
      } else if (nearest) {
        // nothing to grab: keep fighting distance, with a strafe so we don't run in a straight line
        const dx = nearest.x - p.x, dy = nearest.y - p.y, d = Math.hypot(dx, dy) || 1;
        const want = cfg.range || (p.cls.id === 'vanguard' ? 70 : 190);
        const w = d > want ? 1.2 : -0.6;
        fx += (dx / d) * w - (dy / d) * 0.5; fy += (dy / d) * w + (dx / d) * 0.5;
      }

      const l = Math.hypot(fx, fy);
      // smooth to avoid jitter
      const tx = l > 0.05 ? fx / l : 0, ty = l > 0.05 ? fy / l : 0;
      Bot.sx = (Bot.sx || 0) * 0.7 + tx * 0.3;
      Bot.sy = (Bot.sy || 0) * 0.7 + ty * 0.3;
      const sl = Math.hypot(Bot.sx, Bot.sy);
      c.mx = sl > 0.2 ? Bot.sx / sl : 0;
      c.my = sl > 0.2 ? Bot.sy / sl : 0;

      c.autoAim = true;
      c.fire = true;
      if (cfg.sloppy) {
        const a = Math.random() * 6.283, n = 0.35;
        c.mx += Math.cos(a) * n; c.my += Math.sin(a) * n;
        const m = Math.hypot(c.mx, c.my) || 1;
        c.mx /= m; c.my /= m;
        c.dash = ((danger && Math.random() < 0.5) || (close >= 4 && Math.random() < 0.5)) && p.dashCharges > 0;
        c.ability = p.abilityCd <= 0 && (close >= 2 || !!G.boss) && Math.random() < 0.6;
        return;
      }
      c.dash = (danger || close >= 5 || (p.hp < p.stats.maxHp * 0.35 && close >= 2)) && p.dashCharges > 0 && !cfg.noDash;
      c.ability = p.abilityCd <= 0 && (close >= 3 || !!G.boss || G.enemies.length > 25);
    },

    /** choose a card index for a reward spec */
    pick(spec, G) {
      const p = G.player, cfg = G.bot || {};
      if (cfg.random || (cfg.sloppy && Math.random() < 0.3)) return (Math.random() * spec.cards.length) | 0;
      let best = 0, bs = -1e9;
      spec.cards.forEach((card, i) => {
        let s = PRIORITY[card.type] || 0;
        s += card.tier * 3;
        if (card.type === 'skill' && card.el && cfg.element === card.el) s += 30;
        if (card.type === 'skill' && card.el && p.aff[card.el] > 0) s += 6;
        if (card.type === 'tome') {
          if (['might', 'haste', 'multishot'].includes(card.id)) s += 6;
          if (card.lines.some((t) => t.startsWith('Evolves'))) s += 10;
          if (p.hp < p.stats.maxHp * 0.5 && (card.id === 'vitality' || card.id === 'plating')) s += 8;
        }
        if (card.type === 'talent' && cfg.branch === card.id) s += 20;
        if (card.type === 'heal' && p.hp < p.stats.maxHp * 0.4) s += 40;
        s += Math.random() * 4;
        if (s > bs) { bs = s; best = i; }
      });
      return best;
    },
  };

  PS.Bot = Bot;
})();
