/* POWERSCALING — optional server: serves the game, keeps player saves in SQLite and runs a global leaderboard.
   `bun server.ts`. No dependencies. The game still works without it (it falls back to localStorage). */
import { Database } from 'bun:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import './js/seed.js'; // the daily rift's definition, shared with the game: sets globalThis.PS.Daily

const Daily = (globalThis as any).PS.Daily as {
  dateOf(ms: number): string; valid(date: unknown): boolean; spec(date: string): { date: string; seed: string; cls: string; mutator: string };
};
export const DEPTH_MAX = 10;

export const CLASSES = ['vanguard', 'pyromancer', 'ranger', 'reaper'];
const MAX_BODY = 64 * 1024;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const TOKEN_RE = /^[A-Za-z0-9._-]{16,128}$/;
// only these paths are ever served; everything else in the repo (server.ts, data/, tools/, .git) is invisible
const STATIC_RE = /^\/(index\.html|favicon\.(ico|svg|png)|(css|js)\/[A-Za-z0-9._/-]+)$/;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, msg: string): never => { throw new HttpError(status, msg); };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;

/* ------------------------------------------------------------------ run validation */
// Mirrors js/game.js finalScore: score = G.score + floor(time)*60 + (level-1)*100, where G.score is the sum of
// enemy scores (xp, x12 for elites, +10%/min in overtime), boss scores (2500*(idx+1), x(1+k) for overtime repeats)
// and +15000 for the win. The cap pretends every kill was an elite, so it is very loose but stops absurd numbers.
// A Rift Depth multiplies the whole score by 1 + 0.15 per depth (js/data.js depthScore).
export function scoreBounds(r: { time: number; level: number; kills: number; bosses: number; won: boolean; depth?: number }) {
  const base = r.time * 60 + (r.level - 1) * 100 + (r.won ? 15000 : 0);
  const perKill = Math.ceil(96 * (1 + 0.1 * Math.max(0, r.time - 720) / 60));
  const extra = Math.max(0, r.bosses - 4); // overtime bosses n=0.. are worth at most 10000*(n+2)
  const mult = 1 + 0.15 * (r.depth || 0);
  return { min: Math.floor(base * mult) - 1, max: Math.ceil((base + r.kills * perKill + 25000 + 5000 * extra * (extra + 3)) * mult) + 1 };
}
// bosses arrive at 3:00, 6:00, 9:00, 12:00, then every 2:00 of overtime; none can die the moment it spawns
const maxBosses = (time: number) => (time < 720 ? Math.floor(time / 180) : 4 + Math.floor((time - 720) / 120));

/** now: the server's clock, used to check that a daily rift run is for today (or the day that just ended) */
export function validateRun(b: unknown, now = Date.now()) {
  if (!isObj(b)) fail(400, 'run must be an object');
  const r = b as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : fail(400, 'name must be a string');
  if (name.length > 14) fail(400, 'name is longer than 14 characters');
  if (typeof r.cls !== 'string' || !CLASSES.includes(r.cls)) fail(400, 'unknown class');
  if (typeof r.won !== 'boolean') fail(400, 'won must be a boolean');
  const caps = { score: 1e12, time: 86400, level: 5000, kills: 1e9, bosses: 1000 } as const;
  for (const k of Object.keys(caps) as (keyof typeof caps)[]) if (!isCount(r[k], caps[k])) fail(400, `${k} must be a non-negative integer`);
  const build = Array.isArray(r.build) ? r.build : fail(400, 'build must be an array');
  if (build.length > 8 || !build.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 32)) fail(400, 'build must be up to 8 short strings');
  // older clients send neither field: depth 0, not a daily run
  const depth = r.depth === undefined ? 0 : isCount(r.depth, DEPTH_MAX) ? r.depth : fail(400, `depth must be an integer from 0 to ${DEPTH_MAX}`);
  const daily = r.daily === undefined || r.daily === null || r.daily === '' ? '' : Daily.valid(r.daily) ? (r.daily as string) : fail(400, 'daily must be a date');
  const run = {
    name: name || 'Wanderer', cls: r.cls as string, won: r.won as boolean, build: build as string[],
    score: r.score as number, time: r.time as number, level: r.level as number, kills: r.kills as number, bosses: r.bosses as number,
    depth: depth as number, daily: daily as string,
  };
  if (run.daily) {
    // a run that started before midnight UTC may finish after it, so yesterday's rift is still accepted
    if (run.daily !== Daily.dateOf(now) && run.daily !== Daily.dateOf(now - 86400000)) fail(400, 'that daily rift is closed');
    if (run.cls !== Daily.spec(run.daily).cls) fail(400, 'wrong class for that daily rift');
    if (run.depth !== 0) fail(400, 'the daily rift has no depth');
  }
  if (run.level < 1) fail(400, 'level must be at least 1');
  if (run.bosses > maxBosses(run.time) || run.bosses > run.kills) fail(400, 'too many bosses for that time');
  if (run.won && (run.bosses < 4 || run.time < 720)) fail(400, 'a win needs the Rift Lord');
  if (run.kills > 1000 + run.time * 400) fail(400, 'too many kills for that time');
  const { min, max } = scoreBounds(run);
  if (run.score < min || run.score > max) fail(400, 'score does not add up');
  return run;
}

/* ------------------------------------------------------------------ server */
export type Options = { port?: number; hostname?: string; dbPath?: string; writeLimit?: number; root?: string; trustProxy?: boolean };

export function createServer(opts: Options = {}) {
  const root = resolve(opts.root || import.meta.dir);
  const dbPath = opts.dbPath || join(root, 'data', 'powerscaling.db');
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, data TEXT, updated_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id), name TEXT NOT NULL, cls TEXT NOT NULL,
      score INTEGER NOT NULL, time INTEGER NOT NULL, level INTEGER NOT NULL, kills INTEGER NOT NULL, bosses INTEGER NOT NULL,
      won INTEGER NOT NULL, build TEXT NOT NULL, date INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS runs_by_score ON runs(score DESC, id);
    CREATE INDEX IF NOT EXISTS runs_by_cls ON runs(cls, score DESC, id);`);
  // databases from before Rift Depths and the daily rift gain the two columns; their runs are depth 0, not daily
  const have = new Set((db.query('PRAGMA table_info(runs)').all() as { name: string }[]).map((c) => c.name));
  if (!have.has('depth')) db.exec('ALTER TABLE runs ADD COLUMN depth INTEGER NOT NULL DEFAULT 0');
  if (!have.has('daily')) db.exec("ALTER TABLE runs ADD COLUMN daily TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS runs_by_daily ON runs(daily, score DESC, id)');

  type Player = { id: string; token_hash: string; data: string | null; updated_at: number };
  type RunRow = { id: number; player: string; name: string; cls: string; score: number; time: number; level: number; kills: number; bosses: number; won: number; build: string; date: number; depth: number; daily: string };
  const cols = 'id, player, name, cls, score, time, level, kills, bosses, won, build, date, depth, daily';
  // The main board holds every ordinary run. Daily rift runs (daily <> '') live on that day's board only, one row per
  // player: their best of the day. "Best" is the highest score, the earlier run on a tie.
  const bestOfDay = `id = (SELECT b.id FROM runs b WHERE b.daily = r.daily AND b.player = r.player ORDER BY b.score DESC, b.id LIMIT 1)`;
  const q = {
    player: db.prepare<Player, [string]>('SELECT id, token_hash, data, updated_at FROM players WHERE id = ?'),
    claim: db.prepare('INSERT OR IGNORE INTO players (id, token_hash, created_at) VALUES (?, ?, ?)'),
    putProfile: db.prepare('UPDATE players SET data = ?, updated_at = ? WHERE id = ?'),
    addRun: db.prepare<{ id: number }, any[]>(`INSERT INTO runs (player, name, cls, score, time, level, kills, bosses, won, build, date, depth, daily)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`),
    getRun: db.prepare<RunRow, [number]>(`SELECT ${cols} FROM runs WHERE id = ?`),
    rename: db.prepare('UPDATE runs SET name = ? WHERE id = ?'),
    // ties go to the earlier run, matching the leaderboard order
    rankAll: db.prepare<{ n: number }, [number, number]>("SELECT COUNT(*) AS n FROM runs WHERE daily = '' AND (score > ?1 OR (score = ?1 AND id < ?2))"),
    rankCls: db.prepare<{ n: number }, [string, number, number]>("SELECT COUNT(*) AS n FROM runs WHERE daily = '' AND cls = ?1 AND (score > ?2 OR (score = ?2 AND id < ?3))"),
    countAll: db.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM runs WHERE daily = ''"),
    countCls: db.prepare<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM runs WHERE daily = '' AND cls = ?"),
    topAll: db.prepare<RunRow, [number]>(`SELECT ${cols} FROM runs WHERE daily = '' ORDER BY score DESC, id LIMIT ?`),
    topCls: db.prepare<RunRow, [string, number]>(`SELECT ${cols} FROM runs WHERE daily = '' AND cls = ? ORDER BY score DESC, id LIMIT ?`),
    topDaily: db.prepare<RunRow, [string, number]>(`SELECT ${cols} FROM runs r WHERE r.daily = ? AND r.${bestOfDay} ORDER BY score DESC, id LIMIT ?`),
    countDaily: db.prepare<{ n: number }, [string]>('SELECT COUNT(DISTINCT player) AS n FROM runs WHERE daily = ?'),
    // a player's standing on a day's board: their best run against everyone else's best
    bestDaily: db.prepare<RunRow, [string, string]>(`SELECT ${cols} FROM runs WHERE daily = ? AND player = ? ORDER BY score DESC, id LIMIT 1`),
    rankDaily: db.prepare<{ n: number }, [string, number, number]>(`SELECT COUNT(*) AS n FROM runs r WHERE r.daily = ?1 AND r.${bestOfDay} AND (score > ?2 OR (score = ?2 AND id < ?3))`),
  };

  // fixed one-minute window per IP for writes; plenty for debounced saves, stops a script from flooding the board
  const writeLimit = opts.writeLimit ?? 60;
  const hits = new Map<string, { n: number; reset: number }>();
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, 60_000);
  sweep.unref?.();
  const allowWrite = (ip: string) => {
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || h.reset <= now) hits.set(ip, (h = { n: 0, reset: now + 60_000 }));
    return ++h.n <= writeLimit ? 0 : Math.ceil((h.reset - now) / 1000);
  };

  async function readJson(req: Request) {
    if (Number(req.headers.get('content-length') || 0) > MAX_BODY) fail(413, 'body too large');
    const text = await req.text();
    if (Buffer.byteLength(text) > MAX_BODY) fail(413, 'body too large');
    try { return JSON.parse(text); } catch { return fail(400, 'invalid JSON'); }
  }

  /** Bearer-token check. The first write for an unknown id claims it; reads of unknown ids return null. */
  function auth(req: Request, id: string | null, claim: boolean): Player | null {
    if (!id || !ID_RE.test(id)) fail(400, 'bad player id');
    const token = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '')?.[1];
    if (!token || !TOKEN_RE.test(token)) fail(401, 'missing or malformed token');
    const hash = sha256(token!);
    let p = q.player.get(id!);
    if (!p && claim) { q.claim.run(id!, hash, Date.now()); p = q.player.get(id!); }
    if (p && !sameHash(p.token_hash, hash)) fail(403, 'token does not match this player');
    return p;
  }

  const rowOut = (r: RunRow, me: string | null) => {
    const o: Record<string, unknown> = {
      name: r.name, cls: r.cls, score: r.score, time: r.time, level: r.level, kills: r.kills, bosses: r.bosses,
      won: !!r.won, date: r.date, build: JSON.parse(r.build), depth: r.depth,
    };
    if (r.daily) o.daily = r.daily;
    if (me) o.mine = r.player === me; // never expose other players' ids
    return o;
  };
  const rankOf = (r: RunRow) => {
    if (r.daily) {
      // everyone plays the same class in a daily rift, so the class rank is the rank
      const best = q.bestDaily.get(r.daily, r.player)!;
      const rank = q.rankDaily.get(r.daily, best.score, best.id)!.n + 1, total = q.countDaily.get(r.daily)!.n;
      return { rank, total, classRank: rank, classTotal: total };
    }
    return {
      rank: q.rankAll.get(r.score, r.id)!.n + 1, total: q.countAll.get()!.n,
      classRank: q.rankCls.get(r.cls, r.score, r.id)!.n + 1, classTotal: q.countCls.get(r.cls)!.n,
    };
  };

  async function api(req: Request, url: URL, ip: string) {
    const path = url.pathname, method = req.method;
    let m: RegExpMatchArray | null;
    if (method !== 'GET' && method !== 'HEAD') {
      const wait = allowWrite(ip);
      if (wait) return json({ error: 'too many writes, slow down' }, 429, { 'Retry-After': String(wait) });
    }
    // `now` lets every client agree on when the daily rift turns over, whatever its own clock says
    if (path === '/api/health' && method === 'GET') return json({ ok: true, now: Date.now() });

    if (path === '/api/leaderboard' && method === 'GET') {
      const cls = url.searchParams.get('cls') || 'all';
      if (cls !== 'all' && !CLASSES.includes(cls)) fail(400, 'unknown class');
      const limit = Math.max(1, Math.min(100, Math.floor(Number(url.searchParams.get('limit')) || 100)));
      const me = req.headers.get('x-player-id');
      const daily = url.searchParams.get('daily');
      if (daily !== null) {
        // ?daily=YYYY-MM-DD (or "today"): that day's rift, each player's best run
        const date = daily === 'today' ? Daily.dateOf(Date.now()) : Daily.valid(daily) ? daily : fail(400, 'daily must be a date');
        const spec = Daily.spec(date);
        return json({ daily: date, cls: spec.cls, mutator: spec.mutator, total: q.countDaily.get(date)!.n,
          rows: q.topDaily.all(date, limit).map((r) => rowOut(r, me && ID_RE.test(me) ? me : null)) });
      }
      const rows = cls === 'all' ? q.topAll.all(limit) : q.topCls.all(cls, limit);
      const total = (cls === 'all' ? q.countAll.get() : q.countCls.get(cls))!.n;
      return json({ cls, total, rows: rows.map((r) => rowOut(r, me && ID_RE.test(me) ? me : null)) });
    }

    if ((m = path.match(/^\/api\/profile\/([^/]+)$/))) {
      const id = m[1]; // ids are plain [A-Za-z0-9-], so no decoding needed
      if (method === 'GET') {
        const p = auth(req, id, false);
        if (!p || p.data == null) return json({ error: 'no profile' }, 404);
        return json({ data: JSON.parse(p.data), updatedAt: p.updated_at });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        if (!isObj(body) || !isObj(body.data)) fail(400, 'expected {updatedAt, data: {...}}');
        const at = body.updatedAt;
        if (!isCount(at, 8.64e15)) fail(400, 'updatedAt must be a timestamp');
        const { board, ...data } = body.data as Record<string, unknown>; // the server keeps its own runs table
        const p = auth(req, id, true)!;
        // last write wins, except a write older than the stored copy (a late beacon, a stale tab) is refused
        if (p.updated_at > (at as number)) return json({ error: 'stale', updatedAt: p.updated_at }, 409);
        q.putProfile.run(JSON.stringify(data), at as number, id);
        return json({ ok: true, updatedAt: at });
      }
      return json({ error: 'method not allowed' }, 405, { Allow: 'GET, PUT' });
    }

    if (path === '/api/runs' && method === 'POST') {
      const run = validateRun(await readJson(req));
      const id = req.headers.get('x-player-id');
      auth(req, id, true);
      const { id: rid } = q.addRun.get(id, run.name, run.cls, run.score, run.time, run.level, run.kills, run.bosses,
        run.won ? 1 : 0, JSON.stringify(run.build), Date.now(), run.depth, run.daily)!;
      return json({ id: rid, ...rankOf(q.getRun.get(rid)!) }, 201);
    }

    // the results screen lets players rename a run after it was recorded
    if ((m = path.match(/^\/api\/runs\/(\d+)$/)) && method === 'PATCH') {
      const body = await readJson(req);
      const id = req.headers.get('x-player-id');
      const r = q.getRun.get(Number(m[1]));
      const p = auth(req, id, false);
      if (!r || !p || r.player !== p.id) return json({ error: 'no such run' }, 404);
      // only the name is being checked here; the run itself was validated when it was posted (its daily rift may have closed since)
      const { name } = validateRun({ ...rowOut(r, null), daily: undefined, depth: r.daily ? 0 : r.depth, name: isObj(body) ? body.name : null });
      q.rename.run(name, r.id);
      return json({ ok: true, name });
    }
    return json({ error: 'not found' }, 404);
  }

  const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  function serveStatic(req: Request, url: URL) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    let rel: string;
    try { rel = decodeURIComponent(url.pathname); } catch { return notFound(); }
    if (rel === '/') rel = '/index.html';
    if (!STATIC_RE.test(rel) || rel.slice(1).split('/').some((s) => !s || s[0] === '.')) return notFound();
    const abs = resolve(root, '.' + rel);
    if (!abs.startsWith(root + sep)) return notFound();
    const st = statSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isFile()) return notFound();
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const ext = extname(abs);
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream', ETag: etag, 'Last-Modified': st.mtime.toUTCString(),
      // html always revalidates; scripts and styles may be reused briefly (there is no cache busting)
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60', 'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(req.method === 'HEAD' ? null : Bun.file(abs), { headers });
  }

  const server = Bun.serve({
    port: opts.port ?? 3000,
    hostname: opts.hostname,
    maxRequestBodySize: MAX_BODY * 2,
    async fetch(req, srv) {
      const url = new URL(req.url);
      try {
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          const ip = (opts.trustProxy && req.headers.get('x-forwarded-for')?.split(',')[0].trim()) || srv.requestIP(req)?.address || '?';
          return await api(req, url, ip);
        }
        return serveStatic(req, url);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: 'internal error' }, 500);
      }
    },
  });

  return {
    server, db, port: server.port, url: `http://localhost:${server.port}`,
    stop() { clearInterval(sweep); server.stop(true); db.close(); },
  };
}

if (import.meta.main) {
  const env = process.env;
  const app = createServer({
    port: env.PORT ? Number(env.PORT) : 3000,
    hostname: env.HOST || undefined,
    dbPath: env.DB_PATH || undefined,
    writeLimit: env.WRITE_LIMIT ? Number(env.WRITE_LIMIT) : undefined,
    trustProxy: env.TRUST_PROXY === '1',
  });
  console.log(`Powerscaling at ${app.url} (db: ${env.DB_PATH || 'data/powerscaling.db'})`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { app.stop(); process.exit(0); });
}
