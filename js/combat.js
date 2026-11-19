/* POWERSCALING — combat core: damage, statuses, projectiles, zones, strikes, minions, enemy bullets & hazards */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, D = PS.Data;
  const TAU = U.TAU;

  const MAX_PROJ = 700;
  // Reactions are rare and heavy on purpose: about one a second at most, each one an event you can see.
  // Measured with `tools/curve.js --noreact` on the same seeds, they are worth roughly 5% of horde toughness to a build
  // that mixes elements (and nearly every build does), which Director.hpMult gives back (REACTION_OFFSET).
  const RX_COOLDOWN = 3;   // seconds before the same enemy can react again
  const RX_RATE = 1.5;     // reactions per second the whole build may set off (a budget of up to RX_BURST)
  const RX_BURST = 3;
  const RX_POWER = 1.5;    // scales every reaction's damage
  const BASE_POISON_CAP = 6;

  const C = {
    /* ------------------------------------------------------------------ helpers */
    /** scaling baseline for proc/affinity damage so it keeps pace with the player's build */
    power(el) {
      const p = PS.G.player;
      return (14 + p.level * 0.5) * p.dm * (el ? p.stats.el[el] : 1);
    },
    affN(el) {
      return PS.G.player.aff[el] || 0;
    },
    nearest(x, y, r, filter) {
      return PS.G.grid.nearest(x, y, r, filter);
    },
    /** random live enemy within r of the player (cheap reservoir pick over the array) */
    randomEnemy(r) {
      const G = PS.G, p = G.player, list = G.enemies;
      if (!list.length) return null;
      const r2 = r * r;
      for (let tries = 0; tries < 8; tries++) {
        const e = list[(U.rnd() * list.length) | 0];
        if (!e.dead && U.dist2(e.x, e.y, p.x, p.y) < r2) return e;
      }
      return C.nearest(p.x, p.y, r);
    },
    /** point where enemies are densest near the player — used by rifts, flasks etc. */
    clusterPoint(r) {
      const G = PS.G;
      let best = null, bestN = -1;
      for (let i = 0; i < 5; i++) {
        const e = C.randomEnemy(r);
        if (!e) break;
        let n = 0;
        G.grid.query(e.x, e.y, 90, () => { n++; });
        if (n > bestN) { bestN = n; best = e; }
      }
      return best;
    },

    /* ------------------------------------------------------------------ damage */
    /**
     * o: { el, src, ang, knock, crit (force), noCrit, noProc, noStatus, dot, freeze, shock, poison, critBonus }
     */
    damage(e, dmg, o) {
      if (e.dead || e.spawnT > 0 && e.boss) return 0;
      const G = PS.G, p = G.player, s = p.stats, aff = p.aff;
      o = o || EMPTY;
      let crit = false;
      if (!o.dot) {
        if (o.crit === true || (!o.noCrit && U.rnd() < s.crit + (o.critBonus || 0))) {
          crit = true;
          dmg *= s.critMult;
        }
      }
      if (o.minBossPct && e.boss) dmg = Math.max(dmg, e.maxHp * o.minBossPct);
      let m = 1;
      if (e.shockT > 0) m += (aff.storm >= 2 ? 0.30 : 0.15) + (s.f.staticShock ? 0.15 : 0);
      if (e.chillT > 0 && aff.frost >= 2) m += aff.frost >= 6 ? 0.35 : 0.12;
      if (e.markT > 0) m += 0.4;
      if (s.f.necrosis && e.poisStacks >= 8) m += 0.25;
      if (e.chillT > 0 && p.cls.chillBonus) m += p.cls.chillBonus; // the Frostwarden's passive
      if (e.exposeT > 0) m += 0.2;
      if (e.big) m += s.bossDmg;
      if (s.f.execute && e.hp < e.maxHp * 0.25) m += s.f.execute;
      dmg *= m * (e.taken || 1);
      if (e.wardT > G.time) dmg *= 1 - e.wardCut; // a Warder stands nearby
      if (dmg <= 0) return 0;

      // a Shielded elite's barrier is spent before its health
      let soak = 0;
      if (e.shield > 0) {
        soak = Math.min(e.shield, dmg);
        e.shield -= soak;
        e.shieldAt = G.time;
        if (e.shield <= 0) { PS.FX.shatter(e.x, e.y, '#7fc8ff'); PS.Audio.play('frost', { vol: 0.5, pitch: 1.2 }); }
      } else if (e.shieldMax > 0) e.shieldAt = G.time;
      const toHp = dmg - soak;
      // stats and lifesteal count only the health (and barrier) actually removed, not overkill
      const eff = soak + (toHp < e.hp ? toHp : Math.max(0, e.hp));
      e.hp -= toHp;
      if (!o.dot && G.time >= e.flashAt) { e.flash = 0.07; e.flashAt = G.time + (e.big ? 0.28 : 0.16); }
      const src = o.src || 'Other';
      G.dmgBy[src] = (G.dmgBy[src] || 0) + eff;
      G.dmgTotal += eff;

      if (o.knock && e.mass < 50) {
        // a shove lands in full once, then the enemy braces: repeat knocks inside the window barely move it,
        // so auras and orbit skills thin the horde but cannot hold it at arm's length forever
        let k = (o.knock * s.knock) / e.mass;
        if (G.time < e.braceT) k *= 0.35;
        else e.braceT = G.time + 0.5;
        const a = o.ang !== undefined ? o.ang : Math.atan2(e.y - p.y, e.x - p.x);
        e.kx += Math.cos(a) * k;
        e.ky += Math.sin(a) * k;
      }

      if (o.dot) {
        e.dotAcc += dmg;
        e.dotEl = o.el;
      } else {
        PS.FX.dmgNum(e.x, e.y - e.r, dmg, crit, o.el);
        if (!o.noStatus) C.applyElement(e, o.el, dmg, o, crit);
        if (!o.noProc) {
          C.procs(e, dmg, o, crit);
          if (o.el && e.hp > 0) C.tag(e, o.el);
        }
        if (crit) PS.Audio.play('crit', { vol: 0.5 });
        else PS.Audio.play('hit', { vol: 0.35 });
        if (s.lifesteal > 0) p.leech(eff * s.lifesteal);
        // Iron 6: execute
        if (aff.steel >= 6 && !e.boss && e.hp > 0 && e.hp < e.maxHp * 0.15) e.hp = 0;
        if (o.execute && !e.boss && e.hp > 0 && e.hp < e.maxHp * o.execute) e.hp = 0;
      }
      if (e.hp <= 0) C.kill(e, o);
      return dmg;
    },

    applyElement(e, el, dmg, o, crit) {
      const p = PS.G.player, s = p.stats, aff = p.aff, f = s.f;
      if (el === 'fire' || aff.fire >= 6 || o.burn) C.burn(e, dmg * 0.35);
      if (el === 'frost') {
        C.chill(e);
        if (o.freeze) C.freeze(e, o.freeze, o.freezeDur || 1.2);
      }
      if (el === 'storm') {
        if (U.rnd() < (o.shock !== undefined ? o.shock : 0.5)) e.shockT = 4 * s.duration;
      }
      if (el === 'venom' || o.poison) C.poison(e, dmg * 0.12, o.poison || 1);
      if (crit && aff.steel >= 4) {
        e.bleedT = 3;
        e.bleedDps = Math.max(e.bleedDps, (dmg * 0.5) / 3);
      }
      if (o.bleed) {
        e.bleedT = 3;
        e.bleedDps = Math.max(e.bleedDps, (dmg * o.bleed) / 3);
      }
      if (f.freezeProc && U.rnd() < f.freezeProc) C.freeze(e, 1, 1);
      if (f.poisonProc && el !== 'venom' && U.rnd() < f.poisonProc) C.poison(e, dmg * 0.12, 1);
    },
    burn(e, dps) {
      const s = PS.G.player.stats;
      e.burnT = 3 * s.duration;
      if (dps > e.burnDps) e.burnDps = dps;
    },
    chill(e, dur) {
      const p = PS.G.player;
      e.chillT = Math.max(e.chillT, (dur || (p.aff.frost >= 2 ? 3.6 : 2.5)) * p.stats.duration);
    },
    /** chance-based freeze; bosses are only chilled; short immunity afterwards prevents perma-freeze */
    freeze(e, chance, dur) {
      const p = PS.G.player;
      if (p.aff.frost >= 6) chance *= 2;
      if (U.rnd() >= chance) return false;
      if (e.boss || e.freezeImm > 0) { C.chill(e); return false; }
      e.freezeT = dur * (e.elite ? 0.5 : 1) * p.stats.duration;
      e.freezeImm = e.freezeT + 2.5;
      e.chillT = Math.max(e.chillT, e.freezeT + 1);
      return true;
    },
    poison(e, dpsPerStack, stacks) {
      const p = PS.G.player, s = p.stats;
      const cap = BASE_POISON_CAP + (p.aff.venom >= 2 ? 3 : 0) + (s.f.pandemic ? 5 : 0);
      e.poisStacks = Math.min(cap, e.poisStacks + stacks);
      e.poisT = 4 * s.duration;
      if (dpsPerStack > e.poisDps) e.poisDps = dpsPerStack;
    },

    /** on-hit procs from relics/affinities. Everything spawned here must pass noProc to avoid loops. */
    procs(e, dmg, o, crit) {
      const G = PS.G, p = G.player, s = p.stats, aff = p.aff, f = s.f;
      if (G.procN > 24) return;
      if (aff.storm >= 4) {
        if (++p.hitCounter >= 12) {
          p.hitCounter = 0;
          G.procN++;
          PS.FX.bolt(e.x, e.y - 260, e.x, e.y, '#ffe14d');
          C.aoe(e.x, e.y, 55 * s.area, C.power('storm') * 1.7, { el: 'storm', src: 'Tempest', noProc: true, shock: 1 });
          PS.Audio.play('thunder', { vol: 0.4 });
        }
      }
      if (aff.storm >= 6 && e.shockT > 0 && G.time > p.arcIcd) {
        const n = C.nearest(e.x, e.y, 150, (x) => x !== e);
        if (n) {
          p.arcIcd = G.time + 0.08;
          G.procN++;
          PS.FX.bolt(e.x, e.y, n.x, n.y, '#fff3a8');
          C.damage(n, dmg * 0.4, { el: 'storm', src: 'Tempest', noProc: true });
        }
      }
      if (f.chainProc && U.rnd() < f.chainProc) {
        G.procN++;
        C.chain(e.x, e.y, e, dmg * 0.5, 3, 170, { src: 'Arc Coil', noProc: true, skipFirst: true });
      }
    },

    /* ------------------------------------------------------------------ reactions */
    /**
     * Every direct elemental hit leaves its element on the enemy for 4 seconds. A hit of a different element while the
     * mark lasts sets off that pair's reaction (Data.REACTIONS). Proc damage (noProc) neither marks nor triggers, so
     * reactions come from the skills you chose, and a reaction can never set off another.
     * Two limits keep it a build payoff rather than a second damage engine: each enemy reacts at most once every
     * RX_COOLDOWN seconds, and all reactions draw on one small budget that refills at RX_RATE a second (C.refillReactions).
     */
    refillReactions(dt) {
      const G = PS.G;
      if (G.rxTokens < RX_BURST) G.rxTokens = Math.min(RX_BURST, G.rxTokens + RX_RATE * G.rules.react * dt);
    },
    tag(e, el) {
      const G = PS.G;
      if (e.tagEl && e.tagEl !== el && G.time < e.tagT) {
        // on cooldown or out of budget: keep the old mark, so the pair still reacts when it can
        if (G.time < e.rxAt || G.rxTokens < 1) return;
        const rx = D.reaction(e.tagEl, el);
        G.rxTokens -= 1;
        e.rxAt = G.time + (RX_COOLDOWN - (G.player.stats.f.rxBoost ? 1 : 0)) / G.rules.react;
        e.tagEl = el; e.tagT = G.time + 4;
        C.react(e, rx);
        return;
      }
      e.tagEl = el; e.tagT = G.time + 4;
    },
    react(e, rx) {
      const G = PS.G, p = G.player, s = p.stats, area = s.area;
      const a = rx.els[0], b = rx.els[1], name = rx.name;
      const pw = (C.power(a) + C.power(b)) * 0.5 * RX_POWER * G.rules.react * (s.f.rxBoost ? 1.6 : 1);
      const x = e.x, y = e.y;
      const hit = (el, extra) => Object.assign({ el, src: name, noProc: true }, extra);
      G.reactions[name] = (G.reactions[name] || 0) + 1;
      // name the reaction over the enemy, but not on every one of a burst
      if (G.time >= (G.rxSeen[rx.id] || 0)) {
        G.rxSeen[rx.id] = G.time + 0.9;
        PS.FX.text(x, y - e.r - 14, name, D.ELEMENTS[b].glow);
      }
      PS.UI.tip('react', 'Two elements on one enemy react. Pause to see the reactions your build can set off', 'spark');
      switch (rx.id) {
        case 'thermal':
          PS.FX.explosion(x, y, 80 * area, '#ffd3b0');
          C.aoe(x, y, 80 * area, pw * 2.2, hit('fire'));
          break;
        case 'sear':
          C.damage(e, pw * 1.0, hit('steel', { bleed: 3 }));
          PS.FX.hitSpark(x, y, '#ff7a3d');
          break;
        case 'plasma':
          C.chain(x, y, e, pw * 1.1, 3, 200, hit('fire', { skipFirst: true, color: '#ffb061' }));
          break;
        case 'combust': {
          const r = 90 * area, st = Math.min(10, e.poisStacks);
          PS.FX.explosion(x, y, r, '#c8ff8a');
          C.aoe(x, y, r, pw * (1.3 + 0.3 * st), hit('fire'));
          break;
        }
        case 'backdraft':
          C.zone({
            x, y, r: 120 * area, life: 0.55, tick: 99, dmg: 0, el: 'void', src: name, kind: 'implode', pull: 420,
            onEnd(z) { PS.FX.explosion(z.x, z.y, z.r * 0.75, '#ff7a3d'); C.aoe(z.x, z.y, z.r * 0.75, pw * 1.8, hit('fire')); },
          });
          break;
        case 'icebreak':
          PS.FX.shatter(x, y, '#bdf0ff');
          C.damage(e, pw * 2.6 * (e.freezeT > 0 ? 2 : 1), hit('frost', { execute: 0.2, knock: 120 }));
          break;
        case 'supercon':
          PS.FX.ring(x, y, 95 * area, '#bdf0ff', 0.3);
          G.grid.query(x, y, 95 * area, (o) => { C.freeze(o, 1, 0.6); });
          C.aoe(x, y, 95 * area, pw * 0.9, hit('storm'));
          break;
        case 'creep':
          PS.FX.ring(x, y, 115 * area, '#8fe04a', 0.3);
          C.aoe(x, y, 115 * area, pw * 0.6, hit('frost', { poison: 2 }));
          break;
        case 'entropy':
          e.exposeT = 4;
          C.damage(e, pw * 1.2, hit('void'));
          PS.FX.ring(x, y, e.r + 18, '#c06bff', 0.3);
          break;
        case 'rod':
          PS.FX.bolt(x + U.frand(-30, 30), y - 320, x, y, '#fff3a8', 3);
          C.aoe(x, y, 55 * area, pw * 1.7, hit('storm', { crit: true, shock: 1 }));
          PS.Audio.play('thunder', { vol: 0.3 });
          break;
        case 'fester':
          C.damage(e, pw * 0.8, hit('venom', { poison: 3, bleed: 1.5 }));
          PS.FX.puff(x, y, '#8fe04a', 6);
          break;
        case 'sunder':
          PS.FX.explosion(x, y, 105 * area, '#e3b8ff');
          C.aoe(x, y, 105 * area, pw * 1.8, hit('void', { knock: 300 }));
          break;
        case 'caustic': {
          const st = Math.max(2, e.poisStacks), dps = Math.max(e.poisDps, pw * 0.12);
          const seen = [e];
          for (let i = 0; i < 3; i++) {
            const n = C.nearest(x, y, 200, (o) => !seen.includes(o));
            if (!n) break;
            seen.push(n);
            PS.FX.bolt(x, y, n.x, n.y, '#c8ff8a');
            C.poison(n, dps, st);
            C.damage(n, pw * 0.8, hit('storm'));
          }
          break;
        }
        case 'ion':
          C.zone({
            x, y, r: 140 * area, life: 0.5, tick: 99, dmg: 0, el: 'void', src: name, kind: 'implode', pull: 460,
            onEnd(z) { PS.FX.ring(z.x, z.y, z.r * 0.6, '#ffe14d', 0.3); C.aoe(z.x, z.y, z.r * 0.6, pw * 1.0, hit('storm', { shock: 1 })); },
          });
          break;
        case 'wither':
          C.damage(e, Math.max(pw * 1.2, e.maxHp * (e.boss ? 0.004 : e.elite ? 0.02 : 0.05)), hit('venom', { noCrit: true }));
          PS.FX.puff(x, y, '#c06bff', 6);
          break;
      }
    },

    kill(e, o) {
      if (e.dead) return;
      const G = PS.G, p = G.player, s = p.stats, aff = p.aff, f = s.f;
      if (e.boss && PS.Bosses.onDeath(e) === false) return; // boss may refuse to die (phase change)
      e.dead = true;
      G.kills++;
      p.kills++;
      const kid = e.def.id;
      G.slain[kid] = (G.slain[kid] || 0) + 1;
      G.score += e.score;
      PS.FX.death(e);
      if (e.big) PS.Audio.play('eliteDie'); else PS.Audio.play('kill', { vol: 0.4 });

      // drops
      PS.Director.drops(e);
      if (e.breach) PS.Director.breachKill(e);

      const canProc = G.procN < 20;
      if (canProc) {
        const area = s.area;
        if (aff.fire >= 4 && e.burnT > 0) {
          G.procN++;
          PS.FX.ring(e.x, e.y, 70 * area, '#ff7a3d');
          C.aoe(e.x, e.y, 70 * area, C.power('fire') * 1.0, { el: 'fire', src: 'Ember burst', noProc: true });
        }
        if (aff.frost >= 4 && (e.chillT > 0 || e.freezeT > 0)) {
          G.procN++;
          PS.FX.shatter(e.x, e.y, '#bdf0ff');
          C.aoe(e.x, e.y, 80 * area, C.power('frost') * 0.9, { el: 'frost', src: 'Shatter', noProc: true, freeze: 0.12 });
        }
        if ((aff.venom >= 4 || f.pandemic) && e.poisStacks > 0) {
          G.procN++;
          let n = 0;
          const st = Math.max(1, Math.ceil(e.poisStacks * 0.6)), dps = e.poisDps;
          G.grid.query(e.x, e.y, 120 * area, (x) => {
            if (x !== e && n < 6) { C.poison(x, dps, st); n++; }
          });
          PS.FX.puff(e.x, e.y, '#8fe04a', 8);
        }
        if (aff.void >= 4 && (U.rnd() < 0.16 || (aff.void >= 6 && e.elite))) {
          G.procN++;
          C.implode(e.x, e.y, aff.void >= 6 ? 190 : 135, C.power('void') * 1.8);
        }
        if (f.corpseBoom && U.rnd() < f.corpseBoom) {
          G.procN++;
          PS.FX.explosion(e.x, e.y, 85 * area, '#ffb061');
          C.aoe(e.x, e.y, 85 * area, C.power('fire') * 1.6, { el: 'fire', src: 'Volatile Ichor', noProc: true });
          PS.Audio.play('explode', { vol: 0.4 });
        }
      }
      if (e.big && p.relics.warbanner) p.trophies++;
      p.onKill(e, o || EMPTY, canProc);
      if (e.def.onDeath) e.def.onDeath(e);
      if (e.affixes) PS.Enemies.affixDeath(e);
      if (e.boss) PS.Bosses.died(e);
    },

    implode(x, y, r, dmg) {
      const s = PS.G.player.stats;
      C.zone({
        x, y, r: r * s.area, life: 0.9, tick: 99, dmg: 0, el: 'void', src: 'Implosion', kind: 'implode', pull: 420,
        onEnd(z) {
          PS.FX.explosion(z.x, z.y, z.r * 0.7, '#c06bff');
          C.aoe(z.x, z.y, z.r * 0.7, dmg, { el: 'void', src: 'Implosion', noProc: true });
          PS.Audio.play('void', { vol: 0.4 });
        },
      });
    },

    /** immediate area damage. Returns number of enemies hit. */
    aoe(x, y, r, dmg, o) {
      const G = PS.G;
      const hits = TMP;
      hits.length = 0;
      G.grid.query(x, y, r, (e) => { hits.push(e); });
      const n = hits.length;
      // copy because damage() can cascade into more aoe() calls that reuse TMP
      const list = n > 0 ? hits.slice() : hits;
      for (let i = 0; i < n; i++) {
        const e = list[i];
        if (e.dead) continue;
        if (o && o.knock) o.ang = Math.atan2(e.y - y, e.x - x);
        C.damage(e, dmg, o);
      }
      return n;
    },

    /** cone/arc melee sweep. Returns enemies hit. */
    arc(x, y, ang, halfWidth, range, dmg, o) {
      const G = PS.G;
      const list = [];
      G.grid.query(x, y, range, (e) => {
        if (halfWidth >= Math.PI) { list.push(e); return; }
        const a = Math.atan2(e.y - y, e.x - x);
        // widen the test for big/near targets so point-blank hits never whiff
        const d = Math.hypot(e.x - x, e.y - y);
        const slack = Math.atan2(e.r, Math.max(d, 1));
        if (Math.abs(U.angDiff(ang, a)) <= halfWidth + slack || d < e.r + 14) list.push(e);
      });
      for (let i = 0; i < list.length; i++) {
        if (o && o.knock) o.ang = Math.atan2(list[i].y - y, list[i].x - x);
        C.damage(list[i], dmg, o);
      }
      return list.length;
    },

    /** lightning that hops between enemies */
    chain(x, y, first, dmg, jumps, range, o) {
      const G = PS.G;
      const seen = new Set();
      let cur = first, cx = x, cy = y, d = dmg;
      const col = (o && o.color) || '#ffe14d';
      if (o && o.skipFirst) { seen.add(cur.id); cx = cur.x; cy = cur.y; cur = null; }
      for (let i = 0; i <= jumps; i++) {
        if (!cur) {
          cur = C.nearest(cx, cy, range, (e) => !seen.has(e.id));
          if (!cur) break;
        }
        seen.add(cur.id);
        PS.FX.bolt(cx, cy, cur.x, cur.y, col);
        cx = cur.x; cy = cur.y;
        C.damage(cur, d, Object.assign({ el: 'storm' }, o));
        if (o && o.growth) d *= o.growth;
        cur = null;
      }
      G.fxLight = Math.min(1, (G.fxLight || 0) + 0.05);
    },

    /* ------------------------------------------------------------------ player projectiles */
    proj(o) {
      const G = PS.G;
      if (G.projs.length >= MAX_PROJ) return null;
      const ang = o.ang || 0, spd = o.speed || 0;
      const pr = {
        x: o.x, y: o.y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, ang, speed: spd,
        r: o.r || 6, dmg: o.dmg, el: o.el, src: o.src, life: o.life || 1.5, age: 0,
        pierce: o.pierce || 0, kind: o.kind || 'bolt', color: o.color || '#fff', size: o.size || 1,
        homing: o.homing || 0, target: null, explode: o.explode || 0, knock: o.knock || 0,
        boomerang: o.boomerang || 0, returning: false, spin: o.spin || 0, rot: ang,
        onHit: o.onHit || null, onEnd: o.onEnd || null, opts: o.opts || null,
        hit: null, dead: false, bounce: o.bounce || 0, accel: o.accel || 0, growth: o.growth || 0,
        hits: 0, wobble: o.wobble || 0, trail: o.trail || null, ox: o.x, oy: o.y, maxDist: o.maxDist || 0, cut: o.cut || false,
        noHit: o.noHit || false, data: o.data || null,
      };
      if (pr.pierce > 0 || pr.boomerang || pr.bounce) pr.hit = new Set();
      G.projs.push(pr);
      return pr;
    },

    updateProjs(dt) {
      const G = PS.G, p = G.player, list = G.projs;
      for (let i = 0; i < list.length; i++) {
        const pr = list[i];
        pr.age += dt;
        pr.life -= dt;
        if (pr.life <= 0) { C.endProj(pr); continue; }

        if (pr.boomerang) {
          if (!pr.returning && pr.age >= pr.boomerang) {
            pr.returning = true;
            if (pr.hit) pr.hit.clear();
          }
          if (pr.returning) {
            const a = Math.atan2(p.y - pr.y, p.x - pr.x);
            pr.speed = Math.min(pr.speed + 1600 * dt, 760);
            pr.vx = Math.cos(a) * pr.speed;
            pr.vy = Math.sin(a) * pr.speed;
            if (U.dist2(pr.x, pr.y, p.x, p.y) < 26 * 26) { pr.dead = true; continue; }
          } else {
            // decelerate toward apex
            const k = 1 - pr.age / pr.boomerang;
            const sp = pr.speed * (0.25 + 0.75 * k);
            pr.vx = Math.cos(pr.ang) * sp;
            pr.vy = Math.sin(pr.ang) * sp;
          }
        } else if (pr.homing) {
          if (!pr.target || pr.target.dead) {
            pr.target = C.nearest(pr.x, pr.y, 420, pr.hit ? (e) => !pr.hit.has(e.id) : null);
          }
          if (pr.target) {
            const a = Math.atan2(pr.target.y - pr.y, pr.target.x - pr.x);
            pr.ang = U.turnTo(pr.ang, a, pr.homing * dt);
          }
          if (pr.accel) pr.speed += pr.accel * dt;
          pr.vx = Math.cos(pr.ang) * pr.speed;
          pr.vy = Math.sin(pr.ang) * pr.speed;
        } else if (pr.accel) {
          pr.speed += pr.accel * dt;
          pr.vx = Math.cos(pr.ang) * pr.speed;
          pr.vy = Math.sin(pr.ang) * pr.speed;
        }

        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        if (pr.spin) pr.rot += pr.spin * dt; else pr.rot = Math.atan2(pr.vy, pr.vx);
        if (pr.growth) pr.r += pr.growth * dt;
        if (pr.trail && U.rnd() < 0.5) PS.FX.spark(pr.x, pr.y, pr.trail);
        if (pr.noHit) continue;

        // class attacks cut enemy bullets out of the air
        if (pr.cut && G.eprojs.length) {
          const eb = G.eprojs;
          let n = 0;
          for (let j = 0; j < eb.length; j++) {
            const b = eb[j];
            if (b.dead) continue;
            const rr = pr.r + b.r + 5, dx = b.x - pr.x, dy = b.y - pr.y;
            if (dx * dx + dy * dy < rr * rr) { b.dead = true; n++; PS.FX.hitSpark(b.x, b.y, '#ffffff'); }
          }
          if (n) C.bulletReward(n, false);
        }

        // collisions
        let done = false;
        G.grid.query(pr.x, pr.y, pr.r, (e) => {
          if (pr.hit && pr.hit.has(e.id)) return;
          C.projHit(pr, e);
          if (pr.dead) { done = true; return true; }
        });
        if (done) continue;
      }
      U.compact(list);
    },

    projHit(pr, e) {
      const o = pr.opts || {};
      o.el = pr.el; o.src = pr.src; o.knock = pr.knock; o.ang = pr.rot;
      if (pr.spin) o.ang = Math.atan2(pr.vy, pr.vx);
      pr.hits++;
      if (pr.hit) pr.hit.add(e.id);
      const wasBurning = e.burnT > 0; // sampled before this hit applies its own burn
      if (pr.explode) {
        PS.FX.explosion(pr.x, pr.y, pr.explode, pr.color);
        C.aoe(pr.x, pr.y, pr.explode, pr.dmg, o);
        if (pr.cut) C.deflect(pr.x, pr.y, pr.explode, false); // the blast burns bullets away too
        if (pr.el === 'fire') PS.Audio.play('explode', { vol: 0.3 });
      } else {
        C.damage(e, pr.dmg, o);
        PS.FX.hitSpark(pr.x, pr.y, pr.color, pr.spin ? undefined : pr.rot);
      }
      if (pr.onHit) pr.onHit(pr, e, wasBurning);
      if (pr.boomerang) return;
      if (pr.pierce > 0) { pr.pierce--; return; }
      if (pr.bounce > 0) {
        pr.bounce--;
        const n = C.nearest(pr.x, pr.y, 320, (x) => x !== e && !pr.hit.has(x.id));
        if (n) {
          pr.ang = Math.atan2(n.y - pr.y, n.x - pr.x);
          pr.vx = Math.cos(pr.ang) * pr.speed;
          pr.vy = Math.sin(pr.ang) * pr.speed;
          pr.target = n;
          pr.life = Math.max(pr.life, 0.6);
          return;
        }
      }
      C.endProj(pr, true);
    },
    endProj(pr, wasHit) {
      if (pr.dead) return;
      pr.dead = true;
      if (!wasHit && pr.explode && !pr.boomerang) {
        const o = pr.opts || {};
        o.el = pr.el; o.src = pr.src; o.knock = pr.knock;
        PS.FX.explosion(pr.x, pr.y, pr.explode, pr.color);
        C.aoe(pr.x, pr.y, pr.explode, pr.dmg, o);
      }
      if (pr.onEnd) pr.onEnd(pr);
    },

    /* ------------------------------------------------------------------ zones (lingering areas) */
    zone(o) {
      const G = PS.G;
      if (G.zones.length > 140) {
        // drop the oldest plain zone
        for (let i = 0; i < G.zones.length; i++) {
          const old = G.zones[i];
          if (!old.dead && !old.onEnd && !old.follow) { old.dead = true; break; }
        }
      }
      const z = {
        x: o.x, y: o.y, r: o.r, life: o.life, maxLife: o.life, tick: o.tick || 0.5, tickT: o.firstTick !== undefined ? o.firstTick : (o.tick || 0.5) * 0.5,
        dmg: o.dmg, el: o.el, src: o.src, kind: o.kind || 'pool', color: o.color || '#fff', follow: o.follow || false,
        pull: o.pull || 0, slow: o.slow || 0, opts: o.opts || null, onTick: o.onTick || null, onEnd: o.onEnd || null,
        vx: o.vx || 0, vy: o.vy || 0, dead: false, age: 0, data: o.data || null, grow: o.grow || 0,
      };
      G.zones.push(z);
      return z;
    },
    updateZones(dt) {
      const G = PS.G, p = G.player, list = G.zones;
      for (let i = 0; i < list.length; i++) {
        const z = list[i];
        if (z.dead) continue;
        z.age += dt;
        z.life -= dt;
        if (z.follow) { z.x = p.x; z.y = p.y; }
        else if (z.vx || z.vy) { z.x += z.vx * dt; z.y += z.vy * dt; }
        if (z.grow) z.r += z.grow * dt;
        if (z.pull) {
          G.grid.query(z.x, z.y, z.r, (e) => {
            if (e.mass >= 50) return;
            const dx = z.x - e.x, dy = z.y - e.y, d = Math.hypot(dx, dy) || 1;
            if (d < 12) return;
            const f = (z.pull * dt) / Math.max(1, e.mass * 0.6);
            e.x += (dx / d) * Math.min(f, d);
            e.y += (dy / d) * Math.min(f, d);
          });
        }
        z.tickT -= dt;
        if (z.tickT <= 0) {
          z.tickT += z.tick;
          if (z.dmg > 0) {
            const o = z.opts || {};
            o.el = z.el; o.src = z.src;
            C.aoe(z.x, z.y, z.r, z.dmg, o);
          }
          if (z.slow) G.grid.query(z.x, z.y, z.r, (e) => { C.chill(e, 1); });
          if (z.onTick) z.onTick(z);
        }
        if (z.life <= 0) {
          z.dead = true;
          if (z.onEnd) z.onEnd(z);
        }
      }
      U.compact(list);
    },

    /* ------------------------------------------------------------------ strikes (telegraphed player AoE) */
    strike(o) {
      PS.G.strikes.push({
        x: o.x, y: o.y, r: o.r, delay: o.delay || 0.5, t: 0, dmg: o.dmg, el: o.el, src: o.src,
        kind: o.kind || 'meteor', color: o.color || '#ff7a3d', opts: o.opts || null, onLand: o.onLand || null, dead: false,
      });
    },
    updateStrikes(dt) {
      const list = PS.G.strikes;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        s.t += dt;
        if (s.t >= s.delay) {
          s.dead = true;
          const o = s.opts || {};
          o.el = s.el; o.src = s.src;
          if (o.knock === undefined) o.knock = 120;
          if (s.kind === 'meteor') { PS.FX.explosion(s.x, s.y, s.r, s.color, true); PS.Audio.play('explode', { vol: 0.5 }); PS.FX.shake(3); }
          else if (s.kind === 'bolt') { PS.FX.bolt(s.x + U.rand(-30, 30), s.y - 420, s.x, s.y, s.color, 3); PS.FX.ring(s.x, s.y, s.r, s.color); PS.Audio.play('thunder', { vol: 0.35 }); }
          else if (s.kind === 'spike') { PS.FX.spikes(s.x, s.y, s.r, s.color); }
          else PS.FX.explosion(s.x, s.y, s.r, s.color);
          C.aoe(s.x, s.y, s.r, s.dmg, o);
          if (s.onLand) s.onLand(s);
        }
      }
      U.compact(list);
    },

    /* ------------------------------------------------------------------ minions */
    minion(o) {
      const G = PS.G;
      const m = {
        x: o.x, y: o.y, r: o.r || 11, kind: o.kind || 'skeleton', dmg: o.dmg, life: o.life || 20, maxLife: o.life || 20,
        speed: o.speed || 150, atkCd: 0, atkRate: o.atkRate || 0.7, src: o.src || 'Minions', el: o.el || 'void',
        target: null, dead: false, ang: 0, cleave: o.cleave || 0, onEnd: o.onEnd || null, bob: U.rnd() * TAU,
        range: o.range || 0, shot: o.shot || null, seat: o.seat || 0, opts: o.opts || null, retarget: 0, swing: 0,
      };
      G.minions.push(m);
      PS.FX.puff(m.x, m.y, '#c06bff', 6);
      return m;
    },
    updateMinions(dt) {
      const G = PS.G, p = G.player, list = G.minions;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        m.life -= dt;
        m.atkCd -= dt;
        m.retarget -= dt;
        m.swing = Math.max(0, m.swing - dt * 4);
        m.bob += dt * 5;
        if (m.life <= 0) {
          m.dead = true;
          PS.FX.puff(m.x, m.y, '#c06bff', 6);
          if (m.onEnd) m.onEnd(m);
          continue;
        }
        if (m.kind === 'familiar') {
          // hover near the player and shoot
          const a = G.time * 1.3 + m.seat * 2.4;
          const tx = p.x + Math.cos(a) * 46, ty = p.y + Math.sin(a) * 46 - 8;
          m.x += (tx - m.x) * Math.min(1, dt * 8);
          m.y += (ty - m.y) * Math.min(1, dt * 8);
          if (m.atkCd <= 0 && m.shot) {
            const t = C.nearest(m.x, m.y, m.range || 420);
            if (t) { m.ang = Math.atan2(t.y - m.y, t.x - m.x); m.shot(m, t); }
            else m.atkCd = 0.2;
          }
          continue;
        }
        if (m.retarget <= 0 || !m.target || m.target.dead) {
          m.retarget = 0.4;
          m.target = C.nearest(m.x, m.y, 360) || null;
          // don't stray too far from the master
          if (m.target && U.dist2(m.target.x, m.target.y, p.x, p.y) > 520 * 520) m.target = C.nearest(p.x, p.y, 320);
        }
        let tx, ty, stop;
        if (m.target) { tx = m.target.x; ty = m.target.y; stop = m.r + m.target.r; }
        else { const a = m.seat * 1.3 + G.time * 0.4; tx = p.x + Math.cos(a) * 60; ty = p.y + Math.sin(a) * 60; stop = 6; }
        const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy) || 1;
        if (d > stop) {
          const sp = m.speed * (d > 500 ? 2.2 : 1);
          m.x += (dx / d) * sp * dt;
          m.y += (dy / d) * sp * dt;
          m.ang = Math.atan2(dy, dx);
        }
        if (d > 900) { m.x = p.x + U.rand(-40, 40); m.y = p.y + U.rand(-40, 40); }
        if (m.target && d <= stop + 8 && m.atkCd <= 0) {
          m.atkCd = m.atkRate;
          m.swing = 1;
          const o = m.opts || {};
          o.el = m.el; o.src = m.src; o.knock = 60; o.ang = m.ang;
          if (m.cleave) C.aoe(m.target.x, m.target.y, m.cleave, m.dmg, o);
          else C.damage(m.target, m.dmg, o);
        }
      }
      U.compact(list);
    },

    /* ------------------------------------------------------------------ deflecting enemy bullets */
    /** payoff for every bullet destroyed or reflected: your ability (and Ward) come back sooner */
    bulletReward(n, fromWard) {
      const G = PS.G, p = G.player;
      G.deflected += n;
      // refunds draw from a budget set when the ability / Ward was used, and never tick while the ability is still running,
      // so bullets shorten cooldowns without ever chaining into permanent uptime
      if (p.abilityCd > 0 && p.whirlT <= 0 && p.abilityRefund > 0) {
        const r = Math.min(0.15 * n, p.abilityRefund, p.abilityCd);
        p.abilityCd -= r; p.abilityRefund -= r;
      }
      if (p.wardCd > 0 && p.wardRefund > 0) {
        const r = Math.min((fromWard ? 0.4 : 0.1) * n, p.wardRefund, p.wardCd);
        p.wardCd -= r; p.wardRefund -= r;
      }
      PS.Audio.play('frost', { vol: 0.3, pitch: 1.5 });
    },
    /** send an enemy bullet back as a friendly, lightly homing bolt */
    reflectBullet(b, src) {
      const G = PS.G, p = G.player, s = p.stats;
      b.dead = true;
      const t = C.nearest(b.x, b.y, 520);
      const ang = t ? Math.atan2(t.y - b.y, t.x - b.x) : Math.atan2(-b.vy, -b.vx);
      C.proj({
        x: b.x, y: b.y, ang, speed: 620, dmg: C.power('steel') * 5 * (s.f.mirror ? 1.6 : 1), el: 'steel', src: src || 'Reflected',
        r: b.r + 1, life: 1.6, kind: 'reflect', color: '#bfe6ff', homing: 6, knock: 60, trail: '#bfe6ff', opts: { minBossPct: 0.0015 },
      });
      PS.FX.hitSpark(b.x, b.y, '#bfe6ff');
    },
    /**
     * Deal with every enemy bullet inside a circle (optionally only inside an arc): reflect it or just destroy it.
     * Returns how many were caught.
     */
    deflect(x, y, r, reflect, ang, half, src, fromWard) {
      const list = PS.G.eprojs;
      if (!list.length) return 0;
      let n = 0;
      for (let i = 0, len = list.length; i < len; i++) {
        const b = list[i];
        if (b.dead) continue;
        const dx = b.x - x, dy = b.y - y, rr = r + b.r;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (half !== undefined && half < Math.PI && Math.abs(U.angDiff(ang, Math.atan2(dy, dx))) > half + 0.15) continue;
        if (reflect) C.reflectBullet(b, src); else { b.dead = true; PS.FX.hitSpark(b.x, b.y, '#ffffff'); }
        n++;
      }
      if (n) C.bulletReward(n, fromWard);
      return n;
    },

    /* ------------------------------------------------------------------ enemy bullets */
    ebullet(o) {
      const G = PS.G;
      if (!G.rules.noWard) PS.UI.tip('ward', PS.Input.touch ? 'Bullets incoming: your attacks cut them down, and the shield button reflects them' : 'Bullets incoming: your attacks cut them down, and Shift raises a Ward that reflects them', 'shield');
      if (G.eprojs.length > 420) return;
      G.eprojs.push({
        x: o.x, y: o.y, vx: Math.cos(o.ang) * o.speed, vy: Math.sin(o.ang) * o.speed, r: o.r || 7, dmg: o.dmg,
        life: o.life || 5, color: o.color || '#ff5a7a', dead: false, accel: o.accel || 0, curve: o.curve || 0, age: 0,
      });
    },
    updateEBullets(dt) {
      const G = PS.G, p = G.player, list = G.eprojs;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.dead) continue;
        b.life -= dt;
        b.age += dt;
        if (b.curve) {
          const a = Math.atan2(b.vy, b.vx) + b.curve * dt, sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
        }
        if (b.accel) { const k = 1 + b.accel * dt; b.vx *= k; b.vy *= k; }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.life <= 0) { b.dead = true; continue; }
        const rr = b.r + p.r * 0.7;
        if (U.dist2(b.x, b.y, p.x, p.y) < rr * rr) {
          if (p.hurt(b.dmg, 'bullet') !== 'iframe') b.dead = true;
        }
      }
      U.compact(list);
    },

    /* ------------------------------------------------------------------ enemy hazards (telegraphed) */
    /** kinds: circle {x,y,r,delay,dmg} | beam {x,y,ang,len,w,delay,dur,dmg,rot} | ring {x,y,speed,maxR,dmg,thick} */
    hazard(o) {
      const h = Object.assign({ t: 0, dead: false, delay: 0.8, dur: 0.25, hitDone: false, rad: 0, thick: 16, color: '#ff4d6d' }, o);
      PS.G.hazards.push(h);
      return h;
    },
    updateHazards(dt) {
      const G = PS.G, p = G.player, list = G.hazards;
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        h.t += dt;
        if (h.owner && h.owner.dead && h.t < h.delay) { h.dead = true; continue; }
        if (h.kind === 'circle') {
          if (h.t >= h.delay && !h.hitDone) {
            h.hitDone = true;
            PS.FX.explosion(h.x, h.y, h.r, h.color, h.r > 90);
            if (h.r > 90) { PS.FX.shake(5); PS.Audio.play('explode', { vol: 0.5 }); }
            const rr = h.r + p.r * 0.5;
            if (U.dist2(h.x, h.y, p.x, p.y) < rr * rr) {
              if (h.pct) {
                // tremors escalate if you keep standing in them: one slip stings, lingering is fatal
                if (G.time - p.tremorAt > 14) p.tremorN = 0;
                if (p.hurt(p.stats.maxHp * h.pct * Math.pow(1.6, p.tremorN), 'tremor', true) === 'hit') { p.tremorN++; p.tremorAt = G.time; }
              } else p.hurt(h.dmg, 'hazard');
            }
            if (h.onLand) h.onLand(h);
          }
          if (h.t >= h.delay + 0.2) h.dead = true;
        } else if (h.kind === 'beam') {
          if (h.follow && !h.follow.dead) { h.x = h.follow.x; h.y = h.follow.y; }
          if (h.t >= h.delay) {
            if (h.rot) h.ang += h.rot * dt;
            const x2 = h.x + Math.cos(h.ang) * h.len, y2 = h.y + Math.sin(h.ang) * h.len;
            if (!h.harmless && U.segCircle(h.x, h.y, x2, y2, p.x, p.y, h.w * 0.5 + p.r * 0.6)) p.hurt(h.dmg, 'beam');
            if (!h.sfx && !h.harmless) { h.sfx = true; PS.Audio.play('laser', { vol: 0.5 }); }
          } else if (h.track && h.t < h.delay - 0.35) {
            h.ang = U.turnTo(h.ang, Math.atan2(p.y - h.y, p.x - h.x), h.track * dt);
          }
          if (h.t >= h.delay + h.dur) h.dead = true;
        } else if (h.kind === 'ring') {
          h.rad += h.speed * dt;
          const d = Math.hypot(p.x - h.x, p.y - h.y);
          if (Math.abs(d - h.rad) < h.thick + p.r * 0.5) p.hurt(h.dmg, 'ring');
          if (h.rad >= h.maxR) h.dead = true;
        }
      }
      U.compact(list);
    },
  };

  const EMPTY = Object.freeze({});
  const TMP = [];

  PS.Combat = C;
})();
