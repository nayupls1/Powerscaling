/* POWERSCALING — feats: one-time goals that pay Essence. Checked during a run and when it ends; kept in the save */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const D = PS.Data;

  const evolved = (p) => p.skills.filter((k) => k.evolved).length;
  const elements = (p) => new Set(p.skills.map((k) => k.def.el)).size;
  const relicCount = (p) => { let n = 0; for (const id in p.relics) n += p.relics[id]; return n; };
  const wonAs = (cls) => (G) => G.won && G.cls === cls;
  const wonAt = (depth) => (G) => G.won && !G.daily && G.depth >= depth;

  // group, name, what to do, Essence, test(G, p, save). Tests read the live run, so a feat lands the moment it is earned.
  const F = [];
  const feat = (id, group, name, icon, text, essence, test) => F.push({ id, group, name, icon, text, essence, test });

  feat('run1',     'rift', 'Into the Rift',      'vortex',   'Finish a run.',                                   10,  (G) => G.over);
  feat('boss1',    'rift', 'Bonebreaker',        'bone',     'Slay the first boss.',                            20,  (G) => G.bossesKilled >= 1);
  feat('boss2',    'rift', 'Exterminator',       'spores',   'Slay two bosses in one run.',                     30,  (G) => G.bossesKilled >= 2);
  feat('boss3',    'rift', 'Stormbreaker',       'bolt',     'Slay three bosses in one run.',                   40,  (G) => G.bossesKilled >= 3);
  feat('win',      'rift', 'Riftbreaker',        'crown',    'Slay the Rift Lord.',                             100, (G) => G.won);
  feat('over15',   'rift', 'Borrowed Time',      'clock',    'Survive to 15:00.',                               80,  (G) => G.time >= 900);
  feat('over18',   'rift', 'Past the End',       'infinity', 'Survive to 18:00.',                               150, (G) => G.time >= 1080);
  feat('solenne',  'rift', 'Starfall',           'sun',      'Slay Solenne, the boss that waits in overtime.',  120, (G) => G.slain.solenne > 0);
  feat('veyra',    'rift', 'Shattered Glass',    'prism',    'Slay Veyra, the second boss of overtime.',        150, (G) => G.slain.veyra > 0);
  feat('flawless', 'rift', 'Untouched',          'feather',  'Slay a boss without taking a single hit from the moment it arrives.', 80, (G) => G.flawless > 0);
  feat('daily',    'rift', 'Regular',            'timer',    'Finish a daily rift.',                            30,  (G) => G.over && !!G.daily);
  feat('dailywin', 'rift', 'Day Breaker',        'sun',      'Slay the Rift Lord in a daily rift.',             80,  (G) => G.won && !!G.daily);

  feat('w_vanguard',   'class', 'Iron Will',     'sword',    'Slay the Rift Lord as the Vanguard.',             60,  wonAs('vanguard'));
  feat('w_pyromancer', 'class', 'Ashes to Ashes', 'flame',   'Slay the Rift Lord as the Pyromancer.',           60,  wonAs('pyromancer'));
  feat('w_ranger',     'class', 'True Aim',      'bow',      'Slay the Rift Lord as the Ranger.',               60,  wonAs('ranger'));
  feat('w_reaper',     'class', 'Harvest',       'scythe',   'Slay the Rift Lord as the Reaper.',               60,  wonAs('reaper'));
  feat('w_stormcaller', 'class', 'Eye of the Storm', 'thunder', 'Slay the Rift Lord as the Stormcaller.',      60,  wonAs('stormcaller'));
  feat('w_frostwarden', 'class', 'Dead of Winter', 'snow',   'Slay the Rift Lord as the Frostwarden.',          60,  wonAs('frostwarden'));
  feat('w_plaguebearer', 'class', 'Patient Zero', 'flask',   'Slay the Rift Lord as the Plaguebearer.',         60,  wonAs('plaguebearer'));
  feat('capstone', 'class', 'Ascended',          'arrowup',  'Reach the final tier of a class path.',           40,  (G, p) => p.talents.some((r, i) => r >= p.cls.branches[i].nodes.length));
  feat('lvl40',    'class', 'Seasoned',          'star',     'Reach level 40.',                                 40,  (G, p) => p.level >= 40);
  feat('master5',  'class', 'Devoted',           'star',     'Reach mastery rank 5 with any class.',            80,  (G, p, d) => G.over && Object.keys(d.mastery).some((c) => D.masteryRank(d.mastery[c]) >= 5));
  feat('lvl60',    'class', 'Paragon',           'trophy',   'Reach level 60.',                                 100, (G, p) => p.level >= 60);

  feat('depth1',   'depth', 'Deeper',            'key',      'Slay the Rift Lord at Rift Depth 1 or deeper.',   80,  wonAt(1));
  feat('depth3',   'depth', 'No Way Back',       'eye',      'Slay the Rift Lord at Rift Depth 3 or deeper.',   120, wonAt(3));
  feat('depth6',   'depth', 'Short Fuse',        'bomb',     'Slay the Rift Lord at Rift Depth 6 or deeper.',   200, wonAt(6));
  feat('depth10',  'depth', 'The Abyss Blinks',  'skull',    'Slay the Rift Lord at Rift Depth 10.',            500, wonAt(10));

  feat('evo1',     'build', 'Awakening',         'spark',    'Evolve a skill.',                                 20,  (G, p) => evolved(p) >= 1);
  feat('evo3',     'build', 'Trinity',           'orbs',     'Hold three evolved skills at once.',              60,  (G, p) => evolved(p) >= 3);
  feat('evo5',     'build', 'Apotheosis',        'nova',     'Hold five evolved skills at once.',               120, (G, p) => evolved(p) >= 5);
  feat('mono',     'build', 'Devotee',           'gem',      'Reach 6 affinity with one element.',              50,  (G, p) => D.ELEMENT_IDS.some((e) => p.aff[e] >= 6));
  feat('rainbow',  'build', 'Dabbler',           'prism',    'Hold skills of five different elements at once.', 50,  (G, p) => elements(p) >= 5);
  feat('rx8',      'build', 'Alchemist',         'flask',    'Set off eight different reactions in one run.',   60,  (G) => Object.keys(G.reactions).length >= 8);
  feat('rx800',    'build', 'Chain Reaction',    'chain',    'Set off 800 reactions in one run.',               60,  (G) => { let n = 0; for (const k in G.reactions) n += G.reactions[k]; return n >= 800; });
  feat('minimal',  'build', 'Minimalist',        'lock',     'Slay the Rift Lord holding four skills or fewer.', 150, (G, p) => G.won && p.skills.length <= 4);

  feat('relic30',  'loot',  'Collector',         'chest',    'Hold 30 relics.',                                 40,  (G, p) => relicCount(p) >= 30);
  feat('relic45',  'loot',  'Hoarder',           'jar',      'Hold 45 relics.',                                 100, (G, p) => relicCount(p) >= 45);
  feat('legend',   'loot',  'Storied',           'phoenix',  'Find a legendary relic.',                         40,  (G, p) => p.relicOrder.some((id) => D.RELICS[id].tier === 4));
  feat('codex50',  'loot',  'Well Read',         'book',     'Fill half of the codex.',                         100, (G) => { if (!G.over) return false; const c = PS.UI.codexCount(); return c.done * 2 >= c.total; });
  feat('codex100', 'loot',  'Loremaster',        'crown',    'Fill the whole codex.',                           400, (G) => { if (!G.over) return false; const c = PS.UI.codexCount(); return c.done >= c.total; });
  feat('curator',  'loot',  'Curator',           'book',     'Record 30 different relics in the codex.',        80,  (G, p, d) => G.over && Object.keys(d.codex.relics).length >= 30);
  feat('reson',    'loot',  'In Tune',           'gem',      'Complete a relic resonance.',                     40,  (G, p) => p.sets && p.sets.length >= 1);
  feat('gold5k',   'loot',  'Deep Pockets',      'coin',     'Earn 5,000 gold in one run.',                     40,  (G) => G.goldEarned >= 5000);
  feat('pact1',    'loot',  'Signed in Blood',   'blood',    'Strike a pact at a dark altar.',                  20,  (G) => G.pactsStruck >= 1);
  feat('pact3',    'loot',  'In Too Deep',       'mask',     'Strike three pacts in one run.',                  60,  (G) => G.pactsStruck >= 3);
  feat('hoarder',  'loot',  'Finders Keepers',   'coin',     'Catch and slay a Rift Hoarder.',                  20,  (G) => G.hoarders >= 1);
  feat('forge2',   'loot',  'Tempered',          'anvil',    'Use a rift forge twice in one run.',              40,  (G) => G.forged >= 2);
  feat('shop1',    'loot',  'Good Customer',     'coin',     'Buy something from the merchant.',                20,  (G) => G.bought >= 1);
  feat('tides4',   'rift',  'Weathered',         'moon',     'Live through four rift tides in one run.',        40,  (G) => G.tides >= 4);
  feat('breach1',  'loot',  'Sealer',            'rift',     'Seal a breach.',                                  20,  (G) => G.breaches >= 1);
  feat('breach4',  'loot',  'Warden of the Rift', 'shield',  'Seal four breaches in one run.',                  60,  (G) => G.breaches >= 4);

  feat('kill15k',  'slay',  'Reaping',           'ghost',    'Slay 15,000 enemies in one run.',                 40,  (G) => G.kills >= 15000);
  feat('kill40k',  'slay',  'Extinction',        'meteor',   'Slay 40,000 enemies in one run.',                 120, (G) => G.kills >= 40000);
  feat('life100k', 'slay',  'Veteran',           'swords',   'Slay 100,000 enemies across all runs.',           60,  (G, p, d) => d.stats.kills + (G.over ? 0 : G.kills) >= 1e5);
  feat('life1m',   'slay',  'Legend of the Rift', 'trophy',  'Slay 1,000,000 enemies across all runs.',         200, (G, p, d) => d.stats.kills + (G.over ? 0 : G.kills) >= 1e6);
  feat('bestiary', 'slay',  'Know Thy Enemy',    'eye',      'Slay every kind of enemy and every boss.',        80,  (G, p, d) => G.over && Object.keys(PS.Enemies.DEFS).concat(PS.Bosses.DEFS.map((b) => b.id)).every((id) => d.codex.foes[id] > 0));
  feat('deflect',  'slay',  'Return to Sender',  'echo',     'Deflect 2,500 bullets in one run.',               40,  (G) => G.deflected >= 2500);
  feat('score100', 'slay',  'Six Figures',       'target',   'Score 100,000 in one run.',                       50,  (G) => PS.Game.finalScore(G) >= 100000);
  feat('score250', 'slay',  'Off the Charts',    'star',     'Score 250,000 in one run.',                       150, (G) => PS.Game.finalScore(G) >= 250000);

  feat('rush1', 'rift', 'Gauntlet',  'swords', 'Clear a boss rush.',                    80,  (G) => G.won);
  feat('rush2', 'rift', 'No Breath', 'timer',  'Clear a boss rush in under six minutes.', 150, (G) => G.won && G.time < 360);
  F[F.length - 1].rush = F[F.length - 2].rush = true;

  // feats a Relaxed run cannot earn: wins, endurance, score and the depths
  const HARD = new Set(['win', 'over15', 'over18', 'dailywin', 'minimal', 'score100', 'score250', 'solenne', 'veyra', 'flawless', 'depth1', 'depth3', 'depth6', 'depth10'].concat(F.filter((f) => f.id.startsWith('w_')).map((f) => f.id)));

  const GROUPS = { rift: 'The rift', class: 'Heroes', depth: 'Rift Depths', build: 'Builds', loot: 'Spoils and pacts', slay: 'Slaughter' };
  const BY_ID = {};
  for (const f of F) BY_ID[f.id] = f;

  const Feats = {
    LIST: F, GROUPS, BY_ID,
    /** how many are done, and the Essence still on offer */
    summary() {
      const have = PS.Save.data.feats;
      let done = 0, left = 0;
      for (const f of F) { if (have[f.id]) done++; else left += f.essence; }
      return { done, total: F.length, left };
    },
    /** test every feat not yet earned against the live run; pays and announces the new ones */
    check(G) {
      if (!G || G.bot) return;
      const rush = !!G.rush;
      const d = PS.Save.data, have = d.feats, p = G.player;
      let got = 0;
      for (const f of F) {
        if (have[f.id] || rush !== !!f.rush) continue;
        if (G.relaxed && HARD.has(f.id)) continue; // the rift proper only
        let ok = false;
        try { ok = !!f.test(G, p, d); } catch (e) { ok = false; }
        if (!ok) continue;
        have[f.id] = Date.now();
        d.essence += f.essence;
        d.essenceTotal += f.essence;
        G.feats.push(f.id);
        got++;
        if (!G.over) { PS.UI.toast(`Feat: ${f.name} (+${f.essence} Essence)`, 'trophy'); }
      }
      if (got) { if (!G.over) PS.Audio.play('relic', { vol: 0.5, pitch: 1.3 }); PS.Save.save(); }
    },
  };
  PS.Feats = Feats;
})();
