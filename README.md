# Powerscaling

A top-down roguelike horde survivor that runs in the browser. Pick a class, mow through the rift, take one of three rewards every level, and stack skills, tomes, relics and talents until the numbers get silly.

No build step, no dependencies, no assets: everything is drawn on a canvas and every sound is synthesized at runtime.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

It also works as-is on any static host (GitHub Pages, Netlify, itch.io). Progress and the leaderboard then live in the browser's local storage.

To back saves up to a database and share one global leaderboard, run the bundled server instead (see [Server](#server)):

```sh
bun start                     # then open http://localhost:3000
```

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move |
| Mouse | Aim. Attacks fire on their own, or on click/hold with auto-attack off |
| `Space` | Dash, invulnerable while dashing |
| `Shift` / `F` / middle click | Ward: a shield pulse that reflects bullets and staggers the crowd |
| `Q` / `E` / right click | Class ability |
| `T` | Toggle auto-aim |
| `1` `2` `3` | Pick a reward card (`R` reroll, `B` banish) |
| `Esc` / `P` | Pause and inspect your build |

Touch screens get a floating movement stick with auto-aim, and gamepads are supported (left stick move, right stick aim, A/LB dash, B/Y ward, X/RB ability).

## What is in it

- **Four classes** — Vanguard (melee bruiser), Pyromancer (explosive caster), Ranger (piercing sharpshooter) and Reaper (summoner, unlocked by killing a boss). Each has its own attack, ability, dash and three talent paths; you advance one path every 6 levels, and only one path can reach its final tier.
- **18 skills across six elements** — Ember, Rime, Tempest, Blight, Iron and Abyss. Owning 2, 4 and 6 skills of one element unlocks set bonuses, so builds can go deep on one element or split across two.
- **Evolutions** — a skill at level 6 evolves when you hold its matching tome, then can be overcharged without limit.
- **Tomes, relics and shrine blessings** — slotted stat passives with rarity-scaled upgrades, 38 relics from chests, elites and bosses, and blessings from shrines on the map.
- **Bullets you can fight back against** — your class attack cuts enemy bullets out of the air (melee swings bat them back), and a timed Ward reflects everything around you. Both recharge your ability.
- **No standing still** — the rift shells the ground under you and Bombardiers lob blasts at your position; both are trivial to sidestep and fatal to ignore.
- **Bosses** — one every three minutes with telegraphed attack patterns. Kill the Rift Lord at 12:00 to win the run, then keep going in overtime for score.
- **Permanent skill tree** — Essence earned every run buys upgrades across four arms (Might, Vitality, Fortune, Mastery).
- **Leaderboard** — every run is scored and ranked, filterable by class. Served by `server.ts` it is global, shared by everyone on that server; opened as a file or from a static host it is stored in the browser's local storage, so it is per device.

## Project layout

```
server.ts         optional Bun server: static files, SQLite saves, global leaderboard
index.html        page shell, HUD and menu markup
css/style.css     interface styles
js/util.js        math helpers, spatial hash
js/save.js        local storage plus server sync: progress, settings, leaderboard
js/audio.js       synthesized sound effects and music
js/icons.js       vector glyph library used by the UI and canvas
js/data.js        elements, rarities, affinities, tomes, relics, meta tree
js/skills.js      skill definitions and behaviour
js/classes.js     classes, abilities, talent paths
js/player.js      stats, movement, dash, damage intake, levelling
js/combat.js      damage pipeline, statuses, projectiles, zones, hazards
js/enemies.js     enemy roster and AI
js/bosses.js      boss fights
js/director.js    difficulty curves, spawning, drops, chests, shrines
js/rewards.js     reward card generation
js/fx.js          particles, damage numbers, screen shake
js/render.js      canvas renderer
js/input.js       keyboard, mouse, touch, gamepad
js/ui.js          menus, HUD, cards, pause and results screens
js/game.js        main loop, run lifecycle, scoring
js/bot.js         autoplayer used by the playtest tools
tools/            headless playtest scripts, server tests
```

## Server

`server.ts` is a small [Bun](https://bun.sh) server with no dependencies (SQLite comes from `bun:sqlite`). It serves the game and stores player saves and runs. The game never needs it: without it, everything falls back to local storage.

```sh
bun start        # bun server.ts
bun run dev      # restart on file changes
bun test         # server tests (tools/server.test.ts)
```

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `HOST` | all interfaces | address to bind |
| `DB_PATH` | `data/powerscaling.db` | the folder is created; WAL mode, so `-wal`/`-shm` files sit next to it |
| `WRITE_LIMIT` | `60` | writes per minute per IP |
| `TRUST_PROXY` | off | set to `1` behind a reverse proxy to rate-limit by `X-Forwarded-For` |

Only `index.html`, `css/`, `js/` and a favicon are served. Nothing else in the repo is reachable over HTTP, including the server source, `data/`, `tools/` and `.git`.

**Identity.** There are no accounts. When the game first reaches a server it creates a random player id and secret token and keeps them in local storage (`powerscaling.id.v1`, separate from the save, so *Reset progress* keeps the same player). The server stores only a SHA-256 of the token. The first write for an id claims it, and every later request must present the same token as `Authorization: Bearer <token>`. Settings shows this as a code under *Play on another device* (`PS.Save.syncCode()` returns `id.token`); pasting it on another device (`PS.Save.useSyncCode(code)`) links that device to the same profile. The server copy replaces the device's progress; its settings and local runs stay.

**Sync.** Local storage stays the source of truth while playing, and every save is synchronous. Each `save()` bumps `updatedAt` in the save, writes local storage at once and sends a debounced `PUT` (800 ms). Unsent changes are flushed with a `keepalive` request when the tab is hidden or closed. On load the client pulls the server copy:
- If the server copy is newer than what was loaded, it is adopted and a `ps:sync` event fires. Settings stay local, because volume and aim preferences belong to the device.
- If the local copy is newer, or the server has none, it is pushed.

The server applies last write wins, but refuses a write older than the copy it holds (`409`). This can be a late request or a stale tab, and the client then pulls and adopts the newer copy. Progress made in that stale copy is lost, and a device whose clock runs far ahead wins conflicts. When the server is unreachable, the game carries on locally and syncs again on the next save. A finished run that cannot be posted stays on the local board only.

| Endpoint | Auth | |
| --- | --- | --- |
| `GET /api/health` | | `{ok: true}` |
| `GET /api/profile/:id` | Bearer | `{data, updatedAt}`, or `404` if none |
| `PUT /api/profile/:id` | Bearer | body `{updatedAt, data}`; `data` must be an object, at most 64 KB. The local `board` is dropped (runs have their own table). `409 {updatedAt}` if older than the stored copy |
| `POST /api/runs` | Bearer + `X-Player-Id` | body `{name, cls, score, time, level, kills, bosses, won, build}`, validated strictly, with a generous check that the score matches time, level, kills and bosses. Returns `201 {id, rank, total, classRank, classTotal}` |
| `PATCH /api/runs/:id` | Bearer + `X-Player-Id` | `{name}`. Renames your own run (the results screen allows renaming after the run is recorded) |
| `GET /api/leaderboard?cls=all\|<class>&limit=100` | optional `X-Player-Id` | `{cls, total, rows}`. Each row is `{name, cls, score, time, level, kills, bosses, won, date, build}`, plus `mine` when the id header is sent. Other players' ids are never returned |

Unknown `/api` routes return JSON `404`. Writes over the per-IP limit return `429` with `Retry-After`.

## Playtesting

`tools/playtest.js` runs the real simulation headlessly at full speed with the built-in bot and prints a timeline plus the final build. It needs Node and Playwright with Chromium.

```sh
node tools/playtest.js all 14 1            # every class, 14 minutes each
node tools/playtest.js ranger 20 3 --quiet # summaries only
node tools/playtest.js reaper 14 1 --sloppy --el=venom --tree=full
tools/batch.sh "--sloppy" 14               # two runs per class in parallel
tools/afk.sh "300 600"                   # idle test: play to T seconds, then let go of the controls
```

Flags: `--sloppy` (slow, careless player model), `--random` (random card picks), `--el=<element>` (prefer one element), `--branch=<0-2>` (prefer a talent path), `--tree=full` (all permanent upgrades), `--want=<skill ids>` and `--tomes=<tome ids>` (force a build), `--afk=<seconds>` (stand still from that time), `--quiet`.

`tools/stress.js` runs every class with all talents, every relic and every evolved skill at once and fails on any page error or invalid number:

```sh
node tools/stress.js 3
```

`tools/perf.js` measures frame cost. It plays a seeded run with the bot and, at each checkpoint, renders a burst of real frames, splitting the time into simulation, HUD and each canvas layer:

```sh
node tools/perf.js pyromancer 300,540,780   # checkpoints in seconds: after the 1st, 2nd and 4th boss
node tools/perf.js reaper 780 --json --frames=120
```

The numbers come from headless Chromium's software rasterizer, so compare runs with each other rather than with a real GPU. Keep the same checkpoints between runs: frames drawn at earlier checkpoints change the dice later on.

The **Graphics** setting picks the render resolution. *Auto* (the default) starts at the device's pixel ratio, steps the canvas resolution down while frames run below about 45 fps, and climbs back after several seconds of headroom; *Sharp* never lowers it, and *Fast* renders at 70% with fewer particles.

Appending `?bot=1` to the page URL lets you watch the bot play.
