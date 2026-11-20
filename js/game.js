/* POWERSCALING — game loop, run lifecycle, reward flow, scoring */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, D = PS.Data;

  const LEVEL_HEAL = 0.03; // share of max health every level-up restores (Second Wind adds to it)
  const TL_STEP = 10;      // seconds between rows of the run history shown on the results screen
  const HURT_NAMES = { bullet: 'Bullets', tremor: 'Rift tremors', hazard: 'Blasts', beam: 'Beams', ring: 'Shockwaves' };

  const Game = {
    state: 'menu', // menu | play | choice | paused | over
    last: 0,
    idleT: 0,

    init() {
      PS.Save.load();
      const set = PS.Save.data.settings;
      PS.Audio.setSfxVolume(set.sfx);
      PS.Audio.setMusicVolume(set.music);
      const canvas = document.getElementById('game');
      PS.Render.init(canvas);
      PS.Render.setQuality(set.quality);
      PS.Input.init(canvas);
      PS.UI.init();
      const unlock = () => { PS.Audio.init(); PS.Audio.music(this.state === 'menu' ? 'menu' : 'run'); };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
      requestAnimationFrame((t) => this.loop(t));
    },

    /* ------------------------------------------------------------ run lifecycle */
    /**
     * opts: { bot, seed, depth, daily }
     *   daily  true for today's daily rift (or a 'YYYY-MM-DD' date): fixed seed, class and mutator, full skill tree, depth 0
     *   depth  Rift Depth to play at; defaults to the one picked on the class screen, capped at what is unlocked
     *   seed   string or number; a random one is drawn when absent
     */
    start(clsId, opts) {
      opts = opts || {};
      const save = PS.Save.data;
      const rush = !!opts.rush;
      const daily = opts.daily && !rush ? PS.Daily.spec(opts.daily === true ? PS.Save.today() : opts.daily) : null;
      if (daily) clsId = daily.cls;
      // tools and the bot may ask for any depth; a player only gets what they have unlocked
      const depth = daily || rush ? 0 : opts.depth !== undefined && opts.bot ? U.clamp(opts.depth | 0, 0, D.DEPTH_MAX)
        : U.clamp(opts.depth !== undefined ? opts.depth | 0 : save.depth.sel, 0, save.depth.max);
      // a typed seed that names a daily rift is salted, so the day's rift cannot be rehearsed outside it
      const seed = daily ? daily.seed : opts.seed !== undefined ? (/^daily:/i.test(String(opts.seed)) && !opts.bot ? 'x' : '') + String(opts.seed) : PS.RNG.fresh();
      PS.RNG.seed(seed);
      PS.Enemies.reset();
      PS.Bot.reset();
      const vs = PS.Render.viewSize();
      const G = {
        time: 0, frame: 0, rdt: 0.016, cls: clsId,
        seed, depth, daily: daily ? daily.date : null, rules: D.rules(depth, daily ? daily.mutator : opts.mutator),
        timeline: [], hurtBy: {}, lastHurt: '', reactions: {}, rxTokens: 4, rxSeen: {},
        enemies: [], projs: [], eprojs: [], zones: [], strikes: [], hazards: [], minions: [], pickups: [], props: [], orbits: [],
        grid: new U.Grid(72),
        kills: 0, score: 0, bossesKilled: 0, dmgBy: {}, dmgTotal: 0, dmgTaken: 0, goldEarned: 0, gemCount: 0, procN: 0, deflected: 0,
        cam: { x: 0, y: 0 }, shake: 0, flashA: 0, flashCol: '#fff', hitstop: 0, slowmo: 0, boss: null, over: false,
        viewW: vs.w || 1280, viewH: vs.h || 800, biome: 0,
        ctrl: { mx: 0, my: 0, aimX: 100, aimY: 0, fire: true, dash: false, ability: false, ward: false, autoAim: false, manual: false },
        breaches: 0, breachesLost: 0, flawless: 0, hoarders: 0, forged: 0, bought: 0, tides: 0, pactsStruck: 0, pactsAtAltar: [], script: {}, slain: {}, feats: [], featT: 3, picks: [], queue: [], bossLog: [], choiceDelay: 0, bot: opts.bot || null, won: false, endless: false,
      };
      // one sigil, if its feat is earned; tools and the bot may ask for any (opts.sigil), the daily rift allows none
      const sg = daily ? null : D.SIGILS[opts.bot ? opts.sigil : save.sigil];
      G.sigil = sg && (opts.bot || save.feats[sg.feat]) ? sg.id : '';
      if (G.sigil && sg.rules) sg.rules(G.rules);
      if (rush) G.rush = { stage: 0, wait: 3, at: 0 };
      PS.G = G;
      PS.FX.reset();
      PS.Director.reset();
      G.player = new PS.Player(clsId);
      const p = G.player, m = p.stats.m;
      for (let i = (m.startRelic ? 1 : 0) + G.rules.startRelics; i > 0; i--) {
        const r = PS.Rewards.rollRelic(p, 0);
        if (r) p.addRelic(r.id);
      }
      if (G.sigil && D.SIGILS[G.sigil].start) D.SIGILS[G.sigil].start(G, p);
      if (G.rules.startPacts) for (const id of U.shuffle(Object.keys(D.PACTS).filter((k) => !D.PACTS[k].now), PS.RNG.loot).slice(0, G.rules.startPacts)) p.addPact(id);
      if (rush) for (let i = 0; i < PS.Director.rushLevels[0]; i++) p.gainLevel();
      if (m.startLevels) {
        for (let i = 0; i < m.startLevels; i++) { p.level++; p.pendingLevels++; }
        p.xpNext = PS.xpFor(p.level);
      }
      if (!daily) save.lastClass = clsId;
      PS.Save.save();
      this.state = 'play';
      PS.UI.startRun();
      PS.Audio.music('run');
      PS.Audio.setIntensity(0);
    },
    /** another run in the same mode as the one that just ended (the daily rift follows the calendar) */
    again() {
      const G = PS.G;
      if (!G) return;
      this.start(G.cls, G.rush ? { rush: true } : G.daily ? { daily: true } : { depth: G.depth });
    },

    pause() {
      if (this.state !== 'play') return;
      this.state = 'paused';
      PS.Audio.pause();
      PS.UI.showPause();
    },
    resume() {
      if (this.state !== 'paused') return;
      this.state = 'play';
      PS.Audio.resume();
      PS.UI.hidePause();
      this.last = performance.now();
    },
    toMenu() {
      this.state = 'menu';
      PS.G = null;
      PS.Audio.resume();
      PS.Audio.music('menu');
      PS.UI.showMenu();
    },

    /* ------------------------------------------------------------ main loop */
    loop(ts) {
      requestAnimationFrame((t) => this.loop(t));
      let dt = (ts - this.last) / 1000;
      if (this.state === 'play') PS.Render.frameTime(ts - this.last);
      this.last = ts;
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.05) dt = 0.05;
      PS.Input.pollPad();
      const G = PS.G;
      if (!G) {
        this.idleT += dt;
        PS.Render.drawIdle(this.idleT);
        return;
      }
      G.rdt = dt;
      if (this.state === 'play') {
        PS.Input.read(G.ctrl, G);
        if (G.bot) PS.Bot.drive(G);
        this.step(dt);
        PS.UI.updateHud(dt);
      } else if (this.state === 'over') {
        // let effects settle behind the summary
        PS.FX.update(dt * 0.4);
      } else if (G.frozenDrawn && PS.Render.drawnW === PS.Render.width()) {
        return; // paused or picking a card: the scene is a still frame, so don't redraw it 60 times a second
      }
      G.frozenDrawn = this.state === 'paused' || this.state === 'choice';
      PS.Render.draw(G);
    },

    /** advance the simulation by dt seconds (also used by the headless test bot) */
    step(dt) {
      const G = PS.G, p = G.player;
      if (G.hitstop > 0) { G.hitstop -= dt; PS.FX.update(dt * 0.2); return; }
      if (G.slowmo > 0) { G.slowmo -= dt; dt *= 0.35; }
      G.time += dt;
      G.frame++;
      G.procN = 0;

      // spatial index for this frame
      const grid = G.grid, list = G.enemies;
      grid.clear();
      for (let i = 0; i < list.length; i++) grid.insert(list[i]);
      G.orbits.length = 0;

      p.update(dt, G.ctrl);
      PS.Enemies.update(dt);
      PS.Combat.updateProjs(dt);
      PS.Combat.updateZones(dt);
      PS.Combat.updateStrikes(dt);
      PS.Combat.updateMinions(dt);
      PS.Combat.updateEBullets(dt);
      PS.Combat.updateHazards(dt);
      PS.Director.update(dt);
      PS.FX.update(dt);
      if (G.over) return;
      if (G.time >= (G.timeline.length + 1) * TL_STEP) this.snapshot();
      PS.Combat.refillReactions(dt);
      if ((G.featT -= dt) <= 0) { G.featT = 3; PS.Feats.check(G); }

      // ---- rewards waiting to be chosen
      if (p.pendingLevels > 0 && !G.levelFx) {
        G.levelFx = true;
        G.choiceDelay = 0.3;
        PS.FX.levelUp(p);
        PS.Audio.play('levelup');
      }
      if (G.choiceDelay > 0) {
        G.choiceDelay -= dt;
      } else if (G.queue.length || p.pendingLevels > 0) {
        this.nextChoice();
      }
      PS.Audio.setIntensity(Math.min(1, G.time / 600 + (G.boss ? 0.15 : 0)));
    },

    /** one cumulative row of the run history; the results screen turns the differences into a chart */
    snapshot(last) {
      const G = PS.G, tl = G.timeline;
      const row = { t: G.time, dmg: G.dmgTotal, taken: G.dmgTaken, kills: G.kills, lvl: G.player.level };
      // the closing row of a run: a sliver of a slice would chart as a cliff, so fold it into the row before
      if (last && tl.length && G.time - tl[tl.length - 1].t < TL_STEP * 0.4) tl[tl.length - 1] = row;
      else tl.push(row);
    },
    /** record what hurt the hero: src is the enemy that touched them, or one of the hazard kinds */
    tookDamage(src, d) {
      const G = PS.G;
      const name = !src ? 'Other' : typeof src === 'string' ? HURT_NAMES[src] || 'Other'
        : src.boss ? src.def.name : src.elite ? 'Elite ' + src.def.name : src.def.name;
      G.hurtBy[name] = (G.hurtBy[name] || 0) + d;
      G.lastHurt = name;
    },

    /* ------------------------------------------------------------ choices */
    openChest(n, minTier) {
      PS.G.queue.push({ kind: 'chest', n, minTier });
      PS.Audio.play('chest');
    },
    openShrine() {
      PS.G.queue.push({ kind: 'shrine' });
    },
    nextChoice() {
      const G = PS.G, p = G.player, R = PS.Rewards;
      let spec = null;
      if (G.queue.length) {
        const q = G.queue.shift();
        if (q.kind === 'chest') {
          const cards = R.relicChoices(p, q.n + (p.stats.m.relicChoice || 0), q.minTier);
          spec = { kind: 'relic', title: q.n > 1 ? 'Spoils of the fallen' : 'Relic found', sub: cards.length > 1 ? 'Choose one relic to keep.' : 'Relics stack with everything, forever.', cards };
        } else if (q.kind === 'shop') {
          const cards = R.shopChoices(p);
          if (cards.length) spec = { kind: 'shop', title: 'The merchant\'s wares', sub: 'One purchase. You have ' + p.gold + ' gold.', cards };
        } else if (q.kind === 'forge') {
          const cards = R.forgeChoices(p);
          if (cards.length) spec = { kind: 'forge', title: 'The forge is hot', sub: 'Choose one skill to temper.', cards };
        } else if (q.kind === 'altar') {
          const cards = R.pactChoices(p);
          if (cards.length) spec = { kind: 'pact', title: 'The altar offers a pact', sub: 'Every gift has a price, and both last the whole run. You may walk away.', cards };
        } else {
          spec = { kind: 'shrine', title: 'The shrine answers', sub: 'Choose a blessing.', cards: R.boonChoices(p) };
        }
      } else if (p.pendingLevels > 0) {
        G.levelFx = false;
        if (p.talentsDue > 0) {
          const cards = R.talentChoices(p);
          p.talentsDue--;
          if (cards.length) spec = { kind: 'talent', title: p.cls.name + ' ascension', sub: 'Advance one path of your class.', cards };
        }
        if (!spec) {
          p.pendingLevels--;
          // once per level, however the levels were batched: a breather that matters most in the opening, while levels come fast
          if (!G.rules.noLevelHeal) p.heal(p.stats.maxHp * (LEVEL_HEAL + (p.stats.m.levelHeal || 0)) * G.rules.heal, true);
          const lv = p.claimedLevel;
          if (lv > 1 && PS.SLOT_LEVELS.skill.includes(lv)) { PS.UI.toast('A new skill slot opens', 'lock'); PS.Audio.play('shrine', { vol: 0.5 }); }
          else if (PS.SLOT_LEVELS.tome.includes(lv)) PS.UI.toast('A new tome slot opens', 'book');
          spec = { kind: 'level', title: 'Level ' + lv, sub: 'Choose one.', cards: R.levelChoices(p) };
        }
      }
      if (!spec) return;
      if (G.bot) {
        if (spec.kind === 'shop') { spec.cards = spec.cards.filter((c) => c.cost <= p.gold); if (!spec.cards.length) return; }
        const i = PS.Bot.pick(spec, G);
        R.apply(p, spec.cards[i]);
        p.inv = Math.max(p.inv, 0.3);
        return;
      }
      this.state = 'choice';
      PS.Input.clear();
      PS.UI.showChoice(spec);
    },
    /** called by the UI when a card is taken (or skipped with card === null) */
    choose(spec, card) {
      const G = PS.G, p = G.player;
      if (card) { PS.Rewards.apply(p, card); if (spec.kind === 'forge') G.forged++; if (spec.kind === 'shop') G.bought++; }
      else if (spec.kind === 'level') p.gold += 10;
      const more = G.queue.length || p.pendingLevels > 0;
      if (more) {
        // chain straight into the next reward
        this.state = 'play';
        this.nextChoice();
        if (this.state === 'choice') return;
      }
      this.state = 'play';
      p.inv = Math.max(p.inv, 0.8);
      p.hitInv = false;
      PS.UI.hideChoice();
      this.last = performance.now();
    },
    rerollCost() { return Math.round(20 * Math.pow(1.5, PS.G.player.rerollsBought)); },
    reroll(spec) {
      const G = PS.G, p = G.player;
      if (spec.kind !== 'level') return null;
      if (p.rerolls > 0) p.rerolls--;
      else {
        // out of free rerolls: gold buys more, at a rising price
        const cost = this.rerollCost();
        if (p.gold < cost) return null;
        p.gold -= cost;
        p.rerollsBought++;
      }
      spec.cards = PS.Rewards.levelChoices(p);
      return spec;
    },
    banish(spec, card) {
      const p = PS.G.player;
      if (p.banishes <= 0 || spec.kind !== 'level' || (card.type !== 'skill' && card.type !== 'tome')) return false;
      p.banishes--;
      p.banned.add(card.id);
      const i = spec.cards.indexOf(card);
      // replace the banished card with a fresh one
      const fresh = PS.Rewards.levelChoices(p).find((c) => !spec.cards.some((o) => o.type === c.type && o.id === c.id));
      spec.cards[i] = fresh || PS.Rewards.card(p, 'gold', null, 0);
      return true;
    },

    /* ------------------------------------------------------------ outcomes */
    bossKilled() {
      const d = PS.Save.data;
      PS.G.player.rerolls++; // every boss is worth a reroll
      if (PS.G.bot) return; // a bot's kills are not the player's: nothing below is theirs to unlock
      d.stats.bosses++;
      if (!d.unlocked.reaper) {
        d.unlocked.reaper = true;
        PS.UI.toast('Reaper unlocked', 'scythe');
      }
      if (!d.unlocked.frostwarden && d.stats.bosses >= 10 && !PS.G.bot) {
        d.unlocked.frostwarden = true;
        PS.G.unlockedClass = 'frostwarden';
        PS.UI.toast('Frostwarden unlocked', 'snow');
      }
      PS.Save.save();
    },
    victory() {
      const G = PS.G, d = PS.Save.data;
      G.won = true;
      G.endless = true;
      G.score += 15000;
      d.stats.wins++;
      if (!d.unlocked.stormcaller && !G.bot) {
        d.unlocked.stormcaller = true;
        G.unlockedClass = 'stormcaller';
        PS.UI.toast('Stormcaller unlocked', 'thunder');
      }
      let sub = 'You win. The rift does not close — see how far beyond it you can go.';
      if (!G.daily && !G.bot) {
        d.depth.clear[G.cls] = Math.max(d.depth.clear[G.cls] === undefined ? -1 : d.depth.clear[G.cls], G.depth);
        // winning at your deepest depth opens the next one
        if (G.depth === d.depth.max && d.depth.max < D.DEPTH_MAX) {
          d.depth.max++;
          G.unlockedDepth = d.depth.max;
          sub = `Depth ${d.depth.max} is open: ${D.DEPTHS[d.depth.max - 1].name}. Keep going for score.`;
        }
      }
      PS.Save.save();
      PS.UI.banner('The Rift Lord is slain', sub, 6);
      PS.Audio.play('evolve');
    },
    /** the last boss of a rush is down */
    rushWon() {
      const G = PS.G, d = PS.Save.data;
      G.won = true;
      if (!G.bot) { d.rush = d.rush || {}; const best = d.rush[G.cls]; if (!best || G.time < best) { d.rush[G.cls] = Math.floor(G.time); G.rushBest = true; } }
      PS.Audio.play('evolve');
      this.endRun(true);
    },
    /** mirrored in server.ts (scoreBounds): deeper rifts multiply the whole score */
    finalScore(G) {
      // a rush is a race: bosses felled, and for a clear, every second under ten minutes
      if (G.rush) return G.bossesKilled * 10000 + (G.won ? Math.max(0, 600 - Math.floor(G.time)) * 100 : 0);
      return Math.round((G.score + Math.floor(G.time) * 60 + (G.player.level - 1) * 100) * G.rules.score);
    },
    playerDied() {
      this.endRun(false);
    },
    endRun(retired) {
      const G = PS.G;
      if (!G || G.over) return;
      G.over = true;
      const p = G.player, d = PS.Save.data;
      this.snapshot(true);
      const score = this.finalScore(G);
      // the first daily rift of the day pays double
      const firstDaily = !!G.daily && !G.bot && !(d.daily.date === G.daily && d.daily.attempts > 0);
      // Essence pays for time survived, bosses and levels — not raw kill counts, which balloon late
      const essence = Math.round((G.rush ? G.bossesKilled * 20 + (G.won ? 40 : 0) : G.time / 4 + G.bossesKilled * 50 + (p.level - 1) * 1.5 + (G.won ? 100 : 0))
        * (1 + (G.daily ? 0 : p.stats.m.essence || 0)) * G.rules.essence * (firstDaily ? 2 : 1));
      const top = Object.entries(G.dmgBy).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]);
      const run = {
        name: d.name || 'Wanderer', cls: G.cls, score, time: Math.floor(G.time), level: p.level, kills: G.kills, bosses: G.bossesKilled,
        won: G.won, date: Date.now(), build: top, depth: G.depth, seed: G.seed,
      };
      if (G.daily) { run.daily = G.daily; run.mutator = G.rules.mutator; }
      d.essence += essence;
      d.essenceTotal += essence;
      d.stats.runs++;
      d.stats.kills += G.kills;
      if (!G.rush) d.stats.bestTime = Math.max(d.stats.bestTime, run.time);
      // the daily rift lends everyone the full tree, so it keeps its own best score
      const best = G.rush ? !!G.rushBest : G.daily ? score > (d.daily.date === G.daily ? d.daily.best : 0) : score > d.stats.bestScore;
      if (!G.daily && !G.rush) d.stats.bestScore = Math.max(d.stats.bestScore, score);
      G.result = { run, essence, best, retired, rank: 0, firstDaily, unlockedDepth: G.unlockedDepth || 0, unlockedClass: G.unlockedClass || '' };
      if (G.daily && !G.bot) {
        if (d.daily.date !== G.daily) d.daily = { date: G.daily, best: 0, attempts: 0, runs: [] };
        d.daily.attempts++;
        d.daily.best = Math.max(d.daily.best, score);
      }
      if (!G.bot) { PS.Save.record(G); G.result.unlockedClass = G.unlockedClass || ''; }
      PS.Feats.check(G); // the run is over: the last look, with G.over set
      G.result.feats = G.feats.slice();
      if (!G.bot && !G.daily) {
        const before = D.masteryRank(d.mastery[G.cls] || 0);
        d.mastery[G.cls] = (d.mastery[G.cls] || 0) + Math.round(score / 1000);
        const after = D.masteryRank(d.mastery[G.cls]);
        G.result.mastery = { gained: Math.round(score / 1000), rank: after, up: after > before };
      }
      if (!G.bot) { PS.Feats.check(G); G.result.feats = G.feats.slice(); } // again, now that mastery has moved
      if (!G.bot) {
        const L = d.life, add = (k, v) => { L[k] = (L[k] || 0) + (isFinite(v) ? v : 0); };
        add('time', Math.floor(G.time)); add('dmg', Math.round(G.dmgTotal)); add('taken', Math.round(G.dmgTaken)); add('gold', G.goldEarned);
        add('breaches', G.breaches); add('hoarders', G.hoarders); add('pacts', G.pactsStruck); add('forged', G.forged); add('bought', G.bought);
        add('deflected', G.deflected); add('levels', p.level - 1); add('relics', p.relicOrder.reduce((n, id) => n + p.relics[id], 0));
        let rx = 0; for (const k in G.reactions) rx += G.reactions[k];
        add('reactions', rx); add('elites', G.elitesSlain || 0);
        d.history.unshift({ cls: run.cls, score, time: run.time, level: run.level, kills: run.kills, bosses: run.bosses, won: run.won, date: run.date, depth: run.depth,
          seed: G.seed, daily: G.daily || '', rush: !!G.rush, build: top.slice(0, 3), sigil: G.sigil, pacts: p.pacts.slice(), essence, retired: !!retired, by: retired ? '' : G.boss ? G.boss.def.name : G.lastHurt });
        if (d.history.length > 30) d.history.length = 30;
      }
      if (!G.bot && !G.rush) G.result.rank = PS.Save.addRun(run);
      else PS.Save.save();
      this.state = 'over';
      PS.Audio.resume();
      PS.Audio.music('off');
      if (!retired) { PS.Audio.play('death'); PS.FX.flash('#ff2846', 0.5); PS.FX.shake(14); PS.FX.heroDeath(p); }
      PS.UI.showOver(G.result);
    },
  };

  PS.Game = Game;
  window.addEventListener('DOMContentLoaded', () => Game.init());
})();
