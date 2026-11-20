/* POWERSCALING — run director: difficulty curves, spawning, hordes, elites, drops, pickups, chests and shrines */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, TAU = U.TAU;
  // The run's script (which horde, which elite, which tide) is drawn per numbered event from PS.RNG.side: see seed.js.
  // G.script keeps what was drawn, in separate lists, so tools/determinism.js can hold two players on a seed against each other.
  const note = (kind, what) => { const sc = PS.G.script; (sc[kind] = sc[kind] || []).push(what); };

  const MAX_ENEMIES = 300;
  const MAX_GEMS = 340;
  const BOSS_TIMES = [180, 360, 540, 720];
  const FINAL_TIME = 720;
  // Boss rush: the minute each stage plays at (it sets how tough the boss and its hangers-on are), the bosses in order,
  // and the levels handed out before each
  const RUSH_MIN = [3, 6, 9, 12, 13.5], RUSH_ORDER = [0, 1, 2, 3, 4], RUSH_LEVELS = [11, 10, 10, 10, 6];
  const ENDLESS_BOSS_EVERY = 120;
  const HORDE_FIRST = 75, HORDE_EVERY = 80;
  /*
   * Horde toughness by minute, interpolated geometrically between knots. The hero's power does not grow at one rate:
   * it climbs slowly while only a couple of slots are open, fastest in the middle acts as slots fill and skills
   * evolve, then flattens as each pick moves a smaller share of the build. The knots follow that shape a step behind,
   * so a run goes from scrappy to dominant instead of the other way round.
   */
  const HP_KNOTS = [[0, 1.6], [1, 2.4], [2, 3.3], [3, 4.4], [4.5, 7.2], [6, 12], [7.5, 17.2], [9, 24.5], [10.5, 35], [12, 49]];
  const DEEPEN = 1.25; // each boss slain makes the horde this much sturdier: the spoils are the spike, this is the fall
  // Reactions made every mixed-element build a little stronger. This hands that back to the horde so the curve above
  // still describes the game: with it, the bot's results match what they were before reactions existed.
  const REACTION_OFFSET = 1.05;

  // from: minute the type first appears, w: weight once established
  const TABLE = [
    { id: 'imp',     from: 0,   w: (t) => Math.max(2.5, 10 - t * 0.7) },
    { id: 'bat',     from: 1,   w: () => 4 },
    { id: 'spitter', from: 2,   w: () => 2.2 },
    { id: 'slime',   from: 2.6, w: () => 2.4 },
    { id: 'hound',   from: 3.5, w: () => 2.4 },
    { id: 'brute',   from: 4.5, w: () => 1.5 },
    { id: 'bloater', from: 5.5, w: () => 1.6 },
    { id: 'wraith',  from: 6.5, w: () => 2.3 },
    { id: 'mortar',  from: 4,   w: () => 1.2 },
    { id: 'toad',    from: 5,   w: () => 1.1 },
    { id: 'hexer',   from: 7.5, w: () => 1.8 },
    { id: 'warder',  from: 7,   w: () => 0.4 },
    { id: 'knight',  from: 8.5, w: (t) => 2 + Math.min(3, (t - 8.5) * 0.5) },
  ];

  /** geometric interpolation through [x, y] knots */
  function knot(k, x) {
    if (x <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) {
      if (x <= k[i][0]) {
        const f = (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
        return k[i - 1][1] * Math.pow(k[i][1] / k[i - 1][1], f);
      }
    }
    return k[k.length - 1][1];
  }

  const Dr = {
    BOSS_TIMES, FINAL_TIME,
    reset() {
      this.spawnAcc = 0;
      this.eliteT = 60;
      this.hordeT = HORDE_FIRST;
      this.hordeN = 0;
      this.lastHorde = '';
      this.bossIdx = 0;
      this.endlessBossT = 0;
      this.chestT = 6;
      this.shrineT = 40;
      this.altarT = 165;   // dark altars: a pact with a price
      this.forgeT = 210;   // forges: a level for a skill of your choosing
      this.merchantT = 250; // a merchant: gold for one of three offers
      this.breachT = 100;  // breaches: a timed kill trial for a relic
      this.breach = null;  // the breach being fought, if any
      this.breachN = 0;    // breaches woken so far: the first is always a swarm
      this.tideT = 200; this.tide = null; this.tideLeft = 0; this.lastTide = ''; this.guardedAt = 0;
      this.quietT = 0; // a gap after each map event, so the ones a boss held back do not all arrive in one breath
      this.tideN = 0; this.hoarderN = 0; this.guardN = 0; this.eliteN = 0; // how many of each so far: they name the RNG.side draws // rift tides: see Data.TIDES
      this.hoarderT = 140; this.hoarder = null; // a Hoarder now and then: gold and a relic, if it is caught
      this.chestCost = 35;
      this.chestsOpened = 0;
      this.victory = false; this.victoryAt = 0;
      this.healAt = 0; this.magnetAt = 0; this.bombAt = 30;
      this.tremorT = 150; this.tremorX = 1e9; this.tremorY = 1e9; this.linger = 0;
    },
    /** minutes into the run; a boss rush is always as late as the boss it has reached */
    minutes() { const G = PS.G; return G.rush ? RUSH_MIN[Math.min(G.rush.stage, RUSH_MIN.length - 1)] + (G.time - G.rush.at) / 240 : G.time / 60; },
    /** minutes of overtime: the clock starts when the Rift Lord falls, so the final duel itself is not inflated */
    endless() { return this.victory ? Math.max(0, PS.G.time - this.victoryAt) / 60 : 0; },
    hpMult() {
      const t = Math.min(this.minutes(), 12), o = this.endless();
      return knot(HP_KNOTS, t) * Math.pow(DEEPEN, this.depth()) * Math.pow(1.75, o) * REACTION_OFFSET * PS.G.rules.hp;
    },
    /** bosses slain so far, capped at the four scripted ones (overtime has its own ramp) */
    depth() { return Math.min(PS.G.bossesKilled, BOSS_TIMES.length); },
    dmgMult() {
      const t = Math.min(this.minutes(), 12), o = this.endless();
      // the first two acts climb as they always did; the extra bite comes late, when the build can answer it
      return (0.72 + 0.13 * t + 0.045 * Math.max(0, t - 6)) * (1 + 0.04 * this.depth()) * (1 + 0.35 * o + 0.07 * o * o) * PS.G.rules.dmg; // overtime bites harder every minute: nothing is meant to outlast it
    },
    speedMult() { return Math.min(1.3, 1 + this.minutes() * 0.012) * PS.G.rules.speed; },
    /** seconds between hordes */
    hordeGap() { return HORDE_EVERY * PS.G.rules.hordeEvery; },
    xpMult() { return 1 + this.endless() * 0.1; },
    /**
     * Overtime is meant to end the run. Altars, forges, the merchant, breaches and Hoarders come three times as rarely
     * there (and chests stop being free): left at their usual pace they fed the hero relics and levels as fast as the
     * horde grew, and a full-tree build stopped dying. Measured with a 30-minute bot run on one seed.
     */
    lean() { return this.victory ? 3 : 1; },
    /** what the tide in force does to a number (speed, xp, gold, haste), or `none` */
    tideOf(key, none) { return this.tide && this.tide[key] !== undefined ? this.tide[key] : none; },
    /**
     * The horde breathes in a cycle anchored on the hordes: a lull right after one breaks, then a surge that builds
     * into the next. 1 on average, swinging up to 0.7..1.3 once the hero's kit has filled out.
     */
    pressure() {
      // the opening eases in: the first cycle starts only once the first horde has broken
      if (this.hordeN === 0) return 0.75 + 0.25 * U.clamp(PS.G.time / HORDE_FIRST, 0, 1);
      const ph = U.clamp(1 - this.hordeT / this.hordeGap(), 0, 1); // 0 just after a horde, 1 as the next one is due
      const amp = Math.min(0.3, 0.06 + 0.045 * this.minutes()); // gentle swells while the kit is small, full swings later
      return 1 + amp * Math.sin(TAU * (ph - 0.5));
    },
    targetCount() {
      const t = this.minutes();
      return Math.min(MAX_ENEMIES, (30 + 30 * t + 1.4 * t * t) * this.pressure());
    },
    spawnRate() {
      const t = this.minutes();
      return (5 + 6 * Math.min(t, 12) + this.endless() * 10) * this.pressure();
    },

    /** a point just off-screen around the player */
    ringPos(extra) {
      const G = PS.G, p = G.player;
      const a = U.rnd() * TAU;
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
      const early = PS.G.rules.early;
      for (const row of TABLE) {
        let w = 0;
        if (t >= row.from * early) w = row.w(t) * U.clamp((t - row.from * early) / 0.8, 0.2, 1);
        ws.push(w);
        total += w;
      }
      let r = U.rnd() * total;
      for (let i = 0; i < ws.length; i++) {
        r -= ws[i];
        if (r <= 0) {
          // Warders hang back and die last, so left alone they pile up until half the horde is shielded: two at a time, three late
          if (TABLE[i].id === 'warder' && PS.Enemies.warders >= (t > 10 ? 3 : 2)) return 'imp';
          return TABLE[i].id;
        }
      }
      return 'imp';
    },

    update(dt) {
      const G = PS.G, p = G.player;
      const bossAlive = !!G.boss;
      // a boss holds back the horde for a while; drag the fight out and the rift stops waiting
      const bossHold = bossAlive && G.time - G.boss.bornAt < 75;

      if (G.rush) { this.updateRush(dt); this.updateProps(dt); this.updatePickups(dt); return; }
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
          // overtime opens with the two bosses the run has not shown yet, then brings the old ones back
          PS.Bosses.spawn([4, 5, 0, 1, 2, 3][n % 6], n + 1);
          this.bossIdx++;
        }
      }

      // ---- trickle spawns toward the target population
      const target = this.targetCount() * (bossHold ? 0.55 : 1);
      this.spawnAcc += this.spawnRate() * dt * (bossHold ? 0.6 : 1);
      if (this.spawnAcc > 20) this.spawnAcc = 20;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (G.enemies.length >= target) { this.spawnAcc = 0; break; }
        const pos = this.ringPos();
        PS.Enemies.spawn(this.pickType(), pos.x, pos.y);
      }

      // ---- rift tremors: the ground under you gives way if you linger. Trivial to sidestep, lethal to stand in.
      this.tremorT -= dt;
      if (this.tremorT <= 0) {
        const tm = this.minutes();
        // the longer you stay put, the faster the ground breaks up; moving on resets it
        if (U.dist2(p.x, p.y, this.tremorX, this.tremorY) < 170 * 170) this.linger++; else this.linger = 0;
        this.tremorX = p.x; this.tremorY = p.y;
        this.tremorT = Math.max(3, 8.5 - tm * 0.42) * (bossAlive ? 1.5 : 1) * Math.max(0.3, Math.pow(0.65, this.linger)) * (G.rules.tremorEvery || 1);
        PS.Combat.hazard({ kind: 'circle', x: p.x, y: p.y, r: 80, delay: 1.2, dmg: 0, pct: 0.15, color: '#b98cff', tremor: true });
        const extra = 1; // one stray beside the one under your feet: more than that is clutter, not pressure
        for (let i = 0; i < extra; i++) {
          const a = U.rnd() * TAU, d = U.rand(130, 280);
          PS.Combat.hazard({ kind: 'circle', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 70, delay: 1.2 + i * 0.15, dmg: 0, pct: 0.15, color: '#b98cff', tremor: true });
        }
        PS.Audio.play('telegraph', { vol: 0.35, pitch: 0.7 });
        PS.UI.tip('danger', 'Red circles are the rift\'s: step out before they fill. Other colours are yours', 'mountain');
      }

      // ---- elites
      this.eliteT -= dt;
      if (this.eliteT <= 0 && !bossHold) {
        const R = G.rules;
        this.eliteT = Math.max(50, 75 - this.minutes() * 1.2) * R.eliteEvery;
        let first = null;
        for (let i = 0; i < R.eliteN; i++) {
          const pos = this.ringPos();
          // The nth elite is the same for everyone on the seed, whenever it arrives: its draw is named by its number, and
          // what it may be (and how many affixes it carries) goes by the minute an nth elite is due, not by the clock,
          // which a slow boss fight would have pushed back.
          const nth = this.eliteN++, due = 1 + nth * 1.1, SD = PS.RNG.side('elite' + nth); // no rule goes into `due`: a pact can change the rules mid-run
          const e = PS.Enemies.spawn(U.pick(this.elitePool(due), SD), pos.x, pos.y, { elite: true, affixes: this.sideAffixes(SD, Math.min(3, R.affixes + (due > 12.5 ? 1 : 0))) });
          first = first || e;
        }
        note('elite', first.def.id + ':' + first.affixes.join('+'));
        PS.UI.toast(R.eliteN > 1 ? 'Elites have entered the rift' : `${first.label} has entered the rift`, 'skull');
        PS.UI.tip('affix', 'Elites carry affixes. Their name says what to expect', 'skull');
      }

      // ---- hordes
      this.hordeT -= dt;
      if (this.hordeT <= 0 && !bossHold) {
        this.hordeT = this.hordeGap();
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
          } else if (pr !== this.breach && U.dist2(pr.x, pr.y, p.x, p.y) > 2400 * 2400) pr.dead = true;
        }
        if (near < 2) {
          const a = U.rnd() * TAU, d = U.rand(520, 860);
          // now and then a chest that asks no gold: an elite stands guard inside it
          const cursed = this.minutes() > 2.5 && !this.victory && G.time > this.guardedAt && U.rnd() < 0.22 && !G.props.some((x) => x.cursed);
          G.props.push({ kind: 'chest', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 26, dead: false, t: 0, bob: U.rnd() * 6, cursed });
        }
        U.compact(G.props);
      }
      this.shrineT -= dt;
      if (this.shrineT <= 0) {
        this.shrineT = 75 / (1 + (p.stats.m.shrines || 0));
        if (G.props.filter((x) => x.kind === 'shrine').length < 2) {
          const a = U.rnd() * TAU, d = U.rand(560, 820);
          G.props.push({ kind: 'shrine', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 70, dead: false, t: 0, charge: 0, bob: 0 });
          PS.UI.toast('A shrine has appeared', 'spark');
        }
      }
      // a dark altar now and then, and a breach to fight over; neither while a boss holds the field
      if (this.quietT > 0) this.quietT -= dt;
      // map events wait out a boss fight, but only its first 75 seconds: a fight that drags on is when a forge or a merchant helps most
      const quiet = bossHold || this.quietT > 0;
      this.altarT -= dt;
      if (this.altarT <= 0 && !quiet) {
        this.quietT = 9;
        this.altarT = 150 * this.lean();
        if (!G.props.some((x) => x.kind === 'altar') && p.pacts.length < Object.keys(PS.Data.PACTS).length) {
          const a = U.rnd() * TAU, d = U.rand(560, 820);
          G.props.push({ kind: 'altar', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 64, dead: false, t: 0, charge: 0, bob: 0 });
          PS.UI.toast('A dark altar has risen', 'blood');
          PS.UI.tip('altar', 'Altars offer pacts: a strong gift with a lasting price', 'blood');
        }
      }
      this.merchantT -= dt;
      if (this.merchantT <= 0 && !quiet && this.quietT <= 0) {
        this.quietT = 9;
        this.merchantT = 200 * this.lean();
        if (!G.props.some((x) => x.kind === 'merchant')) {
          const a = U.rnd() * TAU, d = U.rand(480, 700);
          G.props.push({ kind: 'merchant', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 60, dead: false, t: 0, charge: 0, bob: 0, life: p.stats.f.ledger ? 150 : 75 });
          PS.UI.toast('A merchant has set up shop. She will not stay long', 'coin');
          PS.UI.tip('merchant', 'The merchant sells one thing for gold: stand in her circle to see her wares', 'coin');
        }
      }
      this.forgeT -= dt;
      if (this.forgeT <= 0 && !quiet && this.quietT <= 0) {
        this.quietT = 9;
        this.forgeT = 190 * this.lean();
        if (!G.props.some((x) => x.kind === 'forge') && p.skills.length > 1) {
          const a = U.rnd() * TAU, d = U.rand(560, 820);
          G.props.push({ kind: 'forge', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 66, dead: false, t: 0, charge: 0, bob: 0 });
          PS.UI.toast('A rift forge has kindled', 'anvil');
          PS.UI.tip('forge', 'A forge levels up one skill of your choosing: stand in its circle', 'anvil');
        }
      }
      this.breachT -= dt;
      if (this.breachT <= 0 && !quiet && this.quietT <= 0) {
        this.quietT = 9;
        this.breachT = (G.sigilBreach ? 58 : 115) * G.rules.breachEvery * this.lean();
        if (!G.props.some((x) => x.kind === 'breach')) {
          const a = U.rnd() * TAU, d = U.rand(520, 760);
          G.props.push({ kind: 'breach', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 150, dead: false, t: 0, charge: 0, bob: 0, active: false, need: 0, got: 0, left: 0, out: 0, acc: 0 });
          PS.UI.toast('A breach has opened', 'rift');
          PS.UI.tip('breach', 'Step into a breach to wake it, then slay what pours out before it seals', 'rift');
        }
      }
      // ---- rift tides: every few minutes the rules bend for a short spell (never during a boss)
      if (this.tide) {
        this.tideLeft -= dt;
        if (this.tideLeft <= 0) { PS.UI.toast(this.tide.name + ' passes', this.tide.icon); this.tide = null; }
      } else {
        this.tideT -= dt;
        if (this.tideT <= 0 && !quiet && this.quietT <= 0) {
          this.quietT = 9;
          const SD = PS.RNG.side('tide' + this.tideN++);
          this.tideT = 150 + SD() * 60;
          const T = PS.Data.TIDES, ids = Object.keys(T).filter((id) => id !== this.lastTide);
          const td = T[U.pick(ids, SD)];
          this.tide = td; this.tideLeft = td.dur * (p.stats.f.tideCaller ? 1.5 : 1); this.lastTide = td.id;
          if (p.stats.f.tideCaller) this.tideT *= 0.8;
          note('tide', td.id);
          G.tides++;
          G.met['tide:' + td.id] = 1;
          PS.UI.banner(td.name, td.text, 3);
          PS.FX.flash(td.color, 0.18);
          PS.Audio.play('shrine', { vol: 0.5, pitch: 0.8 });
          if (td.elites) {
            const due = 3.4 + (this.tideN - 1) * 3, pool = this.elitePool(due); // by the minute this tide is due, as with the scripted elites
            for (let i = 0; i < td.elites; i++) { const pos = this.ringPos(); const e = PS.Enemies.spawn(U.pick(pool, SD), pos.x, pos.y, { elite: true, affixes: this.sideAffixes(SD, G.rules.affixes) }); e.richChest = true; }
          }
        }
      }
      this.hoarderT -= dt;
      if (this.hoarderT <= 0 && !quiet && this.quietT <= 0) {
        this.quietT = 9;
        this.hoarderT = (150 + PS.RNG.side('hoarder' + this.hoarderN++)() * 60) * G.rules.hoarderEvery * this.lean();
        const a = U.rnd() * TAU, d = Math.min(G.viewW, G.viewH) * 0.36;
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        const e = PS.Enemies.spawn('hoarder', x, y, { hpMult: 5 });
        e.life = 15; e.dripAt = e.maxHp * 0.8; e.score = 300; e.spawnT = 0.5;
        this.hoarder = e;
        PS.FX.portal(x, y, 60, '#f0b94a');
        PS.Audio.play('chest', { vol: 0.5, pitch: 1.4 });
        PS.UI.toast('A Hoarder scurries out of the rift. Catch it', 'coin');
        PS.UI.tip('hoarder', 'Hoarders carry gold and a relic, and run. Kill one before it slips away', 'coin');
      }
      this.updateProps(dt);
      this.updatePickups(dt);
    },

    /* ------------------------------------------------------------ breaches */
    /** called by Combat.kill for anything a breach spat out */
    breachKill(e) {
      const b = this.breach;
      if (!b || e.breach !== b || (b.mode === 'champion' && e !== b.champ)) return;
      b.got++;
      if (b.got >= b.need) this.breachEnd(true);
    },
    breachEnd(won) {
      const G = PS.G, b = this.breach;
      if (!b) return;
      this.breach = null;
      b.dead = true;
      this.breachT = Math.max(this.breachT, (PS.G.sigilBreach ? 35 : 70) * PS.G.rules.breachEvery * this.lean());
      if (won) {
        G.breaches++;
        G.score += b.mode === 'swarm' ? 400 + 40 * b.need : 500; // kept small where few kills back it: server.ts budgets score per kill
        PS.FX.flash('#c06bff', 0.3);
        PS.FX.ring(b.x, b.y, 260, '#e3b8ff', 0.6);
        PS.FX.surge(b.x, b.y, '#c06bff', true);
        PS.Audio.play('evolve', { vol: 0.6, pitch: 1.2 });
        PS.UI.toast('Breach sealed', 'rift');
        const s = G.player.stats, t = this.minutes();
        for (let i = 0; i < 5; i++) this.pickup('gold', b.x + U.rand(-40, 40), b.y + U.rand(-40, 40), Math.round((4 + t) * s.gold));
        this.pickup('breachchest', b.x, b.y, 0);
      } else {
        G.breachesLost++;
        PS.FX.ring(b.x, b.y, 200, '#7a6a9a', 0.5);
        PS.Audio.play('deny', { vol: 0.6, pitch: 0.7 });
        PS.UI.toast('The breach sealed itself. Its spoils are lost', 'rift');
      }
    },
    /**
     * Three trials, drawn from the run's script so everyone on a seed meets the same ones (b.mode):
     *   swarm     slay enough of what pours out
     *   champion  one elite climbs out with a small guard: kill it
     *   hold      stand your ground inside the ring until it gives up; stepping out stalls the count
     */
    updateBreach(b, dt, inside) {
      const G = PS.G;
      if (!b.active) {
        if (!inside) return;
        const t = this.minutes();
        b.active = true;
        const SD = PS.RNG.side('breach' + this.breachN);
        b.mode = b.mode || (this.breachN < 1 ? 'swarm' : U.pick(['swarm', 'champion', 'hold'], SD));
        this.breachN++;
        note('breach', b.mode);
        b.out = 0; b.got = 0; b.acc = 3; // a first clutch at once
        this.breach = b;
        if (b.mode === 'champion') {
          b.need = 1; b.left = b.total = 30;
          const pool = ['hound', 'brute', 'knight', 'wraith', 'toad'].filter((id) => t >= TABLE.find((r) => r.id === id).from);
          const e = PS.Enemies.spawn(U.pick(pool.length ? pool : ['imp'], SD), b.x, b.y, { elite: true, affixes: this.sideAffixes(SD) });
          e.breach = b; e.spawnT = 0.9; e.label = 'Breach ' + e.label; e.noChest = true;
          b.champ = e;
          PS.UI.toast(`The breach wakes. Slay its champion: ${e.label}`, 'rift');
        } else if (b.mode === 'hold') {
          b.need = 12; b.left = b.total = 30;
          PS.UI.toast('The breach wakes. Hold your ground inside the ring', 'rift');
        } else {
          b.need = Math.min(80, Math.round(14 + t * 5.5)); b.left = b.total = 24;
          PS.UI.toast(`The breach wakes. Slay ${b.need} of its spawn`, 'rift');
        }
        if (G.player.stats.f.riftKey) b.left += 4; // on the clock only: `total` paces a swarm's spawns, which should not slow
        PS.FX.ring(b.x, b.y, b.r, '#c06bff', 0.5);
        PS.FX.shake(5);
        PS.Audio.play('bossWarn', { vol: 0.4, pitch: 1.5 });
        return;
      }
      b.left -= dt;
      if (b.left <= 0) { this.breachEnd(false); return; }
      if (b.mode === 'hold') {
        if (inside) { b.got = Math.min(b.need, b.got + dt); if (b.got >= b.need) { this.breachEnd(true); return; } }
      }
      // what it spits out: for a swarm, a few more than are needed, all out within the first 60% of the timer;
      // a champion comes with a thin guard, and a held breach never stops
      const t = this.minutes();
      const all = b.mode === 'swarm' ? Math.ceil(b.need * 1.15) : b.mode === 'champion' ? Math.round(6 + t) : 1e9;
      const rate = b.mode === 'swarm' ? all / (b.total * 0.6) : b.mode === 'champion' ? all / 12 : 1.6 + t * 0.45;
      if (b.out < all && G.enemies.length < MAX_ENEMIES + 40) {
        b.acc += rate * dt;
        while (b.acc >= 1 && b.out < all) {
          b.acc -= 1; b.out++;
          const a = U.rnd() * TAU, d = U.rand(10, b.r * 0.8);
          const e = PS.Enemies.spawn(this.pickType(), b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, { hpMult: 0.9 });
          if (b.mode === 'swarm') e.breach = b;
          e.spawnT = 0.7; // they climb out before they bite
          e.xp *= this.victory ? 0.5 : 1.5; // overtime's breaches are a fight, not a harvest
        }
      }
    },

    /* ------------------------------------------------------------ boss rush */
    /** no horde to speak of, no map events: levels, a breath, then the next boss */
    updateRush(dt) {
      const G = PS.G, p = G.player, R = G.rush;
      if (R.wait > 0) {
        // between fights: wait for the level-ups to be spent, then count the boss in
        if (p.pendingLevels > 0 || G.queue.length) return;
        R.wait -= dt;
        if (R.wait <= 0) {
          R.at = G.time;
          PS.Bosses.spawn(RUSH_ORDER[R.stage], 0);
        }
        return;
      }
      if (G.boss) {
        // a thin crowd, so skills that feed on kills still have something to eat
        const target = 14 + R.stage * 5;
        this.spawnAcc += (2 + R.stage) * dt;
        while (this.spawnAcc >= 1) {
          this.spawnAcc -= 1;
          if (G.enemies.length > target) { this.spawnAcc = 0; break; }
          const pos = this.ringPos();
          PS.Enemies.spawn(this.pickType(), pos.x, pos.y);
        }
        return;
      }
      // the boss is down
      R.stage++;
      if (R.stage >= RUSH_ORDER.length) { PS.Game.rushWon(); return; }
      for (let i = 0; i < RUSH_LEVELS[R.stage]; i++) p.gainLevel();
      R.wait = 4;
      for (const e of G.enemies) if (!e.boss) e.hp = 0, PS.Combat.kill(e, null);
      PS.UI.banner('Stage ' + (R.stage + 1) + ' of ' + RUSH_ORDER.length, 'Spend your levels. ' + PS.Bosses.DEFS[RUSH_ORDER[R.stage]].name + ' is next.', 3);
    },
    rushStages: RUSH_ORDER.length, rushLevels: RUSH_LEVELS,

    /** affixes for an elite that is not part of the run's script (a breach champion, a chest's guard): drawn from `rng`, not `event` */
    sideAffixes(rng, count) { return U.shuffle(PS.Data.AFFIX_IDS.slice(), rng).slice(0, count || this.affixCount()); },
    /** the kinds an elite may be at `minute` of a run */
    elitePool(minute) { return ['imp', 'slime', 'hound', 'brute', 'knight', 'wraith', 'toad'].filter((id) => minute >= TABLE.find((r) => r.id === id).from * PS.G.rules.early); },
    /** how many elite affixes the rift hands out right now */
    affixCount() { return Math.min(3, PS.G.rules.affixes + (this.victory ? 1 : 0)); },

    /** a loose line of enemies charging in from direction `a` */
    stampede(a, count, type, hpMult) {
      const G = PS.G, p = G.player;
      const rad = Math.max(G.viewW, G.viewH) * 0.5 + 80;
      const cx = p.x + Math.cos(a) * rad, cy = p.y + Math.sin(a) * rad;
      for (let i = 0; i < count; i++) {
        const off = (i - count / 2) * 26;
        PS.Enemies.spawn(type, cx - Math.sin(a) * off + U.rand(-30, 30), cy + Math.cos(a) * off + U.rand(-30, 30), { hpMult });
      }
    },
    /**
     * The first two hordes are always the ring and the stampede, so a new player meets them in a fixed order.
     * After that the rift picks from all four patterns, never the same one twice running. (force: a pattern, for tools.)
     */
    horde(n, force) {
      const G = PS.G, p = G.player, t = this.minutes();
      const EV = PS.RNG.side('horde' + n); // the nth horde is the same for everyone on the seed, whenever it arrives
      const kinds = ['ring', 'stampede', 'pincer', 'wall', 'coil', 'spearhead'];
      const kind = force || (n < 2 ? kinds[n] : U.pick(kinds.filter((k) => k !== this.lastHorde), EV));
      this.lastHorde = kind;
      if (!force) note('horde', kind);
      if (kind === 'ring') {
        const count = Math.min(60, Math.round(22 + t * 4));
        const type = t > 4 && EV() < 0.4 ? 'slimelet' : 'bat';
        const rad = Math.max(G.viewW, G.viewH) * 0.5 + 60;
        for (let i = 0; i < count; i++) {
          const a = (i * TAU) / count;
          PS.Enemies.spawn(type, p.x + Math.cos(a) * rad, p.y + Math.sin(a) * rad, { hpMult: 1.3 });
        }
        PS.UI.toast('The swarm closes in', 'ghost');
      } else if (kind === 'stampede') {
        this.stampede(EV() * TAU, Math.min(50, Math.round(16 + t * 3.5)), t > 3.5 ? 'hound' : 'imp', 1.2);
        PS.UI.toast('A stampede approaches', 'paw');
      } else if (kind === 'coil') {
        // three arcs at three distances, each a third of the way round: the swarm arrives from one side after another
        const per = Math.min(20, Math.round(8 + t * 1.4)), a0 = EV() * TAU, type = t > 4 && EV() < 0.4 ? 'slimelet' : 'bat';
        const rad = Math.max(G.viewW, G.viewH) * 0.5 + 60;
        for (let arm = 0; arm < 3; arm++) {
          for (let i = 0; i < per; i++) {
            const a = a0 + arm * (TAU / 3) + (i / per) * (TAU / 3) * 0.9;
            PS.Enemies.spawn(type, p.x + Math.cos(a) * (rad + arm * 190), p.y + Math.sin(a) * (rad + arm * 190), { hpMult: 1.3 });
          }
        }
        PS.UI.toast('The swarm coils in, one side after another', 'ghost');
      } else if (kind === 'spearhead') {
        // a wedge with a heavy at its point: step out of its line, or break the point and the rest scatters into you piecemeal
        const a = EV() * TAU, rows = Math.min(6, Math.round(3 + t * 0.3)), type = t > 3.5 ? 'hound' : 'imp', lead = t > 4.5 ? 'brute' : type;
        const rad = Math.max(G.viewW, G.viewH) * 0.5 + 90, ca = Math.cos(a), sa = Math.sin(a);
        const cx = p.x + ca * rad, cy = p.y + sa * rad;
        PS.Enemies.spawn(lead, cx, cy, { hpMult: 3 });
        for (let r = 1; r <= rows; r++) {
          for (const side of [-1, 1]) {
            for (let k = 0; k < 2; k++) {
              const back = r * 34 + k * 26, off = side * (r * 30 + k * 8);
              PS.Enemies.spawn(type, cx + ca * back - sa * off, cy + sa * back + ca * off, { hpMult: 1.2 });
            }
          }
        }
        PS.UI.toast('A spearhead drives at you', 'swords');
      } else if (kind === 'pincer') {
        // two smaller stampedes from opposite sides: whichever way you run, you run into one
        const a = EV() * TAU, count = Math.min(32, Math.round(11 + t * 2.3)), type = t > 3.5 ? 'hound' : 'imp';
        this.stampede(a, count, type, 1.2);
        this.stampede(a + Math.PI, count, type, 1.2);
        PS.UI.toast('The horde closes from both sides', 'swords');
      } else {
        // a wall that marches across the whole screen with one gap in it: find the gap, dash through, or cut a hole
        const horiz = EV() < 0.5, dir = EV() < 0.5 ? 1 : -1;
        const span = (horiz ? G.viewH : G.viewW) + 260, dist = (horiz ? G.viewW : G.viewH) * 0.5 + 70;
        const count = Math.min(60, Math.floor(span / 30)), step = span / count;
        const gapAt = (0.25 + EV() * 0.5) * span, gapW = 200;
        const type = t > 8.5 ? 'knight' : t > 4.5 ? 'hound' : 'imp';
        const rows = t > 7 ? 2 : 1;
        for (let row = 0; row < rows; row++) {
          for (let i = 0; i < count; i++) {
            const off = (i + 0.5) * step;
            if (Math.abs(off - gapAt) < gapW / 2) continue;
            const along = off - span / 2, back = dist + row * 44;
            const e = PS.Enemies.spawn(type, horiz ? p.x - dir * back : p.x + along, horiz ? p.y + along : p.y - dir * back, { hpMult: type === 'knight' ? 0.6 : 1.3 });
            // march straight across before turning on the hero, so the gap stays a gap
            e.mdx = horiz ? dir : 0; e.mdy = horiz ? 0 : dir;
            e.marchT = (back * 2 + 160) / (e.speed * 1.6);
          }
        }
        PS.UI.toast('A wall of the horde sweeps in. Find the gap', 'shield');
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
      if (e.def.hoard) {
        if (this.hoarder === e) this.hoarder = null;
        G.hoarders++;
        for (let i = 0; i < 10; i++) this.pickup('gold', e.x + U.rand(-40, 40), e.y + U.rand(-40, 40), Math.round((6 + t * 1.5) * s.gold));
        this.pickup('chest', e.x, e.y, 0);
        PS.UI.toast('Hoarder slain', 'coin');
        return;
      }
      if (e.elite) {
        for (let i = 0; i < 4; i++) this.pickup('gold', e.x + U.rand(-30, 30), e.y + U.rand(-30, 30), Math.round((5 + t) * s.gold));
        if (!e.noChest) this.pickup(e.richChest ? 'breachchest' : 'chest', e.x, e.y, 0);
        if (U.rnd() < 0.35) this.pickup('heal', e.x + 24, e.y, 0);
        return;
      }
      const r = U.rnd();
      // kill counts already climb with the horde, so a coin barely grows with time: gold, and the chests it buys, stay an event
      // Gold Rain rolls its extra coins on their own die, so the rare drops below keep their odds
      const rain = this.tideOf('gold', 1);
      if (r < 0.05 || (rain > 1 && U.rnd() < 0.05 * (rain - 1))) this.pickup('gold', e.x, e.y, Math.max(1, Math.round((1 + U.rnd() * 2 + t * 0.05) * s.gold)));
      // rare drops are rate-limited: kill counts late in a run would otherwise rain them
      else if (r < 0.0535) { if (G.time > this.healAt) { this.healAt = G.time + 14; this.pickup('heal', e.x, e.y, 0); } }
      else if (r < 0.0545) { if (G.time > this.magnetAt) { this.magnetAt = G.time + 45; this.pickup('magnet', e.x, e.y, 0); } }
      else if (r < 0.0552) { if (G.time > this.bombAt) { this.bombAt = G.time + 90; this.pickup('bomb', e.x, e.y, 0); } }
    },
    gem(x, y, val) {
      const G = PS.G;
      if (G.gemCount >= MAX_GEMS) {
        // at the cap: merge into a gem close to the kill, or drag the most distant stray gem here, so fresh XP always lands nearby
        const p = G.player, list = G.pickups;
        let near = null, nd = 220 * 220, far = null, fd = 0;
        for (let i = 0; i < list.length; i++) {
          const g = list[i];
          if (g.kind !== 'xp' || g.dead) continue;
          const d = U.dist2(g.x, g.y, x, y);
          if (d < nd) { nd = d; near = g; }
          const pd = U.dist2(g.x, g.y, p.x, p.y);
          if (pd > fd) { fd = pd; far = g; }
        }
        if (near) { near.val += val; return; }
        if (far) { far.val += val; far.x = x; far.y = y; far.vx = 0; far.vy = 0; far.pull = false; far.age = 0; return; }
      }
      G.gemCount++;
      G.pickups.push({ kind: 'xp', x: x + U.rand(-6, 6), y: y + U.rand(-6, 6), val, r: 6, vx: U.rand(-40, 40), vy: U.rand(-40, 40), pull: false, dead: false, age: 0 });
    },
    pickup(kind, x, y, val) {
      const a = U.rnd() * TAU, sp = U.rand(40, 120);
      PS.G.pickups.push({ kind, x, y, val, r: kind.endsWith('chest') ? 20 : 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, pull: false, dead: false, age: 0 });
    },
    updatePickups(dt) {
      const G = PS.G, p = G.player, s = p.stats, list = G.pickups;
      const reach = s.pickup * this.tideOf('pickup', 1), range2 = reach * reach;
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
        const chest = k.kind.endsWith('chest');
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
          p.addXp(k.val * this.tideOf('xp', 1));
          if (p.stats.f.gemEater && ++p.gemsEaten >= 60) { p.gemsEaten = 0; p.heal(p.stats.maxHp * 0.04 * p.stats.f.gemEater * G.rules.heal); PS.FX.mend(p); }
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
          p.heal(p.stats.maxHp * 0.3 * G.rules.heal * (1 + (p.stats.m.healMore || 0)));
          PS.FX.mend(p);
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
          PS.FX.ring(p.x, p.y, 760, '#ffffff', 0.55);
          PS.FX.ring(p.x, p.y, 420, '#ffd08a', 0.4);
          PS.FX.flare(p.x, p.y, 180, '#ffffff', 0.3);
          PS.Audio.play('bomb');
          for (const e of G.enemies.slice()) {
            if (U.dist2(e.x, e.y, p.x, p.y) < 800 * 800) PS.Combat.damage(e, e.boss ? e.maxHp * 0.03 : e.elite ? e.maxHp * 0.4 : e.maxHp * 2, { src: 'Bomb', noCrit: true, noProc: true, noStatus: true });
          }
          break;
        case 'chest':
          PS.Game.openChest(1, 0);
          break;
        case 'bosschest':
          PS.Game.openChest(3, 2);
          break;
        case 'breachchest':
          PS.Game.openChest(2 + (p.stats.f.riftKey ? 1 : 0), 1);
          break;
      }
    },

    /* ------------------------------------------------------------ map props */
    chestPrice() {
      const disc = PS.G.player.stats.f.discount || 0;
      return Math.round(this.chestCost * (1 - disc) * PS.G.rules.chestCost);
    },
    updateProps(dt) {
      const G = PS.G, p = G.player;
      for (const pr of G.props) {
        if (pr.dead) continue;
        pr.t += dt;
        const d2 = U.dist2(pr.x, pr.y, p.x, p.y);
        if (pr.kind === 'chest') {
          if (pr.cursed) {
            if (d2 < 38 * 38) {
              pr.dead = true;
              const pool = ['imp', 'hound', 'brute', 'wraith'].filter((id) => this.minutes() >= TABLE.find((r) => r.id === id).from);
              const a = U.rnd() * TAU;
              const e = PS.Enemies.spawn(U.pick(pool), pr.x + Math.cos(a) * 90, pr.y + Math.sin(a) * 90, { elite: true, affixes: this.sideAffixes(PS.RNG.side('guard' + this.guardN++)) });
              e.spawnT = 0.9;
              PS.FX.portal(e.x, e.y, 70, '#c06bff');
              PS.Audio.play('bossWarn', { vol: 0.4, pitch: 1.5 });
              PS.UI.toast(`The chest was guarded: ${e.label}`, 'skull');
              G.cursedOpened = (G.cursedOpened || 0) + 1;
              this.guardedAt = G.time + 75; // a free relic and an elite's chest: not one after another
              PS.Game.openChest(1, 1);
            }
          } else if (d2 < 38 * 38) {
            const cost = this.chestPrice();
            if (p.gold >= cost) {
              p.gold -= cost;
              this.chestCost = Math.round(this.chestCost * 1.3 + 10);
              this.chestsOpened++;
              pr.dead = true;
              PS.Game.openChest(1, 0);
            } else if (!pr.denied || G.time - pr.denied > 1.5) {
              pr.denied = G.time;
              PS.FX.text(pr.x, pr.y - 40, 'Need ' + cost + ' gold', '#ff8a8a');
              PS.Audio.play('deny', { vol: 0.5 });
            }
          }
        } else if (pr.kind === 'breach') {
          this.updateBreach(pr, dt, d2 < pr.r * pr.r);
        } else if (pr.kind === 'merchant') {
          pr.life -= dt;
          if (pr.life <= 0) { pr.dead = true; PS.FX.puff(pr.x, pr.y, '#ffd35c', 10); continue; }
          if (d2 < pr.r * pr.r) {
            pr.charge += dt / 1.2;
            if (pr.charge >= 1) {
              pr.dead = true;
              PS.FX.ring(pr.x, pr.y, 140, '#ffd35c', 0.5);
              PS.Audio.play('chest', { vol: 0.6 });
              PS.G.queue.push({ kind: 'shop' });
            }
          } else pr.charge = Math.max(0, pr.charge - dt * 0.5);
        } else if (pr.kind === 'forge') {
          if (d2 < pr.r * pr.r) {
            pr.charge += dt / 2.2;
            if (pr.charge >= 1) {
              pr.dead = true;
              PS.FX.ring(pr.x, pr.y, 160, '#ffb061', 0.5);
              PS.Audio.play('shrine', { pitch: 1.3 });
              PS.G.queue.push({ kind: 'forge' });
            }
          } else pr.charge = Math.max(0, pr.charge - dt * 0.5);
        } else if (pr.kind === 'altar') {
          if (d2 < pr.r * pr.r) {
            pr.charge += dt / 2.2;
            if (pr.charge >= 1) {
              pr.dead = true;
              PS.FX.ring(pr.x, pr.y, 160, '#ff5a7a', 0.5);
              PS.Audio.play('shrine', { pitch: 0.6 });
              PS.G.queue.push({ kind: 'altar' });
            }
          } else pr.charge = Math.max(0, pr.charge - dt * 0.5);
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
