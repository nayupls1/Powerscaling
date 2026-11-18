/* POWERSCALING — the player: stat assembly, movement, dash, ability, damage intake, levelling */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, C = PS.Combat, D = PS.Data;

  const DASH_TIME = 0.16;
  const DASH_SPEED = 980;

  /** experience needed to go from `level` to `level + 1` */
  function xpFor(level) {
    return Math.floor(5 + level * 5 + Math.pow(level, 2.2) * 0.5);
  }

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
      this.dm = 1; this.as = 1;
      this.dynT = 0; this.wantFire = false; this.gemCombo = 0; this.gemComboT = 0;
      this.stats = null; this.aff = {};
      this.recalc(true);
      this.hp = this.stats.maxHp;
      this.dashCharges = this.stats.dashCharges;
      this.rerolls = 2 + (this.stats.m.rerolls || 0);
      this.banishes = 1 + (this.stats.m.banishes || 0);
    }

    get tomeSlots() { return 6 + (this.stats.m.tomeSlots || 0); }
    get skillSlots() { return 6; }

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
      // permanent meta tree
      const tree = PS.Save.data.tree;
      for (const id in tree) {
        const n = D.META_BY_ID[id];
        if (n && tree[id] > 0) n.apply(s, tree[id]);
      }
      for (const t of this.tomes) t.def.apply(s, t.val);
      for (const id in this.boons) D.BOONS[id].apply(s, this.boons[id]);
      for (const id in this.relics) D.RELICS[id].apply(s, this.relics[id], this);
      cls.branches.forEach((br, bi) => {
        for (let i = 0; i < this.talents[bi]; i++) br.nodes[i].apply(s, this);
      });

      // affinities = owned skills per element + bonus points
      const aff = Object.assign({}, s.aff);
      for (const sk of this.skills) aff[sk.def.el] += 1;
      if (aff.steel >= 2) { s.crit += 0.12; s.armor += 6; }
      if (aff.steel >= 4) s.critMult += 0.5;
      if (aff.steel >= 6) s.dmgMore *= 1.3;
      if (aff.storm >= 6) s.atkSpd += 0.25;
      if (aff.void >= 2) s.area += 0.18;
      if (aff.void >= 6) s.atkSpd += 0.2;

      s.maxHp = Math.max(10, Math.round(s.maxHp * Math.max(0.2, s.hpMult)));
      s.dodge = Math.min(0.6, s.dodge);
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
      if (f.momentum) dm *= 1 + Math.max(0, s.speed / s.baseSpeed - 1) * 0.6;
      this.dm = dm;
      let as = s.atkSpd;
      if (this.frenzy > 0) as += this.frenzy * 0.025;
      if (this.surgeT > 0) as += 0.6;
      if (this.galeT > 0) as += 0.4;
      if (f.momentum2 && this.moving) as += 0.2;
      this.as = Math.max(0.2, as);

      // timers
      if (this.inv > 0) this.inv -= dt;
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
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
        const cap = (4 + s.maxHp * 0.06) * dt;
        const h = Math.min(this.leechPool, cap);
        this.leechPool = Math.min(this.leechPool - h, s.maxHp * 0.5);
        this.hp = Math.min(s.maxHp, this.hp + h);
      }

      // aim
      this.auraR = 0;
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
      this.wantFire = autoAim ? !!target : ctrl.fire;

      // dash
      if (ctrl.dash && this.dashT <= 0 && this.dashCharges > 0) {
        if (this.dashCharges === s.dashCharges) this.dashRecharge = s.dashCd;
        this.dashCharges--;
        this.dashT = DASH_TIME;
        this.dashAng = (ctrl.mx || ctrl.my) ? Math.atan2(ctrl.my, ctrl.mx) : this.aim;
        this.inv = Math.max(this.inv, DASH_TIME + 0.12);
        PS.Audio.play('dash', { vol: 0.5 });
        PS.FX.dashBurst(this.x, this.y, this.dashAng, cls.color);
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
        if (f.rampage && this.frenzy >= this.frenzyMax) sp *= 1.2;
        vx = ctrl.mx * sp;
        vy = ctrl.my * sp;
      }
      this.moving = vx !== 0 || vy !== 0;
      this.x += vx * dt;
      this.y += vy * dt;
      if (this.moving) this.walk += dt * 11;

      // ability
      if (ctrl.ability && this.abilityCd <= 0) {
        this.abilityMax = cls.ability.cd / (1 + s.abilityHaste);
        this.abilityCd = this.abilityMax;
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
    hurt(dmg, src) {
      const G = PS.G, s = this.stats, cls = this.cls;
      if (this.inv > 0 || this.dashT > 0 || G.over) return 'iframe';
      if (s.dodge > 0 && Math.random() < s.dodge) {
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
      let d = dmg * (60 / (60 + Math.max(0, s.armor)));
      if (this.whirlT > 0) d *= 0.6;
      d = Math.max(1, d);
      this.hp -= d;
      G.dmgTaken += d;
      this.inv = 0.55 + (s.m.iframes || 0);
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
      if (cls.onHurt) cls.onHurt(this, d);
      if (this.hp <= 0) this.die();
      return 'hit';
    }
    die() {
      const G = PS.G, s = this.stats;
      if (s.revives - this.revivesUsed > 0) {
        this.revivesUsed++;
        this.hp = s.maxHp * (this.relics.phoenix ? 1 : 0.5);
        this.inv = 3;
        PS.FX.flash('#ffd06b', 0.6);
        PS.FX.explosion(this.x, this.y, 320, '#ffb061', true);
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
        this.level++;
        this.xpNext = xpFor(this.level);
        this.pendingLevels++;
        if (this.level % 5 === 0) this.talentsDue++;
      }
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
      const inc = def.per * (def.fixed ? 1 : D.RARITY[tier].mult);
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
      this.boons[id] = (this.boons[id] || 0) + def.per * D.RARITY[tier].mult;
      this.recalc();
    }
    talentTotal() { return this.talents[0] + this.talents[1] + this.talents[2]; }
  }

  PS.Player = Player;
  PS.xpFor = xpFor;
})();
