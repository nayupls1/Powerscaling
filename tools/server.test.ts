/* bun test tools/ — exercises server.ts on a random port with a throwaway database */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, validateRun } from '../server.ts';

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
    expect(await r.json()).toEqual({ ok: true });
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

describe('static files', () => {
  test('serves the game with content types', async () => {
    let r = await req('GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('cache-control')).toBe('no-cache');
    expect(await r.text()).toContain('js/save.js');
    r = await req('GET', '/js/save.js');
    expect(r.headers.get('content-type')).toContain('javascript');
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
