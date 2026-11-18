/* POWERSCALING — game loop, run lifecycle, reward flow, scoring */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U;

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
      PS.Input.init(canvas);
      PS.UI.init();
      const unlock = () => { PS.Audio.init(); PS.Audio.music(this.state === 'menu' ? 'menu' : 'run'); };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
      requestAnimationFrame((t) => this.loop(t));
    },

    /* ------------------------------------------------------------ run lifecycle */
    start(clsId, opts) {
      opts = opts || {};
      const vs = PS.Render.viewSize();
      const G = {
        time: 0, frame: 0, rdt: 0.016, cls: clsId,
        enemies: [], projs: [], eprojs: [], zones: [], strikes: [], hazards: [], minions: [], pickups: [], props: [], orbits: [],
        grid: new U.Grid(72),
        kills: 0, score: 0, bossesKilled: 0, dmgBy: {}, dmgTotal: 0, dmgTaken: 0, goldEarned: 0, gemCount: 0, procN: 0,
        cam: { x: 0, y: 0 }, shake: 0, flashA: 0, flashCol: '#fff', hitstop: 0, slowmo: 0, boss: null, over: false,
        viewW: vs.w || 1280, viewH: vs.h || 800, biome: 0,
        ctrl: { mx: 0, my: 0, aimX: 100, aimY: 0, fire: true, dash: false, ability: false, autoAim: false },
        picks: [], queue: [], bossLog: [], choiceDelay: 0, bot: opts.bot || null, won: false, endless: false,
      };
      PS.G = G;
      PS.FX.reset();
      PS.Director.reset();
      G.player = new PS.Player(clsId);
      const p = G.player, m = p.stats.m;
      if (m.startRelic) {
        const r = PS.Rewards.rollRelic(p, 0);
        if (r) p.addRelic(r.id);
      }
      if (m.startLevels) {
        for (let i = 0; i < m.startLevels; i++) { p.level++; p.pendingLevels++; }
        p.xpNext = PS.xpFor(p.level);
      }
      PS.Save.data.lastClass = clsId;
      PS.Save.save();
      this.state = 'play';
      PS.UI.startRun();
      PS.Audio.music('run');
      PS.Audio.setIntensity(0);
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
      this.last = ts;
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.05) dt = 0.05;
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
      }
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

      // ---- rewards waiting to be chosen
      if (p.pendingLevels > 0 && !G.levelFx) {
        G.levelFx = true;
        G.choiceDelay = 0.3;
        PS.FX.levelUp(p);
        PS.Audio.play('levelup');
        const heal = p.stats.m.levelHeal;
        if (heal) p.heal(p.stats.maxHp * heal, true);
      }
      if (G.choiceDelay > 0) {
        G.choiceDelay -= dt;
      } else if (G.queue.length || p.pendingLevels > 0) {
        this.nextChoice();
      }
      PS.Audio.setIntensity(Math.min(1, G.time / 600 + (G.boss ? 0.15 : 0)));
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
          const cards = R.relicChoices(p, q.n, q.minTier);
          spec = { kind: 'relic', title: q.n > 1 ? 'Spoils of the fallen' : 'Relic found', sub: q.n > 1 ? 'Choose one relic to keep.' : 'Relics stack with everything, forever.', cards };
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
          spec = { kind: 'level', title: 'Level ' + (p.level - p.pendingLevels), sub: 'Choose one.', cards: R.levelChoices(p) };
        }
      }
      if (!spec) return;
      if (G.bot) {
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
      if (card) PS.Rewards.apply(p, card);
      else p.gold += 10;
      const more = G.queue.length || p.pendingLevels > 0;
      if (more) {
        // chain straight into the next reward
        this.state = 'play';
        this.nextChoice();
        if (this.state === 'choice') return;
      }
      this.state = 'play';
      p.inv = Math.max(p.inv, 0.8);
      PS.UI.hideChoice();
      this.last = performance.now();
    },
    reroll(spec) {
      const G = PS.G, p = G.player;
      if (p.rerolls <= 0 || spec.kind !== 'level') return null;
      p.rerolls--;
      spec.cards = PS.Rewards.levelChoices(p);
      return spec;
    },
    banish(spec, card) {
      const p = PS.G.player;
      if (p.banishes <= 0 || spec.kind !== 'level' || (card.type !== 'skill' && !(card.type === 'tome' && !p.hasTome(card.id)))) return false;
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
      d.stats.bosses++;
      if (!d.unlocked.reaper) {
        d.unlocked.reaper = true;
        PS.UI.toast('Reaper unlocked', 'scythe');
      }
      PS.Save.save();
    },
    victory() {
      const G = PS.G;
      G.won = true;
      G.endless = true;
      G.score += 15000;
      PS.Save.data.stats.wins++;
      PS.Save.save();
      PS.UI.banner('The Rift Lord is slain', 'You win. The rift does not close — see how far beyond it you can go.', 6);
      PS.Audio.play('evolve');
    },
    finalScore(G) {
      return Math.round(G.score + Math.floor(G.time) * 5 + (G.player.level - 1) * 100);
    },
    playerDied() {
      this.endRun(false);
    },
    endRun(retired) {
      const G = PS.G;
      if (!G || G.over) return;
      G.over = true;
      const p = G.player, d = PS.Save.data;
      const score = this.finalScore(G);
      const essence = Math.round((score / 90 + G.bossesKilled * 15) * (1 + (p.stats.m.essence || 0)));
      const top = Object.entries(G.dmgBy).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]);
      const run = {
        name: d.name || 'Wanderer', cls: G.cls, score, time: Math.floor(G.time), level: p.level, kills: G.kills, bosses: G.bossesKilled,
        won: G.won, date: Date.now(), build: top,
      };
      d.essence += essence;
      d.essenceTotal += essence;
      d.stats.runs++;
      d.stats.kills += G.kills;
      d.stats.bestTime = Math.max(d.stats.bestTime, run.time);
      const best = score > d.stats.bestScore;
      d.stats.bestScore = Math.max(d.stats.bestScore, score);
      G.result = { run, essence, best, retired, rank: 0 };
      if (!G.bot) G.result.rank = PS.Save.addRun(run);
      else PS.Save.save();
      this.state = 'over';
      PS.Audio.resume();
      PS.Audio.music('off');
      if (!retired) { PS.Audio.play('death'); PS.FX.flash('#ff2846', 0.5); PS.FX.shake(14); }
      PS.UI.showOver(G.result);
    },
  };

  PS.Game = Game;
  window.addEventListener('DOMContentLoaded', () => Game.init());
})();
