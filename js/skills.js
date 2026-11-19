/* POWERSCALING — skills: definitions + behaviours. Generic skills auto-target; class primaries follow the player's aim. */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, C = PS.Combat, TAU = U.TAU;
  const EL = PS.Data.ELEMENTS;
  const MAX_LEVEL = 6;

  const st = {}; // scratch stats object, refilled by S.stats()

  /** direction for auto-targeted skills: nearest enemy, else current aim */
  function autoAim(p, range) {
    const t = C.nearest(p.x, p.y, range || 520);
    return t ? Math.atan2(t.y - p.y, t.x - p.x) : null;
  }
  function fan(n, spread, fn) {
    for (let i = 0; i < n; i++) fn((i - (n - 1) / 2) * spread, i);
  }
  function orbitHit(inst, x, y, r, dmg, o, icd) {
    const G = PS.G, key = inst.id;
    G.grid.query(x, y, r, (e) => {
      const until = e.icd[key] || 0;
      if (G.time < until) return;
      e.icd[key] = G.time + icd;
      o.ang = Math.atan2(e.y - PS.G.player.y, e.x - PS.G.player.x);
      C.damage(e, dmg, o);
    });
  }

  const DEFS = {
    /* =============================== EMBER =============================== */
    fireball: {
      name: 'Fireball', el: 'fire', icon: 'fireball', usesProj: true,
      desc: 'Hurls a fireball at the nearest enemy that explodes on impact.',
      base: { dmg: 18, cd: 1.5, count: 1, area: 1, speed: 430 },
      up: [{ dmg: 6 }, { count: 1 }, { area: 0.25, dmg: 4 }, { cd: -0.25 }, { count: 1, dmg: 6 }],
      evo: { name: 'Sunburst', tome: 'duration', desc: 'Explosions are 40% larger and leave burning ground.', mod: { area: 0.4, dmg: 8 } },
      fire(inst, s, p) {
        const a = autoAim(p);
        if (a === null) return false;
        const evolved = inst.evolved, dmg = s.dmg, r = 58 * s.area;
        fan(s.count, 0.2, (off) => {
          C.proj({
            x: p.x, y: p.y, ang: a + off, speed: s.speed, dmg, el: 'fire', src: inst.name, r: 9, life: 1.3, kind: 'fireball',
            color: EL.fire.color, explode: r, knock: 90, trail: '#ff9a4d',
            onEnd: evolved ? (pr) => C.zone({ x: pr.x, y: pr.y, r: r * 0.85, life: 2.5 * p.stats.duration, tick: 0.5, dmg: dmg * 0.25, el: 'fire', src: inst.name, kind: 'fire', color: EL.fire.color }) : null,
          });
        });
        PS.Audio.play('fire', { vol: 0.4 });
      },
    },
    inferno: {
      name: 'Inferno Aura', el: 'fire', icon: 'sun',
      desc: 'A ring of flame burns everything close to you.',
      base: { dmg: 5, cd: 0.4, area: 1 },
      up: [{ dmg: 2 }, { area: 0.2 }, { dmg: 3 }, { area: 0.2, cd: -0.05 }, { dmg: 4 }],
      evo: { name: 'Solar Crown', tome: 'reach', desc: 'Every 3 seconds the aura erupts in a huge solar flare.', mod: { dmg: 3, area: 0.15 } },
      unit: 'aura',
      tick(inst, s, dt, p) {
        const r = 95 * s.area;
        p.auraR = r;
        inst.t = (inst.t || 0) - dt;
        if (inst.t <= 0) {
          inst.t += s.b.cd / Math.max(0.5, p.as * 0.6 + 0.4);
          C.aoe(p.x, p.y, r, s.dmg, { el: 'fire', src: inst.name, noCrit: false });
        }
        if (inst.evolved) {
          inst.flare = (inst.flare || 3) - dt;
          if (inst.flare <= 0) {
            inst.flare = 3;
            PS.FX.ring(p.x, p.y, r * 2.6, '#ffb061', 0.5);
            PS.FX.explosion(p.x, p.y, r * 1.2, '#ff7a3d');
            C.aoe(p.x, p.y, r * 2.6, s.dmg * 6, { el: 'fire', src: inst.name, knock: 180 });
            PS.Audio.play('fire', { vol: 0.6 });
          }
        }
      },
    },
    meteor: {
      name: 'Meteor Shower', el: 'fire', icon: 'meteor', usesProj: true, unit: 'meteor',
      desc: 'Calls meteors down on random enemies.',
      base: { dmg: 42, cd: 3.6, count: 2, area: 1 },
      up: [{ dmg: 14 }, { count: 1 }, { area: 0.25 }, { cd: -0.6 }, { count: 1, dmg: 14 }],
      evo: { name: 'Armageddon', tome: 'might', desc: 'Meteors burst into four homing embers.', mod: { dmg: 20 } },
      fire(inst, s, p) {
        if (!PS.G.enemies.length) return false;
        const dmg = s.dmg, r = 85 * s.area, evolved = inst.evolved;
        let any = false;
        for (let i = 0; i < s.count; i++) {
          const e = C.randomEnemy(470);
          if (!e) break;
          any = true;
          C.strike({
            x: e.x + U.rand(-20, 20), y: e.y + U.rand(-20, 20), r, delay: 0.6 + i * 0.12, dmg, el: 'fire', src: inst.name, kind: 'meteor', color: EL.fire.color,
            onLand: evolved ? (sk) => {
              for (let k = 0; k < 4; k++) {
                C.proj({ x: sk.x, y: sk.y, ang: k * (TAU / 4) + 0.6, speed: 300, dmg: dmg * 0.4, el: 'fire', src: inst.name, r: 7, life: 1.6, kind: 'fireball', size: 0.7, color: EL.fire.color, explode: 44 * p.stats.area, homing: 5, trail: '#ff9a4d' });
              }
            } : null,
          });
        }
        return any;
      },
    },

    /* =============================== RIME =============================== */
    shards: {
      name: 'Ice Shards', el: 'frost', icon: 'shards', usesProj: true, unit: 'shard',
      desc: 'Fires a fan of piercing ice shards that chill.',
      base: { dmg: 9, cd: 1.1, count: 3, speed: 560, pierce: 2 },
      up: [{ dmg: 3 }, { count: 1 }, { pierce: 1, dmg: 2 }, { cd: -0.15 }, { count: 2 }],
      evo: { name: 'Glacial Barrage', tome: 'multishot', desc: 'Shards fly in every direction and often freeze.', mod: { dmg: 4, count: 3 } },
      fire(inst, s, p) {
        const a = autoAim(p);
        if (a === null) return false;
        const ev = inst.evolved;
        const n = s.count, spread = ev ? TAU / n : 0.15;
        fan(n, spread, (off) => {
          C.proj({ x: p.x, y: p.y, ang: a + off, speed: s.speed, dmg: s.dmg, el: 'frost', src: inst.name, r: 7, life: 1.1, pierce: s.pierce, kind: 'shard', color: EL.frost.color, knock: 40, opts: { freeze: ev ? 0.2 : 0.05 } });
        });
        PS.Audio.play('frost', { vol: 0.35 });
      },
    },
    nova: {
      name: 'Frost Nova', el: 'frost', icon: 'nova', unit: 'nova',
      desc: 'A burst of cold around you that can freeze enemies solid.',
      base: { dmg: 20, cd: 4.5, area: 1 },
      up: [{ dmg: 8 }, { area: 0.2 }, { cd: -0.6 }, { dmg: 10 }, { area: 0.25, cd: -0.5 }],
      evo: { name: 'Absolute Zero', tome: 'plating', desc: 'Always freezes, hits twice as hard, and leaves a blizzard.', mod: { dmg: 38 } },
      fire(inst, s, p) {
        const r = 150 * s.area, ev = inst.evolved;
        PS.FX.ring(p.x, p.y, r, EL.frost.glow, 0.4);
        PS.FX.frostBurst(p.x, p.y, r);
        C.aoe(p.x, p.y, r, s.dmg, { el: 'frost', src: inst.name, knock: 170, freeze: ev ? 1 : 0.55, freezeDur: ev ? 2 : 1.2 });
        if (ev) C.zone({ x: p.x, y: p.y, r: r * 0.9, life: 3 * p.stats.duration, tick: 0.5, dmg: s.dmg * 0.2, el: 'frost', src: inst.name, kind: 'blizzard', color: EL.frost.color, slow: 1 });
        PS.Audio.play('freeze', { vol: 0.5 });
      },
    },
    orbs: {
      name: 'Glacial Orbs', el: 'frost', icon: 'orbs', usesProj: true, unit: 'orb',
      desc: 'Orbs of ice circle you, chilling whatever they touch.',
      base: { dmg: 10, count: 2, area: 1 },
      up: [{ dmg: 4 }, { count: 1 }, { area: 0.15, dmg: 3 }, { count: 1 }, { dmg: 6, count: 1 }],
      evo: { name: 'Winter\'s Halo', tome: 'swiftness', desc: 'A second, wider ring of orbs spins the other way.', mod: { dmg: 4 } },
      tick(inst, s, dt, p) {
        inst.a = (inst.a || 0) + dt * 2.5 * (0.7 + 0.3 * p.as);
        const o = { el: 'frost', src: inst.name, knock: 50, freeze: 0.04 };
        const rings = inst.evolved ? 2 : 1;
        for (let k = 0; k < rings; k++) {
          const rad = (k === 0 ? 100 : 175) * (0.6 + 0.4 * s.area), n = s.count + k, orbR = 13 * (0.7 + 0.3 * s.area);
          for (let i = 0; i < n; i++) {
            const a = (k === 0 ? inst.a : -inst.a * 0.8) + (i * TAU) / n;
            const x = p.x + Math.cos(a) * rad, y = p.y + Math.sin(a) * rad;
            PS.G.orbits.push({ x, y, r: orbR, kind: 'iceorb', a });
            orbitHit(inst, x, y, orbR + 4, s.dmg, o, 0.45);
          }
        }
      },
    },

    /* =============================== TEMPEST =============================== */
    chain: {
      name: 'Chain Lightning', el: 'storm', icon: 'chain', usesProj: true, unit: 'bolt',
      desc: 'Lightning that leaps from enemy to enemy.',
      base: { dmg: 14, cd: 1.7, count: 1, jumps: 3 },
      up: [{ dmg: 5 }, { jumps: 2 }, { cd: -0.25 }, { dmg: 6, jumps: 1 }, { count: 1 }],
      evo: { name: 'Thunderlord', tome: 'haste', desc: '+5 jumps, and every jump hits 12% harder than the last.', mod: { jumps: 5, dmg: 4 } },
      fire(inst, s, p) {
        const first = C.nearest(p.x, p.y, 430);
        if (!first) return false;
        const o = { src: inst.name, growth: inst.evolved ? 1.12 : 0 };
        C.chain(p.x, p.y, first, s.dmg, s.b.jumps, 200, o);
        for (let i = 1; i < s.count; i++) {
          const e = C.randomEnemy(430);
          if (e) C.chain(p.x, p.y, e, s.dmg, s.b.jumps, 200, o);
        }
        PS.Audio.play('zap', { vol: 0.45 });
      },
    },
    thunder: {
      name: 'Thunderstrike', el: 'storm', icon: 'thunder', usesProj: true, unit: 'strike',
      desc: 'Bolts from above smite random enemies.',
      base: { dmg: 30, cd: 2.4, count: 2, area: 1 },
      up: [{ dmg: 10 }, { count: 1 }, { area: 0.3 }, { cd: -0.4 }, { count: 2 }],
      evo: { name: 'Judgment', tome: 'precision', desc: 'Strikes always crit and each one lands twice.', mod: { dmg: 8 } },
      fire(inst, s, p) {
        if (!PS.G.enemies.length) return false;
        const ev = inst.evolved, r = 52 * s.area;
        let any = false;
        for (let i = 0; i < s.count; i++) {
          const e = C.randomEnemy(480);
          if (!e) break;
          any = true;
          const o = { shock: 1, crit: ev ? true : undefined, knock: 60 };
          C.strike({ x: e.x, y: e.y, r, delay: 0.18 + i * 0.07, dmg: s.dmg, el: 'storm', src: inst.name, kind: 'bolt', color: EL.storm.color, opts: o });
          if (ev) C.strike({ x: e.x, y: e.y, r, delay: 0.5 + i * 0.07, dmg: s.dmg, el: 'storm', src: inst.name, kind: 'bolt', color: '#fff3a8', opts: { shock: 1, crit: true, knock: 60 } });
        }
        return any;
      },
    },
    ball: {
      name: 'Ball Lightning', el: 'storm', icon: 'ball', usesProj: true, unit: 'orb',
      desc: 'A drifting sphere that zaps everything near it.',
      base: { dmg: 7, cd: 4.2, count: 1, area: 1, dur: 1 },
      up: [{ dmg: 3 }, { area: 0.2 }, { count: 1 }, { dmg: 3, dur: 0.3 }, { cd: -0.8 }],
      evo: { name: 'Storm Core', tome: 'magnet', desc: 'Drags enemies in and detonates when it expires.', mod: { dmg: 3 } },
      fire(inst, s, p) {
        let a = autoAim(p, 600);
        if (a === null) return false;
        const dmg = s.dmg, ev = inst.evolved, r = 115 * s.area;
        fan(s.count, TAU / Math.max(s.count, 3), (off) => {
          const ang = a + off;
          C.zone({
            x: p.x, y: p.y, r, life: 4 * s.dur, tick: 0.3, dmg: 0, el: 'storm', src: inst.name, kind: 'ball', color: EL.storm.color,
            vx: Math.cos(ang) * 95, vy: Math.sin(ang) * 95, pull: ev ? 150 : 0,
            onTick(z) {
              let n = 0;
              PS.G.grid.query(z.x, z.y, z.r, (e) => {
                if (n >= 5) return true;
                n++;
                PS.FX.bolt(z.x, z.y, e.x, e.y, '#ffe14d');
                C.damage(e, dmg, { el: 'storm', src: inst.name });
              });
              if (n) PS.Audio.play('zap', { vol: 0.2 });
            },
            onEnd: ev ? (z) => {
              PS.FX.explosion(z.x, z.y, z.r, '#ffe14d', true);
              C.aoe(z.x, z.y, z.r, dmg * 7, { el: 'storm', src: inst.name, shock: 1, knock: 200 });
              PS.Audio.play('thunder', { vol: 0.5 });
            } : null,
          });
        });
        PS.Audio.play('zap', { vol: 0.4 });
      },
    },

    /* =============================== BLIGHT =============================== */
    flask: {
      name: 'Plague Flask', el: 'venom', icon: 'flask', usesProj: true, unit: 'flask',
      desc: 'Lobs a flask that shatters into a pool of poison.',
      base: { dmg: 6, cd: 3.0, count: 1, area: 1, dur: 1 },
      up: [{ dmg: 2 }, { area: 0.2 }, { count: 1 }, { dur: 0.4, dmg: 2 }, { count: 1 }],
      evo: { name: 'Miasma', tome: 'vitality', desc: 'Pools are far larger, slow enemies, and hit twice as hard.', mod: { area: 0.6, dmg: 10 } },
      fire(inst, s, p) {
        if (!PS.G.enemies.length) return false;
        const dmg = s.dmg, r = 75 * s.area, life = 4 * s.dur, ev = inst.evolved;
        let any = false;
        for (let i = 0; i < s.count; i++) {
          const e = i === 0 ? C.clusterPoint(430) : C.randomEnemy(430);
          if (!e) break;
          any = true;
          const tx = e.x + U.rand(-15, 15), ty = e.y + U.rand(-15, 15);
          const d = Math.hypot(tx - p.x, ty - p.y), t = 0.45;
          C.proj({
            x: p.x, y: p.y, ang: Math.atan2(ty - p.y, tx - p.x), speed: d / t, dmg: 0, el: 'venom', src: inst.name, life: t, kind: 'flask', color: EL.venom.color, noHit: true, spin: 9,
            onEnd: (pr) => {
              PS.FX.puff(pr.x, pr.y, '#8fe04a', 12);
              PS.Audio.play('poison', { vol: 0.4 });
              C.zone({ x: pr.x, y: pr.y, r, life, tick: 0.5, firstTick: 0, dmg, el: 'venom', src: inst.name, kind: 'poison', color: EL.venom.color, slow: ev ? 1 : 0 });
            },
          });
        }
        return any;
      },
    },
    spores: {
      name: 'Venom Spores', el: 'venom', icon: 'spores', usesProj: true, unit: 'spore',
      desc: 'Homing spores that stack poison on their victims.',
      base: { dmg: 8, cd: 1.6, count: 3, speed: 300 },
      up: [{ dmg: 3 }, { count: 1 }, { cd: -0.2 }, { dmg: 3, count: 1 }, { count: 2 }],
      evo: { name: 'Hive Swarm', tome: 'fortune', desc: 'Spores bounce to two more enemies.', mod: { dmg: 4 } },
      fire(inst, s, p) {
        if (!C.nearest(p.x, p.y, 520)) return false;
        const base = U.rnd() * TAU, ev = inst.evolved;
        for (let i = 0; i < s.count; i++) {
          C.proj({ x: p.x, y: p.y, ang: base + (i * TAU) / s.count, speed: s.speed, dmg: s.dmg, el: 'venom', src: inst.name, r: 6, life: 2.6, kind: 'spore', color: EL.venom.color, homing: 6.5, accel: 160, pierce: s.pierce, bounce: ev ? 2 : 0, opts: { poison: 2 } });
        }
        PS.Audio.play('poison', { vol: 0.3 });
      },
    },
    trail: {
      name: 'Caustic Wake', el: 'venom', icon: 'trail', unit: 'puddle',
      desc: 'You leave a trail of acid behind you as you move.',
      base: { dmg: 5, cd: 0.35, area: 1, dur: 1 },
      up: [{ dmg: 2 }, { area: 0.25 }, { dur: 0.4 }, { dmg: 3 }, { area: 0.25, dmg: 2 }],
      evo: { name: 'Plague Road', tome: 'swiftness', desc: 'Puddles last longer and burst when they dry up.', mod: { dmg: 3, dur: 0.5 } },
      tick(inst, s, dt, p) {
        if (inst.lx === undefined) { inst.lx = p.x; inst.ly = p.y; }
        if (U.dist2(p.x, p.y, inst.lx, inst.ly) > 34 * 34) {
          inst.lx = p.x; inst.ly = p.y;
          const dmg = s.dmg, r = 42 * s.area, ev = inst.evolved;
          C.zone({
            x: p.x, y: p.y, r, life: 3 * s.dur, tick: 0.4, dmg, el: 'venom', src: inst.name, kind: 'poison', color: EL.venom.color,
            onEnd: ev ? (z) => { PS.FX.puff(z.x, z.y, '#c8ff8a', 6); C.aoe(z.x, z.y, z.r * 1.5, dmg * 3, { el: 'venom', src: inst.name, poison: 2 }); } : null,
          });
        }
      },
    },

    /* =============================== IRON =============================== */
    blades: {
      name: 'Whirling Blades', el: 'steel', icon: 'blades', usesProj: true, unit: 'blade',
      desc: 'Blades spin tightly around you, carving up anything close.',
      base: { dmg: 12, count: 2, area: 1 },
      up: [{ dmg: 4 }, { count: 1 }, { dmg: 4, area: 0.12 }, { count: 1 }, { dmg: 6, count: 1 }],
      evo: { name: 'Bladestorm', tome: 'haste', desc: 'Every 2.5 seconds the blades are flung outward, piercing everything.', mod: { dmg: 5 } },
      tick(inst, s, dt, p) {
        inst.a = (inst.a || 0) + dt * 4.4 * (0.7 + 0.3 * p.as);
        const rad = 64 * (0.6 + 0.4 * s.area), n = s.count, br = 12;
        const o = { el: 'steel', src: inst.name, knock: 130 };
        for (let i = 0; i < n; i++) {
          const a = inst.a + (i * TAU) / n;
          const x = p.x + Math.cos(a) * rad, y = p.y + Math.sin(a) * rad;
          PS.G.orbits.push({ x, y, r: br, kind: 'blade', a: inst.a * 3 + i });
          orbitHit(inst, x, y, br + 5, s.dmg, o, 0.35);
        }
        if (inst.evolved) {
          inst.fling = (inst.fling || 2.5) - dt;
          if (inst.fling <= 0) {
            inst.fling = 2.5;
            for (let i = 0; i < n; i++) {
              const a = inst.a + (i * TAU) / n;
              C.proj({ x: p.x + Math.cos(a) * rad, y: p.y + Math.sin(a) * rad, ang: a, speed: 520, dmg: s.dmg * 1.5, el: 'steel', src: inst.name, r: 12, life: 0.9, pierce: 99, kind: 'blade', color: EL.steel.color, spin: 20, knock: 120 });
            }
            PS.Audio.play('slash', { vol: 0.4 });
          }
        }
      },
    },
    glaive: {
      name: 'Glaive', el: 'steel', icon: 'glaive', usesProj: true, unit: 'glaive',
      desc: 'A thrown glaive that cuts through enemies and returns.',
      base: { dmg: 16, cd: 1.9, count: 1, speed: 560, area: 1 },
      up: [{ dmg: 6 }, { count: 1 }, { area: 0.3, dmg: 4 }, { cd: -0.3 }, { count: 1, dmg: 6 }],
      evo: { name: 'Twin Moons', tome: 'reach', desc: 'Glaives are huge, fly farther and leave enemies bleeding.', mod: { dmg: 8, area: 0.5 } },
      fire(inst, s, p) {
        const a = autoAim(p);
        if (a === null) return false;
        const ev = inst.evolved;
        fan(s.count, 0.5, (off) => {
          C.proj({ x: p.x, y: p.y, ang: a + off, speed: s.speed, dmg: s.dmg, el: 'steel', src: inst.name, r: 16 * s.area, size: s.area, life: 3, kind: 'glaive', color: EL.steel.color, boomerang: ev ? 0.75 : 0.55, spin: 16, knock: 80, opts: ev ? { bleed: 0.8 } : null });
        });
        PS.Audio.play('slash', { vol: 0.35 });
      },
    },
    quake: {
      name: 'Earthsplitter', el: 'steel', icon: 'spikes', usesProj: true, unit: 'fissure',
      desc: 'A line of stone spikes erupts toward your enemies.',
      base: { dmg: 24, cd: 3.2, count: 1, area: 1, n: 5 },
      up: [{ dmg: 8 }, { n: 2 }, { count: 1 }, { dmg: 8, area: 0.2 }, { count: 1, cd: -0.4 }],
      evo: { name: 'Worldbreaker', tome: 'might', desc: 'Fissures tear outward in every direction.', mod: { dmg: 10, count: 3 } },
      fire(inst, s, p) {
        const a = autoAim(p, 420);
        if (a === null) return false;
        const n = s.b.n, r = 40 * s.area, lines = s.count;
        const spread = inst.evolved ? TAU / lines : 0.45;
        fan(lines, spread, (off) => {
          for (let i = 0; i < n; i++) {
            const d = 50 + i * 54 * (0.7 + 0.3 * s.area);
            C.strike({ x: p.x + Math.cos(a + off) * d, y: p.y + Math.sin(a + off) * d, r, delay: 0.05 + i * 0.07, dmg: s.dmg, el: 'steel', src: inst.name, kind: 'spike', color: '#cdb89a', opts: { knock: 220 } });
          }
        });
        PS.FX.shake(2);
        PS.Audio.play('explode', { vol: 0.3, pitch: 0.7 });
      },
    },

    /* =============================== ABYSS =============================== */
    rift: {
      name: 'Void Rift', el: 'void', icon: 'rift', usesProj: true, unit: 'rift',
      desc: 'Tears open a singularity that drags enemies in and grinds them down.',
      base: { dmg: 6, cd: 6.5, count: 1, area: 1, dur: 1 },
      up: [{ dmg: 2 }, { area: 0.2 }, { cd: -1 }, { dmg: 3, dur: 0.3 }, { count: 1 }],
      evo: { name: 'Event Horizon', tome: 'duration', desc: 'Pulls far harder and collapses in a massive blast.', mod: { dmg: 3 } },
      fire(inst, s, p) {
        if (!PS.G.enemies.length) return false;
        const dmg = s.dmg, r = 150 * s.area, ev = inst.evolved;
        let any = false;
        for (let i = 0; i < s.count; i++) {
          const e = i === 0 ? C.clusterPoint(420) : C.randomEnemy(420);
          if (!e) break;
          any = true;
          C.zone({
            x: e.x, y: e.y, r, life: 2.6 * s.dur, tick: 0.25, dmg, el: 'void', src: inst.name, kind: 'rift', color: EL.void.color, pull: ev ? 420 : 260,
            onEnd: ev ? (z) => {
              PS.FX.explosion(z.x, z.y, z.r * 0.9, '#c06bff', true);
              C.aoe(z.x, z.y, z.r * 0.9, dmg * 8, { el: 'void', src: inst.name, knock: 240 });
              PS.Audio.play('bigExplode', { vol: 0.5 });
              PS.FX.shake(4);
            } : null,
          });
        }
        if (any) PS.Audio.play('void', { vol: 0.5 });
        return any;
      },
    },
    missiles: {
      name: 'Arcane Missiles', el: 'void', icon: 'missiles', usesProj: true, unit: 'missile',
      desc: 'A volley of homing missiles that seek out enemies.',
      base: { dmg: 9, cd: 2.2, count: 4, speed: 380 },
      up: [{ dmg: 3 }, { count: 2 }, { cd: -0.3 }, { dmg: 4 }, { count: 2, cd: -0.2 }],
      evo: { name: 'Arcane Torrent', tome: 'wisdom', desc: 'Half again as many missiles, and each one explodes.', mod: { dmg: 3, count: 4 } },
      fire(inst, s, p) {
        if (!C.nearest(p.x, p.y, 540)) return false;
        inst.queue = (inst.queue || 0) + s.count;
        inst.qt = 0;
      },
      tick(inst, s, dt, p) {
        if (!inst.queue) return;
        inst.qt -= dt;
        while (inst.queue > 0 && inst.qt <= 0) {
          inst.queue--;
          inst.qt += 0.06;
          const side = inst.queue % 2 ? 1 : -1;
          const a = p.aim + Math.PI + side * U.rand(0.5, 1.4);
          C.proj({ x: p.x, y: p.y, ang: a, speed: s.speed, dmg: s.dmg, el: 'void', src: inst.name, r: 6, life: 2.4, kind: 'missile', color: EL.void.color, homing: 8, accel: 420, pierce: inst.evolved ? 0 : s.pierce, explode: inst.evolved ? 42 * s.area : 0, trail: '#c06bff' });
          PS.Audio.play('shoot', { vol: 0.2, pitch: 1.3 });
        }
      },
    },
    familiar: {
      name: 'Void Familiar', el: 'void', icon: 'eye', usesProj: true, unit: 'familiar', summon: true,
      desc: 'A floating eye follows you and blasts nearby enemies.',
      base: { dmg: 10, cd: 0.9, count: 1 },
      up: [{ dmg: 4 }, { count: 1 }, { cd: -0.12 }, { dmg: 5 }, { count: 1 }],
      evo: { name: 'Eldritch Gaze', tome: 'precision', desc: 'Shots pierce, crit far more often, and a third eye opens.', mod: { dmg: 4, count: 1 } },
      tick(inst, s, dt, p) {
        const G = PS.G;
        inst.fams = (inst.fams || []).filter((m) => !m.dead);
        const want = Math.min(s.count, 8);
        while (inst.fams.length < want) {
          const seat = inst.fams.length;
          const m = C.minion({ x: p.x, y: p.y, kind: 'familiar', life: 1e9, dmg: 0, src: inst.name, seat, range: 440 });
          m.shot = (fam, t) => {
            const cur = S.stats(inst);
            fam.atkCd = cur.cd;
            C.proj({ x: fam.x, y: fam.y, ang: fam.ang, speed: 620, dmg: cur.dmg, el: 'void', src: inst.name, r: 6, life: 1, kind: 'bolt', color: EL.void.color, pierce: cur.pierce + (inst.evolved ? 3 : 0), opts: inst.evolved ? { critBonus: 0.3 } : null });
            PS.Audio.play('shoot', { vol: 0.15, pitch: 1.5 });
          };
          inst.fams.push(m);
        }
        void G;
      },
    },

    /* =============================== CLASS PRIMARIES =============================== */
    firewave: {
      name: 'Flame Wave', el: 'fire', icon: 'wave', usesProj: true, unit: 'wave',
      desc: 'A wall of flame rolls out through everything in its path.',
      base: { dmg: 27, cd: 2.4, count: 1, area: 1, speed: 470 },
      up: [{ dmg: 6 }, { area: 0.2 }, { count: 1 }, { cd: -0.4 }, { dmg: 9 }],
      evo: { name: 'Firestorm', tome: 'swiftness', desc: 'Waves roll out in every direction and leave the ground burning where they die.', mod: { dmg: 6, count: 3 } },
      fire(inst, s, p) {
        const a = autoAim(p);
        if (a === null) return false;
        const ev = inst.evolved, n = s.count, dmg = s.dmg, area = s.area, dur = p.stats.duration, name = inst.name;
        fan(n, ev ? TAU / n : 0.5, (off) => {
          C.proj({
            x: p.x, y: p.y, ang: a + off, speed: s.speed, dmg, el: 'fire', src: name, r: 30 * area, size: 0.8 + 0.2 * area, life: 0.85, pierce: 99, kind: 'wave', color: '#ffb061', knock: 90,
            onEnd: ev ? (pr) => { C.zone({ x: pr.x, y: pr.y, r: 60 * area, life: 3 * dur, tick: 0.5, dmg: dmg * 0.18, el: 'fire', src: name, kind: 'fire', color: '#ff7a3d' }); } : null,
          });
        });
        PS.Audio.play('fire', { vol: 0.4 });
      },
    },
    blizzard: {
      name: 'Blizzard', el: 'frost', icon: 'snow', unit: 'storm',
      desc: 'A snowstorm settles where the horde is thickest, slowing and wearing down everything inside.',
      base: { dmg: 10, cd: 6, area: 1, dur: 1 },
      up: [{ dmg: 2 }, { area: 0.2 }, { dur: 0.25 }, { cd: -1 }, { dmg: 3, area: 0.15 }],
      evo: { name: 'Whiteout', tome: 'vitality', desc: 'Half again as large, and it keeps freezing what it touches.', mod: { dmg: 3 } },
      fire(inst, s, p) {
        const e = C.clusterPoint(430);
        if (!e) return false;
        const ev = inst.evolved;
        C.zone({ x: e.x, y: e.y, r: 115 * s.area * (ev ? 1.5 : 1), life: 4 * s.dur, tick: 0.5, firstTick: 0.1, dmg: s.dmg, el: 'frost', src: inst.name, kind: 'blizzard', color: EL.frost.color, slow: 1,
          opts: { freeze: ev ? 0.3 : 0.04, freezeDur: 1 } });
        PS.Audio.play('frost', { vol: 0.4 });
      },
    },
    staticfield: {
      name: 'Static Field', el: 'storm', icon: 'spark', usesProj: true, unit: 'arc',
      desc: 'Sparks leap from you to the nearest enemies, Shocking them.',
      base: { dmg: 13, cd: 0.9, count: 2, area: 1 },
      up: [{ dmg: 3 }, { count: 1 }, { area: 0.2 }, { cd: -0.15 }, { count: 1, dmg: 3 }],
      evo: { name: 'Storm Aegis', tome: 'plating', desc: 'Every spark leaps on to two more enemies, and each discharge mends you a little.', mod: { dmg: 3 } },
      fire(inst, s, p) {
        const near = [], r = 230 * s.area;
        PS.G.grid.query(p.x, p.y, r, (e) => { near.push(e); });
        if (!near.length) return false;
        near.sort((a, b) => U.dist2(a.x, a.y, p.x, p.y) - U.dist2(b.x, b.y, p.x, p.y));
        const ev = inst.evolved, o = { el: 'storm', src: inst.name, shock: 1 };
        for (let i = 0; i < Math.min(s.count, near.length); i++) {
          const e = near[i];
          if (e.dead) continue;
          if (ev) C.chain(p.x, p.y, e, s.dmg, 2, 170, { src: inst.name, shock: 1, growth: 0.8 });
          else { PS.FX.bolt(p.x, p.y, e.x, e.y, '#ffe14d'); C.damage(e, s.dmg, o); }
        }
        if (ev) p.heal(p.stats.maxHp * 0.004 * PS.G.rules.heal, true);
        PS.Audio.play('zap', { vol: 0.25, pitch: 1.4 });
      },
    },
    miasma: {
      name: 'Miasma', el: 'venom', icon: 'ghost', unit: 'cloud',
      desc: 'A cloud of rot hangs around you, poisoning whatever comes close.',
      base: { dmg: 7, cd: 0.7, area: 1 },
      up: [{ dmg: 2 }, { area: 0.18 }, { dmg: 2 }, { area: 0.18, cd: -0.1 }, { dmg: 3 }],
      evo: { name: 'Pestilence', tome: 'magnet', desc: 'The cloud lays on two stacks of Poison at a time and leaves everything in it Exposed: 20% more damage taken.', mod: { dmg: 2, area: 0.15 } },
      tick(inst, s, dt, p) {
        const r = 125 * s.area, ev = inst.evolved;
        p.miasmaR = r;
        inst.t = (inst.t || 0) - dt;
        if (inst.t > 0) return;
        inst.t += s.b.cd;
        C.aoe(p.x, p.y, r, s.dmg, { el: 'venom', src: inst.name, poison: ev ? 2 : 1 });
        if (ev) PS.G.grid.query(p.x, p.y, r, (e) => { e.exposeT = Math.max(e.exposeT, 1.2); });
      },
    },
    sword: {
      name: 'Falling Sword', el: 'steel', icon: 'swords', usesProj: true, unit: 'sword',
      desc: 'A great blade drops on the toughest enemy nearby. Likely to crit, and it opens a Bleed.',
      base: { dmg: 70, cd: 2.8, count: 1, area: 1 },
      up: [{ dmg: 18 }, { cd: -0.4 }, { count: 1 }, { dmg: 22 }, { cd: -0.5, area: 0.3 }],
      evo: { name: 'Executioner', tome: 'fortune', desc: 'Always a critical hit, and it slays outright any enemy but a boss below a fifth of its health.', mod: { dmg: 20 } },
      fire(inst, s, p) {
        const found = [];
        PS.G.grid.query(p.x, p.y, 430, (e) => { found.push(e); });
        if (!found.length) return false;
        found.sort((a, b) => b.hp - a.hp);
        const ev = inst.evolved, r = 46 * s.area;
        for (let i = 0; i < Math.min(s.count, found.length); i++) {
          const e = found[i];
          if (e.dead) continue;
          const x = e.x, y = e.y;
          PS.FX.bolt(x, y - 360, x, y, '#e8eeff', 4);
          PS.FX.ring(x, y, r + 20, '#e8eeff', 0.25);
          if (ev && !e.boss && e.hp < e.maxHp * 0.2) { PS.FX.text(x, y - e.r - 12, 'Executed', '#ffffff'); C.damage(e, e.hp * 3 + 1, { el: 'steel', src: inst.name, noCrit: true }); }
          else C.damage(e, s.dmg, { el: 'steel', src: inst.name, crit: ev ? true : undefined, critBonus: 0.3, knock: 60 });
          if (!e.dead) { e.bleedT = 3; e.bleedDps = Math.max(e.bleedDps, s.dmg * 0.12); }
          C.aoe(x, y, r, s.dmg * 0.35, { el: 'steel', src: inst.name, knock: 120 });
        }
        PS.Audio.play('crit', { vol: 0.4, pitch: 0.7 });
      },
    },
    lance: {
      name: 'Void Lance', el: 'void', icon: 'dash', usesProj: true, unit: 'lance',
      desc: 'A ray of nothing is driven through the nearest enemy and everything behind it.',
      base: { dmg: 36, cd: 2.1, count: 1, area: 1 },
      up: [{ dmg: 8 }, { cd: -0.3 }, { area: 0.3 }, { dmg: 10 }, { count: 1 }],
      evo: { name: 'Annihilation Ray', tome: 'wisdom', desc: 'Twice as wide, and everything it passes through is left Exposed: 20% more damage taken for 4 seconds.', mod: { dmg: 8 } },
      fire(inst, s, p) {
        const G = PS.G, ev = inst.evolved, len = 560, w = 22 * s.area * (ev ? 2 : 1);
        const seen = new Set();
        let any = false;
        for (let i = 0; i < s.count; i++) {
          const t = i === 0 ? C.nearest(p.x, p.y, 480) : C.randomEnemy(480);
          if (!t) break;
          any = true;
          const a = Math.atan2(t.y - p.y, t.x - p.x), x2 = p.x + Math.cos(a) * len, y2 = p.y + Math.sin(a) * len;
          PS.FX.bolt(p.x, p.y, x2, y2, '#c06bff', ev ? 7 : 4);
          seen.clear();
          // walk the ray in steps and hit each enemy once
          for (let d = 0; d <= len; d += 60) {
            G.grid.query(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 60 + w, (e) => {
              if (seen.has(e.id) || !U.segCircle(p.x, p.y, x2, y2, e.x, e.y, w + e.r)) return;
              seen.add(e.id);
              C.damage(e, s.dmg, { el: 'void', src: inst.name, ang: a, knock: 50 });
              if (ev) e.exposeT = 4;
            });
          }
        }
        if (!any) return false;
        PS.Audio.play('void', { vol: 0.4, pitch: 1.2 });
      },
    },
    cleave: {
      name: 'Cleave', el: 'steel', icon: 'cleave', primary: true, unit: 'swing',
      desc: 'A wide sword sweep in the direction you aim.',
      base: { dmg: 26, cd: 0.54, area: 1 },
      up: [{ dmg: 7 }, { area: 0.15 }, { cd: -0.06, dmg: 5 }, { dmg: 9 }, { area: 0.2, dmg: 9 }],
      fire(inst, s, p) {
        const f = p.stats.f;
        const rampage = f.rampage && p.frenzy >= p.frenzyMax;
        const range = 116 * (0.55 + 0.45 * s.area) + (f.sweeping ? 18 : 0);
        const half = rampage ? Math.PI : 1.05 + (f.sweeping ? 0.3 : 0);
        const dmg = s.dmg * (rampage ? 1.3 : 1);
        const n = C.arc(p.x, p.y, p.aim, half, range, dmg, { el: 'steel', src: inst.name, knock: 150 });
        C.deflect(p.x, p.y, range + 10, true, p.aim, half, 'Cleave reflect'); // the blade bats bullets back where they came from
        PS.FX.slash(p.x, p.y, p.aim, range, half, rampage ? '#ff6b5a' : '#e8eeff');
        p.swing = 1;
        if (n && f.bloodthirst) p.leech(Math.min(3, n) * 1.2);
        if (n) PS.FX.shake(Math.min(2.5, 0.8 + n * 0.15));
        if (f.bladeWave) {
          inst.swings = (inst.swings || 0) + 1;
          if (inst.swings >= 3) {
            inst.swings = 0;
            C.proj({ x: p.x, y: p.y, ang: p.aim, speed: 620, dmg: s.dmg * 0.9, el: 'steel', src: 'Blade Wave', r: 26, life: 0.75, pierce: 99, kind: 'wave', color: '#e8eeff', knock: 120 });
          }
        }
        PS.Audio.play('slash', { vol: 0.5 });
      },
    },
    firebolt: {
      name: 'Firebolt', el: 'fire', icon: 'firebolt', primary: true, usesProj: true, unit: 'bolt',
      desc: 'A bolt of flame that bursts on impact, fired where you aim.',
      base: { dmg: 15, cd: 0.62, count: 1, area: 1, speed: 540 },
      up: [{ dmg: 5 }, { area: 0.2 }, { count: 1 }, { dmg: 6, cd: -0.06 }, { dmg: 8 }],
      fire(inst, s, p) {
        const f = p.stats.f;
        let dmg = s.dmg, r = 46 * s.area * (f.combustion ? 1.2 : 1), size = 1;
        inst.casts = (inst.casts || 0) + 1;
        const big = f.overload && inst.casts % 5 === 0;
        if (big) { dmg *= 3; r *= 2; size = 1.9; }
        const count = s.count + (f.twinBolt ? 1 : 0);
        fan(count, 0.13, (off) => {
          C.proj({
            x: p.x + Math.cos(p.aim) * 14, y: p.y + Math.sin(p.aim) * 14, ang: p.aim + off, speed: s.speed * (big ? 0.8 : 1), dmg, el: 'fire', src: inst.name,
            r: 8 * size, size, life: 1.1, kind: 'fireball', color: EL.fire.color, explode: r, knock: big ? 200 : 70, trail: '#ff9a4d', cut: true,
            onHit: f.hotStreak ? (pr, e, wasBurning) => {
              if (wasBurning && U.rnd() < 0.3) {
                PS.FX.explosion(e.x, e.y, r * 1.3, '#ffd06b');
                C.aoe(e.x, e.y, r * 1.3, dmg, { el: 'fire', src: 'Hot Streak', noProc: true });
              }
            } : null,
          });
        });
        p.swing = 1;
        PS.Audio.play(big ? 'fire' : 'shoot', { vol: big ? 0.6 : 0.4 });
      },
    },
    longbow: {
      name: 'Longbow', el: 'steel', icon: 'bow', primary: true, usesProj: true, unit: 'arrow',
      desc: 'Fast, piercing arrows loosed where you aim.',
      base: { dmg: 14, cd: 0.42, count: 1, speed: 860, pierce: 2 },
      up: [{ dmg: 4 }, { pierce: 1, dmg: 2 }, { count: 1 }, { cd: -0.05, dmg: 3 }, { dmg: 6 }],
      fire(inst, s, p, isEcho, extra) {
        const f = p.stats.f;
        inst.shots = (inst.shots || 0) + 1;
        const head = f.headshot && inst.shots % 6 === 0;
        const count = s.count + (p.galeT > 0 ? 1 : 0) + (extra || 0);
        // copy what the closures below need: `s` is a shared scratch object and will be stale by the time an arrow lands
        const baseDmg = s.dmg, spd = s.speed, basePierce = s.pierce;
        const mk = (ang, dmg, pierce, isHead, isSplit) => C.proj({
          x: p.x + Math.cos(ang) * 12, y: p.y + Math.sin(ang) * 12, ang, speed: spd * (isHead ? 1.4 : 1), dmg, el: 'steel', src: isHead ? 'Headshot' : inst.name,
          r: isHead ? 9 : 5, size: isHead ? 1.6 : 1, life: 0.95, pierce, cut: true, kind: 'arrow', color: isHead ? '#ffe9a8' : (f.poisonTips ? '#b8f078' : '#f1e7cf'), knock: isHead ? 160 : 50,
          opts: { crit: isHead ? true : undefined, poison: f.poisonTips ? 1 : 0 },
          onHit: (pr, e) => {
            if (f.piercing) pr.dmg *= 1.15;
            if (f.splitShot && !isSplit && pr.hits === 1) {
              for (let k = -1; k <= 1; k += 2) {
                const sp = mk(pr.rot + k * 0.5, baseDmg * 0.6, 1, false, true);
                if (sp) { sp.x = e.x; sp.y = e.y; sp.hit = new Set([e.id]); sp.life = 0.5; }
              }
            }
          },
        });
        fan(count, 0.09, (off) => mk(p.aim + off, head ? baseDmg * 3 : baseDmg, head ? 99 : basePierce + (f.piercing ? 2 : 0), head, false));
        p.swing = 1;
        PS.Audio.play('arrow', { vol: 0.4 });
      },
    },
    arc: {
      name: 'Arc Lash', el: 'storm', icon: 'thunder', primary: true, usesProj: true, unit: 'arc',
      desc: 'A lash of lightning that strikes what you aim at in an instant, then leaps to enemies nearby, weaker with every leap. With no one left to leap to, it grounds itself in the last enemy.',
      base: { dmg: 14, cd: 0.5, count: 1, jumps: 3 },
      up: [{ dmg: 4 }, { jumps: 1, dmg: 2 }, { count: 1 }, { cd: -0.06, dmg: 3 }, { dmg: 5, jumps: 1 }],
      fire(inst, s, p) {
        const G = PS.G, f = p.stats.f, RANGE = 400, CONE = 0.6;
        // the lash goes for whatever stands closest to the line of aim: one target per arc
        const found = [];
        G.grid.query(p.x, p.y, RANGE, (e) => {
          const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
          const off = Math.abs(U.angDiff(p.aim, Math.atan2(dy, dx)));
          if (off > CONE && d > 60) return;
          found.push({ e, k: d + off * 260 });
        });
        found.sort((a, b) => a.k - b.k);
        inst.casts = (inst.casts || 0) + 1;
        const bolt = f.thunderbolt && inst.casts % 5 === 0;
        const full = f.capacitor && p.charge >= 1;
        let dmg = s.dmg * (bolt ? 3 : 1);
        const jumps = s.b.jumps + (f.forked ? 2 : 0);
        const o = { el: 'storm', src: inst.name, growth: bolt ? 1 : 0.85, color: bolt ? '#ffffff' : '#9fe8ff' };
        if (f.staticShock) o.shock = 1;
        p.swing = 1;
        if (!found.length) {
          // nothing in reach: the lash still cracks the air in front of you, and swats bullets out of it
          const x2 = p.x + Math.cos(p.aim) * 230, y2 = p.y + Math.sin(p.aim) * 230;
          PS.FX.bolt(p.x, p.y, x2, y2, '#9fe8ff');
          for (let i = 1; i <= 3; i++) C.deflect(p.x + (x2 - p.x) * i / 3, p.y + (y2 - p.y) * i / 3, 46, false);
          PS.Audio.play('zap', { vol: 0.25, pitch: 1.3 });
          return;
        }
        const n = Math.min(s.count, found.length);
        for (let i = 0; i < n; i++) {
          const e = found[i].e, ex = e.x, ey = e.y;
          for (let k = 1; k <= 3; k++) C.deflect(p.x + (ex - p.x) * k / 3, p.y + (ey - p.y) * k / 3, 42, false);
          if (full && i === 0) {
            // a full capacitor empties into the first target
            p.charge = 0;
            const r = 120 * s.area;
            PS.FX.explosion(ex, ey, r, '#9fe8ff');
            PS.FX.bolt(ex + U.frand(-30, 30), ey - 320, ex, ey, '#ffffff', 3);
            C.aoe(ex, ey, r, dmg * 4, { el: 'storm', src: 'Discharge', shock: 1, knock: 160 });
            PS.Audio.play('thunder', { vol: 0.5 });
          }
          // leap from enemy to enemy; with nobody left to leap to, what is left of the lash grounds itself in the last one
          const seen = new Set();
          let cur = e, cx = p.x, cy = p.y, d = dmg, back = 0;
          for (let k = 0; k <= jumps && cur; k++) {
            seen.add(cur.id);
            PS.FX.bolt(cx, cy, cur.x, cur.y, o.color);
            cx = cur.x; cy = cur.y;
            C.damage(cur, d, o);
            d *= o.growth;
            const next = C.nearest(cx, cy, 180, (x) => !seen.has(x.id));
            if (next) cur = next;
            else if (cur.dead || ++back > 2) cur = null;
            else d *= 0.6;
          }
        }
        PS.Audio.play('zap', { vol: bolt ? 0.6 : 0.4, pitch: bolt ? 0.7 : 1.15 });
      },
    },
    scythe: {
      name: 'Soul Scythe', el: 'void', icon: 'scythe', primary: true, usesProj: true, unit: 'scythe',
      desc: 'A spectral scythe that spins out where you aim and returns.',
      base: { dmg: 18, cd: 0.95, count: 1, speed: 470, area: 1 },
      up: [{ dmg: 5 }, { area: 0.25 }, { cd: -0.12 }, { count: 1 }, { dmg: 8 }],
      fire(inst, s, p) {
        const f = p.stats.f;
        const count = s.count + (f.deathsDoor ? 1 : 0);
        fan(count, 0.42, (off) => {
          C.proj({
            x: p.x, y: p.y, ang: p.aim + off, speed: s.speed, dmg: s.dmg, el: 'void', src: inst.name, r: 20 * (0.6 + 0.4 * s.area), size: 0.6 + 0.4 * s.area, life: 3,
            kind: 'scythe', color: f.withering ? '#a6f07a' : EL.void.color, boomerang: 0.5, spin: -15, knock: 70, cut: true,
            opts: { poison: f.withering ? 1 : 0, execute: f.deathsDoor ? 0.2 : 0 },
          });
        });
        p.swing = 1;
        PS.Audio.play('scythe', { vol: 0.45 });
      },
    },
  };

  for (const id in DEFS) DEFS[id].id = id;

  const UP_FMT = {
    dmg: (v, d) => `+${v} damage`,
    count: (v, d) => `+${v} ${d.unit || 'projectile'}${v > 1 ? 's' : ''}`,
    cd: (v) => `${Math.abs(v)}s faster`,
    area: (v) => `+${Math.round(v * 100)}% area`,
    dur: (v) => `+${Math.round(v * 100)}% duration`,
    pierce: (v) => `+${v} pierce`,
    jumps: (v) => `+${v} jumps`,
    n: (v) => `+${v} eruptions`,
    speed: (v) => `+${v} speed`,
  };

  const S = {
    DEFS,
    MAX_LEVEL,
    make(id) {
      const def = DEFS[id];
      const inst = { id, def, name: def.name, level: 1, over: 0, cd: 0.3, evolved: false, echoT: 0, b: null };
      S.rebuild(inst);
      return inst;
    },
    /** recompute merged base numbers for the instance's level */
    rebuild(inst) {
      const def = inst.def, b = Object.assign({}, def.base);
      for (let i = 0; i < inst.level - 1 && i < def.up.length; i++) {
        for (const k in def.up[i]) b[k] = (b[k] || 0) + def.up[i][k];
      }
      if (inst.evolved && def.evo && def.evo.mod) {
        for (const k in def.evo.mod) b[k] = (b[k] || 0) + def.evo.mod[k];
      }
      if (b.cd !== undefined) b.cd = Math.max(0.1, b.cd);
      inst.b = b;
      inst.name = inst.evolved ? def.evo.name : def.name;
    },
    stats(inst) {
      const p = PS.G.player, s = p.stats, b = inst.b, def = inst.def;
      st.b = b;
      st.dmg = b.dmg * (1 + inst.over) * p.dm * s.el[def.el] * (def.summon ? s.summon : 1);
      // class attacks cannot evolve, so they grow with the hero instead and stay the heart of the build
      if (def.primary) st.dmg *= 1 + 0.045 * (p.level - 1);
      st.cd = Math.max(0.07, (b.cd || 1) / p.as);
      st.count = (b.count || 1) + (def.usesProj ? s.proj : 0);
      st.area = (b.area || 1) * s.area;
      st.speed = (b.speed || 1) * s.projSpd;
      st.pierce = (b.pierce || 0) + s.pierce;
      st.dur = (b.dur || 1) * s.duration;
      return st;
    },
    update(inst, dt, p) {
      const def = inst.def;
      if (def.tick) def.tick(inst, S.stats(inst), dt, p);
      if (!def.fire) return;
      if (inst.echoT > 0) {
        inst.echoT -= dt;
        if (inst.echoT <= 0) def.fire(inst, S.stats(inst), p, true);
      }
      inst.cd -= dt;
      if (inst.cd > 0) return;
      if (def.primary && !p.wantFire) { inst.cd = 0; return; }
      const cur = S.stats(inst);
      const cd = cur.cd;
      if (def.fire(inst, cur, p) === false) { inst.cd = 0.15; return; }
      inst.cd = Math.max(inst.cd + cd, cd * 0.5);
      const echo = p.stats.f.echo;
      if (echo && U.rnd() < echo) inst.echoT = Math.min(0.14, cd * 0.5);
    },
    /** human text for what levelling this skill to `level` adds */
    upText(def, level) {
      const u = def.up[level - 2];
      if (!u) return '';
      return Object.keys(u).map((k) => (UP_FMT[k] ? UP_FMT[k](u[k], def) : k)).join(', ');
    },
    /** ids offered from the level-up pool (class primaries excluded) */
    poolIds() {
      return Object.keys(DEFS).filter((id) => !DEFS[id].primary);
    },
  };

  PS.Skills = S;
})();
