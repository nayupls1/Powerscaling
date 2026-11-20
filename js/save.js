/* POWERSCALING — persistence: meta progression, settings, leaderboard.
   localStorage is always the source of truth for the running game (every call here stays synchronous).
   When the page is served by server.ts the save is mirrored to the server and the leaderboard goes global;
   on a static host or file:// the server calls are skipped or fail quietly. */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const KEY = 'powerscaling.save.v1';
  const ID_KEY = 'powerscaling.id.v1';  // kept apart from the save so reset() does not orphan the player id
  const MAX_BOARD = 100;
  const CLASSES = ['vanguard', 'pyromancer', 'ranger', 'reaper', 'stormcaller', 'frostwarden', 'plaguebearer'];
  const READY_WAIT = 1500;              // Save.ready never holds the menu up longer than this
  const PUSH_DELAY = 800;

  const defaults = () => ({
    v: 1,
    name: '',
    essence: 0,
    essenceTotal: 0,
    tree: {},            // nodeId -> rank
    treeV: 2,            // which build of the skill tree `tree` was bought in (Data.TREE_VERSION)
    treeRefund: false,   // the tree was rebuilt and its Essence refunded: the tree screen says so once
    unlocked: { vanguard: true, pyromancer: true, ranger: true },
    lastClass: 'vanguard',
    settings: { sfx: 0.7, music: 0.45, shake: true, flash: true, subtleFx: false, danger: 'red', dmgNums: true, heroBars: true, quality: 'auto' },
    board: [],           // [{name, cls, score, time, level, kills, bosses, date, build}]
    stats: { runs: 0, kills: 0, bosses: 0, bestTime: 0, bestScore: 0, wins: 0 },
    seenTutorial: false,
    codex: { relics: {}, evos: {}, rx: {}, pacts: {}, foes: {}, sets: {}, rift: {} }, // what has been found (1) and how many of each foe have fallen
    history: [],         // the last 30 runs, newest first, with their seeds: see the Leaderboard's 'Your runs' tab
    life: {},            // lifetime tallies beyond `stats`: seconds played, damage, gold, breaches... (see Game.endRun)
    streak: { n: 0, last: '' }, // consecutive days with a daily rift played, and the last such day (UTC date)
    mastery: {},         // class id -> mastery points
    rush: {},            // boss rush: best clear time in seconds, per class
    relaxed: false,      // the Relaxed toggle on the class screen
    sigil: '',           // the sigil worn into the next run ('' for none)
    feats: {},           // featId -> when it was earned (ms)
    depth: { max: 0, sel: 0, clear: {} },                 // Rift Depths: deepest unlocked, the one selected, deepest cleared per class
    daily: { date: '', best: 0, attempts: 0, runs: [] },  // this player's daily rift for `date` (UTC); starts over each day
    updatedAt: 0,        // ms, bumped on every save(); decides which copy wins when syncing with the server
  });

  // what the first skill tree (before TREE_VERSION 2) charged: base cost per node, each rank 55% dearer than the first
  const V1_COSTS = { m1: 20, m2: 35, m3: 35, m4: 60, m5: 60, m6: 90, m7: 400, v1: 20, v2: 35, v3: 35, v4: 60, v5: 60, v6: 90, v7: 400,
    f1: 20, f2: 35, f3: 35, f4: 60, f5: 80, f6: 90, f7: 400, a1: 20, a2: 40, a3: 40, a4: 60, a5: 120, a6: 150, a7: 400, x1: 150, x2: 500, x3: 150, x4: 150 };
  const V1_MAX = { m1: 5, m2: 5, m3: 5, m4: 3, m5: 3, m6: 3, m7: 1, v1: 5, v2: 5, v3: 5, v4: 3, v5: 3, v6: 2, v7: 1,
    f1: 5, f2: 5, f3: 5, f4: 3, f5: 2, f6: 3, f7: 1, a1: 5, a2: 3, a3: 4, a4: 3, a5: 2, a6: 1, a7: 1, x1: 3, x2: 1, x3: 3, x4: 3 };
  function treeV1Spent(tree) {
    let sum = 0;
    for (const id in V1_COSTS) {
      const r = Math.max(0, Math.min(V1_MAX[id], Math.floor(Number(tree[id]) || 0)));
      for (let i = 0; i < r; i++) sum += Math.round(V1_COSTS[id] * (1 + 0.55 * i));
    }
    return sum;
  }
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const num = (v) => typeof v === 'number' && isFinite(v);

  /** coerce anything (local or from the server) into a well-formed save */
  function sanitize(d) {
    d = obj(d);
    const out = Object.assign(defaults(), d);
    out.settings = Object.assign(defaults().settings, obj(d.settings));
    out.stats = Object.assign(defaults().stats, obj(d.stats));
    out.unlocked = Object.assign(defaults().unlocked, obj(d.unlocked));
    if (out.stats.wins >= 1) out.unlocked.stormcaller = true;
    if (out.stats.bosses >= 10) out.unlocked.frostwarden = true;
    if (Object.keys(obj(obj(d.codex).pacts)).length >= 3) out.unlocked.plaguebearer = true; // saves from before the Stormcaller existed
    out.board = (Array.isArray(d.board) ? d.board : []).filter((r) => r && typeof r === 'object' && num(r.score));
    if (!num(out.essence)) out.essence = 0;
    if (!num(out.essenceTotal)) out.essenceTotal = 0;
    if (typeof out.name !== 'string') out.name = '';
    out.tree = obj(d.tree);
    // the skill tree was rebuilt: a save from an older tree gets back everything it spent, to spend again
    const TV = PS.Data ? PS.Data.TREE_VERSION : 0;
    if (TV && d.treeV !== TV) {
      const back = !num(d.treeV) || d.treeV < 2 ? treeV1Spent(out.tree) : 0;
      out.essence += back;
      out.tree = {};
      out.treeV = TV;
      out.treeRefund = back > 0; // the tree screen says so once
    }
    out.feats = obj(d.feats);
    out.rush = obj(d.rush);
    out.mastery = obj(d.mastery);
    const sk = obj(d.streak);
    out.streak = { n: num(sk.n) ? Math.max(0, Math.floor(sk.n)) : 0, last: typeof sk.last === 'string' ? sk.last : '' };
    out.life = obj(d.life);
    out.history = (Array.isArray(d.history) ? d.history : []).filter((r) => r && typeof r === 'object' && num(r.score)).slice(0, 30);
    if (typeof out.sigil !== 'string') out.sigil = '';
    const cx = obj(d.codex);
    out.codex = { relics: obj(cx.relics), evos: obj(cx.evos), rx: obj(cx.rx), pacts: obj(cx.pacts), foes: obj(cx.foes), sets: obj(cx.sets), rift: obj(cx.rift) };
    const dp = obj(d.depth), cap = PS.Data ? PS.Data.DEPTH_MAX : 10;
    const max = num(dp.max) ? Math.max(0, Math.min(cap, Math.floor(dp.max))) : 0;
    out.depth = { max, sel: num(dp.sel) ? Math.max(0, Math.min(max, Math.floor(dp.sel))) : 0, clear: obj(dp.clear) };
    const dl = obj(d.daily);
    out.daily = {
      date: typeof dl.date === 'string' ? dl.date : '', best: num(dl.best) ? dl.best : 0, attempts: num(dl.attempts) ? dl.attempts : 0,
      runs: (Array.isArray(dl.runs) ? dl.runs : []).filter((r) => r && typeof r === 'object' && num(r.score)),
    };
    if (!num(out.updatedAt)) out.updatedAt = 0;
    return out;
  }

  const mem = {}; // in-memory fallback when storage is unavailable
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  };
  const emit = (type, detail) => { try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch (e) { /* no DOM */ } };

  /* ---------------------------------------------------------------- server link */
  const net = {
    enabled: typeof fetch === 'function' && /^https?:$/.test(location.protocol),
    who: null,       // {id, token}
    fresh: false,    // the id was minted this session, so the server cannot have a profile for it yet
    synced: false,   // a pull has succeeded since the last connection loss; pushes wait for it
    syncing: null,   // in-flight sync promise
    dirty: false,    // local changes not yet on the server
    timer: 0,
    holdUntil: 0,    // after a 429, wait before pushing again
    posted: null,    // last run sent to the server: {run, id, name} so a rename on the results screen follows it
    offset: 0,       // server clock minus this device's, so everyone agrees when the daily rift turns over
  };

  function randomId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // randomUUID needs a secure context; plain-http LAN hosts still get getRandomValues
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
  }
  function who() {
    if (net.who) return net.who;
    try {
      const w = JSON.parse(store.get(ID_KEY) || 'null');
      if (w && typeof w.id === 'string' && typeof w.token === 'string') return (net.who = w);
    } catch (e) { /* regenerate */ }
    return newWho();
  }
  function newWho() {
    net.who = { id: randomId(), token: randomId() + randomId() };
    net.fresh = true;
    store.set(ID_KEY, JSON.stringify(net.who));
    return net.who;
  }

  /** fetch JSON from the server; resolves {status, body}, rejects only on network failure or timeout */
  async function api(method, path, body, o) {
    o = o || {};
    const headers = {};
    if (o.auth || (o.me && Save.online)) headers['X-Player-Id'] = who().id; // identity is only minted once a server answers
    if (o.auth) headers.Authorization = 'Bearer ' + who().token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl && setTimeout(() => ctl.abort(), o.timeout || 5000);
    try {
      // relative so the game also works when the server is mounted under a sub-path
      const res = await fetch('api/' + path, {
        method, headers, cache: 'no-store', keepalive: !!o.keepalive, signal: ctl ? ctl.signal : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* static hosts answer with html */ }
      return { status: res.status, body: data };
    } finally {
      clearTimeout(t);
    }
  }
  const offline = () => { Save.online = false; net.synced = false; };
  const payload = () => { const d = Object.assign({}, Save.data); delete d.board; return { updatedAt: d.updatedAt, data: d }; };

  function persist() { store.set(KEY, JSON.stringify(Save.data)); }

  /** take the server's copy. Settings and the local board stay: they belong to this device. */
  function adopt(remote, at) {
    const cur = Save.data, d = sanitize(remote);
    d.settings = cur.settings;
    d.board = cur.board;
    d.seenTutorial = cur.seenTutorial || d.seenTutorial;
    d.updatedAt = at;
    // mutate in place: other modules hold references to Save.data
    for (const k of Object.keys(cur)) delete cur[k];
    Object.assign(cur, d);
    persist();
    emit('ps:sync', { source: 'server' });
  }

  /**
   * Pull the server copy, keep whichever is newer, push if ours is.
   * base: the local timestamp to compare with. The first sync after load compares with the copy as loaded, so a
   * setting tweaked in the first second does not make a stale device overwrite newer progress from elsewhere.
   */
  function sync(base) {
    if (net.syncing) return net.syncing;
    net.syncing = (async () => {
      try {
        const h = await api('GET', 'health', undefined, { timeout: READY_WAIT });
        if (!h.body || h.body.ok !== true) return offline();
        if (num(h.body.now)) net.offset = h.body.now - Date.now();
        // a new id skips the GET: its 404 would only add a red line to the console on every first visit
        let r = who() && net.fresh ? { status: 404 } : await api('GET', 'profile/' + encodeURIComponent(who().id), undefined, { auth: true });
        if (r.status === 403) { newWho(); r = { status: 404 }; } // id taken by someone else's token: start fresh
        if (r.status !== 200 && r.status !== 404) return offline();
        Save.online = true;
        net.synced = true;
        const srv = r.status === 200 && r.body && obj(r.body.data) ? r.body : null;
        const at = srv && num(srv.updatedAt) ? srv.updatedAt : 0;
        if (srv && at > (num(base) ? base : Save.data.updatedAt)) { adopt(srv.data, at); net.dirty = false; }
        else if (Save.data.updatedAt > at) { net.dirty = true; await push(); }
        else net.dirty = false;
        Save.fetchBoard('all');
      } catch (e) {
        offline();
      } finally {
        net.syncing = null;
      }
      return Save.online;
    })();
    return net.syncing;
  }

  async function push(keepalive) {
    if (!net.dirty || Date.now() < net.holdUntil) return;
    net.dirty = false;
    try {
      const r = await api('PUT', 'profile/' + encodeURIComponent(who().id), payload(), { auth: true, keepalive });
      if (r.status === 200 || r.status === 409) net.fresh = false;
      if (r.status === 200) Save.online = true;
      else if (r.status === 409) {
        // another tab or device saved later: pull theirs. Chained, not awaited — push may be running inside sync()
        net.synced = false;
        Promise.resolve(net.syncing).then(() => sync());
      }
      else if (r.status === 429) {
        net.dirty = true;
        net.holdUntil = Date.now() + 15000;
        clearTimeout(net.timer);
        net.timer = setTimeout(() => flush(false), 15500);
      }
      else if (r.status >= 500 || r.status === 404) { net.dirty = true; offline(); }
      // other 4xx: the payload itself is unacceptable (e.g. too large); retrying will not help
    } catch (e) {
      net.dirty = true;
      offline();
    }
  }

  async function renamePosted() {
    const p = net.posted;
    if (!p || p.run.name === p.name) return;
    const name = p.name = p.run.name;
    try {
      const r = await api('PATCH', 'runs/' + p.id, { name }, { auth: true });
      if (r.status === 200) { if (p.run.daily) Save.fetchBoard('daily'); else { Save.fetchBoard('all'); Save.fetchBoard(p.run.cls); } }
    } catch (e) { /* the old name stays on the global board */ }
  }

  function flush(keepalive) {
    clearTimeout(net.timer);
    if (!net.enabled) return;
    renamePosted();
    if (!net.dirty) return;
    if (net.synced) push(keepalive);
    else if (!keepalive) sync(); // reconnecting: pull first so we never blindly overwrite newer progress
  }

  async function postRun(run) {
    const body = { name: run.name, cls: run.cls, score: run.score, time: run.time, level: run.level, kills: run.kills, bosses: run.bosses, won: !!run.won, build: run.build || [], depth: run.depth || 0 };
    if (run.daily) body.daily = run.daily;
    try {
      const r = await api('POST', 'runs', body, { auth: true });
      if (r.status !== 201 || !r.body) { if (r.status >= 500) offline(); return; }
      Save.online = true;
      net.posted = { run, id: r.body.id, name: run.name };
      run.globalRank = r.body.rank;
      persist();
      emit('ps:run', { run, rank: r.body.rank, total: r.body.total, classRank: r.body.classRank, classTotal: r.body.classTotal });
      if (run.daily) { Save.fetchBoard('daily'); return; }
      Save.fetchBoard('all');
      Save.fetchBoard(run.cls);
    } catch (e) {
      offline();
    }
  }

  let readyDone;
  const ready = new Promise((res) => { readyDone = res; });
  if (!net.enabled) readyDone(false);
  if (net.enabled) {
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  }

  const Save = {
    data: defaults(),
    online: false,             // true while the server answers
    ready,                     // resolves (never rejects) once the first server sync settles, or after ~1.5s
    remote: { board: {} },     // cls|'all' -> rows from the global leaderboard

    load() {
      const raw = store.get(KEY);
      if (raw) {
        try { this.data = sanitize(JSON.parse(raw)); } catch (e) { this.data = defaults(); }
      }
      if (net.enabled) {
        const done = sync(this.data.updatedAt);
        Promise.race([done, new Promise((r) => setTimeout(r, READY_WAIT))]).then(() => readyDone(this.online), () => readyDone(false));
      }
      return this.data;
    },
    save() {
      // never move backwards, even if the adopted server copy came from a device whose clock runs ahead
      this.data.updatedAt = Math.max(Date.now(), (this.data.updatedAt || 0) + 1);
      persist();
      if (!net.enabled) return;
      net.dirty = true;
      clearTimeout(net.timer);
      net.timer = setTimeout(() => flush(false), PUSH_DELAY);
    },
    reset() {
      const keep = this.data.settings;
      this.data = defaults();
      this.data.settings = keep;
      this.save();
    },
    /** the current UTC day ('YYYY-MM-DD') by the server's clock when there is one */
    today() { return PS.Daily.dateOf(Date.now() + net.offset); },
    /** milliseconds until the daily rift turns over */
    untilReset() { return PS.Daily.untilReset(Date.now() + net.offset); },
    /** add a finished run; returns its 1-based rank on the local board (or 0 if it fell off).
        The global rank arrives later as run.globalRank plus a 'ps:run' event.
        Daily rift runs go on the day's own list (the game keeps data.daily current), never on the main board. */
    /** fold what a finished run found into the codex (saved by whoever saves next: endRun always does) */
    record(G) {
      const cx = this.data.codex, p = G.player;
      for (const id of p.relicOrder) cx.relics[id] = 1;
      for (const k of p.skills) if (k.evolved) cx.evos[k.id] = 1;
      for (const id of G.pactsAtAltar) cx.pacts[id] = 1; // struck at an altar, not handed out by a mutator
      for (const name in G.reactions) cx.rx[name] = 1;
      for (const st of p.sets || []) cx.sets[st.id] = 1;
      for (const id in G.met) cx.rift[id] = 1; // affixes slain and tides weathered
      for (const id in G.slain) cx.foes[id] = (cx.foes[id] || 0) + G.slain[id];
      if (!this.data.unlocked.plaguebearer && Object.keys(cx.pacts).length >= 3) { this.data.unlocked.plaguebearer = true; G.unlockedClass = G.unlockedClass || 'plaguebearer'; }
    },
    addRun(run) {
      const b = run.daily ? this.data.daily.runs : this.data.board;
      b.push(run);
      b.sort((x, y) => y.score - x.score);
      if (b.length > (run.daily ? 20 : MAX_BOARD)) b.length = run.daily ? 20 : MAX_BOARD;
      const rank = b.indexOf(run) + 1;
      this.save();
      if (net.enabled) postRun(run);
      return rank;
    },
    /** the global board when it is loaded and the server is up, otherwise this device's runs.
        filterCls: 'all', a class id, or 'daily' for today's daily rift (everyone's best run of the day). */
    board(filterCls) {
      const key = filterCls || 'all', rows = this.online && this.remote.board[key === 'daily' ? 'daily:' + this.today() : key];
      if (rows) return rows.slice();
      if (key === 'daily') return this.data.daily.date === this.today() ? this.data.daily.runs.slice() : [];
      const b = this.data.board;
      return key !== 'all' ? b.filter((r) => r.cls === key) : b.slice();
    },
    boardScope(filterCls) {
      const key = filterCls || 'all';
      return this.online && this.remote.board[key === 'daily' ? 'daily:' + this.today() : key] ? 'global' : 'device';
    },
    /** refresh the global board cache; resolves with rows (local ones when offline) and fires 'ps:board' */
    async fetchBoard(filterCls) {
      const cls = filterCls === 'daily' || CLASSES.includes(filterCls) ? filterCls : 'all';
      if (!net.enabled) return this.board(cls);
      try {
        const day = this.today();
        const r = await api('GET', 'leaderboard?' + (cls === 'daily' ? 'daily=' + day : 'cls=' + cls) + '&limit=' + MAX_BOARD, undefined, { me: true });
        if (r.status === 200 && r.body && Array.isArray(r.body.rows)) {
          this.online = true;
          this.remote.board[cls === 'daily' ? 'daily:' + day : cls] = r.body.rows;
          emit('ps:board', { cls });
        }
      } catch (e) {
        offline();
      }
      return this.board(cls);
    },
    /** "id.token": paste into another device's useSyncCode() to share one profile */
    syncCode() {
      return net.enabled ? who().id + '.' + who().token : '';
    },
    /** link this device to an existing profile; the server copy replaces local progress. Resolves true on success. */
    async useSyncCode(code) {
      const m = /^([A-Za-z0-9-]{8,64})\.([A-Za-z0-9._-]{16,128})$/.exec(String(code || '').trim());
      if (!net.enabled || !m) return false;
      const prev = who();
      if (net.syncing) await net.syncing;
      net.who = { id: m[1], token: m[2] };
      try {
        const r = await api('GET', 'profile/' + encodeURIComponent(m[1]), undefined, { auth: true });
        if (r.status !== 200 || !r.body || !obj(r.body.data)) throw new Error('no profile');
        store.set(ID_KEY, JSON.stringify(net.who));
        net.fresh = false;
        this.online = net.synced = true;
        net.dirty = false;
        adopt(r.body.data, num(r.body.updatedAt) ? r.body.updatedAt : Date.now());
        this.remote.board = {};
        this.fetchBoard('all');
        return true;
      } catch (e) {
        net.who = prev;
        return false;
      }
    },
    rank(nodeId) {
      return this.data.tree[nodeId] || 0;
    },
  };

  PS.Save = Save;
})();
