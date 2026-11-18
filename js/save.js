/* POWERSCALING — persistence: meta progression, settings, local leaderboard */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const KEY = 'powerscaling.save.v1';
  const MAX_BOARD = 100;

  const defaults = () => ({
    v: 1,
    name: '',
    essence: 0,
    essenceTotal: 0,
    tree: {},            // nodeId -> rank
    unlocked: { vanguard: true, pyromancer: true, ranger: true },
    lastClass: 'vanguard',
    settings: { sfx: 0.7, music: 0.45, shake: true, dmgNums: true, autoAim: false, autoFire: true },
    board: [],           // [{name, cls, score, time, level, kills, bosses, date, build}]
    stats: { runs: 0, kills: 0, bosses: 0, bestTime: 0, bestScore: 0, wins: 0 },
    seenTutorial: false,
  });

  let mem = null; // in-memory fallback when storage is unavailable

  const Save = {
    data: defaults(),
    load() {
      let raw = null;
      try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = mem; }
      if (raw) {
        try {
          const d = JSON.parse(raw);
          const base = defaults();
          this.data = Object.assign(base, d);
          this.data.settings = Object.assign(defaults().settings, d.settings || {});
          this.data.stats = Object.assign(defaults().stats, d.stats || {});
          this.data.unlocked = Object.assign(defaults().unlocked, d.unlocked || {});
          if (!Array.isArray(this.data.board)) this.data.board = [];
          if (!this.data.tree || typeof this.data.tree !== 'object') this.data.tree = {};
        } catch (e) {
          this.data = defaults();
        }
      }
      return this.data;
    },
    save() {
      const raw = JSON.stringify(this.data);
      try { window.localStorage.setItem(KEY, raw); } catch (e) { mem = raw; }
    },
    reset() {
      const keep = this.data.settings;
      this.data = defaults();
      this.data.settings = keep;
      this.save();
    },
    /** add a finished run; returns its 1-based rank on the board (or 0 if it fell off) */
    addRun(run) {
      const b = this.data.board;
      b.push(run);
      b.sort((x, y) => y.score - x.score);
      if (b.length > MAX_BOARD) b.length = MAX_BOARD;
      const rank = b.indexOf(run) + 1;
      this.save();
      return rank;
    },
    board(filterCls) {
      const b = this.data.board;
      return filterCls && filterCls !== 'all' ? b.filter((r) => r.cls === filterCls) : b.slice();
    },
    rank(nodeId) {
      return this.data.tree[nodeId] || 0;
    },
  };

  PS.Save = Save;
})();
