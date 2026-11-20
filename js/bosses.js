/* POWERSCALING — bosses: four set-piece fights with telegraphed attack patterns, and a fifth that waits in overtime */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, C = PS.Combat, TAU = U.TAU;

  function ringBullets(e, n, speed, dmg, offset, color, r) {
    for (let i = 0; i < n; i++) C.ebullet({ x: e.x, y: e.y, ang: offset + (i * TAU) / n, speed, dmg, color, r: r || 8, life: 6 });
  }
  function summon(e, type, n, elite) {
    for (let i = 0; i < n; i++) {
      const a = (i * TAU) / n + U.rnd();
      // a boss's own guard comes without affixes: the fight is the boss
      const m = PS.Enemies.spawn(type, e.x + Math.cos(a) * (e.r + 40), e.y + Math.sin(a) * (e.r + 40), elite ? { elite: true, noAffix: true } : null);
      if (m) PS.FX.puff(m.x, m.y, '#ff4d6d', 5);
    }
  }
  function chargeAttack(e, bs, dt, p, speed, count) {
    // repeated: 0.8s telegraph, 0.65s dash, 0.45s recover
    const cycle = 1.9, k = Math.floor(bs.at / cycle), t = bs.at - k * cycle;
    if (k >= count) return true;
    if (bs.step !== k) {
      bs.step = k;
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      bs.dx = Math.cos(a); bs.dy = Math.sin(a);
      C.hazard({ kind: 'beam', x: e.x, y: e.y, ang: a, len: speed * 0.65 + e.r, w: e.r * 2, delay: 0.8, dur: 0, dmg: 0, harmless: true, owner: e, color: '#ff4d6d' });
      PS.Audio.play('telegraph');
    }
    if (t >= 0.8 && t < 1.45) {
      e.x += bs.dx * speed * dt;
      e.y += bs.dy * speed * dt;
      e.ang = Math.atan2(bs.dy, bs.dx);
      if (U.rnd() < 0.6) PS.FX.spark(e.x + U.rand(-e.r, e.r), e.y + U.rand(-e.r, e.r), e.def.color);
    }
    return false;
  }

  const BOSSES = [
    /* ---------------------------------------------------------------- 0: Gorath */
    {
      id: 'gorath', name: 'Gorath', title: 'the Bonecrusher', r: 46, hp: 800, spd: 80, dmg: 18, atk: 20, xp: 120, color: '#d1482f', sprite: 'boss0',
      cd: 2.1, pattern: ['slam', 'charge', 'summon', 'slam', 'charge'],
      attacks: {
        slam(e, bs, dt, p) {
          if (!bs.init) {
            bs.init = true;
            C.hazard({ kind: 'circle', x: e.x, y: e.y, r: 205, delay: 0.9, dmg: e.atk, owner: e });
            PS.Audio.play('telegraph');
          }
          if (bs.at >= 0.9 && !bs.fired) {
            bs.fired = true;
            C.hazard({ kind: 'ring', x: e.x, y: e.y, speed: 330, maxR: 600, dmg: e.atk * 0.8, rad: 150 });
            if (bs.rage) C.hazard({ kind: 'ring', x: e.x, y: e.y, speed: 210, maxR: 520, dmg: e.atk * 0.8, rad: 90 });
            PS.FX.shake(8);
            PS.Audio.play('bigExplode', { vol: 0.7 });
          }
          return bs.at >= 1.4;
        },
        charge(e, bs, dt, p) { return chargeAttack(e, bs, dt, p, 740, bs.rage ? 2 : 1); },
        summon(e, bs) {
          if (!bs.init) { bs.init = true; summon(e, 'imp', 8); if (bs.rage) summon(e, 'bat', 5); PS.Audio.play('summon'); e.flash = 0.3; }
          return bs.at >= 0.8;
        },
      },
    },
    /* ---------------------------------------------------------------- 1: Vexara */
    {
      id: 'vexara', name: 'Vexara', title: 'the Hive Mother', r: 42, hp: 950, spd: 64, dmg: 20, atk: 24, xp: 300, color: '#8fe04a', sprite: 'boss1',
      cd: 1.9, keep: 250, pattern: ['spiral', 'pools', 'brood', 'burst', 'pools'],
      attacks: {
        spiral(e, bs, dt) {
          bs.acc = (bs.acc || 0) + dt;
          const arms = bs.rage ? 3 : 2;
          while (bs.acc >= 0.085) {
            bs.acc -= 0.085;
            bs.a = (bs.a || 0) + 0.27;
            for (let k = 0; k < arms; k++) C.ebullet({ x: e.x, y: e.y, ang: bs.a + (k * TAU) / arms, speed: 185, dmg: e.atk * 0.7, color: '#b6ff5a', r: 7, life: 5 });
          }
          return bs.at >= 3.2;
        },
        pools(e, bs, dt, p) {
          if (!bs.init) {
            bs.init = true;
            const n = bs.rage ? 8 : 5;
            C.hazard({ kind: 'circle', x: p.x, y: p.y, r: 88, delay: 1.0, dmg: e.atk, color: '#8fe04a', owner: e });
            for (let i = 1; i < n; i++) {
              const a = U.rnd() * TAU, d = U.rand(90, 250);
              C.hazard({ kind: 'circle', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 88, delay: 1.0 + i * 0.08, dmg: e.atk, color: '#8fe04a', owner: e });
            }
            PS.Audio.play('telegraph');
          }
          return bs.at >= 1.5;
        },
        brood(e, bs) {
          if (!bs.init) { bs.init = true; summon(e, 'spitter', 3); summon(e, 'bat', 6); PS.Audio.play('summon'); e.flash = 0.3; }
          return bs.at >= 0.8;
        },
        burst(e, bs) {
          const k = Math.floor(bs.at / 0.5);
          if (k !== bs.step && k < 3) {
            bs.step = k;
            ringBullets(e, 18, 200, e.atk * 0.7, k * 0.17, '#b6ff5a');
            PS.Audio.play('shoot', { vol: 0.5, pitch: 0.6 });
          }
          return bs.at >= 1.6;
        },
      },
    },
    /* ---------------------------------------------------------------- 2: Kaelthyr */
    {
      id: 'kaelthyr', name: 'Kaelthyr', title: 'the Storm Lich', r: 40, hp: 1300, spd: 72, dmg: 24, atk: 30, xp: 700, color: '#6fd8ff', sprite: 'boss2',
      cd: 1.7, keep: 230, pattern: ['beams', 'blink', 'fans', 'field', 'blink'],
      attacks: {
        blink(e, bs, dt, p) {
          if (!bs.init) {
            bs.init = true;
            PS.FX.puff(e.x, e.y, '#6fd8ff', 16);
            const a = U.rnd() * TAU;
            e.x = p.x + Math.cos(a) * 190; e.y = p.y + Math.sin(a) * 190;
            PS.FX.puff(e.x, e.y, '#6fd8ff', 16);
            C.hazard({ kind: 'circle', x: e.x, y: e.y, r: 235, delay: 1.0, dmg: e.atk, color: '#6fd8ff', owner: e });
            PS.Audio.play('void', { vol: 0.6 });
          }
          if (bs.rage && bs.at >= 1.0 && !bs.fired) { bs.fired = true; ringBullets(e, 14, 210, e.atk * 0.6, U.rnd(), '#9fe6ff'); }
          return bs.at >= 1.4;
        },
        beams(e, bs, dt, p) {
          const k = Math.floor(bs.at / 1.35);
          if (k !== bs.step && k < 3) {
            bs.step = k;
            const a = Math.atan2(p.y - e.y, p.x - e.x);
            const offs = bs.rage ? [-0.5, 0, 0.5] : [0];
            for (const o of offs) C.hazard({ kind: 'beam', x: e.x, y: e.y, ang: a + o, len: 1000, w: 40, delay: 1.0, dur: 0.4, dmg: e.atk, track: o === 0 ? 2.2 : 0, follow: e, owner: e, color: '#6fd8ff' });
            PS.Audio.play('telegraph');
          }
          return bs.at >= 4.3;
        },
        fans(e, bs, dt, p) {
          const k = Math.floor(bs.at / 0.5);
          if (k !== bs.step && k < 3) {
            bs.step = k;
            const a = Math.atan2(p.y - e.y, p.x - e.x);
            for (let i = -4; i <= 4; i++) C.ebullet({ x: e.x, y: e.y, ang: a + i * 0.15, speed: 235, dmg: e.atk * 0.65, color: '#9fe6ff', r: 7, life: 5 });
            PS.Audio.play('frost', { vol: 0.5 });
          }
          return bs.at >= 1.7;
        },
        field(e, bs, dt, p) {
          const k = Math.floor(bs.at / 0.7);
          if (k !== bs.step && k < 3) {
            bs.step = k;
            for (let i = 0; i < (bs.rage ? 9 : 6); i++) {
              const a = U.rnd() * TAU, d = i === 0 ? 0 : U.rand(60, 280);
              C.hazard({ kind: 'circle', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 76, delay: 0.85, dmg: e.atk, color: '#ffe14d', owner: e });
            }
            PS.Audio.play('telegraph');
          }
          return bs.at >= 2.5;
        },
      },
    },
    /* ---------------------------------------------------------------- 3: Azhmodai */
    {
      id: 'azhmodai', name: 'Azhmodai', title: 'the Rift Lord', r: 54, hp: 1700, spd: 68, dmg: 30, atk: 34, xp: 1500, color: '#c06bff', sprite: 'boss3',
      cd: 1.5, pattern: ['cross', 'rain', 'hell', 'charge', 'rain'], final: true,
      attacks: {
        cross(e, bs) {
          if (!bs.init) {
            bs.init = true;
            const n = bs.rage ? 6 : 4, dir = U.rnd() < 0.5 ? 1 : -1, a0 = U.rnd() * TAU;
            for (let i = 0; i < n; i++) C.hazard({ kind: 'beam', x: e.x, y: e.y, ang: a0 + (i * TAU) / n, len: 950, w: 34, delay: 1.2, dur: 4, dmg: e.atk * 0.7, rot: 0.5 * dir, follow: e, owner: e, color: '#c06bff' });
            PS.Audio.play('telegraph');
          }
          const k = Math.floor(bs.at / 1.1);
          if (k !== bs.step && bs.at > 1.2) { bs.step = k; ringBullets(e, 10, 150, e.atk * 0.6, k * 0.3, '#e3b8ff'); }
          return bs.at >= 5.4;
        },
        hell(e, bs, dt) {
          const k = Math.floor(bs.at / 0.55);
          if (k !== bs.step && bs.at < 4) { bs.step = k; ringBullets(e, 16, 190, e.atk * 0.6, (k % 2) * 0.196, '#ff6bd6'); PS.Audio.play('shoot', { vol: 0.4, pitch: 0.5 }); }
          bs.acc = (bs.acc || 0) + dt;
          while (bs.acc >= 0.11 && bs.at < 4) {
            bs.acc -= 0.11;
            bs.a = (bs.a || 0) + 0.31;
            C.ebullet({ x: e.x, y: e.y, ang: bs.a, speed: 230, dmg: e.atk * 0.6, color: '#e3b8ff', r: 7, life: 5 });
            if (bs.rage) C.ebullet({ x: e.x, y: e.y, ang: -bs.a, speed: 230, dmg: e.atk * 0.6, color: '#e3b8ff', r: 7, life: 5 });
          }
          return bs.at >= 4.4;
        },
        rain(e, bs, dt, p) {
          const k = Math.floor(bs.at / 0.17);
          if (k !== bs.step && k < (bs.rage ? 18 : 13)) {
            bs.step = k;
            const a = U.rnd() * TAU, d = k % 3 === 0 ? 0 : U.rand(40, 240);
            C.hazard({ kind: 'circle', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 92, delay: 0.9, dmg: e.atk, color: '#c06bff', owner: e });
            if (k % 3 === 0) PS.Audio.play('telegraph', { vol: 0.5 });
          }
          return bs.at >= (bs.rage ? 4.1 : 3.3);
        },
        charge(e, bs, dt, p) { return chargeAttack(e, bs, dt, p, 820, 2); },
      },
    },
    /* ---------------------------------------------------------------- 4: Solenne (overtime only) */
    {
      id: 'solenne', name: 'Solenne', title: 'the Dying Star', r: 50, hp: 1700, spd: 70, dmg: 30, atk: 34, xp: 1500, color: '#ffc46b', sprite: 'boss4',
      cd: 1.5, keep: 250, pattern: ['spiral', 'lattice', 'nova', 'gravity', 'flare'], overtime: true,
      attacks: {
        // two arms of bullets wind outward: walk with the turn, or Ward a hole in it
        spiral(e, bs, dt) {
          bs.acc = (bs.acc || 0) + dt;
          while (bs.acc >= 0.09 && bs.at < 3.6) {
            bs.acc -= 0.09;
            bs.a = (bs.a || 0) + 0.21;
            const arms = bs.rage ? 3 : 2;
            for (let i = 0; i < arms; i++) C.ebullet({ x: e.x, y: e.y, ang: bs.a + (i * TAU) / arms, speed: 200, dmg: e.atk * 0.6, color: '#ffd89a', r: 7, life: 5 });
          }
          return bs.at >= 4;
        },
        // a checkerboard of blasts under the hero, then the squares in between: stand in a gap, then step into the scorched one
        lattice(e, bs, dt, p) {
          const k = Math.floor(bs.at / 0.95);
          if (k !== bs.step && k < (bs.rage ? 3 : 2)) {
            bs.step = k;
            if (k === 0) { bs.gx = p.x; bs.gy = p.y; }
            const cell = 150;
            for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
              if (((i + j) & 1) !== (k & 1)) continue;
              C.hazard({ kind: 'circle', x: bs.gx + i * cell, y: bs.gy + j * cell, r: 70, delay: 0.9, dmg: e.atk, color: '#ffc46b', owner: e });
            }
            PS.Audio.play('telegraph');
          }
          return bs.at >= (bs.rage ? 3.9 : 2.9);
        },
        // three shockwaves, each faster than the last: dash through the rings
        nova(e, bs) {
          const k = Math.floor(bs.at / 0.75);
          if (k !== bs.step && k < 3) {
            bs.step = k;
            C.hazard({ kind: 'ring', x: e.x, y: e.y, speed: 250 + k * 70, maxR: 720, dmg: e.atk * 0.8, rad: e.r, color: '#ffc46b' });
            PS.FX.shake(4);
            PS.Audio.play('bossWarn', { vol: 0.4, pitch: 1.4 });
          }
          if (bs.rage && bs.at >= 2.2 && !bs.fired) { bs.fired = true; ringBullets(e, 18, 180, e.atk * 0.6, U.rnd(), '#ffd89a'); }
          return bs.at >= 2.8;
        },
        // the star draws everything in, then bursts: run against the pull, and dash clear before it goes off
        gravity(e, bs, dt, p) {
          if (!bs.init) {
            bs.init = true;
            C.hazard({ kind: 'circle', x: e.x, y: e.y, r: 270, delay: 2.0, dmg: e.atk * 1.3, color: '#ffc46b', owner: e });
            PS.FX.portal(e.x, e.y, 270, '#ffc46b');
            PS.Audio.play('void', { vol: 0.6, pitch: 0.7 });
          }
          if (bs.at < 2.0 && p.dashT <= 0) {
            const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
            if (d > 30 && d < 700) { const pull = (bs.rage ? 150 : 120) * dt; p.x += (dx / d) * pull; p.y += (dy / d) * pull; }
          }
          return bs.at >= 2.5;
        },
        // a fan of rays, twice: stand between two of them
        flare(e, bs, dt, p) {
          const k = Math.floor(bs.at / 1.5);
          if (k !== bs.step && k < 2) {
            bs.step = k;
            const a = Math.atan2(p.y - e.y, p.x - e.x) + (k ? 0.2 : 0), n = bs.rage ? 4 : 3;
            for (let i = -n; i <= n; i++) C.hazard({ kind: 'beam', x: e.x, y: e.y, ang: a + i * 0.4, len: 950, w: 30, delay: 1.0, dur: 0.35, dmg: e.atk, follow: e, owner: e, color: '#ffc46b' });
            PS.Audio.play('telegraph');
          }
          return bs.at >= 3.2;
        },
      },
    },
    /* ---------------------------------------------------------------- 5: Veyra (overtime only) */
    {
      id: 'veyra', name: 'Veyra', title: 'the Mirror', r: 44, hp: 1700, spd: 78, dmg: 30, atk: 34, xp: 1500, color: '#ffb3e6', sprite: 'boss5',
      cd: 1.4, keep: 240, pattern: ['echo', 'shards', 'cage', 'sweep', 'reflections'], overtime: true,
      attacks: {
        // every step you take is answered a moment later: keep walking and nothing lands; stop, or double back, and it does
        echo(e, bs, dt, p) {
          const k = Math.floor(bs.at / (bs.rage ? 0.22 : 0.3));
          if (k !== bs.step && bs.at < 3.2) {
            bs.step = k;
            C.hazard({ kind: 'circle', x: p.x, y: p.y, r: 62, delay: 0.85, dmg: e.atk, color: '#ffb3e6', owner: e });
            if (k % 3 === 0) PS.Audio.play('telegraph', { vol: 0.4 });
          }
          return bs.at >= 4.2;
        },
        // aimed volleys with a mirrored pair to either side
        shards(e, bs, dt, p) {
          const k = Math.floor(bs.at / 0.55);
          if (k !== bs.step && k < 4) {
            bs.step = k;
            const a = Math.atan2(p.y - e.y, p.x - e.x);
            for (const side of bs.rage ? [-0.9, -0.45, 0, 0.45, 0.9] : [-0.6, 0, 0.6]) {
              for (let i = -1; i <= 1; i++) C.ebullet({ x: e.x, y: e.y, ang: a + side + i * 0.09, speed: 240, dmg: e.atk * 0.6, color: '#ffd0f0', r: 7, life: 5 });
            }
            PS.Audio.play('shoot', { vol: 0.4, pitch: 0.7 });
          }
          return bs.at >= 2.6;
        },
        // a ring of blasts closes around you, then the middle goes: stand inside the ring, and leave the moment it lands
        cage(e, bs, dt, p) {
          if (!bs.init) {
            bs.init = true;
            bs.gx = p.x; bs.gy = p.y;
            const n = 10, off = U.rnd() * TAU;
            for (let i = 0; i < n; i++) C.hazard({ kind: 'circle', x: bs.gx + Math.cos(off + (i * TAU) / n) * 215, y: bs.gy + Math.sin(off + (i * TAU) / n) * 215, r: 72, delay: 1.0, dmg: e.atk, color: '#ffb3e6', owner: e });
            PS.Audio.play('telegraph');
          }
          if (bs.at >= 0.75 && !bs.fired) {
            bs.fired = true;
            C.hazard({ kind: 'circle', x: bs.gx, y: bs.gy, r: 150, delay: bs.rage ? 0.95 : 1.15, dmg: e.atk * 1.2, color: '#ffb3e6', owner: e });
          }
          return bs.at >= 2.4;
        },
        // two rays turn about her like the hands of a clock, one against the other
        sweep(e, bs) {
          if (!bs.init) {
            bs.init = true;
            const a0 = U.rnd() * TAU;
            for (const dir of [1, -1]) {
              for (let i = 0; i < (bs.rage ? 2 : 1); i++) C.hazard({ kind: 'beam', x: e.x, y: e.y, ang: a0 + (dir > 0 ? 0 : Math.PI * 0.5) + i * Math.PI, len: 900, w: 32, delay: 1.1, dur: 3.6, dmg: e.atk * 0.7, rot: 0.75 * dir, follow: e, owner: e, color: '#ffb3e6' });
            }
            PS.Audio.play('telegraph');
          }
          return bs.at >= 4.9;
        },
        // she steps out of herself: wraiths, quick and brittle
        reflections(e, bs) {
          if (!bs.init) {
            bs.init = true;
            summon(e, 'wraith', bs.rage ? 8 : 5, false);
            PS.Audio.play('summon', { vol: 0.6 });
          }
          return bs.at >= 1.2;
        },
      },
    },
  ];
  BOSSES.forEach((b, i) => { b.idx = i; b.boss = true; b.mass = 999; b.ai = 'boss'; });

  const B = {
    DEFS: BOSSES,
    /** endlessK: 0 for the scripted fight, 1+ for repeat appearances in overtime */
    spawn(idx, endlessK) {
      const G = PS.G, def = BOSSES[idx];
      const pos = PS.Director.ringPos(-30);
      // boss health is a multiple of the horde's current toughness, so fights stay a similar length all run
      const hpMult = PS.Director.hpMult(true) * G.rules.bossHp * (endlessK ? (BOSSES[3].hp / def.hp) * 1.15 : 1);
      const e = PS.Enemies.spawn(def, pos.x, pos.y, { hpMult });
      const dm = PS.Director.dmgMult();
      e.atk = def.atk * dm * (endlessK ? 1.15 : 1);
      e.atkBase = e.atk; e.dmgBase = e.dmg;
      e.spawnT = 1.4;
      e.bs = { t: 2.2, atk: null, at: 0, n: 0, rage: endlessK > 0, phase2: false };
      e.endlessK = endlessK;
      e.score = 2500 * (Math.min(idx, 3) + 1) * (endlessK ? 1 + endlessK : 1); // capped at the Rift Lord's worth: server.ts scoreBounds assumes it
      G.boss = e;
      e.bornAt = G.time;
      e.hurtAt = G.dmgTaken;
      PS.UI.bossIntro(def);
      PS.Audio.play('bossWarn');
      PS.Audio.music('boss');
      PS.FX.shake(6);
      PS.FX.portal(e.x, e.y, e.r * 3.5, def.color);
      return e;
    },
    update(e, dt, sp, dx, dy, d) {
      const G = PS.G, p = G.player, def = e.def, bs = e.bs;
      if (e.spawnT > 0) return;
      e.ang = Math.atan2(dy, dx);

      // overlong fights escalate both ways so they always resolve: the boss hits harder and its guard crumbles
      const late = Math.floor((G.time - e.bornAt - 75) / 10);
      if (late >= 0) {
        if (!bs.frenzy) { bs.frenzy = true; PS.UI.toast(def.name + ' is done toying with you', 'skull'); PS.Audio.play('bossWarn', { vol: 0.5, pitch: 1.2 }); }
        e.atk = e.atkBase * (1.1 + late * 0.1);
        e.dmg = e.dmgBase * (1.1 + late * 0.1);
        e.taken = 1.15 + late * 0.15;
      }

      // enrage / phase change
      if (!bs.rage && e.hp < e.maxHp * G.rules.bossRage) {
        bs.rage = true;
        e.flash = 0.4;
        PS.FX.ring(e.x, e.y, 260, def.color, 0.5);
        PS.FX.rays(e.x, e.y, 300, def.color, 8, 0.6);
        PS.UI.toast(def.name + ' is enraged', 'skull');
      }
      if (def.final && !bs.phase2 && e.hp < e.maxHp * 0.5) {
        bs.phase2 = true;
        e.spawnT = 1.2;
        PS.FX.flash('#c06bff', 0.4);
        PS.FX.shake(10);
        C.hazard({ kind: 'ring', x: e.x, y: e.y, speed: 380, maxR: 700, dmg: e.atk * 0.7, rad: 60, color: '#c06bff' });
        summon(e, 'knight', 2, true);
        G.eprojs.length = 0;
        PS.Audio.play('bossWarn', { pitch: 0.8 });
        return;
      }

      if (bs.atk) {
        bs.at += dt;
        if (def.attacks[bs.atk](e, bs, dt, p)) {
          bs.atk = null;
          bs.t = def.cd * (bs.rage ? 0.6 : 1);
        }
        return;
      }
      // reposition between attacks
      if (def.keep) {
        if (d > def.keep + 70) { e.x += (dx / d) * sp * dt; e.y += (dy / d) * sp * dt; }
        else if (d < def.keep - 70) { e.x -= (dx / d) * sp * 0.6 * dt; e.y -= (dy / d) * sp * 0.6 * dt; }
        else { e.x += (-dy / d) * sp * 0.5 * dt; e.y += (dx / d) * sp * 0.5 * dt; }
      } else if (d > e.r) {
        e.x += (dx / d) * sp * dt; e.y += (dy / d) * sp * dt;
      }
      // if the player runs off, close the gap fast
      if (d > 900) { e.x += (dx / d) * 600 * dt; e.y += (dy / d) * 600 * dt; }
      bs.t -= dt;
      if (bs.t <= 0) {
        bs.atk = def.pattern[bs.n % def.pattern.length];
        bs.n++;
        bs.at = 0; bs.init = false; bs.fired = false; bs.step = -1; bs.acc = 0;
      }
    },
    onDeath() { return true; },
    died(e) {
      const G = PS.G;
      if (G.boss === e) G.boss = null;
      G.bossesKilled++;
      if (G.dmgTaken === e.hurtAt) G.flawless++;
      G.bossLog.push({ name: e.def.name, at: Math.round(e.bornAt), took: Math.round(G.time - e.bornAt) });
      PS.Director.quietT = Math.max(PS.Director.quietT, 7); // let the kill land before the map starts talking again
      G.eprojs.length = 0;
      for (const h of G.hazards) if (h.owner === e) h.dead = true;
      for (const k of G.pickups) if (k.kind === 'xp' || k.kind === 'gold') k.pull = true; // the spoils come to you
      PS.FX.bossDeath(e);
      PS.FX.shake(16);
      PS.FX.flash('#ffffff', 0.5);
      PS.Audio.play('bossDie');
      PS.Audio.music('run');
      G.slowmo = 1.2;
      if (e.def.final && !PS.Director.victory && !G.rush) {
        PS.Director.victory = true;
        PS.Director.victoryAt = G.time;
        PS.Game.victory();
      } else {
        PS.UI.toast(e.def.name + ' has fallen', 'trophy');
        // the spoils are the spike; this is the fall that follows (see Director.hpMult)
        if (G.bossesKilled < PS.Director.BOSS_TIMES.length) PS.UI.toast('The rift deepens. The horde grows sturdier', 'vortex');
      }
      PS.Game.bossKilled(e);
    },
  };

  PS.Bosses = B;
})();
