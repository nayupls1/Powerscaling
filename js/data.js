/* POWERSCALING — static data: elements, rarities, affinities, tomes, relics, shrine boons, meta tree */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const D = (PS.Data = PS.Data || {});
  const pc = (v) => Math.round(v * 100) + '%';
  const r1 = (v) => (Math.round(v * 10) / 10).toString();

  D.ELEMENTS = {
    fire:  { id: 'fire',  name: 'Ember',   icon: 'flame',  color: '#ff7a3d', glow: '#ffb061', status: 'Burn' },
    frost: { id: 'frost', name: 'Rime',    icon: 'snow',   color: '#6fd8ff', glow: '#bdf0ff', status: 'Chill' },
    storm: { id: 'storm', name: 'Tempest', icon: 'bolt',   color: '#ffe14d', glow: '#fff3a8', status: 'Shock' },
    venom: { id: 'venom', name: 'Blight',  icon: 'drop',   color: '#8fe04a', glow: '#c8ff8a', status: 'Poison' },
    steel: { id: 'steel', name: 'Iron',    icon: 'sword',  color: '#d9dfef', glow: '#ffffff', status: 'Bleed' },
    void:  { id: 'void',  name: 'Abyss',   icon: 'vortex', color: '#c06bff', glow: '#e3b8ff', status: 'Implode' },
  };
  D.ELEMENT_IDS = Object.keys(D.ELEMENTS);

  D.RARITY = [
    { id: 'common',    name: 'Common',    mult: 1.0,  color: '#aeb6cc', w: 60 },
    { id: 'uncommon',  name: 'Uncommon',  mult: 1.35, color: '#6fe08a', w: 26 },
    { id: 'rare',      name: 'Rare',      mult: 1.8,  color: '#5db4ff', w: 10 },
    { id: 'epic',      name: 'Epic',      mult: 2.5,  color: '#c77dff', w: 3.2 },
    { id: 'legendary', name: 'Legendary', mult: 3.5,  color: '#ffb43d', w: 0.8 },
  ];
  /** luck 0..300ish. Every 100 luck roughly doubles each step up the ladder. */
  /** how much one pick of a tome or boon adds at a given rarity (flat stats are whole numbers) */
  D.incFor = function (def, tier) {
    const v = def.per * (def.fixed ? 1 : D.RARITY[tier].mult);
    return def.whole ? Math.round(v) : v;
  };
  D.rollRarity = function (luck, minTier) {
    const f = 1 + Math.max(0, luck) / 100;
    let total = 0;
    const ws = D.RARITY.map((r, i) => {
      const w = i < (minTier || 0) ? 0 : r.w * Math.pow(f, i);
      total += w;
      return w;
    });
    let roll = PS.RNG.loot() * total;
    for (let i = 0; i < ws.length; i++) {
      roll -= ws[i];
      if (roll <= 0) return i;
    }
    return 0;
  };

  /* ---------- Affinities: own skills of one element to unlock set bonuses ---------- */
  D.AFFINITY = {
    fire: [
      { n: 2, text: 'Burn deals 60% more damage.' },
      { n: 4, text: 'Burning enemies explode when they die.' },
      { n: 6, text: 'Every hit you deal applies Burn, and Burn ticks twice as fast.' },
    ],
    frost: [
      { n: 2, text: 'Chill slows harder and lasts longer. Chilled enemies take 12% more damage.' },
      { n: 4, text: 'Chilled enemies shatter on death, chilling and damaging others.' },
      { n: 6, text: 'Chilled enemies take 35% more damage instead. Freeze chance doubled.' },
    ],
    storm: [
      { n: 2, text: 'Shocked enemies take 30% more damage instead of 15%.' },
      { n: 4, text: 'Every 12th hit calls down a lightning bolt.' },
      { n: 6, text: '+25% attack speed. Hitting a shocked enemy arcs to a neighbour.' },
    ],
    venom: [
      { n: 2, text: 'Poison deals 50% more damage and stacks 3 higher.' },
      { n: 4, text: 'Poisoned enemies spread their poison when they die.' },
      { n: 6, text: 'Poison also eats 0.6% of max health per second (a tenth of that on bosses).' },
    ],
    steel: [
      { n: 2, text: '+12% critical chance and +6 armor.' },
      { n: 4, text: 'Critical hits cause Bleed. +50% critical damage.' },
      { n: 6, text: '+30% damage. Hits execute enemies below 15% health.' },
    ],
    void: [
      { n: 2, text: '+18% area of effect.' },
      { n: 4, text: 'Kills can tear open an implosion that drags enemies in.' },
      { n: 6, text: '+20% attack speed. Implosions are larger and always trigger on elites.' },
    ],
  };

  /* ---------- Tomes: slotted passives, upgraded with rarity-scaled increments ---------- */
  D.TOMES = {
    might:     { name: 'Tome of Might',     icon: 'fist',      max: 10, per: 0.10, stat: 'Damage',          fmt: pc, apply: (s, v) => { s.dmg += v; } },
    haste:     { name: 'Tome of Haste',     icon: 'hourglass', max: 10, per: 0.08, stat: 'Attack speed',    fmt: pc, apply: (s, v) => { s.atkSpd += v; } },
    precision: { name: 'Tome of Precision', icon: 'crosshair', max: 10, per: 0.05, stat: 'Critical chance', fmt: pc, apply: (s, v) => { s.crit += v; s.critMult += v * 2; }, extra: 'Also adds twice that much critical damage.' },
    reach:     { name: 'Tome of Reach',     icon: 'expand',    max: 8,  per: 0.08, stat: 'Area of effect',  fmt: pc, apply: (s, v) => { s.area += v; } },
    multishot: { name: 'Tome of Volleys',   icon: 'multishot', max: 3,  per: 1,    stat: 'Projectiles',     fmt: (v) => r1(v), fixed: true, minRar: 2, cardText: '+1 projectile on every skill that fires them.', apply: (s, v) => { s.proj += v; } },
    duration:  { name: 'Tome of Lingering', icon: 'clock',     max: 8,  per: 0.10, stat: 'Effect duration', fmt: pc, apply: (s, v) => { s.duration += v; s.statusDmg += v * 0.5; }, extra: 'Burn, Poison and Bleed also deal more damage.' },
    vitality:  { name: 'Tome of Vitality',  icon: 'heart',     max: 10, per: 18,   whole: true, stat: 'Max health', fmt: (v) => r1(v), apply: (s, v) => { s.maxHp += v; s.regen += v * 0.015; }, extra: 'Also adds a little regeneration.' },
    plating:   { name: 'Tome of Plating',   icon: 'shield',    max: 8,  per: 4,    whole: true, stat: 'Armor',  fmt: (v) => r1(v), apply: (s, v) => { s.armor += v; } },
    swiftness: { name: 'Tome of Swiftness', icon: 'boot',      max: 8,  per: 0.06, stat: 'Move speed',      fmt: pc, apply: (s, v) => { s.speed *= 1 + v; } },
    magnet:    { name: 'Tome of Pull',      icon: 'magnet',    max: 6,  per: 0.25, stat: 'Pickup range',    fmt: pc, apply: (s, v) => { s.pickup *= 1 + v; } },
    wisdom:    { name: 'Tome of Wisdom',    icon: 'book',      max: 8,  per: 0.08, stat: 'Experience',      fmt: pc, apply: (s, v) => { s.xp += v; } },
    fortune:   { name: 'Tome of Fortune',   icon: 'clover',    max: 8,  per: 10,   whole: true, stat: 'Luck',   fmt: (v) => r1(v), apply: (s, v) => { s.luck += v; s.gold += v * 0.01; }, extra: 'Luck improves reward rarity. Also adds gold gain.' },
  };

  /* ---------- Shrine boons: small permanent blessings, no slots ---------- */
  D.BOONS = {
    b_dmg:   { name: 'Blessing of Wrath',   icon: 'swords',  per: 0.06, stat: 'Damage',          fmt: pc, apply: (s, v) => { s.dmg += v; } },
    b_hp:    { name: 'Blessing of Life',    icon: 'heart',   per: 12,   whole: true, stat: 'Max health', fmt: r1, apply: (s, v) => { s.maxHp += v; } },
    b_crit:  { name: 'Blessing of Fate',    icon: 'star',    per: 0.03, stat: 'Critical chance', fmt: pc, apply: (s, v) => { s.crit += v; } },
    b_spd:   { name: 'Blessing of Wind',    icon: 'wings',   per: 0.04, stat: 'Move speed',      fmt: pc, apply: (s, v) => { s.speed *= 1 + v; } },
    b_atk:   { name: 'Blessing of Fury',    icon: 'bolt',    per: 0.05, stat: 'Attack speed',    fmt: pc, apply: (s, v) => { s.atkSpd += v; } },
    b_area:  { name: 'Blessing of Tides',   icon: 'wave',    per: 0.05, stat: 'Area of effect',  fmt: pc, apply: (s, v) => { s.area += v; } },
    b_armor: { name: 'Blessing of Stone',   icon: 'mountain', per: 3, whole: true, stat: 'Armor',      fmt: r1, apply: (s, v) => { s.armor += v; } },
    b_xp:    { name: 'Blessing of Insight', icon: 'eye',     per: 0.06, stat: 'Experience',      fmt: pc, apply: (s, v) => { s.xp += v; } },
    b_luck:  { name: 'Blessing of Fortune', icon: 'clover',  per: 8,    whole: true, stat: 'Luck',   fmt: r1, apply: (s, v) => { s.luck += v; } },
    b_cdr:   { name: 'Blessing of Focus',   icon: 'hourglass', per: 0.08, stat: 'Ability haste', fmt: pc, apply: (s, v) => { s.abilityHaste += v; } },
  };

  /* ---------- Pacts: offered by the dark altars. A strong gift with a lasting price; each can be struck once a run ---------- */
  // stats(s): the hero's side, applied on every recalc. rules(r): turned once, when the pact is struck. now(G, p): a one-off.
  D.PACTS = {
    blood:    { name: 'Pact of Blood',    icon: 'blood',     gift: '+35% damage.',                         price: '20% less max health.',
      stats: (s) => { s.dmg += 0.35; s.hpMult -= 0.2; } },
    frenzy:   { name: 'Pact of Frenzy',   icon: 'hourglass', gift: '+30% attack speed.',                   price: 'The horde moves 10% faster.',
      stats: (s) => { s.atkSpd += 0.3; }, rules: (r) => { r.speed *= 1.1; } },
    avarice:  { name: 'Pact of Avarice',  icon: 'coin',      gift: '150 gold now, and +60% gold found.',   price: 'Healing is 30% weaker.',
      stats: (s) => { s.gold += 0.6; }, rules: (r) => { r.heal *= 0.7; }, now: (G, p) => { p.gold += 150; G.goldEarned += 150; } },
    hunt:     { name: 'Pact of the Hunt', icon: 'skull',     gift: 'A relic of Rare quality or better, now.', price: 'Elites arrive 40% more often.',
      rules: (r) => { r.eliteEvery *= 0.7; }, now: () => { PS.Game.openChest(3, 2); } },
    insight:  { name: 'Pact of Insight',  icon: 'eye',       gift: '+35% experience.',                     price: 'The horde has 15% more health.',
      stats: (s) => { s.xp += 0.35; }, rules: (r) => { r.hp *= 1.15; } },
    glass:    { name: 'Pact of Edges',    icon: 'crosshair', gift: '+20% critical chance and +60% critical damage.', price: 'Enemies hit 20% harder.',
      stats: (s) => { s.crit += 0.2; s.critMult += 0.6; }, rules: (r) => { r.dmg *= 1.2; } },
    echoes:   { name: 'Pact of Echoes',   icon: 'multishot', gift: '+1 projectile on every skill that fires them.', price: 'Your ability recharges 30% slower.',
      stats: (s) => { s.proj += 1; s.abilityHaste -= 0.23; } },
    colossus: { name: 'Pact of the Titan', icon: 'mountain', gift: '+35% area of effect and +40 max health.', price: 'You move 12% slower.',
      stats: (s) => { s.area += 0.35; s.maxHp += 40; s.speed *= 0.88; } },
    swarm:    { name: 'Pact of the Swarm', icon: 'ghost',    gift: 'Two skill levels, now.',                price: 'Hordes arrive 35% more often.',
      rules: (r) => { r.hordeEvery *= 0.74; }, now: (G, p) => { p.gainLevel(); p.gainLevel(); } },
  };
  Object.assign(D.PACTS, {
    fury:     { name: 'Pact of Fury',     icon: 'spark',    gift: '+45% ability haste.',                   price: '12% less attack speed.',
      stats: (s) => { s.abilityHaste += 0.45; s.atkSpd -= 0.12; } },
    famine:   { name: 'Pact of Famine',   icon: 'dice',     gift: 'Two rerolls and two banishes, now.',    price: 'Level-ups no longer restore health.',
      rules: (r) => { r.noLevelHeal = true; }, now: (G, p) => { p.rerolls += 2; p.banishes += 2; } },
    stone:    { name: 'Pact of Stone',    icon: 'armor',    gift: '+15 armor and +30 max health.',         price: 'You no longer regenerate health.',
      stats: (s) => { s.armor += 15; s.maxHp += 30; s.noRegen = true; } },
    tempo:    { name: 'Pact of the Gale', icon: 'wings',    gift: '+18% move speed.',                      price: 'The ground gives way half again as often.',
      stats: (s) => { s.speed *= 1.18; }, rules: (r) => { r.tremorEvery = (r.tremorEvery || 1) * 0.67; } },
  });
  for (const id in D.PACTS) D.PACTS[id].id = id;

  /* ---------- Class mastery: every run with a class earns it points (a thousandth of the score); ranks give that class
     +1% damage each. Small on purpose: a reason to stay with a class, not a second skill tree ---------- */
  D.MASTERY = [40, 120, 250, 450, 700, 1000, 1400, 1900, 2500, 3200]; // points needed for ranks 1..10
  D.masteryRank = (pts) => { let r = 0; while (r < D.MASTERY.length && pts >= D.MASTERY[r]) r++; return r; };

  /* ---------- Sigils: one perk worn into a run, each unlocked by a feat (PS.Feats). The daily rift allows none ---------- */
  // feat: the feat id that unlocks it. stats(s) on every recalc, rules(r) and start(G, p) once when the run begins.
  D.SIGILS = {
    purse:    { name: 'Sigil of the Purse',   icon: 'coin',     feat: 'gold5k',   text: 'Begin with 80 gold.',                                   start: (G, p) => { p.gold += 80; } },
    scholar:  { name: 'Sigil of the Scholar', icon: 'book',     feat: 'lvl40',    text: '+10% experience.',                                      stats: (s) => { s.xp += 0.1; } },
    bulwark:  { name: 'Sigil of the Bulwark', icon: 'shield',   feat: 'win',      text: '+20 max health and +6 armor.',                          stats: (s) => { s.maxHp += 20; s.armor += 6; } },
    wind:     { name: 'Sigil of the Wind',    icon: 'feather',  feat: 'flawless', text: '+1 dash charge, but 10% less max health.',              stats: (s) => { s.dashCharges += 1; s.hpMult -= 0.1; } },
    gambler:  { name: 'Sigil of the Gambler', icon: 'dice',     feat: 'legend',   text: '+15 luck and one more reroll.',                         stats: (s) => { s.luck += 15; }, start: (G, p) => { p.rerolls += 1; } },
    warlord:  { name: 'Sigil of the Warlord', icon: 'skull',    feat: 'boss3',    text: '+15% damage to elites and bosses. Elites arrive 25% more often.', stats: (s) => { s.bossDmg += 0.15; }, rules: (r) => { r.eliteEvery *= 0.8; } },
    alchemy:  { name: 'Sigil of Alchemy',     icon: 'flask',    feat: 'rx8',      text: 'Reactions hit 25% harder.',                             rules: (r) => { r.react *= 1.25; } },
    oath:     { name: 'Sigil of the Oath',    icon: 'blood',    feat: 'pact1',    text: 'A dark altar stands beside you when the run begins.',    start: (G, p) => { G.props.push({ kind: 'altar', x: p.x + 150, y: p.y - 40, r: 64, dead: false, t: 0, charge: 0, bob: 0 }); } },
    breaker:  { name: 'Sigil of the Breaker', icon: 'rift',     feat: 'breach4',  text: 'Breaches open twice as often.',                         start: (G) => { G.sigilBreach = true; } },
    star:     { name: 'Sigil of the Star',    icon: 'sun',      feat: 'solenne',  text: '+8% damage, +8% attack speed and +8% move speed.',      stats: (s) => { s.dmg += 0.08; s.atkSpd += 0.08; s.speed *= 1.08; } },
  };
  for (const id in D.SIGILS) D.SIGILS[id].id = id;

  /* ---------- Relics: found in chests and dropped by bosses. No slot limit. ---------- */
  const affRelic = (el, name, icon) => ({
    name, icon, tier: 1, max: 2,
    desc: `+1 ${D.ELEMENTS[el].name} affinity and +15% ${D.ELEMENTS[el].name} damage.`,
    apply: (s, n) => { s.aff[el] += n; s.el[el] += 0.15 * n; },
  });
  D.RELICS = {
    // common — stackable stat pieces
    whetstone:  { name: 'Whetstone',       icon: 'anvil',     tier: 0, max: 99, desc: '+6% damage.',             apply: (s, n) => { s.dmg += 0.06 * n; } },
    boots:      { name: 'Traveler\'s Boots', icon: 'boot',    tier: 0, max: 6,  desc: '+7% move speed.',         apply: (s, n) => { s.speed *= 1 + 0.07 * n; } },
    ironheart:  { name: 'Iron Heart',      icon: 'heart',     tier: 0, max: 99, desc: '+25 max health.',         apply: (s, n) => { s.maxHp += 25 * n; } },
    luckycoin:  { name: 'Lucky Coin',      icon: 'clover',    tier: 0, max: 99, desc: '+12 luck.',               apply: (s, n) => { s.luck += 12 * n; } },
    sandglass:  { name: 'Sandglass',       icon: 'hourglass', tier: 0, max: 99, desc: '+7% attack speed.',       apply: (s, n) => { s.atkSpd += 0.07 * n; } },
    lens:       { name: 'Hunter\'s Lens',  icon: 'lens',      tier: 0, max: 10, desc: '+6% critical chance.',    apply: (s, n) => { s.crit += 0.06 * n; } },
    lodestone:  { name: 'Lodestone',       icon: 'magnet',    tier: 0, max: 5,  desc: '+35% pickup range.',      apply: (s, n) => { s.pickup *= 1 + 0.35 * n; } },
    bandage:    { name: 'Field Dressing',  icon: 'plus',      tier: 0, max: 99, desc: '+0.8 health regeneration.', apply: (s, n) => { s.regen += 0.8 * n; } },
    scrap:      { name: 'Torn Page',       icon: 'book',      tier: 0, max: 8,  desc: '+8% experience.',         apply: (s, n) => { s.xp += 0.08 * n; } },
    // uncommon
    emberheart: affRelic('fire', 'Ember Heart', 'flame'),
    rimecore:   affRelic('frost', 'Rime Core', 'snow'),
    stormcap:   affRelic('storm', 'Storm Capacitor', 'bolt'),
    blightgland: affRelic('venom', 'Blight Gland', 'drop'),
    ironsigil:  affRelic('steel', 'Iron Sigil', 'sword'),
    voidshard:  affRelic('void', 'Abyss Shard', 'vortex'),
    vampfang:   { name: 'Vampire Fang',    icon: 'fang',    tier: 1, max: 3, desc: 'Heal for 2.5% of the damage you deal.', apply: (s, n) => { s.lifesteal += 0.025 * n; } },
    thornmail:  { name: 'Thornmail',       icon: 'thorns',  tier: 1, max: 5, desc: 'When hit, lash out at everything nearby. Scales with armor.', apply: (s, n) => { s.f.thorns = (s.f.thorns || 0) + n; } },
    feather:    { name: 'Windfeather',     icon: 'feather', tier: 1, max: 2, desc: '+1 dash charge.',       apply: (s, n) => { s.dashCharges += n; } },
    goldtooth:  { name: 'Gilded Hand',     icon: 'hand',    tier: 1, max: 5, desc: '+25% gold found.',      apply: (s, n) => { s.gold += 0.25 * n; } },
    battery:    { name: 'Rift Battery',    icon: 'battery', tier: 1, max: 3, desc: '+20% ability haste.',   apply: (s, n) => { s.abilityHaste += 0.20 * n; } },
    plate:      { name: 'Scale Plate',     icon: 'armor',   tier: 1, max: 99, desc: '+6 armor.',            apply: (s, n) => { s.armor += 6 * n; } },
    secondskin: { name: 'Second Skin',     icon: 'armor',   tier: 1, max: 2, desc: 'After you are hit, gain 25 armor for 5 seconds.', apply: (s, n, p) => { s.f.secondSkin = n; if (p.skinT > 0) s.armor += 25 * n; }, dynamic: true },
    kindling:   { name: 'Kindling',        icon: 'nova',    tier: 1, max: 3, desc: 'Every level you gain sets off a blast around you.', apply: (s, n) => { s.f.kindling = (s.f.kindling || 0) + n; } },
    gemeater:   { name: 'Gem Eater',       icon: 'gem',     tier: 1, max: 2, desc: 'Every 60 gems you collect restore 4% of your health.', apply: (s, n) => { s.f.gemEater = (s.f.gemEater || 0) + n; } },
    ledger:     { name: 'Merchant\'s Ledger', icon: 'book',  tier: 1, max: 1, desc: 'The merchant charges a third less, and stays twice as long.', apply: (s) => { s.f.ledger = 1; } },
    // rare
    chainspark: { name: 'Arc Coil',        icon: 'chain',   tier: 2, max: 4, desc: 'Hits have a 6% chance to chain lightning to nearby enemies.', apply: (s, n) => { s.f.chainProc = (s.f.chainProc || 0) + 0.06 * n; } },
    volatile:   { name: 'Volatile Ichor',  icon: 'bomb',    tier: 2, max: 4, desc: 'Slain enemies have a 12% chance to explode.', apply: (s, n) => { s.f.corpseBoom = (s.f.corpseBoom || 0) + 0.12 * n; } },
    echo:       { name: 'Echo Stone',      icon: 'echo',    tier: 2, max: 3, desc: 'Skills that fire on a cooldown have a 15% chance to fire twice.', apply: (s, n) => { s.f.echo = (s.f.echo || 0) + 0.15 * n; } },
    giantsbelt: { name: 'Giant\'s Belt',   icon: 'belt',    tier: 2, max: 3, desc: '+20% area of effect and +15% max health.', apply: (s, n) => { s.area += 0.2 * n; s.hpMult += 0.15 * n; } },
    ricochet:   { name: 'Splinter Prism',  icon: 'shards',   tier: 2, max: 3, desc: 'Arrows, shards, spores and bolts pierce 1 more enemy. All projectiles fly 15% faster.', apply: (s, n) => { s.pierce += n; s.projSpd += 0.15 * n; } },
    slayer:     { name: 'Giantslayer',     icon: 'skull',   tier: 2, max: 3, desc: '+30% damage to elites and bosses.', apply: (s, n) => { s.bossDmg += 0.30 * n; } },
    frostbite:  { name: 'Frostbite Ring',  icon: 'crystal', tier: 2, max: 3, desc: 'Hits have an 8% chance to freeze enemies solid.', apply: (s, n) => { s.f.freezeProc = (s.f.freezeProc || 0) + 0.08 * n; } },
    venomous:   { name: 'Serpent Tooth',   icon: 'spores',  tier: 2, max: 3, desc: 'Hits have a 20% chance to poison.', apply: (s, n) => { s.f.poisonProc = (s.f.poisonProc || 0) + 0.20 * n; } },
    souljar:    { name: 'Soul Jar',        icon: 'jar',     tier: 2, max: 3, desc: '+1% damage for every 1,000 enemies slain this run, up to +50%.', apply: (s, n, p) => { s.dmg += Math.min(0.5, Math.floor((p.kills || 0) / 1000) * 0.01) * n; }, dynamic: true },
    mirror:     { name: 'Mirror Shard',    icon: 'prism',   tier: 2, max: 1, desc: 'Ward is 25% larger and recharges 25% faster. Reflected bullets hit 60% harder.', apply: (s) => { s.f.mirror = 1; } },
    executioner: { name: 'Headsman\'s Axe', icon: 'cleave',  tier: 2, max: 2, desc: 'Enemies below 25% health take 35% more damage.', apply: (s, n) => { s.f.execute = (s.f.execute || 0) + 0.35 * n; } },
    stopwatch:  { name: 'Frozen Stopwatch', icon: 'timer',  tier: 2, max: 1, desc: 'Dashing chills every enemy around where you set off, and freezes the lesser ones for a moment.', apply: (s) => { s.f.dashChill = 1; } },
    warbanner:  { name: 'War Banner',      icon: 'swords',  tier: 2, max: 1, desc: '+4% damage for every elite and boss you slay from now on, up to +60%.', apply: (s, n, p) => { s.dmg += Math.min(0.6, 0.04 * (p.trophies || 0)); }, dynamic: true },
    riftkey:    { name: 'Rift Key',        icon: 'key',     tier: 2, max: 1, desc: 'A sealed breach offers one more relic to choose from, and breaches give 4 more seconds.', apply: (s) => { s.f.riftKey = 1; } },
    tidecaller: { name: 'Tidecaller',      icon: 'moon',    tier: 2, max: 1, desc: 'Rift tides last half again as long, and come a little sooner.', apply: (s) => { s.f.tideCaller = 1; } },
    // epic
    glasscannon: { name: 'Glass Cannon',   icon: 'target',  tier: 3, max: 2, desc: '+50% damage, but −25% max health.', apply: (s, n) => { s.dmg += 0.5 * n; s.hpMult -= 0.25 * n; } },
    berserker:  { name: 'Berserker Mask',  icon: 'mask',    tier: 3, max: 2, desc: 'Deal up to 70% more damage the lower your health.', apply: (s, n) => { s.f.berserk = (s.f.berserk || 0) + 0.7 * n; } },
    timecrystal: { name: 'Time Crystal',   icon: 'clock',   tier: 3, max: 1, desc: 'Every 25 seconds, freeze every enemy on screen for 2 seconds.', apply: (s) => { s.f.timeStop = 1; } },
    greed:      { name: 'Dragon\'s Hoard', icon: 'gem',     tier: 3, max: 1, desc: '+1% damage per 10 gold you are holding (up to +80%).', apply: (s, n, p) => { s.dmg += Math.min(0.8, Math.floor((p.gold || 0) / 10) * 0.01); }, dynamic: true },
    momentum:   { name: 'Stormstride',     icon: 'wings',   tier: 3, max: 1, desc: '+12% move speed. Bonus move speed also raises your damage.', apply: (s) => { s.speed *= 1.12; s.f.momentum = 1; } },
    twinsouls:  { name: 'Twin Souls',      icon: 'multishot', tier: 3, max: 2, desc: '+1 projectile on every skill that fires projectiles.', apply: (s, n) => { s.proj += n; } },
    bloodpact:  { name: 'Blood Pact',      icon: 'blood',   tier: 3, max: 1, desc: '+35% attack speed and 3% lifesteal, but lose 1 health per second.', apply: (s) => { s.atkSpd += 0.35; s.lifesteal += 0.03; s.regen -= 1; } },
    stillwater: { name: 'Still Water',     icon: 'wave',    tier: 3, max: 1, desc: '+5% damage for every 10 seconds since you were last hit, up to +35%. Being hit resets it.', apply: (s, n, p) => { s.dmg += Math.min(0.35, 0.05 * Math.floor((p.calmT || 0) / 10)); }, dynamic: true },
    oathstone:  { name: 'Oathstone',       icon: 'blood',   tier: 3, max: 1, desc: '+6% damage and +6% attack speed for every pact you hold.', apply: (s, n, p) => { const k = (p.pacts || []).length; s.dmg += 0.06 * k; s.atkSpd += 0.06 * k; }, dynamic: true },
    // legendary
    crown:      { name: 'Crown of the Rift', icon: 'crown', tier: 4, max: 1, desc: '+1 affinity with every element.', apply: (s) => { for (const k in s.aff) s.aff[k] += 1; } },
    phoenix:    { name: 'Phoenix Plume',   icon: 'phoenix', tier: 4, max: 1, desc: 'Once per run, return from death at full health in a blaze.', apply: (s) => { s.revives += 1; } },
    infinity:   { name: 'Infinity Loop',   icon: 'infinity', tier: 4, max: 1, desc: '+2% damage for every level you have gained.', apply: (s, n, p) => { s.dmg += 0.02 * (p.level || 1); }, dynamic: true },
    paradox:    { name: 'Paradox Engine',  icon: 'gear',    tier: 4, max: 1, desc: '+30% attack speed and +40% ability haste.', apply: (s) => { s.atkSpd += 0.3; s.abilityHaste += 0.4; } },
    colossus:   { name: 'Heart of the Colossus', icon: 'mountain', tier: 4, max: 1, desc: '+100 max health, +10 armor, +25% area of effect.', apply: (s) => { s.maxHp += 100; s.armor += 10; s.area += 0.25; } },
    prismheart: { name: 'Prism Heart',     icon: 'prism',   tier: 4, max: 1, desc: 'Reactions hit 60% harder and each enemy can react again a second sooner.', apply: (s) => { s.f.rxBoost = 1; } },
    midas:      { name: 'Midas Sigil',     icon: 'trophy',  tier: 4, max: 1, desc: 'Double gold. Chests cost 30% less.', apply: (s) => { s.gold += 1; s.f.discount = 0.3; } },
  };
  /* Resonances: hold every relic of a set and it gives a bonus of its own. Plain stats, so a set is one line here */
  D.RELIC_SETS = [
    { id: 'bloodline',  name: 'Bloodline',       ids: ['vampfang', 'bloodpact'],               text: '+2% lifesteal and +25 max health.',          apply: (s) => { s.lifesteal += 0.02; s.maxHp += 25; } },
    { id: 'stormfront', name: 'Stormfront',      ids: ['stormcap', 'chainspark'],              text: '+25% Tempest damage.',                       apply: (s) => { s.el.storm += 0.25; } },
    { id: 'hoardking',  name: 'Hoard King',      ids: ['greed', 'goldtooth'],                  text: '+30% gold found and +15 luck.',              apply: (s) => { s.gold += 0.3; s.luck += 15; } },
    { id: 'glassedge',  name: 'Glass Edge',      ids: ['glasscannon', 'lens'],                 text: '+30% critical damage.',                      apply: (s) => { s.critMult += 0.3; } },
    { id: 'timekeeper', name: 'Timekeeper',      ids: ['sandglass', 'timecrystal', 'stopwatch'], text: '+15% attack speed and +20% ability haste.', apply: (s) => { s.atkSpd += 0.15; s.abilityHaste += 0.2; } },
    { id: 'juggernaut', name: 'Juggernaut',      ids: ['plate', 'ironheart', 'giantsbelt'],    text: '+10 armor and +12% max health.',             apply: (s) => { s.armor += 10; s.hpMult += 0.12; } },
    { id: 'headhunter', name: 'Headhunter',      ids: ['slayer', 'executioner'],               text: '+25% damage to elites and bosses.',          apply: (s) => { s.bossDmg += 0.25; } },
    { id: 'deepwinter', name: 'Deep Winter',     ids: ['rimecore', 'frostbite'],               text: '+25% Rime damage.',                          apply: (s) => { s.el.frost += 0.25; } },
    { id: 'wildfire',   name: 'Ashfall',         ids: ['emberheart', 'volatile'],              text: '+25% Ember damage.',                         apply: (s) => { s.el.fire += 0.25; } },
    { id: 'plague',     name: 'Rot and Ruin',    ids: ['blightgland', 'venomous'],             text: '+25% Blight damage.',                        apply: (s) => { s.el.venom += 0.25; } },
    { id: 'windwalker', name: 'Windwalker',      ids: ['boots', 'feather', 'momentum'],        text: '+10% move speed, and dashes recharge 20% faster.', apply: (s) => { s.speed *= 1.1; s.dashCd *= 0.8; } },
    { id: 'scholar',    name: 'Scholar\'s Pair', ids: ['scrap', 'souljar'],                    text: '+12% experience.',                           apply: (s) => { s.xp += 0.12; } },
  ];
  D.SETS_OF = {}; // relic id -> the sets it belongs to
  for (const st of D.RELIC_SETS) for (const id of st.ids) { if (!D.RELICS[id]) throw new Error('unknown relic in set: ' + id); (D.SETS_OF[id] = D.SETS_OF[id] || []).push(st); }
  for (const id in D.RELICS) D.RELICS[id].id = id;
  for (const id in D.TOMES) D.TOMES[id].id = id;
  for (const id in D.BOONS) D.BOONS[id].id = id;

  /* ---------- Meta tree: permanent upgrades bought with Essence ---------- */
  // Layout coordinates are in abstract units; the UI scales them. Four arms off a central core, each in three rings:
  // the inner ring is cheap and shallow, a gate node opens the middle ring, and a second gate opens the last node, a
  // long sink of small ranks. Ranks are deliberately small, so a few thousand Essence buys an edge, not a different game.
  // Positions are given along the arm (a) and across it (s), then turned to face the arm's way.
  const T = [];
  const ARM_DIR = { might: (a, s) => [s, -a], vitality: (a, s) => [-a, s], fortune: (a, s) => [a, s], mastery: (a, s) => [s, a] };
  const node = (id, arm, name, icon, a, s, max, cost, req, desc, apply, grow) => {
    const [x, y] = ARM_DIR[arm](a, s);
    T.push({ id, arm, name, icon, x, y, max, cost, req, desc, apply, grow: grow || 0.4, gate: false });
  };
  const at = (id, arm, name, icon, x, y, max, cost, req, desc, apply, grow) => T.push({ id, arm, name, icon, x, y, max, cost, req, desc, apply, grow: grow || 0.4, gate: false });
  const p1 = (v) => (Math.round(v * 10) / 10).toString();

  // Might — up
  node('m1',  'might', 'Sharpened Edge', 'sword',     1.35, 0,     10, 30,   ['core'], (r) => `+${2 * r}% damage`, (s, r) => { s.dmg += 0.02 * r; });
  node('m2',  'might', 'Quick Hands',    'hourglass', 2.6, -1.15,  8, 60,    ['m1'],   (r) => `+${p1(1.5 * r)}% attack speed`, (s, r) => { s.atkSpd += 0.015 * r; });
  node('m3',  'might', 'Keen Eye',       'crosshair', 2.6, 1.15,   8, 60,    ['m1'],   (r) => `+${r}% critical chance`, (s, r) => { s.crit += 0.01 * r; });
  node('m4',  'might', 'Wide Arc',       'expand',    3.85, -1.15, 5, 120,    ['m2'],   (r) => `+${2 * r}% area of effect`, (s, r) => { s.area += 0.02 * r; });
  node('m5',  'might', 'Brutality',      'skull',     3.85, 1.15,  6, 120,    ['m3'],   (r) => `+${5 * r}% critical damage`, (s, r) => { s.critMult += 0.05 * r; });
  node('m6',  'might', 'Lingering Pain', 'flame',     4.75, 0,     5, 200,   ['m4', 'm5'], (r) => `+${4 * r}% Burn, Poison and Bleed damage`, (s, r) => { s.statusDmg += 0.04 * r; });
  node('m7',  'might', 'Giantsbane',     'trophy',    5.95, 0,     3, 900,   ['m6'],   (r) => `+${5 * r}% damage to elites and bosses`, (s, r) => { s.bossDmg += 0.05 * r; });
  node('m8',  'might', 'Killing Intent', 'fang',      7.1, -1.6,   10, 120,  ['m7'],   (r) => `×${p1(Math.pow(1.02, r) * 100 - 100)}% more damage (multiplies)`, (s, r) => { s.dmgMore *= Math.pow(1.02, r); });
  node('m9',  'might', 'Elementalist',   'prism',     7.1, 1.6,    10, 120,  ['m7'],   (r) => `+${2 * r}% damage of every element`, (s, r) => { for (const e in s.el) s.el[e] += 0.02 * r; });
  node('m10', 'might', 'Deadly Precision', 'target',  8.4, -2.6,   8, 180,   ['m8'],   (r) => `+${p1(0.8 * r)}% critical chance and +${3 * r}% critical damage`, (s, r) => { s.crit += 0.008 * r; s.critMult += 0.03 * r; });
  node('m11', 'might', 'Festering',      'spores',    8.4, 2.6,    8, 180,   ['m9'],   (r) => `+${4 * r}% Burn, Poison and Bleed damage, +${p1(1.5 * r)}% effect duration`, (s, r) => { s.statusDmg += 0.04 * r; s.duration += 0.015 * r; });
  node('m12', 'might', 'Warlord',        'swords',    9.6, 0,      5, 400,   ['m10', 'm11'], (r) => `+${3 * r}% damage and +${2 * r}% attack speed`, (s, r) => { s.dmg += 0.03 * r; s.atkSpd += 0.02 * r; });
  node('m13', 'might', 'Twin Volley',    'multishot', 10.9, 0,     1, 7000,  ['m12'],  () => '+1 projectile on every skill that fires them', (s, r) => { s.proj += r; });
  node('m14', 'might', 'Endless Might',  'nova',      12.2, 0,     25, 260,  ['m13'],  (r) => `×${p1(Math.pow(1.01, r) * 100 - 100)}% more damage (multiplies)`, (s, r) => { s.dmgMore *= Math.pow(1.01, r); }, 0.12);

  // Vitality — left
  node('v1',  'vitality', 'Hardy',        'heart',   1.35, 0,     10, 30,  ['core'], (r) => `+${3 * r} max health`, (s, r) => { s.maxHp += 3 * r; });
  node('v2',  'vitality', 'Mending',      'plus',    2.6, -1.15,  8, 60,   ['v1'],   (r) => `+${(0.1 * r).toFixed(1)} health regeneration`, (s, r) => { s.regen += 0.1 * r; });
  node('v3',  'vitality', 'Thick Hide',   'shield',  2.6, 1.15,   8, 60,   ['v1'],   (r) => `+${r} armor`, (s, r) => { s.armor += r; });
  node('v4',  'vitality', 'Second Wind',  'potion',  3.85, -1.15, 5, 120,   ['v2'],   (r) => `Level-ups heal ${r}% more of max health`, (s, r) => { s.m.levelHeal = 0.01 * r; });
  node('v5',  'vitality', 'Evasion',      'feather', 3.85, 1.15,  5, 120,   ['v3'],   (r) => `+${r}% chance to dodge hits`, (s, r) => { s.dodge += 0.01 * r; });
  node('v6',  'vitality', 'Aegis',        'cross',   4.75, 0,     4, 240,  ['v4', 'v5'], (r) => `Stay invulnerable ${(0.05 * r).toFixed(2)}s longer after being hit`, (s, r) => { s.m.iframes = 0.05 * r; });
  node('v7',  'vitality', 'Stalwart',     'armor',   5.95, 0,     3, 900,  ['v6'],   (r) => `+${4 * r}% max health`, (s, r) => { s.hpMult += 0.04 * r; });
  node('v8',  'vitality', 'Bulwark',      'heart',   7.1, -1.6,   10, 120, ['v7'],   (r) => `+${2 * r}% max health`, (s, r) => { s.hpMult += 0.02 * r; });
  node('v9',  'vitality', 'Troll Blood',  'plus',    7.1, 1.6,    10, 120, ['v7'],   (r) => `+${(0.15 * r).toFixed(2)} health regeneration`, (s, r) => { s.regen += 0.15 * r; });
  node('v10', 'vitality', 'Ironskin',     'shield',  8.4, -2.6,   10, 180, ['v8'],   (r) => `+${r} armor`, (s, r) => { s.armor += r; });
  node('v11', 'vitality', 'Lifebond',     'blood',   8.4, 2.6,    6, 180,  ['v9'],   (r) => `Heal for ${p1(0.25 * r)}% of the damage you deal`, (s, r) => { s.lifesteal += 0.0025 * r; });
  node('v12', 'vitality', 'Fortitude',    'mountain', 9.6, 0,     5, 400,  ['v10', 'v11'], (r) => `+${3 * r}% max health and +${r} armor`, (s, r) => { s.hpMult += 0.03 * r; s.armor += r; });
  node('v13', 'vitality', 'Undying',      'phoenix', 10.9, 0,     1, 7000, ['v12'],  () => 'Return from death once per run', (s, r) => { s.revives += r; });
  node('v14', 'vitality', 'Endless Vigor', 'heart',  12.2, 0,     25, 260, ['v13'],  (r) => `+${r}% max health, +${(0.04 * r).toFixed(1)} regeneration`, (s, r) => { s.hpMult += 0.01 * r; s.regen += 0.04 * r; }, 0.12);

  // Fortune — right
  node('f1',  'fortune', 'Scholar',        'book',    1.35, 0,     10, 30,  ['core'], (r) => `+${r}% experience`, (s, r) => { s.xp += 0.01 * r; });
  node('f2',  'fortune', 'Prospector',     'coin',    2.6, -1.15,  8, 60,   ['f1'],   (r) => `+${4 * r}% gold found`, (s, r) => { s.gold += 0.04 * r; });
  node('f3',  'fortune', 'Lucky Star',     'star',    2.6, 1.15,   8, 60,   ['f1'],   (r) => `+${2 * r} luck`, (s, r) => { s.luck += 2 * r; });
  node('f4',  'fortune', 'Second Opinion', 'dice',    3.85, -1.15, 3, 180,   ['f2'],   (r) => `+${r} reroll${r > 1 ? 's' : ''} each run`, (s, r) => { s.m.rerolls = (s.m.rerolls || 0) + r; });
  node('f5',  'fortune', 'Exile',          'ban',     3.85, 1.15,  2, 240,  ['f3'],   (r) => `+${r} banish${r > 1 ? 'es' : ''} each run`, (s, r) => { s.m.banishes = (s.m.banishes || 0) + r; });
  node('f6',  'fortune', 'Soul Tithe',     'essence', 4.75, 0,     4, 240,  ['f4', 'f5'], (r) => `+${5 * r}% Essence earned`, (s, r) => { s.m.essence = (s.m.essence || 0) + 0.05 * r; });
  node('f7',  'fortune', 'Fortune\'s Favour', 'trophy', 5.95, 0,   3, 900,  ['f6'],   (r) => `+${4 * r} luck and +${r}% experience`, (s, r) => { s.luck += 4 * r; s.xp += 0.01 * r; });
  node('f8',  'fortune', 'Tutor',          'book',    7.1, -1.6,   10, 120, ['f7'],   (r) => `+${r}% experience`, (s, r) => { s.xp += 0.01 * r; });
  node('f9',  'fortune', 'Gilded',         'coin',    7.1, 1.6,    10, 120, ['f7'],   (r) => `+${5 * r}% gold found`, (s, r) => { s.gold += 0.05 * r; });
  node('f10', 'fortune', 'Bargainer',      'chest',   8.4, -2.6,   5, 180,  ['f8'],   (r) => `Chests cost ${4 * r}% less`, (s, r) => { s.m.discount = 0.04 * r; });
  node('f11', 'fortune', 'Charmed',        'star',    8.4, 2.6,    10, 180, ['f9'],   (r) => `+${2 * r} luck`, (s, r) => { s.luck += 2 * r; });
  node('f12', 'fortune', 'Tithe of Ages',  'essence', 9.6, 0,      5, 400,  ['f10', 'f11'], (r) => `+${5 * r}% Essence earned`, (s, r) => { s.m.essence = (s.m.essence || 0) + 0.05 * r; });
  node('f13', 'fortune', 'Inheritance',    'jar',     10.9, 0,     1, 7000, ['f12'],  () => 'Begin every run with a random relic', (s, r) => { s.m.startRelic = r; });
  node('f14', 'fortune', 'Endless Fortune', 'gem',    12.2, 0,     25, 260, ['f13'],  (r) => `+${p1(0.4 * r)}% experience and +${2 * r}% gold found`, (s, r) => { s.xp += 0.004 * r; s.gold += 0.02 * r; }, 0.12);

  // Mastery — down
  node('a1',  'mastery', 'Fleet Foot',     'boot',    1.35, 0,     10, 30,  ['core'], (r) => `+${r}% move speed`, (s, r) => { s.speed *= 1 + 0.01 * r; });
  node('a2',  'mastery', 'Blink Training', 'dash',    2.6, -1.15,  5, 80,   ['a1'],   (r) => `Dash recharges ${4 * r}% faster`, (s, r) => { s.dashCd *= 1 - 0.04 * r; });
  node('a3',  'mastery', 'Focus',          'spark',   2.6, 1.15,   6, 80,   ['a1'],   (r) => `+${3 * r}% ability haste`, (s, r) => { s.abilityHaste += 0.03 * r; });
  node('a4',  'mastery', 'Persistence',    'clock',   3.85, -1.15, 5, 120,   ['a2'],   (r) => `+${3 * r}% effect duration`, (s, r) => { s.duration += 0.03 * r; });
  node('a5',  'mastery', 'Prodigy',        'arrowup', 3.85, 1.15,  2, 400,  ['a3'],   (r) => `Begin each run ${r} level${r > 1 ? 's' : ''} higher`, (s, r) => { s.m.startLevels = (s.m.startLevels || 0) + r; });
  node('a6',  'mastery', 'Tailwind',       'wings',   4.75, 0,     1, 1200,  ['a4', 'a5'], () => '+1 dash charge', (s, r) => { s.dashCharges += r; });
  node('a7',  'mastery', 'Attunement',     'orbs',    5.95, 0,     3, 900,  ['a6'],   (r) => `+${4 * r}% ability haste and +${2 * r}% attack speed`, (s, r) => { s.abilityHaste += 0.04 * r; s.atkSpd += 0.02 * r; });
  node('a8',  'mastery', 'Magnetism',      'magnet',  7.1, -1.6,   5, 150,  ['a7'],   (r) => `+${8 * r} pickup range`, (s, r) => { s.pickup += 8 * r; });
  node('a9',  'mastery', 'Overclock',      'bolt',    7.1, 1.6,    10, 120, ['a7'],   (r) => `+${3 * r}% ability haste`, (s, r) => { s.abilityHaste += 0.03 * r; });
  node('a10', 'mastery', 'Slipstream',     'dash',    8.4, -2.6,   10, 180, ['a8'],   (r) => `+${r}% move speed, dash recharges ${2 * r}% faster`, (s, r) => { s.speed *= 1 + 0.01 * r; s.dashCd *= 1 - 0.02 * r; });
  node('a11', 'mastery', 'Endurance',      'clock',   8.4, 2.6,    6, 180,  ['a9'],   (r) => `+${3 * r}% effect duration and +${2 * r}% area`, (s, r) => { s.duration += 0.03 * r; s.area += 0.02 * r; });
  node('a12', 'mastery', 'Head Start',     'arrowup', 9.6, 0,      2, 1200, ['a10', 'a11'], (r) => `Begin each run ${r} more level${r > 1 ? 's' : ''} higher`, (s, r) => { s.m.startLevels = (s.m.startLevels || 0) + r; });
  node('a13', 'mastery', 'Seventh Tome',   'book',    10.9, 0,     1, 7000, ['a12'],  () => '+1 tome slot', (s, r) => { s.m.tomeSlots = r; });
  node('a14', 'mastery', 'Endless Focus',  'spark',   12.2, 0,     25, 260, ['a13'],  (r) => `+${r}% ability haste and +${p1(0.5 * r)}% attack speed`, (s, r) => { s.abilityHaste += 0.01 * r; s.atkSpd += 0.005 * r; }, 0.12);

  // Bridges: nodes in the corners between the arms, opened from either arm beside them. The inner four hang off the
  // first ring, the outer four off the second.
  at('x1', 'might',    'Blooded',     'blood',  -3.2, -3.2, 3, 400,  ['m4', 'v4'], (r) => `+${5 * r}% damage while below half health`, (s, r) => { s.m.blooded = 0.05 * r; });
  at('x2', 'fortune',  'Appraiser',   'lens',    3.2, -3.2, 1, 3000, ['m5', 'f4'], () => 'Relic chests offer one more relic to choose from', (s, r) => { s.m.relicChoice = r; });
  at('x3', 'vitality', 'Field Medic', 'potion', -3.2,  3.2, 3, 400,  ['v5', 'a4'], (r) => `Health pickups and tonics heal ${15 * r}% more`, (s, r) => { s.m.healMore = 0.15 * r; });
  at('x4', 'mastery',  'Wayfinder',   'spark',   3.2,  3.2, 3, 400,  ['f5', 'a5'], (r) => `Shrines appear ${20 * r}% more often`, (s, r) => { s.m.shrines = 0.2 * r; });
  at('x5', 'might',    'Bloodlust',   'fang',   -6.6, -6.6, 5, 500, ['m10', 'v10'], (r) => `+${2 * r}% damage and +${2 * r}% max health`, (s, r) => { s.dmg += 0.02 * r; s.hpMult += 0.02 * r; });
  at('x6', 'fortune',  'Bounty Hunter', 'skull', 6.6, -6.6, 5, 500, ['m11', 'f10'], (r) => `+${4 * r}% damage to elites and bosses, +${2 * r} luck`, (s, r) => { s.bossDmg += 0.04 * r; s.luck += 2 * r; });
  at('x7', 'vitality', 'Second Skin', 'feather', -6.6, 6.6, 5, 500, ['v11', 'a10'], (r) => `+${r}% chance to dodge hits`, (s, r) => { s.dodge += 0.01 * r; });
  at('x8', 'mastery',  'Forethought', 'dice',    6.6,  6.6, 2, 900, ['f11', 'a11'], (r) => `+${r} reroll${r > 1 ? 's' : ''} and +${r} banish${r > 1 ? 'es' : ''} each run`, (s, r) => { s.m.rerolls = (s.m.rerolls || 0) + r; s.m.banishes = (s.m.banishes || 0) + r; });

  // Lore: past each outer bridge, two nodes of ten ranks that deepen one kind of build: an element each, reactions, minions
  const lore = (id, arm, name, icon, x, y, req, el) => at(id, arm, name, icon, x, y, 10, 300, [req], (r) => `+${3 * r}% ${D.ELEMENTS[el].name} damage`, (s, r) => { s.el[el] += 0.03 * r; });
  lore('l1', 'might',    'Ember Lore',   'flame',   -8.1, -9.7, 'x5', 'fire');
  lore('l2', 'vitality', 'Iron Lore',    'sword',   -9.7, -8.1, 'x5', 'steel');
  lore('l3', 'might',    'Tempest Lore', 'bolt',     8.1, -9.7, 'x6', 'storm');
  lore('l4', 'fortune',  'Abyss Lore',   'vortex',   9.7, -8.1, 'x6', 'void');
  lore('l5', 'vitality', 'Rime Lore',    'snow',    -9.7,  8.1, 'x7', 'frost');
  lore('l6', 'mastery',  'Blight Lore',  'spores',  -8.1,  9.7, 'x7', 'venom');
  at('l7', 'fortune', 'Catalyst',  'flask', 9.7, 8.1, 10, 300, ['x8'], (r) => `Reactions hit ${4 * r}% harder`, (s, r) => { s.m.rxDmg = 0.04 * r; });
  at('l8', 'mastery', 'Warlock',   'bone',  8.1, 9.7, 10, 300, ['x8'], (r) => `Summons deal ${4 * r}% more damage`, (s, r) => { s.summon += 0.04 * r; });

  // gates: the nodes that open the next ring of their arm
  for (const id of ['m7', 'm13', 'v7', 'v13', 'f7', 'f13', 'a7', 'a13', 'x2']) T.find((n) => n.id === id).gate = true;

  D.META = T;
  D.META_BY_ID = {};
  for (const n of T) D.META_BY_ID[n.id] = n;
  D.META_ARMS = {
    might:    { name: 'Might',    color: '#ff7a5a' },
    vitality: { name: 'Vitality', color: '#74e39a' },
    fortune:  { name: 'Fortune',  color: '#ffcf5c' },
    mastery:  { name: 'Mastery',  color: '#a98bff' },
  };
  D.META_SPAN = 13.4; // layout units from the core to the edge of the tree
  D.TREE_VERSION = 2; // bump when the tree is rebuilt: saves from an older tree get everything they spent back
  /** cost of buying the next rank of a node: each rank costs a share more than the last (n.grow) */
  D.metaCost = (n, rank) => Math.round(n.cost * (1 + n.grow * rank));
  /**
   * a tree bought the way a player tends to buy it, for the playtest tools: with `budget` Essence, keep taking the
   * cheapest rank that is open until nothing more is affordable
   */
  D.metaGreedy = (budget) => {
    const tree = {};
    const open = (n) => n.req.some((r) => r === 'core' || (tree[r] || 0) > 0);
    for (;;) {
      let best = null, bc = Infinity;
      for (const n of T) { const r = tree[n.id] || 0; if (r < n.max && open(n)) { const c = D.metaCost(n, r); if (c < bc) { bc = c; best = n; } } }
      if (!best || bc > budget) return tree;
      budget -= bc; tree[best.id] = (tree[best.id] || 0) + 1;
    }
  };
  /** the tree the daily rift lends every hero, so its board compares play, not grind: the same for everyone, well short of all of it */
  D.DAILY_ESSENCE = 30000;
  D.DAILY_TREE = D.metaGreedy(D.DAILY_ESSENCE);
  /** what every rank bought so far has cost */
  D.metaSpent = (tree) => D.META.reduce((sum, m) => { let s = 0; for (let i = 0; i < Math.min(m.max, tree[m.id] || 0); i++) s += D.metaCost(m, i); return sum + s; }, 0);

  /* ---------- Reactions: hit one enemy with two different elements within a few seconds ---------- */
  // keyed by the two element ids in alphabetical order; the effects live in Combat.react
  D.REACTIONS = {
    'fire+frost':  { id: 'thermal',   name: 'Thermal Shock', text: 'Heat meets cold and bursts, damaging everything around the target.' },
    'fire+steel':  { id: 'sear',      name: 'Sear',          text: 'Molten metal opens a deep wound: the target Bleeds heavily.' },
    'fire+storm':  { id: 'plasma',    name: 'Plasma Arc',    text: 'A plasma arc leaps to 3 more enemies and sets them alight.' },
    'fire+venom':  { id: 'combust',   name: 'Combust',       text: 'The poison ignites and explodes, harder for every stack of Poison.' },
    'fire+void':   { id: 'backdraft', name: 'Backdraft',     text: 'Enemies are sucked toward the target, then scorched.' },
    'frost+steel': { id: 'icebreak',  name: 'Icebreaker',    text: 'A crushing blow, twice as hard on frozen enemies. Finishes off anything below 20% health.' },
    'frost+storm': { id: 'supercon',  name: 'Superconduct',  text: 'The target and the enemies beside it are stunned.' },
    'frost+venom': { id: 'creep',     name: 'Creeping Frost', text: 'Chill and Poison spread to everything nearby.' },
    'frost+void':  { id: 'entropy',   name: 'Entropy',       text: 'The target is Exposed: it takes 20% more damage for 4 seconds.' },
    'steel+storm': { id: 'rod',       name: 'Lightning Rod', text: 'A thunderbolt strikes the target for a guaranteed critical hit.' },
    'steel+venom': { id: 'fester',    name: 'Fester',        text: 'The wound festers: 3 stacks of Poison and a Bleed.' },
    'steel+void':  { id: 'sunder',    name: 'Sunder',        text: 'A shockwave tears outward, damaging and hurling back everything near the target.' },
    'storm+venom': { id: 'caustic',   name: 'Caustic Arc',   text: 'Lightning carries the target\'s Poison to 3 enemies nearby.' },
    'storm+void':  { id: 'ion',       name: 'Ion Storm',     text: 'Nearby enemies are dragged to the target and Shocked.' },
    'venom+void':  { id: 'wither',    name: 'Wither',        text: 'The target loses 5% of its max health (far less for elites and bosses).' },
  };
  for (const k in D.REACTIONS) { const r = D.REACTIONS[k]; r.key = k; r.els = k.split('+'); }
  D.reaction = (a, b) => (a === b ? null : D.REACTIONS[a < b ? a + '+' + b : b + '+' + a] || null);
  /** reactions between `el` and each element in `others` */
  D.reactionsWith = (el, others) => others.filter((o) => o !== el).map((o) => D.reaction(el, o)).filter(Boolean);

  /* ---------- Rift tides: a short spell of different rules every few minutes. The director reads the numbers ---------- */
  D.TIDES = {
    bloodmoon: { name: 'Hunter\'s Moon', icon: 'moon', color: '#ffab4a', dur: 20, text: 'The horde runs 25% faster. Gems are worth half again as much.', speed: 1.25, xp: 1.5 },
    goldrain:  { name: 'Gold Rain',    icon: 'coin',  color: '#ffd35c', dur: 18, text: 'Three times as many of the slain drop gold.',        gold: 3 },
    stillness: { name: 'Stillness',    icon: 'clock', color: '#9fe6ff', dur: 14, text: 'The rift holds its breath: enemies move 40% slower.', speed: 0.6 },
    surge:     { name: 'Power Surge',  icon: 'bolt',  color: '#ffe14d', dur: 14, text: 'Your skills and attacks come 30% faster.',          haste: 0.3 },
    echoes:    { name: 'Echoes',       icon: 'echo',  color: '#c9b8ff', dur: 16, text: 'Your skills have a 35% chance to fire twice.',       echo: 0.35 },
    harvest:   { name: 'Harvest',      icon: 'magnet', color: '#8ad1ff', dur: 16, text: 'Gems and gold fly to you from three times as far.',   pickup: 3 },
    bounty:    { name: 'Open Season',  icon: 'skull', color: '#c77dff', dur: 20, text: 'Two elites enter the rift at once. Their chests hold better relics.', elites: 2 },
  };
  for (const id in D.TIDES) D.TIDES[id].id = id;

  /* ---------- Elite affixes: every elite carries at least one. Behaviour lives in enemies.js ---------- */
  D.AFFIXES = {
    shielded: { name: 'Shielded', color: '#7fc8ff', text: 'A barrier soaks up damage and regrows if you let up.' },
    volatile: { name: 'Volatile', color: '#ff8a4d', text: 'Bursts into a ring of bullets when it dies.' },
    blinking: { name: 'Blinking', color: '#c06bff', text: 'Teleports next to you.' },
    mending:  { name: 'Mending',  color: '#7dffa0', text: 'Heals the horde around it.' },
    molten:   { name: 'Molten',   color: '#ff5a3d', text: 'Leaves erupting ground in its wake.' },
    brooding: { name: 'Brooding', color: '#b6ff5a', text: 'Keeps spawning lesser enemies.' },
    frenzied: { name: 'Frenzied', color: '#ffd35c', text: 'Faster, and faster still when wounded.' },
    splitting: { name: 'Splitting', color: '#5ff0d0', text: 'Breaks into three lesser copies of itself when it dies.' },
    warding:  { name: 'Warding',  color: '#bff3ff', text: 'Shields the horde around it, as a Warder does.' },
    grasping: { name: 'Grasping', color: '#ff7ad9', text: 'Drags you toward it while it is close.' },
  };
  D.AFFIX_IDS = Object.keys(D.AFFIXES);

  /* ---------- Run rules: every knob a Rift Depth or a daily mutator can turn ---------- */
  D.baseRules = () => ({
    hp: 1, dmg: 1, speed: 1,          // the horde: health, damage, movement
    bossHp: 0.55, bossRage: 0.4,         // bosses: health, and the share of health at which they enrage
    eliteN: 1, eliteEvery: 1, affixes: 1, hordeEvery: 1,
    chestCost: 1, heal: 1, xp: 1,     // heal covers pickups, tonics and the level-up breather
    pDmg: 1, pHp: 1, pSpeed: 1, dashCd: 1, noWard: false, startRelics: 0, // the hero
    react: 1,                         // reactions: how often they may trigger and how hard they hit
    breachEvery: 1, hoarderEvery: 1, startPacts: 0, early: 1, // map events, pacts struck before the run, and how soon each enemy type arrives
    score: 1, essence: 1,
  });

  /*
   * Rift Depths: beating the Rift Lord at your deepest unlocked depth opens the next. Each depth keeps every modifier
   * above it, and the rift itself hardens a little with every step (DEPTH_HP, DEPTH_DMG) so the ladder climbs evenly
   * instead of only at the modifiers that touch raw numbers. The deep depths are
   * where a full skill tree is meant to be tested: at depth 0 it wins every run.
   */
  D.DEPTH_HP = 1.095;  // horde health per depth, compounding
  D.DEPTH_DMG = 1.055; // enemy damage per depth, compounding
  D.DEPTHS = [
    { name: 'Thick Hides',     icon: 'armor',     text: 'The horde has 15% more health.',                      apply: (r) => { r.hp *= 1.15; } },
    { name: 'Sharpened Claws', icon: 'fang',      text: 'Enemies hit 15% harder.',                             apply: (r) => { r.dmg *= 1.15; } },
    { name: 'Twin Elites',     icon: 'skull',     text: 'Elites arrive in pairs.',                             apply: (r) => { r.eliteN += 1; } },
    { name: 'Quickening',      icon: 'boot',      text: 'Enemies move 8% faster.',                             apply: (r) => { r.speed *= 1.08; } },
    { name: 'Lean Pickings',   icon: 'coin',      text: 'Chests cost 40% more and healing is 25% weaker.',     apply: (r) => { r.chestCost *= 1.4; r.heal *= 0.75; } },
    { name: 'Short Fuse',      icon: 'bomb',      text: 'Bosses enrage at 65% health instead of 40%.',         apply: (r) => { r.bossRage = 0.65; } },
    { name: 'Restless',        icon: 'ghost',     text: 'Hordes arrive 30% more often.',                       apply: (r) => { r.hordeEvery *= 0.77; } },
    { name: 'Twisted Elites',  icon: 'mask',      text: 'Elites carry one more affix.',                        apply: (r) => { r.affixes += 1; } },
    { name: 'Titans',          icon: 'mountain',  text: 'Bosses have 40% more health.',                        apply: (r) => { r.bossHp *= 1.4; } },
    { name: 'The Abyss Stares Back', icon: 'eye', text: 'The horde has 25% more health and hits 15% harder.',  apply: (r) => { r.hp *= 1.25; r.dmg *= 1.15; } },
  ];
  D.DEPTH_MAX = D.DEPTHS.length;
  D.depthScore = (depth) => 1 + 0.15 * depth;   // mirrored in server.ts (scoreBounds)
  D.depthEssence = (depth) => 1 + 0.1 * depth;

  /* Daily mutators: one per day, picked by PS.Daily.spec (the id list there must match these keys) */
  D.MUTATORS = {
    glass:       { name: 'Glass Rift',     icon: 'target',    text: 'You deal 40% more damage, with 35% less health.',                 apply: (r) => { r.pDmg *= 1.4; r.pHp *= 0.65; } },
    restless:    { name: 'Restless Dead',  icon: 'ghost',     text: 'Hordes arrive twice as often.',                                   apply: (r) => { r.hordeEvery *= 0.5; } },
    parade:      { name: 'Elite Parade',   icon: 'skull',     text: 'Elites arrive twice as often and carry one more affix.',          apply: (r) => { r.eliteEvery *= 0.5; r.affixes += 1; } },
    quicksilver: { name: 'Quicksilver',    icon: 'wings',     text: 'You and every enemy move 20% faster.',                            apply: (r) => { r.pSpeed *= 1.2; r.speed *= 1.2; } },
    flux:        { name: 'Elemental Flux', icon: 'spark',     text: 'Reactions trigger twice as often and hit twice as hard.',         apply: (r) => { r.react *= 2; } },
    hoard:       { name: 'Dragon\'s Due',  icon: 'chest',     text: 'Start with 2 relics. Chests cost twice as much.',                 apply: (r) => { r.startRelics += 2; r.chestCost *= 2; } },
    openguard:   { name: 'Open Guard',     icon: 'dash',      text: 'No Ward. Your dash recharges 40% faster.',                        apply: (r) => { r.noWard = true; r.dashCd *= 0.6; } },
    scholar:     { name: 'Scholar\'s Rift', icon: 'book',     text: '40% more experience, but the horde has 25% more health.',         apply: (r) => { r.xp *= 1.4; r.hp *= 1.25; } },
  };
  Object.assign(D.MUTATORS, {
    breached:  { name: 'Torn Sky',        icon: 'rift',      text: 'Breaches open three times as often.',                              apply: (r) => { r.breachEvery *= 0.34; } },
    pacted:    { name: 'Sworn In',        icon: 'blood',     text: 'You begin with two pacts already struck, prices and all.',         apply: (r) => { r.startPacts += 2; } },
    goldrush:  { name: 'Gold Rush',       icon: 'coin',      text: 'Hoarders appear three times as often. Chests cost 50% more.',     apply: (r) => { r.hoarderEvery *= 0.34; r.chestCost *= 1.5; } },
    menagerie: { name: 'Menagerie',       icon: 'paw',       text: 'Every kind of enemy arrives in the first few minutes. 25% more experience.', apply: (r) => { r.early *= 0.3; r.xp *= 1.25; } },
  });
  for (const id in D.MUTATORS) D.MUTATORS[id].id = id;

  /** the rules for a run at this depth, with this mutator (either may be absent) */
  D.rules = function (depth, mutator) {
    const r = D.baseRules();
    depth = Math.max(0, Math.min(D.DEPTH_MAX, depth | 0));
    for (let i = 0; i < depth; i++) D.DEPTHS[i].apply(r);
    r.hp *= Math.pow(D.DEPTH_HP, depth);
    r.dmg *= Math.pow(D.DEPTH_DMG, depth);
    if (mutator && D.MUTATORS[mutator]) D.MUTATORS[mutator].apply(r);
    r.depth = depth;
    r.mutator = mutator && D.MUTATORS[mutator] ? mutator : null;
    r.score = D.depthScore(depth);
    r.essence = D.depthEssence(depth);
    return r;
  };
})();
