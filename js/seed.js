/* POWERSCALING — seeded randomness and the daily rift's definition.
   Loaded by the page before everything else, and imported by server.ts (so it must not assume a window). */
(function (root) {
  'use strict';
  const PS = (root.PS = root.PS || {});

  /** string -> uint32 (FNV-1a, then an avalanche so near-identical strings land far apart) */
  function hash(str) {
    let h = 2166136261;
    str = String(str);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 2246822507);
    h ^= h >>> 13; h = Math.imul(h, 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  /** mulberry32: small, fast, good enough for a game. Returns a function giving floats in [0, 1). */
  function make(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hash(seed);
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * A run draws from three independent streams, all derived from one seed:
   *   sim    moment-to-moment simulation: spawn positions, crits, enemy AI. Diverges as soon as two players move differently.
   *   event  the run's script: which horde comes next, which elite and which affixes. Drawn once per event, so two
   *          players on the same seed meet the same hordes and elites in the same order.
   *   loot   reward cards, rarities and relic rolls.
   * Anything whose moment depends on the player (breaches, tides that wait for a boss to fall, Hoarders, guarded chests)
   * draws from RNG.side(name) instead, so it cannot shift those three.
   * Cosmetic code (particles, screen shake, audio) keeps using Math.random so it can never disturb a seeded run.
   */
  const RNG = {
    hash, make,
    value: '',
    sim: Math.random, event: Math.random, loot: Math.random,
    /** start every stream over from this seed (a string or a number) */
    seed(seed) {
      RNG.value = String(seed);
      RNG.sim = make(RNG.value + '/sim');
      RNG.event = make(RNG.value + '/event');
      RNG.loot = make(RNG.value + '/loot');
    },
    /**
     * A generator of its own for one named thing (the third tide, the second breach). What it gives depends only on the
     * seed and the name, never on when it is asked, so events the player triggers at their own pace (waking a breach,
     * opening a guarded chest) or that wait on a boss cannot shift the script in `event` for everyone else on the seed.
     */
    side(name) { return make(RNG.value + '/side/' + name); },
    /** a fresh seed for an ordinary run: six characters, easy to read out */
    fresh() {
      let s = '';
      for (let i = 0; i < 6; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(Math.random() * 32) | 0];
      return s;
    },
  };

  /* ---------- the daily rift: one seed, one class and one mutator per UTC day, the same for everyone ---------- */
  const DAY = 86400000;
  const CLASSES = ['vanguard', 'pyromancer', 'ranger', 'reaper', 'stormcaller', 'frostwarden', 'plaguebearer'];
  const MUTATORS = ['glass', 'restless', 'parade', 'quicksilver', 'flux', 'hoard', 'openguard', 'scholar', 'breached', 'pacted', 'goldrush', 'menagerie'];
  /** every class once per seven days and every mutator once per twelve, in an order that changes each cycle */
  function cycle(list, day, salt) {
    const n = list.length, block = Math.floor(day / n), rnd = make(salt + ':' + block);
    const order = list.slice();
    for (let i = n - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order[((day % n) + n) % n];
  }
  const Daily = {
    CLASSES, MUTATORS,
    /** 'YYYY-MM-DD' (UTC) for a timestamp */
    dateOf(ms) { return new Date(ms).toISOString().slice(0, 10); },
    /** milliseconds until the next UTC midnight */
    untilReset(ms) { return DAY - (((ms % DAY) + DAY) % DAY); },
    valid(date) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const t = Date.parse(date + 'T00:00:00Z');
      return !isNaN(t) && Daily.dateOf(t) === date;
    },
    /** what everyone plays on that day */
    spec(date) {
      const day = Math.floor(Date.parse(date + 'T00:00:00Z') / DAY);
      return { date, seed: 'daily:' + date, cls: cycle(CLASSES, day, 'class'), mutator: cycle(MUTATORS, day, 'mutator') };
    },
  };

  PS.RNG = RNG;
  PS.Daily = Daily;
})(typeof window !== 'undefined' ? window : globalThis);
