/* POWERSCALING — enemy roster, spawning and AI */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, C = PS.Combat, TAU = U.TAU;

  const DEFS = {
    imp:      { name: 'Rift Imp',     r: 12, hp: 9,  spd: 64,  dmg: 5,  xp: 1, mass: 1,   ai: 'chase',   color: '#b3324a' },
    bat:      { name: 'Gloomwing',    r: 10, hp: 6,  spd: 125, dmg: 6,  xp: 1, mass: 0.6, ai: 'swoop',   color: '#7b4bd1' },
    spitter:  { name: 'Spitter',      r: 13, hp: 16, spd: 58,  dmg: 7,  xp: 3, mass: 1,   ai: 'ranged',  color: '#5fa83a', range: 290, shotCd: 2.8, shotDmg: 8, shotSpd: 175 },
    slime:    { name: 'Ooze',         r: 17, hp: 30, spd: 55,  dmg: 9,  xp: 2, mass: 1.6, ai: 'chase',   color: '#2fa8a0', split: { into: 'slimelet', n: 3 } },
    slimelet: { name: 'Oozeling',     r: 9,  hp: 8,  spd: 92,  dmg: 6,  xp: 1, mass: 0.6, ai: 'chase',   color: '#45c9c0' },
    hound:    { name: 'Rift Hound',   r: 14, hp: 24, spd: 78,  dmg: 12, xp: 3, mass: 1.2, ai: 'charger', color: '#d1482f' },
    brute:    { name: 'Brute',        r: 24, hp: 85, spd: 44,  dmg: 16, xp: 8, mass: 5,   ai: 'chase',   color: '#8a3b2a' },
    bloater:  { name: 'Bloater',      r: 18, hp: 32, spd: 56,  dmg: 9,  xp: 4, mass: 1.8, ai: 'chase',   color: '#b5a13a', explode: { r: 95, dmg: 20 } },
    wraith:   { name: 'Wraith',       r: 13, hp: 26, spd: 104, dmg: 11, xp: 4, mass: 0.9, ai: 'wraith',  color: '#8fb6ff' },
    mortar:   { name: 'Bombardier',   r: 15, hp: 26, spd: 56,  dmg: 8,  xp: 5, mass: 1.4, ai: 'mortar',  color: '#d98a2b', range: 300, shotCd: 3.8, blast: { r: 74, dmg: 14 } },
    hexer:    { name: 'Hexer',        r: 14, hp: 30, spd: 60,  dmg: 8,  xp: 5, mass: 1,   ai: 'ranged',  color: '#c04bb0', range: 330, shotCd: 3.4, shotDmg: 9, shotSpd: 190, burst: 3 },
    toad:     { name: 'Rift Toad',    r: 15, hp: 26, spd: 46,  dmg: 11, xp: 4, mass: 1.4, ai: 'leaper',  color: '#3fbf6a', leap: { range: 340, cd: 4, r: 56, dmg: 13 } },
    warder:   { name: 'Warder',       r: 15, hp: 36, spd: 52,  dmg: 8,  xp: 7, mass: 1.6, ai: 'warder',  color: '#e9d8a6', ward: { r: 150, cut: 0.33 } },
    hoarder:  { name: 'Rift Hoarder', r: 15, hp: 55, spd: 118, dmg: 0,  xp: 12, mass: 1.5, ai: 'flee',    color: '#f0b94a', harmless: true, hoard: true },
    knight:   { name: 'Dread Knight', r: 16, hp: 72, spd: 66,  dmg: 17, xp: 8, mass: 2.6, ai: 'chase',   color: '#5b6485', taken: 0.75 },
  };
  // one line each for the codex: what it does and what to do about it
  const NOTES = {
    imp: 'The rank and file. Harmless alone, never alone.',
    bat: 'Fast and weaving. Comes in rings that close on you.',
    spitter: 'Keeps its distance and spits. Your attack cuts its shots out of the air.',
    slime: 'Bursts into three Oozelings when it dies.',
    slimelet: 'What is left of an Ooze. Quick, and soon dealt with.',
    hound: 'Lines up, then charges in a straight line. Step aside as it winds up.',
    brute: 'Slow, heavy, and hard to shove. Hits like a wall.',
    bloater: 'Explodes when it dies, hurting you and the horde alike. Kill it in a crowd, from a distance.',
    wraith: 'Lunges in pulses and passes through its own kind.',
    mortar: 'Shells the spot where you stand. Keep moving and it never lands.',
    toad: 'Crouches, marks the ground under you, then leaps onto the mark. Step off it.',
    hexer: 'Fires bursts of three bolts. A Ward throws them straight back.',
    warder: 'Everything inside its dotted ring takes a third less damage. Kill it first.',
    knight: 'Armoured: takes a quarter less damage from everything.',
    hoarder: 'Carries a sack of gold and a relic, and runs. Catch it before it slips back into the rift.',
  };
  for (const id in DEFS) { DEFS[id].id = id; DEFS[id].sprite = id; DEFS[id].note = NOTES[id] || ''; }

  DEFS.bloater.onDeath = function (e) {
    // bloaters burst — dangerous to the player, and to the horde around them
    const x = e.x, y = e.y, r = e.def.explode.r * (e.elite ? 1.4 : 1);
    C.hazard({ kind: 'circle', x, y, r, delay: 0.45, dmg: e.def.explode.dmg * PS.Director.dmgMult(), color: '#d6c14a',
      onLand() { C.aoe(x, y, r, e.maxHp * 0.1, { src: 'Bloater burst', noCrit: true, noProc: true, noStatus: true, knock: 200 }); } });
  };
  DEFS.slime.onDeath = function (e) {
    const sp = e.def.split;
    for (let i = 0; i < sp.n; i++) {
      const a = (i * TAU) / sp.n + U.rnd();
      const c = E.spawn(sp.into, e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12);
      if (c) { c.kx = Math.cos(a) * 160; c.ky = Math.sin(a) * 160; c.spawnT = 0; }
    }
  };

  /*
   * Elite affixes. Hooks: spawn(e) once, update(e, dt, G, p, d) every frame the elite is not frozen (d = distance to the
   * hero), death(e). The Shielded barrier itself is spent in Combat.damage. Names and blurbs are in Data.AFFIXES.
   */
  const AFFIX = {
    shielded: {
      spawn(e) { e.shieldMax = e.shield = e.maxHp * 0.35; e.shieldAt = -99; },
      // any damage, a burn included, stops the barrier regrowing for four seconds
      update(e, dt, G) { if (e.shield < e.shieldMax && G.time - e.shieldAt > 4) e.shield = Math.min(e.shieldMax, e.shield + e.shieldMax * 0.3 * dt); },
    },
    volatile: {
      death(e) {
        // telegraphed like a bloater, then a ring of bullets: back off, or Ward it back
        const x = e.x, y = e.y, dmg = 9 * PS.Director.dmgMult();
        C.hazard({ kind: 'circle', x, y, r: e.r * 2.2, delay: 0.55, dmg: dmg * 1.4, color: '#ff8a4d',
          onLand() { const off = U.rnd() * TAU; for (let i = 0; i < 14; i++) C.ebullet({ x, y, ang: off + (i * TAU) / 14, speed: 170, dmg, r: 7, color: '#ff8a4d', life: 4 }); } });
      },
    },
    blinking: {
      spawn(e) { e.afT = 4; },
      update(e, dt, G, p, d) {
        e.afT -= dt;
        if (e.afT > 0 || d < 240) return;
        e.afT = 6;
        PS.FX.puff(e.x, e.y, '#c06bff', 12);
        const a = U.rnd() * TAU;
        e.x = p.x + Math.cos(a) * 150; e.y = p.y + Math.sin(a) * 150; e.kx = 0; e.ky = 0;
        e.spawnT = 0.6; // fades in, harmless for a beat: the blink is a threat, not a free hit
        PS.FX.puff(e.x, e.y, '#c06bff', 12);
        PS.Audio.play('void', { vol: 0.35, pitch: 1.4 });
      },
    },
    mending: {
      spawn(e) { e.afT = 1.5; },
      update(e, dt, G) {
        e.afT -= dt;
        if (e.afT > 0) return;
        e.afT = 1.5;
        let n = 0;
        G.grid.query(e.x, e.y, 200, (o) => { if (!o.big && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.15); n++; } });
        if (n) PS.FX.ring(e.x, e.y, 200, '#7dffa0', 0.3);
      },
    },
    molten: {
      spawn(e) { e.afT = 1.5; },
      update(e, dt, G, p, d) {
        e.afT -= dt;
        if (e.afT > 0 || d > 560) return;
        e.afT = 1.3;
        C.hazard({ kind: 'circle', x: e.x, y: e.y, r: 58, delay: 0.9, dmg: e.dmg * 0.7, color: '#ff5a3d' });
      },
    },
    brooding: {
      spawn(e) { e.afT = 5; },
      update(e, dt, G, p, d) {
        e.afT -= dt;
        if (e.afT > 0 || d > 700 || G.enemies.length > 280) return;
        e.afT = 7;
        for (let i = 0; i < 3; i++) {
          const a = (i * TAU) / 3 + U.rnd();
          const c = E.spawn('slimelet', e.x + Math.cos(a) * (e.r + 8), e.y + Math.sin(a) * (e.r + 8));
          c.kx = Math.cos(a) * 150; c.ky = Math.sin(a) * 150;
        }
        PS.FX.puff(e.x, e.y, '#b6ff5a', 8);
      },
    },
    splitting: {
      death(e) {
        // three of its own kind, tougher than the rank and file but nothing like an elite
        for (let i = 0; i < 3; i++) {
          const a = (i * TAU) / 3 + U.rnd();
          const c = E.spawn(e.def.id, e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, { hpMult: 2.5 });
          c.kx = Math.cos(a) * 220; c.ky = Math.sin(a) * 220; c.spawnT = 0.25;
        }
        PS.FX.puff(e.x, e.y, '#5ff0d0', 12);
      },
    },
    warding: {
      spawn(e) { e.afT = 0.4; },
      update(e, dt, G) {
        e.afT -= dt;
        if (e.afT > 0) return;
        e.afT = 0.4;
        const until = G.time + 0.6;
        G.grid.query(e.x, e.y, 150, (o) => { if (o !== e && !o.big && o.def.ai !== 'warder') { o.wardT = until; o.wardCut = 0.33; } });
      },
    },
    grasping: {
      // a steady tug while it is near: not enough to pin the hero, enough to spoil a line of retreat. A dash breaks free
      update(e, dt, G, p, d) {
        if (d > 330 || d < 50 || p.dashT > 0) return;
        const pull = 38 * dt;
        p.x += ((e.x - p.x) / d) * pull; p.y += ((e.y - p.y) / d) * pull;
      },
    },
    frenzied: {
      spawn(e) { e.speed *= 1.25; },
      update(e) { e.rage = e.hp < e.maxHp * 0.5; },
    },
  };

  let nextId = 1;
  let leaps = 0; // toad landings marked right now, recounted every frame

  const E = {
    DEFS,
    /** ids restart with every run: they decide strafe directions and update parity, so a seeded run needs them stable */
    reset() { nextId = 1; },
    /** opts: { elite, hpMult, boss, noAffix, affixes } (affixes: a fixed list of ids, for tools) */
    spawn(typeId, x, y, opts) {
      const G = PS.G, def = DEFS[typeId] || typeId; // bosses pass a def object
      opts = opts || {};
      const Dr = PS.Director;
      let hp = def.hp * (def.boss ? 1 : Dr.hpMult()) * (opts.hpMult || 1);
      let r = def.r, dmg = def.dmg * Dr.dmgMult(), mass = def.mass, xp = def.xp * Dr.xpMult();
      mass *= 1 + Dr.minutes() * 0.06; // the horde gets harder to shove around as the run goes on
      // elites are a short duel, not a sponge: the tanky types (brutes, knights) get a smaller multiplier than the light ones
      if (opts.elite) { hp *= (7 + Dr.minutes() * 0.2) * Math.min(1, Math.sqrt(30 / def.hp)); r *= 1.45; dmg *= 1.4; mass *= 3.5; xp *= 12; }
      const e = {
        id: nextId++, def, x, y, r, hp, maxHp: hp, dmg, speed: def.spd * Dr.speedMult(), xp, mass,
        score: Math.max(1, Math.round(xp)), kx: 0, ky: 0, flash: 0, flashAt: 0, braceT: 0, ang: 0, t: U.rnd() * 3, state: 0, st: 0,
        burnT: 0, burnDps: 0, poisT: 0, poisStacks: 0, poisDps: 0, bleedT: 0, bleedDps: 0,
        chillT: 0, freezeT: 0, freezeImm: 0, shockT: 0, markT: 0, dotT: U.rnd() * 0.25, dotAcc: 0, dotEl: null, dotShow: 0,
        icd: {}, elite: !!opts.elite, boss: !!def.boss, big: !!opts.elite || !!def.boss, taken: def.taken || 1,
        spawnT: 0.35, wob: U.rnd() * TAU, dead: false, dx: 0, dy: 0, tx: 0, ty: 0,
        tagEl: null, tagT: 0, rxAt: 0, exposeT: 0, hop: 0, wardT: 0, wardCut: 0, // reactions: the element last hit with, and the reaction cooldown
        shield: 0, shieldMax: 0, marchT: 0, mdx: 0, mdy: 0, rage: false, affixes: null, label: def.name,
      };
      if (opts.elite) {
        const want = opts.noAffix ? 0 : opts.affixes ? opts.affixes.length : Dr.affixCount();
        if (want > 0) {
          // drawn from the event stream, so everyone on the same seed meets the same elites
          e.affixes = opts.affixes || U.shuffle(PS.Data.AFFIX_IDS.slice(), PS.RNG.event).slice(0, want);
          for (const id of e.affixes) if (AFFIX[id].spawn) AFFIX[id].spawn(e);
          e.label = e.affixes.map((id) => PS.Data.AFFIXES[id].name).join(' ') + ' ' + def.name;
        }
      }
      G.enemies.push(e);
      return e;
    },
    /** called by Combat.kill for elites */
    affixDeath(e) {
      for (const id of e.affixes) if (AFFIX[id].death) AFFIX[id].death(e);
    },

    update(dt) {
      const G = PS.G, p = G.player, list = G.enemies, grid = G.grid;
      const aff = p.aff, s = p.stats, f = s.f;
      const slowAmt = aff.frost >= 2 ? 0.5 : 0.3;
      const burnMul = s.statusDmg * (aff.fire >= 2 ? 1.6 : 1) * (aff.fire >= 6 ? 2 : 1) * (f.combustion ? 1.5 : 1);
      const poisMul = s.statusDmg * (aff.venom >= 2 ? 1.5 : 1);
      const venom6 = aff.venom >= 6;
      leaps = 0;
      const tideSpeed = PS.Director.tideOf('speed', 1);
      for (const h of G.hazards) if (h.leap && !h.dead) leaps++;
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
        if (e.exposeT > 0) e.exposeT -= dt;
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
            if (venom6) d += e.maxHp * (e.boss ? 0.0006 : 0.006) * 0.25;
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
          e.hop = 0;
        } else {
          let sp = e.speed * tideSpeed;
          if (e.chillT > 0) sp *= 1 - (e.boss ? slowAmt * 0.4 : slowAmt);
          if (e.rage) sp *= 1.35;
          e.t += dt;
          if (e.affixes) for (let k = 0; k < e.affixes.length; k++) { const af = AFFIX[e.affixes[k]]; if (af.update) af.update(e, dt, G, p, d); }
          if (e.boss) PS.Bosses.update(e, dt, sp, dx, dy, d);
          else if (e.marchT > 0) {
            // part of a wall: straight ahead, whatever the hero does
            e.marchT -= dt;
            e.x += e.mdx * sp * 1.6 * dt; e.y += e.mdy * sp * 1.6 * dt;
            e.ang = Math.atan2(e.mdy, e.mdx);
          }
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
        if (d < rr && e.freezeT <= 0 && e.spawnT <= 0 && e.hop <= 0 && !e.def.harmless) {
          p.hurt(e.dmg * (pandemic && e.poisStacks > 0 ? 0.75 : 1), e);
        }

        // ---- recycle stragglers far behind the player
        if (d > 1350 && !e.boss && !e.def.hoard) {
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
    mortar(e, dt, sp, dx, dy, d, p) {
      // hangs back out of reach and shells wherever you are standing right now: harmless if you keep moving
      const def = e.def;
      e.ang = Math.atan2(dy, dx);
      if (d > def.range) moveTo(e, dx, dy, d, sp, dt);
      else if (d < def.range * 0.6) moveTo(e, -dx, -dy, d, sp * 0.8, dt);
      else {
        const dir = e.id & 1 ? 1 : -1;
        e.x += (-dy / d) * sp * 0.4 * dir * dt;
        e.y += (dx / d) * sp * 0.4 * dir * dt;
      }
      e.st -= dt;
      if (e.st <= 0 && d < 390 && Math.abs(dx) < PS.G.viewW * 0.5 - 10 && Math.abs(dy) < PS.G.viewH * 0.5 - 10) {
        e.st = def.shotCd * (0.8 + U.rnd() * 0.4);
        e.flash = 0.1;
        C.hazard({ kind: 'circle', x: p.x, y: p.y, r: def.blast.r * (e.elite ? 1.3 : 1), delay: 1.1, dmg: def.blast.dmg * PS.Director.dmgMult(), color: '#ffa53d', owner: e });
        PS.FX.bolt(e.x, e.y, e.x + (p.x - e.x) * 0.25, e.y + (p.y - e.y) * 0.25 - 60, '#ffa53d');
      }
    },
    chase(e, dt, sp, dx, dy, d) {
      moveTo(e, dx, dy, d, sp, dt);
    },
    flee(e, dt, sp, dx, dy, d) {
      // runs from the hero in a weaving line, shedding coins as it is hurt, and slips away if it is not caught in time
      const G = PS.G, w = Math.sin(e.t * 2.6 + e.wob) * 0.8;
      const nx = -dx / d, ny = -dy / d, vx = nx - ny * w, vy = ny + nx * w, l = Math.hypot(vx, vy) || 1;
      const k = d > 520 ? 0.35 : 1; // it dawdles once it has a lead, so it can be run down
      e.x += (vx / l) * sp * k * dt; e.y += (vy / l) * sp * k * dt;
      e.ang = Math.atan2(vy, vx);
      if (e.hp < e.dripAt) {
        e.dripAt -= e.maxHp * 0.2;
        for (let i = 0; i < 2; i++) PS.Director.pickup('gold', e.x, e.y, Math.round((4 + PS.Director.minutes()) * G.player.stats.gold));
        PS.Audio.play('gold', { vol: 0.4 });
      }
      e.life -= dt;
      if (e.life <= 0) {
        e.dead = true; // gone, not slain: no drops, no kill
        PS.FX.puff(e.x, e.y, '#c06bff', 14);
        PS.FX.ring(e.x, e.y, 60, '#c06bff', 0.35);
        PS.UI.toast('The Hoarder slipped away', 'coin');
        if (PS.Director.hoarder === e) PS.Director.hoarder = null;
      }
    },
    leaper(e, dt, sp, dx, dy, d, p) {
      // state 0 shuffle closer, 1 crouch (the landing spot is marked), 2 in the air, 3 recover
      const L = e.def.leap;
      if (e.state === 0) {
        moveTo(e, dx, dy, d, sp, dt);
        e.st -= dt;
        // only a couple may be in the air at once: a screen of landing marks is noise, not a threat to read
        if (e.st <= 0 && d < L.range && d > 70 && leaps < (PS.Director.minutes() > 9 ? 3 : 2)) {
          leaps++;
          e.state = 1; e.st = 0.65;
          e.tx = p.x; e.ty = p.y; e.dx = e.x; e.dy = e.y;
          // it lands where you stood when it crouched: step off the mark
          C.hazard({ kind: 'circle', x: e.tx, y: e.ty, r: L.r * (e.elite ? 1.35 : 1), delay: 1.0, dmg: L.dmg * PS.Director.dmgMult() * (e.elite ? 1.4 : 1), color: '#3fbf6a', owner: e, leap: true });
        }
      } else if (e.state === 1) {
        e.st -= dt;
        e.ang = Math.atan2(e.ty - e.y, e.tx - e.x);
        if (e.st <= 0) { e.state = 2; e.st = 0.35; e.dx = e.x; e.dy = e.y; }
      } else if (e.state === 2) {
        e.st -= dt;
        const k = U.clamp(1 - e.st / 0.35, 0, 1);
        e.x = e.dx + (e.tx - e.dx) * k; e.y = e.dy + (e.ty - e.dy) * k;
        e.hop = Math.sin(k * Math.PI);
        e.kx = 0; e.ky = 0;
        if (e.st <= 0) { e.state = 3; e.st = 0.8; e.hop = 0; }
      } else {
        e.st -= dt;
        if (e.st <= 0) { e.state = 0; e.st = L.cd * (0.8 + U.rnd() * 0.4); }
      }
    },
    warder(e, dt, sp, dx, dy, d) {
      // keeps to the middle of the pack, a little way off, and wards everything around it: kill it first
      const W = e.def.ward;
      e.ang = Math.atan2(dy, dx);
      if (d > 300) moveTo(e, dx, dy, d, sp, dt);
      else if (d < 190) moveTo(e, -dx, -dy, d, sp * 0.8, dt);
      e.st -= dt;
      if (e.st <= 0) {
        e.st = 0.4;
        const until = PS.G.time + 0.6, r = W.r * (e.elite ? 1.3 : 1);
        PS.G.grid.query(e.x, e.y, r, (o) => { if (o !== e && o.def.ai !== 'warder' && !o.boss) { o.wardT = until; o.wardCut = W.cut; } });
      }
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
        e.st = def.shotCd * (0.8 + U.rnd() * 0.4);
        const a = Math.atan2(dy, dx);
        const n = def.burst || 1;
        const weak = e.poisStacks > 0 && p.stats.f.pandemic ? 0.75 : 1;
        const dmg = def.shotDmg * PS.Director.dmgMult() * weak;
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
        if (e.st <= 0) { e.state = 0; e.st = 1.2 + U.rnd(); }
      }
    },
  };

  PS.Enemies = E;
})();
