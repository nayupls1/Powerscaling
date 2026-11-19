/* POWERSCALING — classes: base stats, active abilities, passive hooks and the three-branch talent trees */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, C = PS.Combat, TAU = U.TAU;

  /** ability damage scales with the build and with level so it never falls off */
  const abil = (p, base, el) => base * p.dm * p.stats.el[el] * (1 + p.level * 0.1);

  function retribution(p, mult) {
    const s = p.stats;
    const dmg = (40 + s.armor * 3 + s.maxHp * 0.15) * p.dm * mult;
    PS.FX.ring(p.x, p.y, 150 * s.area, '#e8eeff', 0.3);
    C.aoe(p.x, p.y, 150 * s.area, dmg, { el: 'steel', src: 'Retribution', knock: 280, noProc: true });
  }

  function raiseSkeleton(p, x, y) {
    const s = p.stats, f = s.f;
    const max = 3 + (f.legion || 0);
    const alive = PS.G.minions.filter((m) => m.kind === 'skeleton' || m.kind === 'knight');
    if (alive.length >= max) {
      // refresh the oldest instead of wasting the soul
      let oldest = alive[0];
      for (const m of alive) if (m.life < oldest.life) oldest = m;
      oldest.life = oldest.maxLife;
      return;
    }
    const king = !!f.lichKing;
    const dmg = (12 + p.level * 1.85) * p.dm * s.el.void * s.summon * (king ? 2 : 1);
    C.minion({
      x, y, kind: king ? 'knight' : 'skeleton', r: king ? 15 : 11, dmg, life: (18 + (f.deadExplode ? 8 : 0)) * s.duration,
      speed: king ? 175 : 160, atkRate: 0.65, src: king ? 'Death Knights' : 'Skeletons', el: 'void', cleave: king ? 55 : 0, seat: alive.length,
      onEnd: f.deadExplode ? (m) => {
        PS.FX.explosion(m.x, m.y, 95 * s.area, '#c06bff');
        C.aoe(m.x, m.y, 95 * s.area, m.dmg * 4, { el: 'void', src: 'Volatile Dead', noProc: true, knock: 120 });
        PS.Audio.play('explode', { vol: 0.35 });
      } : null,
    });
    PS.Audio.play('summon', { vol: 0.35 });
  }

  /** Lightning Step: a burst where the Stormcaller leaves and where they land */
  function stepBurst(p) {
    const s = p.stats, r = 95 * s.area * (s.f.afterimage ? 1.5 : 1);
    PS.FX.ring(p.x, p.y, r, '#9fe8ff', 0.3);
    PS.FX.bolt(p.x + U.frand(-30, 30), p.y - 300, p.x, p.y, '#ffffff', 3);
    C.aoe(p.x, p.y, r, abil(p, 16, 'storm'), { el: 'storm', src: 'Lightning Step', shock: 1, knock: 140 });
    C.deflect(p.x, p.y, r, false);
  }

  const CLASSES = {
    /* ============================================================ VANGUARD */
    vanguard: {
      name: 'Vanguard', title: 'Frontline bruiser', difficulty: 'Forgiving', color: '#ff8a5a', accent: '#ffd3b0', primary: 'cleave',
      blurb: 'Wades into the horde with wide sword sweeps. Tough, simple, and brutal up close.',
      base: { maxHp: 150, speed: 205, armor: 6, regen: 0.6, dashCd: 2.4 },
      dashName: 'Shoulder Charge',
      ability: {
        name: 'Whirlwind', icon: 'whirl', cd: 13,
        desc: 'Spin for 3 seconds, shredding everything around you. You move faster and take 40% less damage.',
        use(p) {
          p.whirlT = 3 + (p.stats.f.cyclone ? 2 : 0);
          p.whirlTick = 0;
          p.waveT = 0;
          PS.Audio.play('ability');
        },
      },
      update(p, dt) {
        const s = p.stats, f = s.f;
        if (p.whirlT > 0) {
          p.whirlT -= dt;
          p.whirlTick -= dt;
          const r = 128 * s.area;
          if (p.whirlTick <= 0) {
            p.whirlTick = 0.14;
            C.aoe(p.x, p.y, r, abil(p, 11, 'steel'), { el: 'steel', src: 'Whirlwind', knock: f.cyclone ? 0 : 60 });
            PS.FX.whirl(p.x, p.y, r);
            C.deflect(p.x, p.y, r, true, 0, undefined, 'Whirlwind reflect');
          }
          if (f.cyclone) {
            PS.G.grid.query(p.x, p.y, r * 2.2, (e) => {
              if (e.mass >= 50) return;
              const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
              if (d > 40) { e.x += (dx / d) * 150 * dt; e.y += (dy / d) * 150 * dt; }
            });
            p.waveT -= dt;
            if (p.waveT <= 0) {
              p.waveT = 1;
              for (let i = 0; i < 8; i++) {
                C.proj({ x: p.x, y: p.y, ang: (i * TAU) / 8 + PS.G.time, speed: 560, dmg: abil(p, 16, 'steel'), el: 'steel', src: 'Cyclone', r: 24, life: 0.7, pierce: 99, kind: 'wave', color: '#e8eeff', knock: 100 });
              }
            }
          }
        }
        // Bloodlust decay
        if (p.frenzy > 0) {
          p.frenzyT -= dt;
          if (p.frenzyT <= 0) { p.frenzy = Math.max(0, p.frenzy - 1); p.frenzyT = 0.25; }
        }
        // Unbreakable barrier
        if (f.barrier && !p.barrier) {
          p.barrierT -= dt;
          if (p.barrierT <= 0) { p.barrier = true; PS.FX.ring(p.x, p.y, 40, '#9fd0ff', 0.3); }
        }
      },
      meter(p) { return p.stats.f.bloodlust ? { v: p.frenzy / p.frenzyMax, color: '#ff5a5a' } : null; },
      onKill(p) {
        if (p.stats.f.bloodlust) {
          p.frenzy = Math.min(p.frenzyMax, p.frenzy + 1);
          p.frenzyT = 4;
        }
      },
      onHurt(p) {
        if (p.stats.f.retribution) retribution(p, 1);
      },
      onBlock(p) {
        retribution(p, 3);
        PS.G.grid.query(p.x, p.y, 170, (e) => { C.freeze(e, 1, 1.5); });
      },
      onDash(p) {
        // shoulder charge: hit everything along the dash path once
        p.chargeHit = new Set();
      },
      dashing(p) {
        const dmg = abil(p, 14, 'steel');
        PS.G.grid.query(p.x, p.y, 30, (e) => {
          if (p.chargeHit.has(e.id)) return;
          p.chargeHit.add(e.id);
          C.damage(e, dmg, { el: 'steel', src: 'Shoulder Charge', knock: 260, ang: p.dashAng });
        });
      },
      branches: [
        {
          name: 'Berserker', icon: 'blood', color: '#ff5a5a',
          nodes: [
            { name: 'Bloodlust', icon: 'blood', desc: 'Each kill grants Frenzy: +2.5% attack speed, stacking 20 times. Fades when the killing stops.', apply: (s) => { s.f.bloodlust = 1; } },
            { name: 'Bloodthirst', icon: 'fang', desc: 'Cleave heals you for each enemy it hits. +12% damage.', apply: (s) => { s.f.bloodthirst = 1; s.dmg += 0.12; } },
            { name: 'Rampage', icon: 'skull', desc: 'At full Frenzy, Cleave strikes all around you for 30% more damage and you move 20% faster.', apply: (s) => { s.f.rampage = 1; } },
          ],
        },
        {
          name: 'Bulwark', icon: 'shield', color: '#9fd0ff',
          nodes: [
            { name: 'Iron Skin', icon: 'armor', desc: '+8 armor and +30 max health.', apply: (s) => { s.armor += 8; s.maxHp += 30; } },
            { name: 'Retribution', icon: 'thorns', desc: 'Whenever you are hit, a shockwave punishes everything nearby. Scales with armor and max health.', apply: (s) => { s.f.retribution = 1; } },
            { name: 'Unbreakable', icon: 'cross', desc: 'Every 9 seconds gain a barrier that blocks one hit. Blocking stuns nearby enemies and triggers a triple Retribution.', apply: (s) => { s.f.barrier = 1; } },
          ],
        },
        {
          name: 'Warlord', icon: 'swords', color: '#ffd36b',
          nodes: [
            { name: 'Sweeping Arc', icon: 'cleave', desc: 'Cleave reaches farther and sweeps a much wider arc. +10% area.', apply: (s) => { s.f.sweeping = 1; s.area += 0.1; } },
            { name: 'Blade Wave', icon: 'wave', desc: 'Every third Cleave launches a wave of force that pierces every enemy in its path.', apply: (s) => { s.f.bladeWave = 1; } },
            { name: 'Cyclone', icon: 'tornado', desc: 'Whirlwind lasts 2 seconds longer, drags enemies in, and throws blade waves in all directions.', apply: (s) => { s.f.cyclone = 1; } },
          ],
        },
      ],
    },

    /* ============================================================ PYROMANCER */
    pyromancer: {
      name: 'Pyromancer', title: 'Glass-cannon caster', difficulty: 'Moderate', color: '#ff6b3d', accent: '#ffd06b', primary: 'firebolt',
      blurb: 'Explosive firebolts and a screen-clearing meteor. Fragile — keep your distance.',
      base: { maxHp: 105, speed: 210, dashCd: 2.2, crit: 0.08, regen: 0.3 },
      dashName: 'Blink',
      ability: {
        name: 'Cataclysm', icon: 'meteor', cd: 15,
        desc: 'Call down a colossal meteor where you aim. It leaves the ground burning.',
        use(p) {
          const s = p.stats;
          const t = p.abilityPoint();
          const dmg = abil(p, 120, 'fire'), r = 185 * s.area;
          C.strike({
            x: t.x, y: t.y, r, delay: 0.7, dmg, el: 'fire', src: 'Cataclysm', kind: 'meteor', color: '#ff7a3d', opts: { knock: 300 },
            onLand: (sk) => {
              PS.FX.shake(9);
              C.deflect(sk.x, sk.y, r, false);
              PS.Audio.play('bigExplode');
              C.zone({ x: sk.x, y: sk.y, r: r * 0.85, life: 4 * s.duration, tick: 0.5, dmg: dmg * 0.08, el: 'fire', src: 'Cataclysm', kind: 'fire', color: '#ff7a3d' });
            },
          });
          if (s.f.surge) p.surgeT = 6;
          PS.Audio.play('ability');
        },
      },
      update(p, dt) {
        if (p.surgeT > 0) p.surgeT -= dt;
      },
      onKill(p, e, canProc) {
        if (p.stats.f.wildfire && e.burnT > 0 && canProc) {
          let n = 0;
          const dps = e.burnDps;
          PS.G.grid.query(e.x, e.y, 120 * p.stats.area, (x) => {
            if (x !== e && n < 6) { C.burn(x, dps); n++; }
          });
          if (n) PS.FX.puff(e.x, e.y, '#ff9a4d', 6);
        }
      },
      onHurt(p) {
        if (p.stats.f.emberShield) {
          PS.FX.ring(p.x, p.y, 160 * p.stats.area, '#ff7a3d', 0.3);
          C.aoe(p.x, p.y, 160 * p.stats.area, C.power('fire') * 2, { el: 'fire', src: 'Ember Shield', knock: 220, noProc: true });
        }
      },
      onDash(p) {
        if (p.stats.f.flameDash) p.flameDrop = 0;
      },
      dashing(p, dt) {
        if (!p.stats.f.flameDash) return;
        p.flameDrop -= dt;
        if (p.flameDrop <= 0) {
          p.flameDrop = 0.035;
          C.zone({ x: p.x, y: p.y, r: 38 * p.stats.area, life: 2.5 * p.stats.duration, tick: 0.4, firstTick: 0, dmg: C.power('fire') * 0.6, el: 'fire', src: 'Flame Dash', kind: 'fire', color: '#ff7a3d' });
        }
      },
      onRevive(p) {
        if (p.stats.f.rebirth) { p.reborn = true; }
      },
      branches: [
        {
          name: 'Inferno', icon: 'flame', color: '#ff7a3d',
          nodes: [
            { name: 'Combustion', icon: 'flame', desc: 'Burn deals 50% more damage and Firebolt explosions are 20% larger.', apply: (s) => { s.f.combustion = 1; } },
            { name: 'Wildfire', icon: 'sun', desc: 'Burning enemies spread their flames to others nearby when they die.', apply: (s) => { s.f.wildfire = 1; } },
            { name: 'Hot Streak', icon: 'fireball', desc: 'Firebolts that hit a burning enemy have a 30% chance to trigger a second, bigger explosion.', apply: (s) => { s.f.hotStreak = 1; } },
          ],
        },
        {
          name: 'Arcanist', icon: 'spark', color: '#8ad1ff',
          nodes: [
            { name: 'Twin Bolt', icon: 'multishot', desc: 'Firebolt launches an extra bolt.', apply: (s) => { s.f.twinBolt = 1; } },
            { name: 'Overload', icon: 'bomb', desc: 'Every fifth Firebolt is overcharged: triple damage and twice the blast.', apply: (s) => { s.f.overload = 1; } },
            { name: 'Arcane Surge', icon: 'bolt', desc: 'Casting Cataclysm grants +60% attack speed for 6 seconds. +25% ability haste.', apply: (s) => { s.f.surge = 1; s.abilityHaste += 0.25; } },
          ],
        },
        {
          name: 'Phoenix', icon: 'phoenix', color: '#ffb061',
          nodes: [
            { name: 'Ember Shield', icon: 'shield', desc: '+25 max health and +0.6 regeneration. Being hit scorches and repels nearby enemies.', apply: (s) => { s.maxHp += 25; s.regen += 0.6; s.f.emberShield = 1; } },
            { name: 'Flame Dash', icon: 'dash', desc: 'Blink leaves a wall of fire and recharges 25% faster.', apply: (s) => { s.f.flameDash = 1; s.dashCd *= 0.75; } },
            { name: 'Rebirth', icon: 'phoenix', desc: 'Return from death once per run. After rising you deal 30% more damage.', apply: (s) => { s.revives += 1; s.f.rebirth = 1; } },
          ],
        },
      ],
    },

    /* ============================================================ RANGER */
    ranger: {
      name: 'Ranger', title: 'Mobile sharpshooter', difficulty: 'Demanding', color: '#9be36b', accent: '#f1e7cf', primary: 'longbow',
      blurb: 'Rapid piercing arrows and the fastest feet in the rift. Thrives on kiting and crits.',
      base: { maxHp: 115, speed: 232, dashCd: 1.7, crit: 0.1, regen: 0.3 },
      dashName: 'Tumble',
      ability: {
        name: 'Arrow Storm', icon: 'multishot', cd: 12,
        desc: 'Rain arrows on the area you aim at for 3 seconds.',
        use(p) {
          const s = p.stats;
          const t = p.abilityPoint();
          const dmg = abil(p, 11, 'steel'), mark = !!s.f.mark;
          C.zone({
            x: t.x, y: t.y, r: 165 * s.area, life: 3 * s.duration, tick: 0.18, firstTick: 0.1, dmg, el: 'steel', src: 'Arrow Storm', kind: 'arrows', color: '#f1e7cf',
            opts: { poison: s.f.poisonTips ? 1 : 0 },
            onTick: (z) => {
              C.deflect(z.x, z.y, z.r, false); // the volley shoots bullets down
              if (mark) PS.G.grid.query(z.x, z.y, z.r, (e) => { e.markT = 6; });
            },
          });
          PS.Audio.play('ability');
        },
      },
      update(p, dt) {
        if (p.galeT > 0) p.galeT -= dt;
      },
      onKill(p, e, canProc) {
        if (p.stats.f.mark && e.poisStacks > 0 && canProc && U.rnd() < 0.3) {
          C.zone({ x: e.x, y: e.y, r: 62 * p.stats.area, life: 2 * p.stats.duration, tick: 0.4, dmg: C.power('venom') * 0.7, el: 'venom', src: 'Toxic Cloud', kind: 'poison', color: '#8fe04a' });
        }
      },
      onDash(p) {
        const s = p.stats, f = s.f;
        if (f.gale) p.galeT = 3;
        if (f.momentum2) {
          const inst = p.skills[0];
          const cur = PS.Skills.stats(inst);
          const dmg = cur.dmg;
          for (let i = 0; i < 10; i++) {
            C.proj({ x: p.x, y: p.y, ang: (i * TAU) / 10, speed: 760, dmg, el: 'steel', src: 'Tumble Volley', r: 5, life: 0.6, pierce: 2, kind: 'arrow', color: '#f1e7cf', knock: 60, opts: { poison: f.poisonTips ? 1 : 0 } });
          }
          PS.Audio.play('arrow', { vol: 0.5 });
        }
      },
      branches: [
        {
          name: 'Sharpshooter', icon: 'crosshair', color: '#ffe9a8',
          nodes: [
            { name: 'Eagle Eye', icon: 'eye', desc: '+10% critical chance and +25% critical damage.', apply: (s) => { s.crit += 0.10; s.critMult += 0.25; } },
            { name: 'Piercing Shots', icon: 'multishot', desc: 'Arrows pierce 2 more enemies and hit 15% harder with each enemy they pass through.', apply: (s) => { s.f.piercing = 1; } },
            { name: 'Headshot', icon: 'target', desc: 'Every sixth arrow is a guaranteed critical railshot: triple damage, pierces everything.', apply: (s) => { s.f.headshot = 1; } },
          ],
        },
        {
          name: 'Hunter', icon: 'drop', color: '#8fe04a',
          nodes: [
            { name: 'Poison Tips', icon: 'drop', desc: 'Arrows poison their targets. +1 Blight affinity.', apply: (s) => { s.f.poisonTips = 1; s.aff.venom += 1; } },
            { name: 'Split Shot', icon: 'shards', desc: 'Arrows split into two more on their first hit.', apply: (s) => { s.f.splitShot = 1; } },
            { name: 'Predator\'s Mark', icon: 'paw', desc: 'Arrow Storm marks enemies to take 40% more damage. Poisoned enemies can burst into toxic clouds.', apply: (s) => { s.f.mark = 1; } },
          ],
        },
        {
          name: 'Windrunner', icon: 'wings', color: '#8ad1ff',
          nodes: [
            { name: 'Fleet', icon: 'boot', desc: '+12% move speed and +8% chance to dodge.', apply: (s) => { s.speed *= 1.12; s.dodge += 0.08; } },
            { name: 'Momentum', icon: 'dash', desc: '+20% attack speed while moving. Tumble looses a ring of arrows.', apply: (s) => { s.f.momentum2 = 1; } },
            { name: 'Gale', icon: 'tornado', desc: '+1 dash charge. After a Tumble, fire an extra arrow with +40% attack speed for 3 seconds.', apply: (s) => { s.dashCharges += 1; s.f.gale = 1; } },
          ],
        },
      ],
    },

    /* ============================================================ REAPER */
    reaper: {
      name: 'Reaper', title: 'Soul-harvesting summoner', difficulty: 'Moderate', color: '#c06bff', accent: '#e3b8ff', primary: 'scythe',
      blurb: 'A returning scythe and an army raised from the fallen. Every kill feeds the next.',
      base: { maxHp: 105, speed: 212, dashCd: 2.2, regen: 0.4 },
      dashName: 'Shade Step',
      unlock: { text: 'Defeat any boss to unlock', check: (save) => save.stats.bosses >= 1 },
      passive: 'Every 10 kills raises a skeleton to fight for you.',
      ability: {
        name: 'Soul Harvest', icon: 'skull', cd: 15,
        desc: 'A wave of death around you. Heals for each enemy struck and raises a full pack of skeletons.',
        use(p) {
          const s = p.stats, r = 230 * s.area;
          PS.FX.ring(p.x, p.y, r, '#c06bff', 0.45);
          PS.FX.explosion(p.x, p.y, r * 0.6, '#c06bff', true);
          const n = C.aoe(p.x, p.y, r, abil(p, 85, 'void'), { el: 'void', src: 'Soul Harvest', knock: 200 });
          C.deflect(p.x, p.y, r, true, 0, undefined, 'Soul Harvest');
          p.heal(Math.min(20, n) * 1.2, true);
          const max = 3 + (s.f.legion || 0);
          for (let i = 0; i < max; i++) raiseSkeleton(p, p.x + Math.cos((i * TAU) / max) * 50, p.y + Math.sin((i * TAU) / max) * 50);
          PS.FX.shake(6);
          PS.Audio.play('ability');
        },
      },
      update() {},
      onKill(p, e, canProc) {
        const f = p.stats.f;
        p.souls++;
        if (p.souls >= (f.lichKing ? 5 : 10)) {
          p.souls = 0;
          raiseSkeleton(p, e.x, e.y);
        }
        if (f.siphon) p.leech(0.4);
        if (f.corpseEx && canProc && U.rnd() < 0.22) {
          PS.FX.explosion(e.x, e.y, 88 * p.stats.area, '#8fe04a');
          C.aoe(e.x, e.y, 88 * p.stats.area, C.power('venom') * 1.6, { el: 'venom', src: 'Corpse Explosion', noProc: true, poison: 2 });
          PS.Audio.play('poison', { vol: 0.35 });
        }
      },
      branches: [
        {
          name: 'Lich', icon: 'bone', color: '#e3b8ff',
          nodes: [
            { name: 'Legion', icon: 'bone', desc: 'Command 2 more skeletons, and all your summons deal 30% more damage.', apply: (s) => { s.f.legion = 2; s.summon += 0.3; } },
            { name: 'Volatile Dead', icon: 'bomb', desc: 'Skeletons last longer and explode violently when their time runs out.', apply: (s) => { s.f.deadExplode = 1; } },
            { name: 'Lich King', icon: 'crown', desc: 'You raise Death Knights instead: double damage, cleaving strikes — and they rise twice as often.', apply: (s) => { s.f.lichKing = 1; } },
          ],
        },
        {
          name: 'Harvester', icon: 'scythe', color: '#ff7aa8',
          nodes: [
            { name: 'Soul Siphon', icon: 'heart', desc: 'Kills restore health and you heal for 2% of damage dealt.', apply: (s) => { s.f.siphon = 1; s.lifesteal += 0.02; } },
            { name: 'Reaping', icon: 'jar', desc: '+1.5% damage for every 1,000 enemies you have slain this run, up to +60%.', apply: (s, p) => { s.f.reaping = 1; s.dmg += Math.min(0.6, Math.floor((p.kills || 0) / 1000) * 0.015); }, dynamic: true },
            { name: 'Death\'s Door', icon: 'skull', desc: 'Throw an extra scythe. Scythes execute enemies below 20% health.', apply: (s) => { s.f.deathsDoor = 1; } },
          ],
        },
        {
          name: 'Plaguelord', icon: 'drop', color: '#8fe04a',
          nodes: [
            { name: 'Withering', icon: 'drop', desc: 'Your scythe poisons everything it cuts. +1 Blight affinity.', apply: (s) => { s.f.withering = 1; s.aff.venom += 1; } },
            { name: 'Corpse Explosion', icon: 'spores', desc: 'Slain enemies have a 22% chance to burst, poisoning everything nearby.', apply: (s) => { s.f.corpseEx = 1; } },
            { name: 'Pandemic', icon: 'ghost', desc: 'Poison stacks 5 higher and spreads on death. Poisoned enemies deal 25% less damage.', apply: (s) => { s.f.pandemic = 1; } },
          ],
        },
      ],
    },
    /* ============================================================ STORMCALLER */
    stormcaller: {
      name: 'Stormcaller', title: 'Chain-lightning caster', difficulty: 'Moderate', color: '#5ad1ff', accent: '#fff3a8', primary: 'arc',
      blurb: 'Lightning that lands the instant you aim and leaps through the crowd. Fragile, quick, and strongest when the horde is packed tight.',
      base: { maxHp: 105, speed: 220, dashCd: 2.0, crit: 0.06, regen: 0.4 },
      dashName: 'Lightning Step',
      passive: 'Lightning bursts where you leave and where you land.',
      unlock: { text: 'Slay the Rift Lord to unlock', check: (save) => save.stats.wins >= 1 },
      ability: {
        name: 'Maelstrom', icon: 'tornado', cd: 14,
        desc: 'Call a storm that follows you for 5 seconds, striking enemies all around with lightning and swatting bullets out of the air.',
        use(p) {
          p.tempestT = 5 + (p.stats.f.gathering ? 2 : 0);
          p.tempestTick = 0;
          PS.FX.ring(p.x, p.y, 330, '#9fe8ff', 0.5);
          PS.Audio.play('ability');
          PS.Audio.play('thunder', { vol: 0.5 });
        },
      },
      update(p, dt) {
        const s = p.stats, f = s.f;
        if (p.stepT > 0) p.stepT -= dt;
        if (f.capacitor && p.moving && p.charge < 1) {
          p.charge = Math.min(1, (p.charge || 0) + dt / 4);
          if (p.charge >= 1) { PS.FX.ring(p.x, p.y, 46, '#ffffff', 0.3); PS.Audio.play('zap', { vol: 0.3, pitch: 1.6 }); }
        }
        if (!(p.tempestT > 0)) return;
        p.tempestT -= dt;
        p.tempestTick -= dt;
        if (p.tempestTick > 0) return;
        p.tempestTick = f.stormlord ? 0.08 : 0.16;
        C.deflect(p.x, p.y, 130, false);
        const e = C.randomEnemy(330);
        if (!e) return;
        const dmg = abil(p, 19, 'storm'), r = 62 * s.area, x = e.x, y = e.y;
        PS.FX.bolt(x + U.frand(-40, 40), y - 380, x, y, '#9fe8ff', 3);
        PS.FX.ring(x, y, r, '#9fe8ff');
        C.aoe(x, y, r, dmg, { el: 'storm', src: 'Maelstrom', shock: 1, knock: 50 });
        if (f.stormlord && !e.dead) C.chain(x, y, e, dmg * 0.6, 2, 180, { src: 'Maelstrom', skipFirst: true, color: '#9fe8ff' });
        PS.Audio.play('zap', { vol: 0.22, pitch: 0.8 });
      },
      meter(p) { return p.stats.f.capacitor ? { v: p.charge || 0, color: '#9fe8ff' } : null; },
      onHurt(p) {
        if (!p.stats.f.living) return;
        PS.FX.ring(p.x, p.y, 170 * p.stats.area, '#ffffff', 0.35);
        C.aoe(p.x, p.y, 170 * p.stats.area, C.power('storm') * 1.5, { el: 'storm', src: 'Living Lightning', shock: 1, knock: 200, noProc: true });
        PS.G.grid.query(p.x, p.y, 170 * p.stats.area, (e) => { C.freeze(e, 1, 1.2); });
      },
      onDash(p) {
        stepBurst(p);
        p.stepLanded = false;
      },
      dashing(p) {
        // the far end of the step: one more burst where you land
        if (p.dashT <= 0 && !p.stepLanded) {
          p.stepLanded = true;
          stepBurst(p);
          if (p.stats.f.living) p.stepT = 3;
        }
      },
      branches: [
        {
          name: 'Conduit', icon: 'chain', color: '#9fe8ff',
          nodes: [
            { name: 'Forked Lightning', icon: 'chain', desc: 'Arc Lash leaps 2 more times.', apply: (s) => { s.f.forked = 1; } },
            { name: 'Static', icon: 'bolt', desc: 'Arc Lash always Shocks, and you deal 15% more damage to Shocked enemies.', apply: (s) => { s.f.staticShock = 1; } },
            { name: 'Thunderbolt', icon: 'thunder', desc: 'Every fifth Arc Lash is a thunderbolt: triple damage, and its leaps lose no strength.', apply: (s) => { s.f.thunderbolt = 1; } },
          ],
        },
        {
          name: 'Maelstrom', icon: 'tornado', color: '#ffe14d',
          nodes: [
            { name: 'Gathering Storm', icon: 'hourglass', desc: 'Maelstrom lasts 2 seconds longer. +25% ability haste.', apply: (s) => { s.f.gathering = 1; s.abilityHaste += 0.25; } },
            { name: 'Eye of the Storm', icon: 'eye', desc: 'While Maelstrom rages you move 25% faster and take 35% less damage.', apply: (s) => { s.f.eye = 1; } },
            { name: 'Stormlord', icon: 'crown', desc: 'Maelstrom strikes twice as often, and every strike leaps to 2 more enemies.', apply: (s) => { s.f.stormlord = 1; } },
          ],
        },
        {
          name: 'Surge', icon: 'dash', color: '#c9b8ff',
          nodes: [
            { name: 'Afterimage', icon: 'dash', desc: '+1 dash charge. The bursts of Lightning Step are 50% larger.', apply: (s) => { s.dashCharges += 1; s.f.afterimage = 1; } },
            { name: 'Capacitor', icon: 'battery', desc: 'Moving builds charge. Once full, your next Arc Lash discharges: four times the damage, in a burst around its target.', apply: (s) => { s.f.capacitor = 1; } },
            { name: 'Living Lightning', icon: 'spark', desc: '+50% attack speed for 3 seconds after a Lightning Step. Being hit releases a nova that stuns everything nearby.', apply: (s) => { s.f.living = 1; } },
          ],
        },
      ],
    },
    /* ============================================================ FROSTWARDEN */
    frostwarden: {
      name: 'Frostwarden', title: 'Close-range controller', difficulty: 'Moderate', color: '#9ff0e0', accent: '#ffffff', primary: 'breath',
      blurb: 'Stands in the thick of it behind a cone of freezing breath. Sturdy and slow, and nothing near it moves fast for long.',
      base: { maxHp: 135, speed: 200, armor: 4, dashCd: 2.3, regen: 0.5 },
      dashName: 'Ice Slide', botRange: 100, chillBonus: 0.3,
      passive: 'You leave a strip of ice that Chills whatever crosses it. Everything Chilled takes 30% more damage from you.',
      unlock: { text: 'Slay 10 bosses in all to unlock', check: (save) => save.stats.bosses >= 10 },
      ability: {
        name: 'Glacial Tomb', icon: 'crystal', cd: 16,
        desc: 'Freeze everything around you solid for a moment. When the ice breaks, it breaks them: heavy damage to everything that was caught.',
        use(p) {
          const s = p.stats, r = 260 * s.area, dmg = abil(p, 85, 'frost') * (s.f.avalanche ? 2.5 : 1);
          PS.FX.ring(p.x, p.y, r, '#bdf0ff', 0.5);
          PS.FX.frostBurst(p.x, p.y, r);
          PS.FX.flash('#bdf0ff', 0.2);
          const caught = [];
          PS.G.grid.query(p.x, p.y, r, (e) => { caught.push(e); if (e.boss) C.chill(e, 4); else { e.freezeImm = 0; C.freeze(e, 1, 2.2); } });
          C.deflect(p.x, p.y, r, false);
          p.tombT = 1.6; p.tomb = { caught, dmg };
          PS.Audio.play('ability');
          PS.Audio.play('freeze', { vol: 0.7 });
        },
      },
      update(p, dt) {
        const s = p.stats, f = s.f;
        if (p.snapT > 0) p.snapT -= dt;
        if (p.iceArmorCd > 0) p.iceArmorCd -= dt;
        if (p.tombT > 0) {
          p.tombT -= dt;
          if (p.tombT <= 0 && p.tomb) {
            // the ice breaks
            for (const e of p.tomb.caught) {
              if (e.dead) continue;
              PS.FX.shatter(e.x, e.y, '#bdf0ff');
              C.damage(e, p.tomb.dmg, { el: 'frost', src: 'Glacial Tomb', knock: 120 });
            }
            p.tomb = null;
            PS.FX.shake(6);
            PS.Audio.play('explode', { vol: 0.5, pitch: 1.4 });
          }
        }
        if (f.blizzardWalk) {
          p.walkT = (p.walkT || 0) - dt;
          if (p.walkT <= 0) {
            p.walkT = 0.5;
            const r = 150 * s.area;
            C.aoe(p.x, p.y, r, C.power('frost') * 0.5, { el: 'frost', src: 'Blizzard Walk', noProc: true });
          }
          p.miasmaR = 0;
        }
      },
      onHurt(p) {
        const f = p.stats.f;
        if (!f.iceArmor || p.iceArmorCd > 0) return;
        p.iceArmorCd = 4;
        PS.FX.ring(p.x, p.y, 150 * p.stats.area, '#bdf0ff', 0.3);
        PS.G.grid.query(p.x, p.y, 150 * p.stats.area, (e) => { C.freeze(e, 1, 1.5); });
      },
      onDash(p) {
        p.iceDrop = 0;
        if (p.stats.f.coldSnap) p.snapT = 3;
      },
      dashing(p, dt) {
        // the slide lays ice behind it: it Chills, and with Black Ice it bites
        const s = p.stats, f = s.f;
        p.iceDrop -= dt;
        if (p.iceDrop > 0) return;
        p.iceDrop = 0.04;
        C.zone({ x: p.x, y: p.y, r: 44 * s.area, life: (f.blackIce ? 5 : 2.5) * s.duration, tick: 0.5, firstTick: 0.05, dmg: f.blackIce ? C.power('frost') * 0.55 : 0.01, el: 'frost', src: 'Ice Slide', kind: 'blizzard', color: '#6fd8ff', slow: 1 });
      },
      branches: [
        {
          name: 'Winter', icon: 'snow', color: '#bdf0ff',
          nodes: [
            { name: 'Deep Freeze', icon: 'crystal', desc: 'Frost Breath has a chance to freeze what it touches solid.', apply: (s) => { s.f.deepFreeze = 1; } },
            { name: 'Wide Maw', icon: 'expand', desc: 'Frost Breath reaches 30% further and spreads 30% wider.', apply: (s) => { s.f.wideMaw = 1; } },
            { name: 'Brittle', icon: 'shards', desc: 'Frost Breath deals 40% more damage to frozen enemies, and you deal 20% more Rime damage.', apply: (s) => { s.f.shatterBreath = 1; s.el.frost += 0.2; } },
          ],
        },
        {
          name: 'Glacier', icon: 'mountain', color: '#9ff0e0',
          nodes: [
            { name: 'Permafrost', icon: 'heart', desc: '+35 max health and +6 armor.', apply: (s) => { s.maxHp += 35; s.armor += 6; } },
            { name: 'Ice Armor', icon: 'armor', desc: 'Being hit freezes everything near you. This can happen once every 4 seconds.', apply: (s) => { s.f.iceArmor = 1; } },
            { name: 'Avalanche', icon: 'meteor', desc: 'Glacial Tomb breaks for two and a half times the damage. +25% ability haste.', apply: (s) => { s.f.avalanche = 1; s.abilityHaste += 0.25; } },
          ],
        },
        {
          name: 'Rime', icon: 'dash', color: '#6fd8ff',
          nodes: [
            { name: 'Black Ice', icon: 'dash', desc: 'The ice left by Ice Slide lasts twice as long and damages what stands on it. +1 dash charge.', apply: (s) => { s.f.blackIce = 1; s.dashCharges += 1; } },
            { name: 'Cold Snap', icon: 'hourglass', desc: 'For 3 seconds after an Ice Slide, Frost Breath deals 50% more damage.', apply: (s) => { s.f.coldSnap = 1; } },
            { name: 'Blizzard Walk', icon: 'tornado', desc: 'A storm follows you, wearing down and Chilling everything near. +10% move speed.', apply: (s) => { s.f.blizzardWalk = 1; s.speed *= 1.1; } },
          ],
        },
      ],
    },
    /* ============================================================ PLAGUEBEARER */
    plaguebearer: {
      name: 'Plaguebearer', title: 'Poison and detonation', difficulty: 'Demanding', color: '#d6c84a', accent: '#8fe04a', primary: 'darts',
      blurb: 'Hits like a feather. Fills the horde with Poison, then sets all of it off at once.',
      base: { maxHp: 110, speed: 215, dashCd: 2.1, regen: 0.4, statusDmg: 1.15 },
      dashName: 'Miasma Step',
      passive: 'You leave a cloud of rot where you set off. Your Poison, Burn and Bleed deal 15% more damage.',
      unlock: { text: 'Strike three different pacts to unlock', check: (save) => Object.keys(save.codex.pacts).length >= 3 },
      ability: {
        name: 'Catalyst', icon: 'flask', cd: 12,
        desc: 'Every poisoned enemy in sight takes four seconds of its Poison at once. The rest are poisoned, so it is never wasted.',
        use(p) {
          const G = PS.G, s = p.stats, f = s.f, r = 520 * (f.reagents ? 1.3 : 1), base = abil(p, 10, 'venom');
          let pools = 0;
          PS.FX.ring(p.x, p.y, r, '#b8f078', 0.5);
          const hit = [];
          G.grid.query(p.x, p.y, r, (e) => { hit.push(e); });
          for (const e of hit) {
            if (e.dead) continue;
            if (e.poisStacks <= 0) { C.poison(e, C.power('venom') * 0.12, 3); continue; }
            const dmg = base + e.poisStacks * e.poisDps * 4 * s.statusDmg, x = e.x, y = e.y;
            PS.FX.puff(x, y, '#b8f078', 7);
            // noStatus: its own hit must not set the Poison it will read next time, or every cast multiplies the last
            C.damage(e, dmg, { el: 'venom', src: 'Catalyst', noCrit: true, noStatus: true });
            if (f.chainCatalysis && e.dead) { PS.FX.ring(x, y, 90 * s.area, '#b8f078'); C.aoe(x, y, 90 * s.area, dmg * 0.5, { el: 'venom', src: 'Catalyst', noProc: true, noStatus: true }); }
            if (f.acidBath && pools < 8) { pools++; C.zone({ x, y, r: 70 * s.area, life: 4 * s.duration, tick: 0.5, dmg: C.power('venom') * 0.7, el: 'venom', src: 'Acid Bath', kind: 'poison', color: '#8fe04a' }); }
          }
          PS.FX.flash('#8fe04a', 0.15);
          PS.Audio.play('ability');
          PS.Audio.play('poison', { vol: 0.7, pitch: 0.7 });
        },
      },
      update() {},
      onKill(p, e) {
        if (p.stats.f.siphon && e.poisStacks > 0) p.leechPool += 0.8;
      },
      onDash(p) {
        const s = p.stats, big = s.f.plagueWard ? 2 : 1;
        C.zone({ x: p.x, y: p.y, r: 95 * s.area * big, life: 3.5 * s.duration, tick: 0.5, firstTick: 0.05, dmg: C.power('venom') * 0.5, el: 'venom', src: 'Miasma Step', kind: 'poison', color: '#8fe04a', opts: { poison: 2 } });
      },
      branches: [
        {
          name: 'Contagion', icon: 'spores', color: '#8fe04a',
          nodes: [
            { name: 'Virulence', icon: 'drop', desc: 'Plague Darts leave one more stack of Poison. +20% Blight damage.', apply: (s) => { s.f.virulence = 1; s.el.venom += 0.2; } },
            { name: 'Outbreak', icon: 'ghost', desc: 'Poison stacks 5 higher and spreads when its host dies. Poisoned enemies deal 25% less damage.', apply: (s) => { s.f.pandemic = 1; } },
            { name: 'Necrosis', icon: 'skull', desc: 'Enemies carrying 8 or more stacks of Poison take 25% more damage from everything.', apply: (s) => { s.f.necrosis = 1; } },
          ],
        },
        {
          name: 'Catalysis', icon: 'flask', color: '#d6c84a',
          nodes: [
            { name: 'Quick Reagents', icon: 'hourglass', desc: 'Catalyst reaches 30% further. +25% ability haste.', apply: (s) => { s.f.reagents = 1; s.abilityHaste += 0.25; } },
            { name: 'Acid Bath', icon: 'wave', desc: 'Catalyst leaves a pool of acid under up to 8 of the enemies it bursts.', apply: (s) => { s.f.acidBath = 1; } },
            { name: 'Chain Catalysis', icon: 'bomb', desc: 'Enemies slain by Catalyst burst again, hurting those around them.', apply: (s) => { s.f.chainCatalysis = 1; } },
          ],
        },
        {
          name: 'Leech', icon: 'blood', color: '#ff7a8a',
          nodes: [
            { name: 'Thick Blood', icon: 'heart', desc: '+25 max health and +0.8 regeneration.', apply: (s) => { s.maxHp += 25; s.regen += 0.8; } },
            { name: 'Siphon', icon: 'fang', desc: 'Every poisoned enemy that dies restores a little of your health.', apply: (s) => { s.f.siphon = 1; } },
            { name: 'Plague Ward', icon: 'shield', desc: '+1 dash charge, and the cloud Miasma Step leaves is twice as large. Poisoned enemies deal 20% less damage to you.', apply: (s) => { s.dashCharges += 1; s.f.plagueWard = 1; } },
          ],
        },
      ],
    },
  };

  for (const id in CLASSES) CLASSES[id].id = id;
  PS.Data.CLASSES = CLASSES;
  PS.Data.CLASS_IDS = Object.keys(CLASSES);
  PS.Data.abilityDmg = abil;
})();
