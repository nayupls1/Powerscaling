# Powerscaling

A top-down roguelike horde survivor that runs in the browser. Pick a class, mow through the rift, take one of three rewards every level, and stack skills, tomes, relics and talents until the numbers get silly.

No build step, no dependencies, no assets: everything is drawn on a canvas and every sound is synthesized at runtime.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

It also works as-is on any static host (GitHub Pages, Netlify, itch.io).

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move |
| Mouse | Aim (attacks fire on their own) |
| `Space` / `Shift` | Dash, invulnerable while dashing |
| `Q` / `E` / right click | Class ability |
| `T` | Toggle auto-aim |
| `1` `2` `3` | Pick a reward card (`R` reroll, `B` banish) |
| `Esc` / `P` | Pause and inspect your build |

Touch screens get a floating movement stick with auto-aim, and gamepads are supported (left stick move, right stick aim, A/LB dash, X/RB ability).

## What is in it

- **Four classes** — Vanguard (melee bruiser), Pyromancer (explosive caster), Ranger (piercing sharpshooter) and Reaper (summoner, unlocked by killing a boss). Each has its own attack, ability, dash and three talent paths; you advance one path every 6 levels, and only one path can reach its final tier.
- **18 skills across six elements** — Ember, Rime, Tempest, Blight, Iron and Abyss. Owning 2, 4 and 6 skills of one element unlocks set bonuses, so builds can go deep on one element or split across two.
- **Evolutions** — a skill at level 6 evolves when you hold its matching tome, then can be overcharged without limit.
- **Tomes, relics and shrine blessings** — slotted stat passives with rarity-scaled upgrades, 38 relics from chests, elites and bosses, and blessings from shrines on the map.
- **Bosses** — one every three minutes with telegraphed attack patterns. Kill the Rift Lord at 12:00 to win the run, then keep going in overtime for score.
- **Permanent skill tree** — Essence earned every run buys upgrades across four arms (Might, Vitality, Fortune, Mastery).
- **Leaderboard** — every run is scored and ranked, filterable by class. It is stored in the browser's local storage, so it is per device.

## Project layout

```
index.html        page shell, HUD and menu markup
css/style.css     interface styles
js/util.js        math helpers, spatial hash
js/save.js        local storage: progress, settings, leaderboard
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
tools/            headless playtest scripts
```

## Playtesting

`tools/playtest.js` runs the real simulation headlessly at full speed with the built-in bot and prints a timeline plus the final build. It needs Node and Playwright with Chromium.

```sh
node tools/playtest.js all 14 1            # every class, 14 minutes each
node tools/playtest.js ranger 20 3 --quiet # summaries only
node tools/playtest.js reaper 14 1 --sloppy --el=venom --tree=full
tools/batch.sh "--sloppy" 14               # two runs per class in parallel
```

Flags: `--sloppy` (slow, careless player model), `--random` (random card picks), `--el=<element>` (prefer one element), `--branch=<0-2>` (prefer a talent path), `--tree=full` (all permanent upgrades), `--quiet`.

`tools/stress.js` runs every class with all talents, every relic and every evolved skill at once and fails on any page error or invalid number:

```sh
node tools/stress.js 3
```

Appending `?bot=1` to the page URL lets you watch the bot play.
