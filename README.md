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

With a mouse or gamepad, health and the three cooldowns sit bottom-centre, and a small health bar and one segment per dash charge ride under the hero, each segment filling as its charge comes back, so a fight never sends your eyes to a corner. The bars under the hero can be switched off in Settings (Hero bars).

## What is in it

- **Six classes** — Vanguard (melee bruiser), Pyromancer (explosive caster), Ranger (piercing sharpshooter), Reaper (summoner, unlocked by killing a boss), Stormcaller (instant chain lightning, unlocked by slaying the Rift Lord) and Frostwarden (a cone of freezing breath at close range, unlocked by slaying ten bosses in all). Each has its own attack, ability, dash and three talent paths; you advance one path every 6 levels, and only one path can reach its final tier.
- **24 skills across six elements** — Ember, Rime, Tempest, Blight, Iron and Abyss. Owning 2, 4 and 6 skills of one element unlocks set bonuses, so builds can go deep on one element or split across two.
- **Slots you grow into** — a run starts with only the class attack. Skill slots open at levels 2, 5, 9, 14 and 20, tome slots at 2, 4, 7, 11, 16 and 22, and the HUD shows each locked slot with the level that opens it.
- **Reactions** — hit one enemy with two different elements within 4 seconds and the pair reacts: fifteen reactions, one for every pair (Ember and Blight *Combust* the poison stacks, Rime and Tempest *Superconduct* into a stun, Iron and Abyss *Sunder* the crowd). A split build is a real build, not a failed mono-element one. The pause screen lists the reactions your current skills can set off, and a new-skill card says what it would react with.
- **Evolutions** — a skill at level 6 evolves when you hold its matching tome, then can be overcharged without limit.
- **Tomes, relics and shrine blessings** — slotted stat passives with rarity-scaled upgrades, 52 relics from chests, elites and bosses, and blessings from shrines on the map.
- **Altars and breaches** — dark altars offer three of thirteen pacts: a strong gift with a price that lasts the run (35% more damage for a fifth of your health, a rare relic for elites that come 40% more often), or you can walk away. Breaches are a trial: step in to wake one and beat it before the timer on its rim burns down, and it leaves a relic behind. There are three kinds: slay enough of what pours out, kill the champion that climbs out, or hold your ground inside the ring.
- **Guarded chests** — some chests on the map ask no gold. Open one and an elite steps out of it; you keep the relic either way, and the elite drops another if you can kill it.
- **Hoarders** — every couple of minutes a Rift Hoarder scurries out with a sack of gold and a relic and runs for it, shedding coins as it is hurt. Kill it before the ring around it empties, or it slips away.
- **Bullets you can fight back against** — your class attack cuts enemy bullets out of the air (melee swings bat them back), and a timed Ward reflects everything around you. Both recharge your ability.
- **Red means danger** — every enemy blast, beam and shockwave is drawn in one reserved red with a dashed rim that flashes white before it lands, whoever cast it. The hero's own ground effects are soft-edged, and their strikes are marked with a thin reticle, so a glance tells you which circles to leave.
- **No standing still** — the rift shells the ground under you and Bombardiers lob blasts at your position; both are trivial to sidestep and fatal to ignore.
- **A horde with roles** — fifteen enemy types arrive through the run. Besides chasers, chargers and gunners there are Rift Toads, which crouch, mark the spot you stand on and leap onto it, and Warders, which shield every enemy inside their dotted ring until you cut them down.
- **Elites with affixes** — every elite carries one of ten affixes, named over its head: Shielded, Volatile, Blinking, Mending, Molten, Brooding, Frenzied, Splitting, Warding or Grasping. Deeper rifts and overtime stack more than one.
- **Four horde shapes** — the closing ring and the stampede, then a pincer from two sides and a wall that sweeps the whole screen with a single gap in it.
- **Bosses** — one every three minutes with telegraphed attack patterns. Kill the Rift Lord at 12:00 to win the run, then keep going in overtime for score. Two minutes in, overtime opens with a fifth boss the run has not shown you: Solenne, the Dying Star, who pulls you in before she bursts and lays blasts in a checkerboard.
- **Rift Depths** — beating the Rift Lord opens Depth 1, and winning at your deepest depth opens the next, up to 10. Each depth adds one named modifier on top of all the ones before it (sturdier hordes, elites in pairs, bosses that enrage early), hardens the horde by a further 6% health and 3% damage, and adds 15% to score and 10% to Essence. Depth 10 is meant for a full skill tree and clean play.
- **Daily rift** — one seed a day, the same for everyone: a set class, one of twelve mutators, and the full skill tree for every hero. Play it as often as you like; your best run of the day goes on the daily board, and the first run each day pays double Essence.
- **A run summary worth reading** — damage per second and damage taken charted over the run with boss kills and evolutions marked, every damage source, what hurt you, and the reactions you set off.
- **Codex** — a record of every relic you have held, evolution awakened, reaction set off and pact struck, and a bestiary with a note and a kill count for each enemy. Undiscovered entries stay hidden.
- **Feats** — 50 one-time goals, from slaying the first boss to winning at Depth 10 or beating the Rift Lord with four skills. Each pays Essence the moment it is earned, and the results screen lists the ones a run brought in.
- **Sigils** — ten perks, each unlocked by a feat. Wear one into a run: 80 gold in your purse, a spare dash, stronger reactions, or a dark altar waiting at your feet. The daily rift allows none.
- **Permanent skill tree** — Essence earned every run buys upgrades across four arms (Might, Vitality, Fortune, Mastery), and four bridge nodes in the corners between them (more damage when hurt, an extra relic to choose from, stronger healing, more shrines).
- **Your runs** — the last 30 runs are kept with how they ended, their build and their seed, and any of them can be played again on the same seed: the same hordes, elites and loot rolls, a different fight.
- **Leaderboard** — every run is scored and ranked, filterable by class. Served by `server.ts` it is global, shared by everyone on that server; opened as a file or from a static host it is stored in the browser's local storage, so it is per device.

## Progression

A run is paced in four acts of three minutes, each closed by a boss. The hero starts scrappy (one attack, enemies that need a couple of hits, a horde the hero cannot quite clear) and ends dominant, but the climb is not a straight line:

- **Spikes** come from discrete gains: a new slot opening, a talent every 6 levels, an evolution (usually the first one lands in act 2), a relic from an elite or a chest, and the three-relic spoils of each boss.
- **Falls** follow them: every boss slain deepens the rift, making the horde sturdier in one step, and new enemy types arrive through the run.
- **Waves**: spawn pressure breathes in a cycle anchored on the hordes, with a lull after each horde breaks and a surge that builds into the next. The swells start gentle and reach full strength once the kit has filled out.

Every level-up restores 3% of max health, a breather that matters most in the opening, when levels come fast and the kit is small.

### Reactions

Every direct hit from a skill, an ability or a minion marks the enemy with its element for 4 seconds. A hit of a different element while the mark lasts sets off that pair's reaction (`REACTIONS` in `js/data.js`, effects in `Combat.react`). Damage from relic and affinity procs neither marks nor triggers, so reactions come from the skills you picked and can never chain into each other. Two limits keep them a build payoff rather than a second damage engine: an enemy reacts at most once every 3 seconds, and all reactions share a budget that refills at 1.5 a second, so a reaction is a rare, heavy event. `tools/curve.js` prints how many reactions a run set off and their share of the damage, and `--noreact` replays the same seeds with reactions switched off. Measured that way they are worth about 5% of horde toughness to any build that mixes elements, which the horde gets back (`REACTION_OFFSET` in `js/director.js`).

### Depths and mutators

A run's rules are one flat object (`Data.rules(depth, mutator)`): horde health, damage and speed, elite and horde timing, affix count, chest cost, healing, and a few hero-side knobs. Rift Depths and daily mutators are just functions that turn those knobs, so adding one is a line in `DEPTHS` or `MUTATORS`. With the full tree, the bot's careless player model (`--sloppy`) wins about four runs in five at depth 0, about half at depth 6 and one in five at depth 10; the careful one still wins most of its runs there. Nothing in the rules moves the boss schedule, which the server's run validation relies on.

### Seeds

Every run has a seed, shown on the pause and results screens. It feeds three independent streams (`js/seed.js`): `sim` for moment-to-moment simulation, `event` for the run's script (which horde comes next, which elite, which affixes) and `loot` for reward cards and relic rolls. Two players on the same seed meet the same hordes and elites in the same order even though their fights differ; with the bot at a fixed time step, the same seed replays the same run exactly. Particles, shake and sound use `Math.random` and cannot disturb a seeded run.

Horde toughness is a per-minute knot table in `js/director.js` (`HP_KNOTS`), interpolated geometrically, so each act can be tuned on its own. Overtime starts when the Rift Lord falls and ramps until it ends the run. The permanent skill tree roughly doubles a hero's strength when fully bought: enough that a weaker player can grind their way to a win, not so much that a strong one is never threatened.

## Project layout

```
server.ts         optional Bun server: static files, SQLite saves, global leaderboard
index.html        page shell, HUD and menu markup
css/style.css     interface styles
js/seed.js        seeded random streams, the daily rift's definition (also imported by server.ts)
js/util.js        math helpers, spatial hash
js/save.js        local storage plus server sync: progress, settings, leaderboard
js/audio.js       synthesized sound effects and music
js/icons.js       vector glyph library used by the UI and canvas
js/feats.js       feats: one-time goals that pay Essence
js/data.js        elements, rarities, affinities, tomes, relics, pacts, meta tree, reactions, elite affixes, depths, mutators
js/skills.js      skill definitions and behaviour
js/classes.js     classes, abilities, talent paths
js/player.js      stats, movement, dash, damage intake, levelling
js/combat.js      damage pipeline, statuses, reactions, projectiles, zones, hazards
js/enemies.js     enemy roster, AI and elite affixes
js/bosses.js      boss fights
js/director.js    difficulty curves, spawning, drops, chests, shrines, altars, breaches
js/rewards.js     reward card generation
js/fx.js          effects: particles, explosions, bolts, scorch marks, damage numbers, screen shake
js/models.js      character art: the horde, bosses, heroes and minions
js/render.js      canvas renderer
js/input.js       keyboard, mouse, touch, gamepad
js/ui.js          menus, HUD, cards, pause and results screens
js/game.js        main loop, run lifecycle, scoring
js/bot.js         autoplayer used by the playtest tools
tools/            headless playtest scripts, model and effect sheets, server tests
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
| `GET /api/health` | | `{ok: true, now}`. `now` is the server clock in ms; clients use it to agree on when the daily rift turns over |
| `GET /api/profile/:id` | Bearer | `{data, updatedAt}`, or `404` if none |
| `PUT /api/profile/:id` | Bearer | body `{updatedAt, data}`; `data` must be an object, at most 64 KB. The local `board` is dropped (runs have their own table). `409 {updatedAt}` if older than the stored copy |
| `POST /api/runs` | Bearer + `X-Player-Id` | body `{name, cls, score, time, level, kills, bosses, won, build, depth?, daily?}`, validated strictly, with a generous check that the score matches time, level, kills, bosses and depth (0 to 10, default 0). `daily` is a `YYYY-MM-DD` date: it must be today or yesterday by the server's clock (a run can start before midnight UTC and end after it), the class must be that day's, and the depth 0. Returns `201 {id, rank, total, classRank, classTotal}`; for a daily run the rank is the player's standing on that day's board |
| `PATCH /api/runs/:id` | Bearer + `X-Player-Id` | `{name}`. Renames your own run (the results screen allows renaming after the run is recorded) |
| `GET /api/leaderboard?cls=all\|<class>&limit=100` | optional `X-Player-Id` | `{cls, total, rows}`. Each row is `{name, cls, score, time, level, kills, bosses, won, date, build, depth}`, plus `mine` when the id header is sent. Other players' ids are never returned. Daily rift runs are never on this board |
| `GET /api/leaderboard?daily=<YYYY-MM-DD\|today>&limit=100` | optional `X-Player-Id` | `{daily, cls, mutator, total, rows}`: that day's rift, one row per player (their best run), and `total` players |

A database created before Rift Depths and the daily rift gains the `depth` and `daily` columns the first time the server starts on it; its runs count as depth 0.

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

Flags: `--sloppy` (slow, careless player model), `--random` (random card picks), `--el=<element>` (prefer one element), `--branch=<0-2>` (prefer a talent path), `--tree=full` (all permanent upgrades), `--want=<skill ids>` and `--tomes=<tome ids>` (force a build), `--afk=<seconds>` (stand still from that time), `--seed=<text>` (reproducible: the same seed, class and flags replay the same run), `--depth=<0-10>`, `--mutator=<id>`, `--sigil=<id>`, `--daily[=YYYY-MM-DD]` (that day's rift: its seed, class and mutator, full tree), `--quiet`.

`tools/curve.js` is the balance report. It plays many runs in parallel and averages, per time bucket, the hero's level and loadout against how hard the rift is pushing back: seconds to kill a normal enemy and an elite, how full the screen is relative to the director's target, clearing headroom (raw damage against the toughness of what spawns), damage taken and lowest health. It also lists death times and the average length of each boss fight:

```sh
node tools/curve.js all 13 10 --quiet                 # 10 runs per class, summary lines only
node tools/curve.js ranger 13 8 --bucket=30           # finer timeline for one class
node tools/curve.js all 13 6 --sloppy --tree=full     # careless player with every permanent upgrade
node tools/curve.js all 13 6 --tree=arm:might         # one arm of the tree; also half, m1,m2 or -a5 (full minus a node)
node tools/curve.js all 13 6 --seed=a --depth=5       # a reproducible report at Rift Depth 5
```

With `--seed`, each run gets its own seed derived from it, so two reports with the same seed and flags are identical and a change in the numbers is a change in the game. `--depth` and `--mutator` play under those rules.

`tools/stress.js` runs every class with all talents, every relic and every evolved skill at once, sets off every reaction, spawns every elite affix and horde shape, and plays each pass under a different mutator (every second one at depth 10), drawing frames as it goes. It fails on any page error or invalid number:

```sh
node tools/stress.js 3
```

`tools/perf.js` measures frame cost. It plays a seeded run with the bot and, at each checkpoint, renders a burst of real frames, splitting the time into simulation, HUD and each canvas layer:

```sh
node tools/perf.js pyromancer 300,540,780   # checkpoints in seconds: after the 1st, 2nd and 4th boss
node tools/perf.js reaper 780 --json --frames=120
```

The numbers come from headless Chromium's software rasterizer, so compare runs with each other rather than with a real GPU. The run is seeded (`--seed=1` by default), so two profiles of the same class and checkpoints see the same fight. The effects are split into `decals`, `corpses`, `fx:glow`, `fx:lines` and `fx:parts`.

`tools/models.js` draws every character model with the real renderer, one per labelled cell, and writes a PNG. Run it before and after an art change to compare:

```sh
node tools/models.js --out=models.png               # the sheet: heroes, minions, the horde, an elite, bosses
node tools/models.js --scene --out=fight.png        # a staged fight instead
node tools/models.js --scene --frames=36 --dt=0.033 # numbered frames, for checking animation
node tools/models.js --root=../other-checkout       # draw another checkout's models with this tool
```

The art itself is vector code in `js/models.js`, drawn facing +x in units of the model's collision radius, with a looping phase for its walk cycle. The horde and the Reaper's minions are cached as animation frames (8 per cycle, supersampled 2x, or 3x on dense screens), so a model can be as detailed as it likes at no per-frame cost. The hero and the boss are drawn live, into a scratch canvas that is then blitted: keep gradient fills off the main canvas, where a single one slows Chromium's software rasterizer for the rest of the session.

`tools/fx.js` is the same idea for effects. It sets each one off on an empty field with the real renderer and lays its life out as a strip of frames, one effect per row:

```sh
node tools/fx.js --out=fx.png                               # every effect
node tools/fx.js --only=explosion,death,bolt --cell=320     # a few rows, larger
node tools/fx.js --root=../other-checkout --out=before.png  # another checkout's effects, for a before/after pair
```

Effects live in `js/fx.js`, with the renderer's half (death flashes, trails, motes, the boss burning away) in `js/render.js`. They draw only from `Math.random`, so they cannot disturb a seeded run. Three rules keep them cheap, each one measured with `tools/perf.js`:

- **Blend mode times bounding box is the cost.** In the software rasterizer an additive (`lighter`) stroke or fill costs nearly twice a plain one, and a thin ring or a long diagonal sliver costs as much as its whole bounding square. So only soft light is added; every line (shock rings, bolts, slashes, trails) is drawn bright in the ordinary blend, where it looks the same.
- **Soft light is a cached sprite that holds its size and only fades.** A fireball, a flare or a scorch mark is one 1:1 blit from one cache entry; a glow that grew every frame would mint a new sprite for each size.
- **Particles are flat typed arrays, drawn in device pixels**: dots as squares on whole pixels (half the cost of anti-aliased ones), sparks as tapered triangles along their velocity.

Effects also thin themselves out as the screen fills: single-hit flashes and ring echoes only show while few are in flight, every list has a cap, and blasts on top of each other share one scorch mark.

The **Graphics** setting picks the render resolution. *Auto* (the default) starts at the device's pixel ratio, steps the canvas resolution down while frames run below about 45 fps, and climbs back after several seconds of headroom; *Sharp* never lowers it, and *Fast* renders at 70% with fewer particles. Once resolution has been given up, the purely decorative layers (scorch marks, drifting motes) go too.

Appending `?bot=1` to the page URL lets you watch the bot play.
