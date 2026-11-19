/* bun test tools/ — exercises server.ts on a random port with a throwaway database */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { createServer, validateRun } from '../server.ts';

const Daily = (globalThis as any).PS.Daily; // set by server.ts importing js/seed.js
const RNG = (globalThis as any).PS.RNG;

const dir = mkdtempSync(join(tmpdir(), 'ps-test-'));
let app: ReturnType<typeof createServer>;
beforeAll(() => { app = createServer({ port: 0, dbPath: join(dir, 'sub', 'test.db'), writeLimit: 10_000 }); });
afterAll(() => { app.stop(); rmSync(dir, { recursive: true, force: true }); });

const who = () => ({ id: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID() });
type Who = ReturnType<typeof who>;
function req(method: string, path: string, body?: unknown, w?: Who, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (w) { headers['X-Player-Id'] = w.id; headers.Authorization = 'Bearer ' + w.token; }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(app.url + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
}
// a plausible finished run: score = kills-based points + time*60 + (level-1)*100
const run = (o: Record<string, unknown> = {}) => {
  const r: any = { name: 'Tester', cls: 'ranger', time: 400, level: 30, kills: 2000, bosses: 2, won: false, build: ['Arc Coil', 'Volley'], ...o };
  if (r.score === undefined) r.score = r.time * 60 + (r.level - 1) * 100 + (r.won ? 15000 : 0) + r.kills * 3 + 7500;
  return r;
};

describe('api basics', () => {
  test('health', async () => {
    const r = await req('GET', '/api/health');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(Math.abs(body.now - Date.now())).toBeLessThan(5000); // clients take the daily rift's date from this clock
  });
  test('unknown api route is JSON 404', async () => {
    const r = await req('GET', '/api/nope');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/json');
  });
  test('database uses WAL', () => {
    expect((app.db.query('PRAGMA journal_mode').get() as any).journal_mode).toBe('wal');
  });
});

describe('profiles', () => {
  test('roundtrip, claim and wrong-token rejection', async () => {
    const me = who();
    expect((await req('GET', `/api/profile/${me.id}`, undefined, me)).status).toBe(404);
    const data = { name: 'Ash', essence: 120, tree: { might1: 2 }, board: [{ score: 1 }], updatedAt: 1000 };
    let r = await req('PUT', `/api/profile/${me.id}`, { updatedAt: 1000, data }, me);
    expect(r.status).toBe(200);
    r = await req('GET', `/api/profile/${me.id}`, undefined, me);
    const got = await r.json();
    expect(got.updatedAt).toBe(1000);
    expect(got.data.essence).toBe(120);
    expect(got.data.board).toBeUndefined(); // the local board is not stored

    const thief = { id: me.id, token: who().token };
    expect((await req('GET', `/api/profile/${me.id}`, undefined, thief)).status).toBe(403);
    expect((await req('PUT', `/api/profile/${me.id}`, { updatedAt: 9e12, data: {} }, thief)).status).toBe(403);
    expect((await req('GET', `/api/profile/${me.id}`)).status).toBe(401);
  });
  test('stale writes are refused, newer ones win', async () => {
    const me = who();
    await req('PUT', `/api/profile/${me.id}`, { updatedAt: 5000, data: { essence: 5 } }, me);
    let r = await req('PUT', `/api/profile/${me.id}`, { updatedAt: 4000, data: { essence: 4 } }, me);
    expect(r.status).toBe(409);
    expect((await r.json()).updatedAt).toBe(5000);
    r = await req('PUT', `/api/profile/${me.id}`, { updatedAt: 6000, data: { essence: 6 } }, me);
    expect(r.status).toBe(200);
    expect((await (await req('GET', `/api/profile/${me.id}`, undefined, me)).json()).data.essence).toBe(6);
  });
  test('rejects bad bodies', async () => {
    const me = who();
    const put = (b: unknown) => req('PUT', `/api/profile/${me.id}`, b, me).then((r) => r.status);
    expect(await put('not json')).toBe(400);
    expect(await put({ updatedAt: 1, data: [1, 2] })).toBe(400);
    expect(await put({ updatedAt: -1, data: {} })).toBe(400);
    expect(await put({ updatedAt: 1, data: { junk: 'x'.repeat(70 * 1024) } })).toBe(413);
    expect((await req('PUT', '/api/profile/bad id!', { updatedAt: 1, data: {} }, me)).status).toBe(400);
    expect((await req('PUT', '/api/profile/short', { updatedAt: 1, data: {} }, me)).status).toBe(400);
    // invalid requests must not claim the id
    expect((await req('GET', `/api/profile/${me.id}`, undefined, { id: me.id, token: who().token })).status).toBe(404);
  });
});

describe('runs and leaderboard', () => {
  test('validation rejects bad input', async () => {
    const me = who();
    const bad = [
      run({ cls: 'paladin' }), run({ name: 'x'.repeat(15) }), run({ name: 42 }), run({ score: -5 }), run({ time: 1.5 }),
      run({ kills: '10' }), run({ level: 0 }), run({ won: 'yes' }), run({ build: 'Volley' }), run({ build: Array(9).fill('a') }),
      run({ build: ['x'.repeat(40)] }), run({ score: 999_999_999 }), run({ score: 10 }), run({ bosses: 9 }),
      run({ won: true, time: 600, bosses: 3 }), run({ score: Infinity }), {},
    ];
    for (const b of bad) {
      const r = await req('POST', '/api/runs', b, me);
      if (r.status !== 400) throw new Error('accepted ' + JSON.stringify(b).slice(0, 120));
    }
    expect((await req('POST', '/api/runs', run())).status).toBe(400); // no id
  });
  test('validateRun accepts real-looking runs and trims names', () => {
    expect(validateRun(run({ name: '  Ash  ' })).name).toBe('Ash');
    expect(validateRun(run({ name: '' })).name).toBe('Wanderer');
    // a 20 minute win with overtime bosses
    const w = run({ time: 1200, level: 90, kills: 30000, bosses: 8, won: true });
    w.score = w.time * 60 + (w.level - 1) * 100 + 15000 + 25000 + 2500 * (2 + 2 * 3 + 3 * 4 + 4 * 5) + w.kills * 6;
    expect(validateRun(w).score).toBe(w.score);
  });
  test('ordering, ranks, class filter, mine flag', async () => {
    const a = who(), b = who();
    const post = async (w: Who, o: Record<string, unknown>) => (await req('POST', '/api/runs', run(o), w)).json();
    const r1 = await post(a, { cls: 'vanguard', kills: 1000 });
    const r2 = await post(b, { cls: 'ranger', kills: 5000 });
    const r3 = await post(a, { cls: 'vanguard', kills: 3000 });
    expect(r2.rank).toBe(1);
    expect(r3.rank).toBe(2);
    expect(r3.classRank).toBe(1);
    expect(r1.rank).toBe(1); // it was alone when posted
    expect(r3.total).toBe(3);

    let lb = await (await req('GET', '/api/leaderboard?cls=all&limit=100', undefined, undefined, { 'X-Player-Id': a.id })).json();
    expect(lb.rows.map((r: any) => r.kills)).toEqual([5000, 3000, 1000]);
    expect(lb.rows.map((r: any) => r.mine)).toEqual([false, true, true]);
    expect(lb.rows.every((r: any) => !('player' in r) && !('id' in r))).toBe(true);
    expect(lb.rows[0].build).toEqual(['Arc Coil', 'Volley']);

    lb = await (await req('GET', '/api/leaderboard?cls=vanguard')).json();
    expect(lb.rows.length).toBe(2);
    expect(lb.rows.every((r: any) => r.cls === 'vanguard' && !('mine' in r))).toBe(true);
    expect((await req('GET', '/api/leaderboard?cls=bard')).status).toBe(400);
    expect((await (await req('GET', '/api/leaderboard?limit=1')).json()).rows.length).toBe(1);

    // a run from someone else's id with the wrong token is refused
    expect((await req('POST', '/api/runs', run(), { id: a.id, token: b.token })).status).toBe(403);
  });
  test('owner can rename a run, others cannot', async () => {
    const a = who(), b = who();
    const { id } = await (await req('POST', '/api/runs', run({ name: 'Old' }), a)).json();
    expect((await req('PATCH', `/api/runs/${id}`, { name: 'Sneaky' }, b)).status).toBe(404);
    expect((await req('PATCH', `/api/runs/${id}`, { name: 'x'.repeat(20) }, a)).status).toBe(400);
    const r = await req('PATCH', `/api/runs/${id}`, { name: ' New ' }, a);
    expect(await r.json()).toEqual({ ok: true, name: 'New' });
  });
});

describe('rift depths', () => {
  test('depth multiplies the score bounds and is listed', async () => {
    const me = who();
    const base = run({ cls: 'reaper', kills: 4000 });
    // the same run at depth 4 scores 1.6 times as much
    const deep = { ...base, depth: 4, score: Math.round(base.score * 1.6) };
    expect((await req('POST', '/api/runs', deep, me)).status).toBe(201);
    // the lowest score that run could have at depth 0 is too low for depth 4
    const floor = base.time * 60 + (base.level - 1) * 100;
    expect((await req('POST', '/api/runs', { ...base, score: floor }, me)).status).toBe(201);
    expect((await req('POST', '/api/runs', { ...base, score: floor, depth: 4 }, me)).status).toBe(400);
    for (const depth of [-1, 11, 1.5, '3']) expect((await req('POST', '/api/runs', { ...base, depth }, me)).status).toBe(400);
    const lb = await (await req('GET', '/api/leaderboard?cls=reaper')).json();
    expect(lb.rows.find((r: any) => r.score === deep.score).depth).toBe(4);
    expect(validateRun(base).depth).toBe(0); // clients from before depths send no depth
  });
});

describe('daily rift', () => {
  const today = Daily.dateOf(Date.now());
  const spec = Daily.spec(today);
  const daily = (o: Record<string, unknown> = {}) => run({ cls: spec.cls, daily: today, ...o });

  test('the definition is stable, and varied', () => {
    expect(Daily.spec('2026-01-01')).toEqual(Daily.spec('2026-01-01'));
    expect(Daily.valid('2026-02-30')).toBe(false);
    expect(Daily.valid('2026-2-3')).toBe(false);
    // every class appears once in each block of four days, every mutator once in each block of eight
    const day0 = Math.ceil(Date.parse('2026-01-01T00:00:00Z') / 86400000 / 8) * 8;
    const specs = Array.from({ length: 8 }, (_, i) => Daily.spec(Daily.dateOf((day0 + i) * 86400000)));
    expect(new Set(specs.slice(0, 4).map((x) => x.cls)).size).toBe(4);
    expect(new Set(specs.slice(4).map((x) => x.cls)).size).toBe(4);
    expect(new Set(specs.map((x) => x.mutator)).size).toBe(8);
  });
  test('seeded streams repeat, and differ from each other', () => {
    RNG.seed('abc');
    const a = [RNG.sim(), RNG.sim(), RNG.event(), RNG.loot()];
    RNG.seed('abc');
    expect([RNG.sim(), RNG.sim(), RNG.event(), RNG.loot()]).toEqual(a);
    expect(new Set(a).size).toBe(4);
    RNG.seed('abd');
    expect(RNG.sim()).not.toBe(a[0]);
  });
  test('validation: right day, right class, no depth', () => {
    const now = Date.parse(today + 'T12:00:00Z');
    expect(validateRun(daily(), now).daily).toBe(today);
    const yesterday = Daily.dateOf(now - 86400000), old = Daily.dateOf(now - 3 * 86400000), tomorrow = Daily.dateOf(now + 86400000);
    expect(validateRun(run({ cls: Daily.spec(yesterday).cls, daily: yesterday }), now).daily).toBe(yesterday); // finished just after midnight
    expect(() => validateRun(run({ cls: Daily.spec(old).cls, daily: old }), now)).toThrow();
    expect(() => validateRun(run({ cls: Daily.spec(tomorrow).cls, daily: tomorrow }), now)).toThrow();
    const other = ['vanguard', 'pyromancer', 'ranger', 'reaper', 'stormcaller'].find((c) => c !== spec.cls);
    expect(() => validateRun(daily({ cls: other }), now)).toThrow();
    expect(() => validateRun(daily({ depth: 2, score: undefined }), now)).toThrow();
    expect(() => validateRun(daily({ daily: 'soon' }), now)).toThrow();
  });
  test('its own board: one row per player, their best, and nothing leaks onto the main board', async () => {
    const a = who(), b = who(), c = who();
    const post = async (w: Who, kills: number) => (await req('POST', '/api/runs', daily({ kills, name: 'D' + kills }), w)).json();
    const before = (await (await req('GET', '/api/leaderboard?cls=all')).json()).total;
    const a1 = await post(a, 1000);
    expect(a1.rank).toBe(1);
    const b1 = await post(b, 3000);
    expect(b1.rank).toBe(1);
    expect(b1.total).toBe(2);
    const a2 = await post(a, 2000);          // better than a's first, still behind b
    expect(a2.rank).toBe(2);
    const a3 = await post(a, 500);           // worse: a's standing is still their best run
    expect(a3.rank).toBe(2);
    const c1 = await post(c, 9000);
    expect(c1.rank).toBe(1);
    expect(c1.total).toBe(3);

    const lb = await (await req('GET', `/api/leaderboard?daily=${today}`, undefined, undefined, { 'X-Player-Id': a.id })).json();
    expect(lb.daily).toBe(today);
    expect(lb.cls).toBe(spec.cls);
    expect(lb.mutator).toBe(spec.mutator);
    expect(lb.total).toBe(3);
    expect(lb.rows.map((r: any) => r.kills)).toEqual([9000, 3000, 2000]);
    expect(lb.rows.map((r: any) => r.mine)).toEqual([false, false, true]);
    expect(lb.rows.every((r: any) => r.daily === today)).toBe(true);
    expect((await (await req('GET', '/api/leaderboard?daily=today')).json()).rows.length).toBe(3);
    expect((await req('GET', '/api/leaderboard?daily=nope')).status).toBe(400);
    expect((await (await req('GET', '/api/leaderboard?daily=2020-01-01')).json()).rows).toEqual([]);

    const after = await (await req('GET', '/api/leaderboard?cls=all')).json();
    expect(after.total).toBe(before);
    expect(after.rows.some((r: any) => r.daily)).toBe(false);
    // a daily run can still be renamed after the fact
    const { id } = await (await req('POST', '/api/runs', daily({ kills: 700 }), b)).json();
    expect((await req('PATCH', `/api/runs/${id}`, { name: 'Renamed' }, b)).status).toBe(200);
  });
});

test('a database from before depths and the daily rift is upgraded in place', async () => {
  const path = join(dir, 'old.db');
  const old = new Database(path, { create: true });
  old.exec(`CREATE TABLE players (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, data TEXT, updated_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE runs (id INTEGER PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id), name TEXT NOT NULL, cls TEXT NOT NULL,
      score INTEGER NOT NULL, time INTEGER NOT NULL, level INTEGER NOT NULL, kills INTEGER NOT NULL, bosses INTEGER NOT NULL,
      won INTEGER NOT NULL, build TEXT NOT NULL, date INTEGER NOT NULL);
    INSERT INTO players VALUES ('old-player-1', 'x', NULL, 0, 0);
    INSERT INTO runs VALUES (1, 'old-player-1', 'Elder', 'ranger', 40000, 400, 30, 2000, 2, 0, '["Longbow"]', 1700000000000);`);
  old.close();
  for (let pass = 0; pass < 2; pass++) { // the second start must find nothing left to do
    const up = createServer({ port: 0, dbPath: path });
    try {
      const lb = await (await fetch(`${up.url}/api/leaderboard`)).json();
      expect(lb.rows.length).toBe(1);
      expect(lb.rows[0].name).toBe('Elder');
      expect(lb.rows[0].depth).toBe(0);
      expect('daily' in lb.rows[0]).toBe(false);
    } finally {
      up.stop();
    }
  }
});

describe('static files', () => {
  test('serves the game with content types', async () => {
    let r = await req('GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('cache-control')).toBe('no-cache');
    expect(await r.text()).toContain('js/save.js');
    r = await req('GET', '/js/save.js');
    expect(r.headers.get('content-type')).toContain('javascript');
    expect((await req('GET', '/js/seed.js')).status).toBe(200);
    expect((await req('GET', '/css/style.css')).headers.get('content-type')).toContain('text/css');
    const etag = r.headers.get('etag')!;
    expect((await req('GET', '/js/save.js', undefined, undefined, { 'If-None-Match': etag })).status).toBe(304);
  });
  test('never serves anything outside the allowlist', async () => {
    const paths = ['/server.ts', '/package.json', '/README.md', '/data/test.db', '/tools/playtest.js', '/.git/config', '/.gitignore',
      '/js/../server.ts', '/js/%2e%2e/server.ts', '/js/..%2fserver.ts', '/css/..%2f..%2fetc%2fpasswd', '/js/.hidden', '/js/', '/js//save.js', '/%E0%A4%A'];
    for (const p of paths) {
      const r = await fetch(app.url + p);
      if (r.status !== 404) throw new Error(`${p} -> ${r.status}`);
    }
    expect((await req('POST', '/index.html')).status).toBe(405);
  });
});

test('rate limit kicks in', async () => {
  const small = createServer({ port: 0, dbPath: ':memory:', writeLimit: 5 });
  try {
    const me = who();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await fetch(`${small.url}/api/profile/${me.id}`, {
        method: 'PUT', headers: { Authorization: 'Bearer ' + me.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: i, data: {} }),
      });
      codes.push(r.status);
      if (r.status === 429) expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
    expect((await fetch(`${small.url}/api/health`)).status).toBe(200); // reads are not limited
  } finally {
    small.stop();
  }
});
