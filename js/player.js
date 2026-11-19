/* POWERSCALING — the player: stat assembly, movement, dash, ability, damage intake, levelling */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, C = PS.Combat, D = PS.Data;

  const DASH_TIME = 0.16;
  const DASH_SPEED = 980;
  const WARD_CD = 6, WARD_TIME = 0.35, WARD_RADIUS = 150;

  /** experience needed to go from `level` to `level + 1` */
  function xpFor(level) {
    return Math.floor(8 + level * 9 + Math.pow(level, 2.35) * 0.9);
  }
  // slots open as the hero levels, so a build is assembled over the run instead of in the first minute.
  // Each unlock is a power spike the player can see coming on the HUD.
  const SKILL_SLOT_LEVELS = [1, 2, 5, 9, 14, 20];
  const TOME_SLOT_LEVELS = [2, 4, 7, 11, 16, 22];
  const slotsAt = (table, level) => { let n = 0; for (const l of table) if (level >= l) n++; return n; };

  class Player {
    constructor(clsId) {
      const cls = D.CLASSES[clsId];
      this.cls = cls;
      this.x = 0; this.y = 0; this.r = 14;
      this.aim = 0; this.aimX = 100; this.aimY = 0; this.face = 1;
      this.level = 1; this.xp = 0; this.xpNext = xpFor(1); this.pendingLevels = 0;
      this.kills = 0; this.gold = 0;
      this.skills = [PS.Skills.make(cls.primary)];
      this.tomes = [];
      this.relics = {}; this.relicOrder = [];
      this.boons = {};
      this.pacts = [];
      this.trophies = 0; this.calmT = 0; this.skinT = 0; this.gemsEaten = 0; // relic counters
      this.talents = [0, 0, 0];
      this.talentsDue = 0;
      this.banned = new Set();
      this.inv = 1.5; this.hurtFlash = 0;
      this.dashT = 0; this.dashAng = 0; this.dashCharges = 1; this.dashRecharge = 0;
      this.abilityCd = 3; this.abilityMax = 1;
      this.moving = false; this.swing = 0; this.walk = 0;
      this.frenzy = 0; this.frenzyMax = 20; this.frenzyT = 0;
      this.surgeT = 0; this.galeT = 0; this.whirlT = 0; this.barrier = false; this.barrierT = 3; this.reborn = false;
      this.souls = 0; this.hitCounter = 0; this.arcIcd = 0; this.timeStopT = 20;
      this.revivesUsed = 0; this.leechPool = 0; this.auraR = 0;
      this.tremorN = 0; this.tremorAt = -99; this.hitInv = false; this.abilityRefund = 0; this.wardRefund = 0;
      this.wardCd = 0; this.wardMax = WARD_CD; this.wardT = 0; this.wardR = WARD_RADIUS; this.wardHits = 0;
      this.dm = 1; this.as = 1;
      this.dynT = 0; this.wantFire = false; this.gemCombo = 0; this.gemComboT = 0;
      this.stats = null; this.aff = {};
      this.recalc(true);
      this.hp = this.stats.maxHp;
      this.dashCharges = this.stats.dashCharges;
      this.rerolls = 3 + (this.stats.m.rerolls || 0);
      this.banishes = 2 + (this.stats.m.banishes || 0);
      this.rerollsBought = 0;
    }

    /** the level whose reward is being chosen: levels are banked at once but claimed one card at a time */
    get claimedLevel() { return this.level - this.pendingLevels; }
    get tomeSlots() { return slotsAt(TOME_SLOT_LEVELS, this.claimedLevel) + (this.stats.m.tomeSlots || 0); }
    get skillSlots() { return slotsAt(SKILL_SLOT_LEVELS, this.claimedLevel); }

    recalc(first) {
      const cls = this.cls;
      const s = {
        maxHp: 100, hpMult: 1, regen: 0, armor: 0, dodge: 0, speed: 210,
        dmg: 1, dmgMore: 1, atkSpd: 1, crit: 0.05, critMult: 1.5, area: 1, projSpd: 1, duration: 1,
        proj: 0, pierce: 0, knock: 1, pickup: 95, xp: 1, gold: 1, luck: 0, lifesteal: 0, bossDmg: 0,
        statusDmg: 1, summon: 1, abilityHaste: 0, dashCd: 2.2, dashCharges: 1, revives: 0,
        el: { fire: 1, frost: 1, storm: 1, venom: 1, steel: 1, void: 1 },
        aff: { fire: 0, frost: 0, storm: 0, venom: 0, steel: 0, void: 0 },
        f: {}, m: {},
      };
      Object.assign(s, cls.base);
      // permanent meta tree. The daily rift lends every hero the whole tree, so the day's board compares play, not grind
      const G = PS.G, rules = G && G.rules, tree = PS.Save.data.tree;
      for (const n of D.META) {
        const rank = G && G.daily ? n.max : tree[n.id] || 0;
        if (rank > 0) n.apply(s, rank);
      }
      for (const t of this.tomes) t.def.apply(s, t.val);
      for (const id in this.boons) D.BOONS[id].apply(s, this.boons[id]);
      for (const id of this.pacts) if (D.PACTS[id].stats) D.PACTS[id].stats(s);
      if (G && G.sigil && D.SIGILS[G.sigil].stats) D.SIGILS[G.sigil].stats(s);
      for (const id in this.relics) D.RELICS[id].apply(s, this.relics[id], this);
      cls.branches.forEach((br, bi) => {
        for (let i = 0; i < this.talents[bi]; i++) br.nodes[i].apply(s, this);
      });

      // affinities = owned skills per element + bonus points
      const aff = Object.assign({}, s.aff);
      for (const sk of this.skills) aff[sk.def.el] += sk.evolved ? 2 : 1; // an evolved skill counts twice
      if (aff.steel >= 2) { s.crit += 0.12; s.armor += 6; }
      if (aff.steel >= 4) s.critMult += 0.5;
      if (aff.steel >= 6) s.dmgMore *= 1.3;
      if (aff.storm >= 6) s.atkSpd += 0.25;
      if (aff.void >= 2) s.area += 0.18;
      if (aff.void >= 6) s.atkSpd += 0.2;

      // what the depth or the day's mutator does to the hero
      if (rules) {
        s.dmgMore *= rules.pDmg; s.hpMult *= rules.pHp; s.speed *= rules.pSpeed; s.dashCd *= rules.dashCd; s.xp *= rules.xp;
      }
      s.maxHp = Math.max(10, Math.round(s.maxHp * Math.max(0.2, s.hpMult)));
      s.dodge = Math.min(0.6, s.dodge);
      if (s.noRegen) s.regen = Math.min(0, s.regen);
      s.dashCd = Math.max(0.5, s.dashCd);
      s.baseSpeed = cls.base.speed || 210;

      const prevMax = this.stats ? this.stats.maxHp : s.maxHp;
      // announce newly reached affinity thresholds — these are the big build moments
      if (!first && PS.G && PS.G.player === this) {
        for (const el in aff) {
          for (const th of D.AFFINITY[el]) {
            if ((this.aff[el] || 0) < th.n && aff[el] >= th.n) {
              PS.UI.toast(`${D.ELEMENTS[el].name} ${th.n}: ${th.text}`, D.ELEMENTS[el].icon);
              PS.Audio.play('shrine', { vol: 0.6 });
            }
          }
        }
      }
      this.stats = s;
      this.aff = aff;
      if (!first) {
        if (s.maxHp > prevMax) this.hp += s.maxHp - prevMax;
        this.hp = Math.min(this.hp, s.maxHp);
      }
      this.frenzyMax = 20;
      this.abilityMax = cls.ability.cd / (1 + s.abilityHaste);
    }

    /* ------------------------------------------------------------ per-frame */
    update(dt, ctrl) {
      const G = PS.G, s = this.stats, f = s.f, cls = this.cls;

      // relics/talents whose value depends on kills, gold or level
      this.dynT -= dt;
      if (this.dynT <= 0) { this.dynT = 1; this.recalc(); }

      // dynamic multipliers
      let dm = s.dmg * s.dmgMore;
      if (f.berserk) dm *= 1 + f.berserk * (1 - this.hp / s.maxHp);
      if (this.reborn) dm *= 1.3;
      if (s.m.blooded && this.hp < s.maxHp * 0.5) dm *= 1 + s.m.blooded;
      if (f.momentum) dm *= 1 + Math.max(0, s.speed / s.baseSpeed - 1) * 0.6;
      this.dm = dm;
      let as = s.atkSpd;
      if (this.frenzy > 0) as += this.frenzy * 0.025;
      if (this.surgeT > 0) as += 0.6;
      if (this.galeT > 0) as += 0.4;
      if (this.stepT > 0) as += 0.5;
      as += PS.Director.tideOf('haste', 0);
      if (f.momentum2 && this.moving) as += 0.2;
      this.as = Math.max(0.2, as);

      // timers
      if (this.inv > 0) { this.inv -= dt; if (this.inv <= 0) this.hitInv = false; }
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
      this.calmT += dt;
      if (this.skinT > 0) { this.skinT -= dt; if (this.skinT <= 0) this.recalc(); }
      if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 5);
      if (this.abilityCd > 0) this.abilityCd -= dt;
      if (this.dashCharges < s.dashCharges) {
        this.dashRecharge -= dt;
        if (this.dashRecharge <= 0) {
          this.dashCharges++;
          this.dashRecharge = s.dashCd;
        }
      }
      if (this.gemComboT > 0) { this.gemComboT -= dt; if (this.gemComboT <= 0) this.gemCombo = 0; }

      // regen & capped lifesteal
      if (s.regen !== 0 && this.hp > 0) {
        this.hp = Math.min(s.maxHp, this.hp + s.regen * dt);
        if (this.hp < 1) this.hp = 1;
      }
      if (this.leechPool > 0) {
        const cap = (2 + s.maxHp * 0.025) * dt;
        const h = Math.min(this.leechPool, cap);
        this.leechPool = Math.min(this.leechPool - h, s.maxHp * 0.5);
        this.hp = Math.min(s.maxHp, this.hp + h);
      }

      // aim
      this.auraR = 0; this.miasmaR = 0;
      const autoAim = ctrl.autoAim;
      let target = null;
      if (autoAim) {
        target = C.nearest(this.x, this.y, 520);
        if (target) { this.aimX = target.x; this.aimY = target.y; }
        else if (this.moving) { this.aimX = this.x + ctrl.mx * 200; this.aimY = this.y + ctrl.my * 200; }
      } else {
        this.aimX = ctrl.aimX; this.aimY = ctrl.aimY;
      }
      const want = Math.atan2(this.aimY - this.y, this.aimX - this.x);
      this.aim = autoAim ? U.turnTo(this.aim, want, 14 * dt) : want;
      if (Math.abs(Math.cos(this.aim)) > 0.2) this.face = Math.cos(this.aim) > 0 ? 1 : -1;
      // auto-aim holds fire with nothing in range; manual attack only swings on a click or hold
      this.wantFire = ctrl.fire && (!autoAim || !!target);

      // dash
      if (ctrl.dash && this.dashT <= 0 && this.dashCharges > 0) {
        if (this.dashCharges === s.dashCharges) this.dashRecharge = s.dashCd;
        this.dashCharges--;
        this.dashT = DASH_TIME;
        this.dashAng = (ctrl.mx || ctrl.my) ? Math.atan2(ctrl.my, ctrl.mx) : this.aim;
        this.inv = Math.max(this.inv, DASH_TIME + 0.12);
        this.hitInv = false;
        PS.Audio.play('dash', { vol: 0.5 });
        PS.FX.dashBurst(this.x, this.y, this.dashAng, cls.color);
        if (f.dashChill) {
          PS.FX.ring(this.x, this.y, 170 * s.area, '#bdf0ff', 0.35);
          G.grid.query(this.x, this.y, 170 * s.area, (e) => { C.chill(e, 3); if (!e.big) C.freeze(e, 1, 0.8); });
        }
        if (cls.onDash) cls.onDash(this);
      }

      // move
      let vx = 0, vy = 0;
      if (this.dashT > 0) {
        this.dashT -= dt;
        vx = Math.cos(this.dashAng) * DASH_SPEED;
        vy = Math.sin(this.dashAng) * DASH_SPEED;
        PS.FX.ghost(this);
        if (cls.dashing) cls.dashing(this, dt);
      } else {
        let sp = s.speed;
        if (this.whirlT > 0) sp *= 1.3;
        if (this.tempestT > 0 && f.eye) sp *= 1.25;
        if (f.rampage && this.frenzy >= this.frenzyMax) sp *= 1.2;
        vx = ctrl.mx * sp;
        vy = ctrl.my * sp;
      }
      this.moving = vx !== 0 || vy !== 0;
      this.x += vx * dt;
      this.y += vy * dt;
      if (this.moving) this.walk += dt * 11;

      // Ward: a brief shield pulse that reflects bullets and staggers whatever is touching you
      if (this.wardCd > 0) this.wardCd -= dt;
      if (ctrl.ward && this.wardCd <= 0 && this.wardT <= 0 && !G.rules.noWard) this.raiseWard();
      if (this.wardT > 0) {
        this.wardT -= dt;
        const got = C.deflect(this.x, this.y, this.wardR, true, 0, undefined, 'Ward', true);
        if (got) this.wardHits += got; // the cooldown refund is handled (and capped) in Combat.bulletReward
        if (this.wardT <= 0 && this.wardHits > 0) {
          PS.FX.text(this.x, this.y - 44, 'Reflected ' + this.wardHits, '#bfe6ff');
          PS.Audio.play('crit', { vol: 0.6, pitch: 0.8 });
        }
      }

      // ability
      if (ctrl.ability && this.abilityCd <= 0) {
        this.abilityMax = cls.ability.cd / (1 + s.abilityHaste);
        this.abilityCd = this.abilityMax;
        this.abilityRefund = this.abilityMax * 0.35;
        cls.ability.use(this);
        PS.FX.ring(this.x, this.y, 60, cls.color, 0.3);
      }
      cls.update(this, dt);

      // skills
      for (let i = 0; i < this.skills.length; i++) PS.Skills.update(this.skills[i], dt, this);

      // Time Crystal
      if (f.timeStop) {
        this.timeStopT -= dt;
        if (this.timeStopT <= 0) {
          this.timeStopT = 25;
          PS.FX.flash('#bdf0ff', 0.25);
          PS.Audio.play('freeze');
          for (const e of G.enemies) {
            if (U.dist2(e.x, e.y, this.x, this.y) < 700 * 700) {
              if (e.boss) C.chill(e, 3);
              else { e.freezeT = Math.max(e.freezeT, 2); e.chillT = Math.max(e.chillT, 3); }
            }
          }
        }
      }
    }

    raiseWard() {
      const G = PS.G, s = this.stats;
      this.wardMax = WARD_CD * (s.f.mirror ? 0.75 : 1);
      this.wardCd = this.wardMax;
      this.wardRefund = this.wardMax * 0.4; // a good parry buys back up to 40% of the cooldown, no more
      this.hitInv = false;
      this.wardT = WARD_TIME;
      this.wardHits = 0;
      this.wardR = WARD_RADIUS * (s.f.mirror ? 1.25 : 1);
      this.inv = Math.max(this.inv, WARD_TIME + 0.1);
      PS.FX.ring(this.x, this.y, this.wardR, '#bfe6ff', 0.35);
      PS.Audio.play('frost', { vol: 0.7, pitch: 0.7 });
      // shove and stagger everything in reach (bosses only flinch)
      const dmg = C.power('steel') * 2;
      G.grid.query(this.x, this.y, this.wardR, (e) => {
        C.freeze(e, 1, 0.6); // respects freeze immunity, so the Ward cannot hold a crowd frozen
        C.damage(e, dmg, { el: 'steel', src: 'Ward', knock: 320, noProc: true, noStatus: true });
      });
    }

    /** where an aimed ability lands */
    abilityPoint() {
      const G = PS.G;
      if (G.ctrl.autoAim) {
        const e = C.clusterPoint(430);
        if (e) return { x: e.x, y: e.y };
        return { x: this.x + Math.cos(this.aim) * 160, y: this.y + Math.sin(this.aim) * 160 };
      }
      const dx = this.aimX - this.x, dy = this.aimY - this.y, d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, 460 / d);
      return { x: this.x + dx * k, y: this.y + dy * k };
    }

    /* ------------------------------------------------------------ health */
    heal(v, quiet) {
      if (this.hp <= 0) return;
      const before = this.hp;
      this.hp = Math.min(this.stats.maxHp, this.hp + v);
      if (!quiet && this.hp - before >= 1) PS.FX.text(this.x, this.y - 30, '+' + Math.round(this.hp - before), '#7dffa0');
    }
    leech(v) {
      this.leechPool += v;
    }
    /** returns 'iframe' | 'dodge' | 'block' | 'hit' */
    hurt(dmg, src, raw) {
      const G = PS.G, s = this.stats, cls = this.cls;
      // the grace period after a contact hit does not shelter you from the ground giving way; dash, Ward and revive still do
      if (this.dashT > 0 || G.over || (this.inv > 0 && !(raw && this.hitInv))) return 'iframe';
      if (s.dodge > 0 && U.rnd() < s.dodge) {
        this.inv = 0.3;
        PS.FX.text(this.x, this.y - 30, 'Dodge', '#bfe6ff');
        return 'dodge';
      }
      if (this.barrier) {
        this.barrier = false;
        this.barrierT = 9;
        this.inv = 0.7;
        PS.FX.text(this.x, this.y - 30, 'Blocked', '#9fd0ff');
        PS.Audio.play('frost', { vol: 0.6 });
        if (cls.onBlock) cls.onBlock(this);
        return 'block';
      }
      let d = raw ? dmg : dmg * (60 / (60 + Math.max(0, s.armor)));
      if (this.whirlT > 0) d *= 0.6;
      if (this.tempestT > 0 && s.f.eye) d *= 0.65;
      d = Math.max(1, d);
      this.hp -= d;
      G.dmgTaken += d;
      PS.Game.tookDamage(src, d);
      this.inv = 0.55 + (s.m.iframes || 0);
      this.hitInv = true;
      this.hurtFlash = 0.35;
      G.hitstop = 0.07;
      PS.FX.shake(8);
      PS.FX.hurt(this, d);
      PS.Audio.play('hurt');
      if (s.f.thorns) {
        const td = (30 + s.armor * 4) * this.dm * s.f.thorns;
        PS.FX.ring(this.x, this.y, 130 * s.area, '#d9dfef', 0.25);
        C.aoe(this.x, this.y, 130 * s.area, td, { el: 'steel', src: 'Thornmail', knock: 200, noProc: true });
      }
      this.calmT = 0;
      if (s.f.secondSkin) { const had = this.skinT > 0; this.skinT = 5; if (!had) this.recalc(); }
      if (cls.onHurt) cls.onHurt(this, d);
      if (this.hp <= 0) this.die();
      return 'hit';
    }
    die() {
      const G = PS.G, s = this.stats;
      if (s.revives - this.revivesUsed > 0) {
        this.revivesUsed++;
        // the Phoenix Plume's own revive is the one that restores full health; it is spent first
        const plume = this.relics.phoenix && !this.plumeUsed;
        if (plume) this.plumeUsed = true;
        this.hp = s.maxHp * (plume ? 1 : 0.5);
        this.inv = 3;
        this.hitInv = false;
        this.tremorN = 0;
        PS.FX.flash('#ffd06b', 0.6);
        PS.FX.explosion(this.x, this.y, 320, '#ffb061', true);
        PS.FX.rays(this.x, this.y, 380, '#ffd06b', 12, 0.8);
        PS.FX.shake(12);
        PS.Audio.play('revive');
        C.aoe(this.x, this.y, 340, C.power('fire') * 12, { el: 'fire', src: 'Rebirth', knock: 500, noProc: true });
        G.eprojs.length = 0;
        if (this.cls.onRevive) this.cls.onRevive(this);
        PS.UI.toast('You rise again', 'phoenix');
        return;
      }
      this.hp = 0;
      PS.Game.playerDied();
    }

    /* ------------------------------------------------------------ progression */
    addXp(v) {
      this.xp += v * this.stats.xp;
      while (this.xp >= this.xpNext) {
        this.xp -= this.xpNext;
        this.gainLevel();
      }
    }
    /** one level, however it was earned (experience, or a pact that hands levels out) */
    gainLevel() {
      const k = this.stats.f.kindling;
      if (k) {
        const r = 190 * this.stats.area;
        PS.FX.explosion(this.x, this.y, r, '#ffd06b');
        C.aoe(this.x, this.y, r, (40 + this.level * 6) * this.dm * k, { src: 'Kindling', knock: 220, noProc: true });
      }
      this.level++;
      this.xpNext = xpFor(this.level);
      this.pendingLevels++;
      if (this.level % 6 === 0) this.talentsDue++;
    }
    onKill(e, o, canProc) {
      if (this.cls.onKill) this.cls.onKill(this, e, canProc);
    }

    /* ------------------------------------------------------------ inventory */
    hasSkill(id) { return this.skills.find((s) => s.id === id); }
    hasTome(id) { return this.tomes.find((t) => t.id === id); }
    addSkill(id) {
      const inst = PS.Skills.make(id);
      this.skills.push(inst);
      this.recalc();
      return inst;
    }
    addTome(id, tier) {
      const def = D.TOMES[id];
      const inc = D.incFor(def, tier);
      let t = this.hasTome(id);
      if (!t) { t = { id, def, level: 0, val: 0 }; this.tomes.push(t); }
      t.level++;
      t.val += inc;
      this.recalc();
      return t;
    }
    addRelic(id) {
      if (!this.relics[id]) { this.relics[id] = 0; this.relicOrder.push(id); }
      this.relics[id]++;
      this.recalc();
    }
    addBoon(id, tier) {
      const def = D.BOONS[id];
      this.boons[id] = (this.boons[id] || 0) + D.incFor(def, tier);
      this.recalc();
    }
    /** strike a pact: its price is paid at once (the run's rules turn), its gift lasts the run */
    addPact(id) {
      const def = D.PACTS[id], G = PS.G;
      this.pacts.push(id);
      if (def.rules) def.rules(G.rules);
      this.recalc();
      if (def.now) def.now(G, this);
    }
    talentTotal() { return this.talents[0] + this.talents[1] + this.talents[2]; }
  }

  PS.Player = Player;
  PS.xpFor = xpFor;
  PS.SLOT_LEVELS = { skill: SKILL_SLOT_LEVELS, tome: TOME_SLOT_LEVELS };
})();
