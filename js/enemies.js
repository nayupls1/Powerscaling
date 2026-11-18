/* POWERSCALING — enemy roster, spawning and AI */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, C = PS.Combat, TAU = U.TAU;

  const DEFS = {
    imp:      { name: 'Rift Imp',     r: 12, hp: 9,  spd: 64,  dmg: 7,  xp: 1, mass: 1,   ai: 'chase',   color: '#b3324a' },
    bat:      { name: 'Gloomwing',    r: 10, hp: 6,  spd: 125, dmg: 6,  xp: 1, mass: 0.6, ai: 'swoop',   color: '#7b4bd1' },
    spitter:  { name: 'Spitter',      r: 13, hp: 16, spd: 58,  dmg: 7,  xp: 3, mass: 1,   ai: 'ranged',  color: '#5fa83a', range: 290, shotCd: 2.8, shotDmg: 8, shotSpd: 175 },
    slime:    { name: 'Ooze',         r: 17, hp: 30, spd: 55,  dmg: 9,  xp: 2, mass: 1.6, ai: 'chase',   color: '#2fa8a0', split: { into: 'slimelet', n: 3 } },
    slimelet: { name: 'Oozeling',     r: 9,  hp: 8,  spd: 92,  dmg: 6,  xp: 1, mass: 0.6, ai: 'chase',   color: '#45c9c0' },
    hound:    { name: 'Rift Hound',   r: 14, hp: 24, spd: 78,  dmg: 12, xp: 3, mass: 1.2, ai: 'charger', color: '#d1482f' },
    brute:    { name: 'Brute',        r: 24, hp: 85, spd: 44,  dmg: 16, xp: 8, mass: 5,   ai: 'chase',   color: '#8a3b2a' },
    bloater:  { name: 'Bloater',      r: 18, hp: 32, spd: 56,  dmg: 9,  xp: 4, mass: 1.8, ai: 'chase',   color: '#b5a13a', explode: { r: 95, dmg: 20 } },
    wraith:   { name: 'Wraith',       r: 13, hp: 26, spd: 104, dmg: 11, xp: 4, mass: 0.9, ai: 'wraith',  color: '#8fb6ff' },
    hexer:    { name: 'Hexer',        r: 14, hp: 30, spd: 60,  dmg: 8,  xp: 5, mass: 1,   ai: 'ranged',  color: '#c04bb0', range: 330, shotCd: 3.4, shotDmg: 9, shotSpd: 190, burst: 3 },
    knight:   { name: 'Dread Knight', r: 16, hp: 72, spd: 66,  dmg: 17, xp: 8, mass: 2.6, ai: 'chase',   color: '#5b6485', taken: 0.75 },
  };
  for (const id in DEFS) { DEFS[id].id = id; DEFS[id].sprite = id; }

  DEFS.bloater.onDeath = function (e) {
    // bloaters burst — dangerous to the player, and to the horde around them
    const x = e.x, y = e.y, r = e.def.explode.r * (e.elite ? 1.4 : 1);
    C.hazard({ kind: 'circle', x, y, r, delay: 0.45, dmg: e.def.explode.dmg * PS.Director.dmgMult(), color: '#d6c14a',
      onLand() { C.aoe(x, y, r, e.maxHp * 0.6, { src: 'Bloater burst', noCrit: true, noProc: true, noStatus: true, knock: 200 }); } });
  };
  DEFS.slime.onDeath = function (e) {
    const sp = e.def.split;
    for (let i = 0; i < sp.n; i++) {
      const a = (i * TAU) / sp.n + Math.random();
      const c = E.spawn(sp.into, e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12);
      if (c) { c.kx = Math.cos(a) * 160; c.ky = Math.sin(a) * 160; c.spawnT = 0; }
    }
  };

  let nextId = 1;

  const E = {
    DEFS,
    /** opts: { elite, hpMult, boss } */
    spawn(typeId, x, y, opts) {
      const G = PS.G, def = DEFS[typeId] || typeId; // bosses pass a def object
      opts = opts || {};
      const Dr = PS.Director;
      let hp = def.hp * (def.boss ? 1 : Dr.hpMult()) * (opts.hpMult || 1);
      let r = def.r, dmg = def.dmg * Dr.dmgMult(), mass = def.mass, xp = def.xp * Dr.xpMult();
      if (opts.elite) { hp *= 7 + Dr.minutes() * 0.6; r *= 1.45; dmg *= 1.4; mass *= 3.5; xp *= 12; }
      const e = {
        id: nextId++, def, x, y, r, hp, maxHp: hp, dmg, speed: def.spd * Dr.speedMult(), xp, mass,
        score: Math.round(xp * 10), kx: 0, ky: 0, flash: 0, ang: 0, t: Math.random() * 3, state: 0, st: 0,
        burnT: 0, burnDps: 0, poisT: 0, poisStacks: 0, poisDps: 0, bleedT: 0, bleedDps: 0,
        chillT: 0, freezeT: 0, freezeImm: 0, shockT: 0, markT: 0, dotT: Math.random() * 0.25, dotAcc: 0, dotEl: null, dotShow: 0,
        icd: {}, elite: !!opts.elite, boss: !!def.boss, big: !!opts.elite || !!def.boss, taken: def.taken || 1,
        spawnT: 0.35, wob: Math.random() * TAU, dead: false, dx: 0, dy: 0, tx: 0, ty: 0,
      };
      G.enemies.push(e);
      return e;
    },

    update(dt) {
      const G = PS.G, p = G.player, list = G.enemies, grid = G.grid;
      const aff = p.aff, s = p.stats, f = s.f;
      const slowAmt = aff.frost >= 2 ? 0.5 : 0.3;
      const burnMul = s.statusDmg * (aff.fire >= 2 ? 1.6 : 1) * (aff.fire >= 6 ? 2 : 1) * (f.combustion ? 1.5 : 1);
      const poisMul = s.statusDmg * (aff.venom >= 2 ? 1.5 : 1);
      const venom6 = aff.venom >= 6;
      const pandemic = !!f.pandemic;
      const parity = G.frame & 1;

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.dead) continue;
        if (e.flash > 0) e.flash -= dt;
        if (e.spawnT > 0) e.spawnT -= dt;

        // ---- status timers and damage-over-time
        if (e.shockT > 0) e.shockT -= dt;
        if (e.markT > 0) e.markT -= dt;
        if (e.chillT > 0) e.chillT -= dt;
        if (e.freezeImm > 0) e.freezeImm -= dt;
        if (e.burnT > 0) { e.burnT -= dt; if (e.burnT <= 0) e.burnDps = 0; }
        if (e.poisT > 0) { e.poisT -= dt; if (e.poisT <= 0) { e.poisStacks = 0; e.poisDps = 0; } }
        if (e.bleedT > 0) { e.bleedT -= dt; if (e.bleedT <= 0) e.bleedDps = 0; }
        e.dotT -= dt;
        if (e.dotT <= 0) {
          e.dotT += 0.25;
          if (e.burnT > 0) C.damage(e, e.burnDps * 0.25 * burnMul, DOT_BURN);
          if (!e.dead && e.poisStacks > 0) {
            let d = e.poisStacks * e.poisDps * 0.25 * poisMul;
            if (venom6) d += e.maxHp * (e.boss ? 0.0015 : 0.015) * 0.25;
            C.damage(e, d, DOT_POISON);
          }
          if (!e.dead && e.bleedT > 0) C.damage(e, e.bleedDps * 0.25 * s.statusDmg, DOT_BLEED);
          if (e.dead) continue;
          if (e.dotAcc >= 1 && ++e.dotShow >= 2) {
            e.dotShow = 0;
            PS.FX.dmgNum(e.x, e.y - e.r, e.dotAcc, false, e.dotEl, true);
            e.dotAcc = 0;
          }
        }

        // ---- knockback
        if (e.kx !== 0 || e.ky !== 0) {
          e.x += e.kx * dt;
          e.y += e.ky * dt;
          const k = Math.max(0, 1 - 9 * dt);
          e.kx *= k; e.ky *= k;
          if (Math.abs(e.kx) < 2 && Math.abs(e.ky) < 2) { e.kx = 0; e.ky = 0; }
        }

        const dx = p.x - e.x, dy = p.y - e.y;
        const d = Math.hypot(dx, dy) || 1;

        if (e.freezeT > 0) {
          e.freezeT -= dt;
        } else {
          let sp = e.speed;
          if (e.chillT > 0) sp *= 1 - (e.boss ? slowAmt * 0.4 : slowAmt);
          e.t += dt;
          if (e.boss) PS.Bosses.update(e, dt, sp, dx, dy, d);
          else AI[e.def.ai](e, dt, sp, dx, dy, d, p);
        }

        // ---- soft separation (half the horde per frame)
        if (!e.boss && (e.id & 1) === parity && e.def.ai !== 'wraith') {
          let px = 0, py = 0, n = 0;
          grid.query(e.x, e.y, e.r * 0.6, (o) => {
            if (o === e || o.boss) return;
            const ox = e.x - o.x, oy = e.y - o.y;
            const od = Math.hypot(ox, oy) || 0.01;
            const overlap = e.r + o.r - od;
            if (overlap > 0) {
              const w = o.mass / (e.mass + o.mass);
              px += (ox / od) * overlap * w;
              py += (oy / od) * overlap * w;
              if (++n >= 6) return true;
            }
          });
          if (n) { e.x += px * 0.5; e.y += py * 0.5; }
        }

        // ---- contact damage
        const rr = e.r + p.r * 0.75;
        if (d < rr && e.freezeT <= 0 && e.spawnT <= 0) {
          p.hurt(e.dmg * (pandemic && e.poisStacks > 0 ? 0.75 : 1), e);
        }

        // ---- recycle stragglers far behind the player
        if (d > 1350 && !e.boss) {
          const pos = PS.Director.ringPos();
          e.x = pos.x; e.y = pos.y; e.kx = 0; e.ky = 0;
        }
      }
      U.compact(list);
    },
  };

  const DOT_BURN = Object.freeze({ dot: true, el: 'fire', src: 'Burn' });
  const DOT_POISON = Object.freeze({ dot: true, el: 'venom', src: 'Poison' });
  const DOT_BLEED = Object.freeze({ dot: true, el: 'steel', src: 'Bleed' });

  function moveTo(e, dx, dy, d, sp, dt) {
    e.x += (dx / d) * sp * dt;
    e.y += (dy / d) * sp * dt;
    e.ang = Math.atan2(dy, dx);
  }

  const AI = {
    chase(e, dt, sp, dx, dy, d) {
      moveTo(e, dx, dy, d, sp, dt);
    },
    swoop(e, dt, sp, dx, dy, d) {
      // weave side to side while closing in
      const w = Math.sin(e.t * 3.2 + e.wob) * 0.9;
      const nx = dx / d, ny = dy / d;
      const vx = nx - ny * w, vy = ny + nx * w;
      const l = Math.hypot(vx, vy);
      e.x += (vx / l) * sp * dt;
      e.y += (vy / l) * sp * dt;
      e.ang = Math.atan2(vy, vx);
    },
    wraith(e, dt, sp, dx, dy, d) {
      // lunges in pulses, drifts between them
      const pulse = 0.55 + 0.75 * Math.max(0, Math.sin(e.t * 2.4 + e.wob));
      moveTo(e, dx, dy, d, sp * pulse, dt);
    },
    ranged(e, dt, sp, dx, dy, d, p) {
      const def = e.def;
      e.ang = Math.atan2(dy, dx);
      if (d > def.range) moveTo(e, dx, dy, d, sp, dt);
      else if (d < def.range * 0.55) moveTo(e, -dx, -dy, d, sp * 0.7, dt);
      else {
        // strafe
        const dir = e.id & 1 ? 1 : -1;
        e.x += (-dy / d) * sp * 0.5 * dir * dt;
        e.y += (dx / d) * sp * 0.5 * dir * dt;
      }
      e.st -= dt;
      if (e.st <= 0 && d < def.range + 120 && d < 620) {
        e.st = def.shotCd * (0.8 + Math.random() * 0.4);
        const a = Math.atan2(dy, dx);
        const n = def.burst || 1;
        const dmg = def.shotDmg * PS.Director.dmgMult();
        for (let k = 0; k < n; k++) {
          C.ebullet({ x: e.x, y: e.y, ang: a + (k - (n - 1) / 2) * 0.22, speed: def.shotSpd, dmg, r: 7, color: def.burst ? '#ff6bd6' : '#b6ff5a', life: 4.5 });
        }
        e.flash = 0.08;
      }
    },
    charger(e, dt, sp, dx, dy, d) {
      // state 0 approach, 1 wind-up, 2 dash, 3 recover
      if (e.state === 0) {
        moveTo(e, dx, dy, d, sp, dt);
        e.st -= dt;
        if (d < 260 && e.st <= 0) { e.state = 1; e.st = 0.55; e.dx = dx / d; e.dy = dy / d; }
      } else if (e.state === 1) {
        e.st -= dt;
        e.ang = Math.atan2(e.dy, e.dx);
        if (e.st <= 0) { e.state = 2; e.st = 0.5; }
      } else if (e.state === 2) {
        e.st -= dt;
        e.x += e.dx * sp * 5.6 * dt;
        e.y += e.dy * sp * 5.6 * dt;
        if (e.st <= 0) { e.state = 3; e.st = 0.9; }
      } else {
        e.st -= dt;
        if (e.st <= 0) { e.state = 0; e.st = 1.2 + Math.random(); }
      }
    },
  };

  PS.Enemies = E;
})();
