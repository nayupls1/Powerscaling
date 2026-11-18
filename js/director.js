/* POWERSCALING — run director: difficulty curves, spawning, hordes, elites, drops, pickups, chests and shrines */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, TAU = U.TAU;

  const MAX_ENEMIES = 300;
  const MAX_GEMS = 340;
  const BOSS_TIMES = [180, 360, 540, 720];
  const FINAL_TIME = 720;
  const ENDLESS_BOSS_EVERY = 120;

  // from: minute the type first appears, w: weight once established
  const TABLE = [
    { id: 'imp',     from: 0,   w: (t) => Math.max(2.5, 10 - t * 0.7) },
    { id: 'bat',     from: 1,   w: () => 4 },
    { id: 'spitter', from: 2,   w: () => 1.8 },
    { id: 'slime',   from: 2.6, w: () => 2.4 },
    { id: 'hound',   from: 3.5, w: () => 2.4 },
    { id: 'brute',   from: 4.5, w: () => 1.5 },
    { id: 'bloater', from: 5.5, w: () => 1.6 },
    { id: 'wraith',  from: 6.5, w: () => 2.3 },
    { id: 'hexer',   from: 7.5, w: () => 1.4 },
    { id: 'knight',  from: 8.5, w: (t) => 2 + Math.min(3, (t - 8.5) * 0.5) },
  ];

  const Dr = {
    BOSS_TIMES, FINAL_TIME,
    reset() {
      this.spawnAcc = 0;
      this.eliteT = 55;
      this.hordeT = 75;
      this.hordeN = 0;
      this.bossIdx = 0;
      this.endlessBossT = 0;
      this.chestT = 6;
      this.shrineT = 40;
      this.chestCost = 25;
      this.chestsOpened = 0;
      this.victory = false;
    },
    minutes() { return PS.G.time / 60; },
    endless() { return Math.max(0, PS.G.time - FINAL_TIME) / 60; },
    hpMult() {
      const t = Math.min(this.minutes(), 12), o = this.endless();
      return (1 + 0.24 * t + 0.05 * t * t) * Math.pow(1.3, o);
    },
    dmgMult() {
      const t = Math.min(this.minutes(), 12), o = this.endless();
      return (1 + 0.075 * t) * (1 + 0.14 * o);
    },
    speedMult() { return Math.min(1.3, 1 + this.minutes() * 0.012); },
    xpMult() { return 1 + this.endless() * 0.25; },
    targetCount() {
      const t = this.minutes();
      return Math.min(MAX_ENEMIES, 24 + 20 * t + 1.1 * t * t);
    },
    spawnRate() {
      const t = this.minutes();
      return 3.5 + 3.1 * t + Math.max(0, t - 12) * 3;
    },

    /** a point just off-screen around the player */
    ringPos(extra) {
      const G = PS.G, p = G.player;
      const a = Math.random() * TAU;
      const rx = G.viewW * 0.5 + 70 + (extra || 0), ry = G.viewH * 0.5 + 70 + (extra || 0);
      // rectangle-ish ring so spawns hug the screen edge on wide displays
      const c = Math.cos(a), s = Math.sin(a);
      const k = 1 / Math.max(Math.abs(c) / rx, Math.abs(s) / ry);
      return { x: p.x + c * k, y: p.y + s * k };
    },
    pickType() {
      const t = this.minutes();
      let total = 0;
      const ws = [];
      for (const row of TABLE) {
        let w = 0;
        if (t >= row.from) w = row.w(t) * U.clamp((t - row.from) / 0.8, 0.2, 1);
        ws.push(w);
        total += w;
      }
      let r = Math.random() * total;
      for (let i = 0; i < ws.length; i++) {
        r -= ws[i];
        if (r <= 0) return TABLE[i].id;
      }
      return 'imp';
    },

    update(dt) {
      const G = PS.G, p = G.player;
      const bossAlive = !!G.boss;

      // ---- bosses
      if (this.bossIdx < BOSS_TIMES.length) {
        if (G.time >= BOSS_TIMES[this.bossIdx] && !bossAlive) {
          PS.Bosses.spawn(this.bossIdx, 0);
          this.bossIdx++;
        }
      } else if (this.victory) {
        this.endlessBossT += dt;
        if (this.endlessBossT >= ENDLESS_BOSS_EVERY && !bossAlive) {
          this.endlessBossT = 0;
          const n = this.bossIdx - BOSS_TIMES.length;
          PS.Bosses.spawn(n % 4, n + 1);
          this.bossIdx++;
        }
      }

      // ---- trickle spawns toward the target population
      const target = this.targetCount() * (bossAlive ? 0.55 : 1);
      this.spawnAcc += this.spawnRate() * dt * (bossAlive ? 0.6 : 1);
      if (this.spawnAcc > 20) this.spawnAcc = 20;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (G.enemies.length >= target) { this.spawnAcc = 0; break; }
        const pos = this.ringPos();
        PS.Enemies.spawn(this.pickType(), pos.x, pos.y);
      }

      // ---- elites
      this.eliteT -= dt;
      if (this.eliteT <= 0 && !bossAlive) {
        this.eliteT = Math.max(32, 58 - this.minutes() * 1.5);
        const pos = this.ringPos();
        const pool = ['imp', 'slime', 'hound', 'brute', 'knight', 'wraith'].filter((id) => {
          const row = TABLE.find((r) => r.id === id);
          return this.minutes() >= row.from;
        });
        PS.Enemies.spawn(U.pick(pool), pos.x, pos.y, { elite: true });
        PS.UI.toast('An elite has entered the rift', 'skull');
      }

      // ---- hordes
      this.hordeT -= dt;
      if (this.hordeT <= 0 && !bossAlive) {
        this.hordeT = 80;
        this.horde(this.hordeN++);
      }

      // ---- chests and shrines on the map
      this.chestT -= dt;
      if (this.chestT <= 0) {
        this.chestT = 4;
        let near = 0;
        for (const pr of G.props) {
          if (pr.kind === 'chest') {
            if (U.dist2(pr.x, pr.y, p.x, p.y) < 1500 * 1500) near++;
            else pr.dead = true; // left far behind
          } else if (pr.kind === 'shrine' && U.dist2(pr.x, pr.y, p.x, p.y) > 2400 * 2400) pr.dead = true;
        }
        if (near < 2) {
          const a = Math.random() * TAU, d = U.rand(520, 860);
          G.props.push({ kind: 'chest', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 26, dead: false, t: 0, bob: Math.random() * 6 });
        }
        U.compact(G.props);
      }
      this.shrineT -= dt;
      if (this.shrineT <= 0) {
        this.shrineT = 75;
        if (G.props.filter((x) => x.kind === 'shrine').length < 2) {
          const a = Math.random() * TAU, d = U.rand(560, 820);
          G.props.push({ kind: 'shrine', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 70, dead: false, t: 0, charge: 0, bob: 0 });
          PS.UI.toast('A shrine has appeared', 'spark');
        }
      }
      this.updateProps(dt);
      this.updatePickups(dt);
    },

    horde(n) {
      const G = PS.G, p = G.player, t = this.minutes();
      if (n % 2 === 0) {
        // closing ring
        const count = Math.min(60, Math.round(22 + t * 4));
        const type = t > 4 && Math.random() < 0.4 ? 'slimelet' : 'bat';
        const rad = Math.max(G.viewW, G.viewH) * 0.5 + 60;
        for (let i = 0; i < count; i++) {
          const a = (i * TAU) / count;
          PS.Enemies.spawn(type, p.x + Math.cos(a) * rad, p.y + Math.sin(a) * rad, { hpMult: 1.3 });
        }
        PS.UI.toast('The swarm closes in', 'ghost');
      } else {
        // stampede from one side
        const count = Math.min(50, Math.round(16 + t * 3.5));
        const a = Math.random() * TAU, type = t > 3.5 ? 'hound' : 'imp';
        const rad = Math.max(G.viewW, G.viewH) * 0.5 + 80;
        const cx = p.x + Math.cos(a) * rad, cy = p.y + Math.sin(a) * rad;
        for (let i = 0; i < count; i++) {
          const off = (i - count / 2) * 26;
          PS.Enemies.spawn(type, cx - Math.sin(a) * off + U.rand(-30, 30), cy + Math.cos(a) * off + U.rand(-30, 30), { hpMult: 1.2 });
        }
        PS.UI.toast('A stampede approaches', 'paw');
      }
      PS.Audio.play('bossWarn', { vol: 0.35, pitch: 1.3 });
    },

    /* ------------------------------------------------------------ drops */
    drops(e) {
      const G = PS.G, p = G.player, s = p.stats;
      this.gem(e.x, e.y, e.xp);
      const t = this.minutes();
      if (e.boss) {
        for (let i = 0; i < 14; i++) this.gem(e.x + U.rand(-70, 70), e.y + U.rand(-70, 70), e.xp / 14);
        for (let i = 0; i < 8; i++) this.pickup('gold', e.x + U.rand(-60, 60), e.y + U.rand(-60, 60), Math.round((12 + t * 2) * s.gold));
        this.pickup('bosschest', e.x, e.y, 0);
        this.pickup('heal', e.x + 40, e.y + 20, 0);
        return;
      }
      if (e.elite) {
        for (let i = 0; i < 4; i++) this.pickup('gold', e.x + U.rand(-30, 30), e.y + U.rand(-30, 30), Math.round((5 + t) * s.gold));
        this.pickup('chest', e.x, e.y, 0);
        if (Math.random() < 0.35) this.pickup('heal', e.x + 24, e.y, 0);
        return;
      }
      const r = Math.random();
      if (r < 0.085) this.pickup('gold', e.x, e.y, Math.max(1, Math.round((1 + Math.random() * 2 + t * 0.3) * s.gold)));
      else if (r < 0.091) this.pickup('heal', e.x, e.y, 0);
      else if (r < 0.0925) this.pickup('magnet', e.x, e.y, 0);
      else if (r < 0.0937) this.pickup('bomb', e.x, e.y, 0);
    },
    gem(x, y, val) {
      const G = PS.G;
      if (G.gemCount >= MAX_GEMS) {
        // fold the value into an existing gem so nothing is lost
        for (let k = 0; k < 6; k++) {
          const g = G.pickups[(Math.random() * G.pickups.length) | 0];
          if (g && g.kind === 'xp' && !g.dead) { g.val += val; return; }
        }
      }
      G.gemCount++;
      G.pickups.push({ kind: 'xp', x: x + U.rand(-6, 6), y: y + U.rand(-6, 6), val, r: 6, vx: U.rand(-40, 40), vy: U.rand(-40, 40), pull: false, dead: false, age: 0 });
    },
    pickup(kind, x, y, val) {
      const a = Math.random() * TAU, sp = U.rand(40, 120);
      PS.G.pickups.push({ kind, x, y, val, r: kind === 'chest' || kind === 'bosschest' ? 20 : 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, pull: false, dead: false, age: 0 });
    },
    updatePickups(dt) {
      const G = PS.G, p = G.player, s = p.stats, list = G.pickups;
      const range2 = s.pickup * s.pickup;
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        k.age += dt;
        if (k.vx || k.vy) {
          k.x += k.vx * dt; k.y += k.vy * dt;
          const f = Math.max(0, 1 - 6 * dt);
          k.vx *= f; k.vy *= f;
          if (Math.abs(k.vx) < 1 && Math.abs(k.vy) < 1) { k.vx = 0; k.vy = 0; }
        }
        const dx = p.x - k.x, dy = p.y - k.y, d2 = dx * dx + dy * dy;
        const chest = k.kind === 'chest' || k.kind === 'bosschest';
        if (!k.pull && !chest && d2 < range2 && k.age > 0.15) k.pull = true;
        if (k.pull) {
          const d = Math.sqrt(d2) || 1;
          const sp = Math.max(420, s.speed * 1.9) + k.age * 120;
          k.x += (dx / d) * sp * dt;
          k.y += (dy / d) * sp * dt;
        }
        const cr = chest ? 34 : 20;
        if (d2 < cr * cr && k.age > 0.2) {
          k.dead = true;
          this.collect(k);
        }
      }
      U.compact(list);
    },
    collect(k) {
      const G = PS.G, p = G.player;
      switch (k.kind) {
        case 'xp':
          G.gemCount--;
          p.addXp(k.val);
          p.gemCombo = Math.min(24, p.gemCombo + 1);
          p.gemComboT = 0.6;
          PS.Audio.play('gem', { vol: 0.3, pitch: 1 + p.gemCombo * 0.03 });
          break;
        case 'gold':
          p.gold += k.val;
          G.goldEarned += k.val;
          PS.FX.text(p.x, p.y - 34, '+' + k.val, '#ffd35c');
          PS.Audio.play('gold', { vol: 0.4 });
          break;
        case 'heal':
          p.heal(p.stats.maxHp * 0.3);
          PS.Audio.play('heal');
          break;
        case 'magnet':
          for (const o of G.pickups) if (o.kind === 'xp' || o.kind === 'gold') o.pull = true;
          PS.Audio.play('magnet');
          PS.FX.ring(p.x, p.y, 400, '#8ad1ff', 0.5);
          break;
        case 'bomb':
          PS.FX.flash('#ffffff', 0.5);
          PS.FX.shake(10);
          PS.Audio.play('bomb');
          for (const e of G.enemies.slice()) {
            if (U.dist2(e.x, e.y, p.x, p.y) < 800 * 800) PS.Combat.damage(e, e.boss ? e.maxHp * 0.05 : e.elite ? e.maxHp * 0.5 : e.maxHp * 2, { src: 'Bomb', noCrit: true, noProc: true, noStatus: true });
          }
          break;
        case 'chest':
          PS.Game.openChest(1, 0);
          break;
        case 'bosschest':
          PS.Game.openChest(3, 2);
          break;
      }
    },

    /* ------------------------------------------------------------ map props */
    chestPrice() {
      const disc = PS.G.player.stats.f.discount || 0;
      return Math.round(this.chestCost * (1 - disc));
    },
    updateProps(dt) {
      const G = PS.G, p = G.player;
      for (const pr of G.props) {
        if (pr.dead) continue;
        pr.t += dt;
        const d2 = U.dist2(pr.x, pr.y, p.x, p.y);
        if (pr.kind === 'chest') {
          if (d2 < 38 * 38) {
            const cost = this.chestPrice();
            if (p.gold >= cost) {
              p.gold -= cost;
              this.chestCost = Math.round(this.chestCost * 1.3 + 4);
              this.chestsOpened++;
              pr.dead = true;
              PS.Game.openChest(1, 0);
            } else if (!pr.denied || G.time - pr.denied > 1.5) {
              pr.denied = G.time;
              PS.FX.text(pr.x, pr.y - 40, 'Need ' + cost + ' gold', '#ff8a8a');
              PS.Audio.play('deny', { vol: 0.5 });
            }
          }
        } else if (pr.kind === 'shrine') {
          if (d2 < pr.r * pr.r) {
            pr.charge += dt / 2.2;
            if (pr.charge >= 1) {
              pr.dead = true;
              PS.FX.ring(pr.x, pr.y, 160, '#ffe9a8', 0.5);
              PS.Audio.play('shrine');
              PS.Game.openShrine();
            }
          } else pr.charge = Math.max(0, pr.charge - dt * 0.5);
        }
      }
    },
  };

  PS.Director = Dr;
})();
