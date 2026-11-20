/* POWERSCALING — reward generation: level-up cards, talents, relics, shrine boons */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, D = PS.Data;
  const OVER_BONUS = [0, 0.05, 0.10, 0.18, 0.30];
  const RELIC_W = [52, 30, 13, 4.2, 0.8];
  const LOOT = () => PS.RNG.loot(); // reward rolls have their own seeded stream (see seed.js)

  function sample(cands, n) {
    const out = [];
    const pool = cands.slice();
    while (out.length < n && pool.length) {
      const c = U.weighted(pool, LOOT);
      out.push(c);
      pool.splice(pool.indexOf(c), 1);
    }
    return out;
  }

  const R = {
    /* ------------------------------------------------------------ level-up */
    levelChoices(p) {
      const S = PS.Skills, luck = p.stats.luck;
      const cands = [];
      const evoTomes = new Set();

      for (const inst of p.skills) {
        const def = inst.def;
        if (def.evo && !inst.evolved) evoTomes.add(def.evo.tome);
        if (inst.level < S.MAX_LEVEL) {
          cands.push({ w: def.primary ? 2.8 : 2.6, type: 'skillup', id: inst.id });
        } else if (def.evo && !inst.evolved && p.hasTome(def.evo.tome)) {
          cands.push({ w: 60, type: 'evolve', id: inst.id });
        } else {
          cands.push({ w: 0.75, type: 'over', id: inst.id });
        }
      }
      if (p.skills.length < p.skillSlots) {
        for (const id of S.poolIds()) {
          if (p.hasSkill(id) || p.banned.has(id)) continue;
          const el = S.DEFS[id].el;
          cands.push({ w: p.aff[el] > 0 ? 0.9 : 0.45, type: 'skill', id });
        }
      }
      for (const t of p.tomes) {
        if (t.level < t.def.max && !p.banned.has(t.id)) cands.push({ w: evoTomes.has(t.id) ? 1.1 : 1.5, type: 'tome', id: t.id });
      }
      if (p.tomes.length < p.tomeSlots) {
        for (const id in D.TOMES) {
          if (p.hasTome(id) || p.banned.has(id)) continue;
          cands.push({ w: evoTomes.has(id) ? 1.5 : 0.8, type: 'tome', id });
        }
      }

      let picks = sample(cands, 3);
      // a freshly opened skill slot should always be offered something to fill it
      const opened = PS.SLOT_LEVELS.skill.includes(p.claimedLevel);
      if (p.skills.length < p.skillSlots && (p.skills.length < 3 || opened) && !picks.some((c) => c.type === 'skill')) {
        const sk = cands.filter((c) => c.type === 'skill');
        if (sk.length && picks.length) picks[picks.length - 1] = U.weighted(sk, LOOT);
      }
      const cards = picks.map((c) => R.card(p, c.type, c.id, luck));
      const fill = ['heal', 'gold', 'heal'];
      while (cards.length < 3) cards.push(R.card(p, fill[cards.length], null, luck));
      return cards;
    },

    card(p, type, id, luck) {
      const S = PS.Skills;
      const card = { type, id, tier: 0, icon: 'star', title: '', tag: '', desc: '', el: null, lines: [] };
      if (type === 'skill') {
        const def = S.DEFS[id];
        card.tier = D.rollRarity(luck);
        card.icon = def.icon; card.title = def.name; card.tag = 'New skill'; card.desc = def.desc; card.el = def.el;
        if (OVER_BONUS[card.tier]) card.lines.push(`+${Math.round(OVER_BONUS[card.tier] * 100)}% damage from rarity`);
        const n = p.aff[def.el] + 1;
        const th = D.AFFINITY[def.el].find((a) => a.n === n);
        if (th) card.lines.push(`Unlocks ${D.ELEMENTS[def.el].name} ${n}: ${th.text}`);
        // a new element reacts with every element already in the build
        const own = D.ELEMENT_IDS.filter((e) => p.skills.some((k) => k.def.el === e));
        if (!own.includes(def.el)) {
          const rx = D.reactionsWith(def.el, own);
          if (rx.length) card.lines.push('Reacts: ' + rx.slice(0, 2).map((r) => `${r.name} with ${D.ELEMENTS[r.els[0] === def.el ? r.els[1] : r.els[0]].name}`).join(', ') + (rx.length > 2 ? `, and ${rx.length - 2} more` : ''));
        }
      } else if (type === 'skillup') {
        const inst = p.hasSkill(id), def = inst.def;
        card.tier = D.rollRarity(luck);
        card.icon = def.icon; card.title = def.name; card.el = def.el;
        card.tag = `Level ${inst.level} to ${inst.level + 1}`;
        card.desc = S.upText(def, inst.level + 1);
        if (OVER_BONUS[card.tier]) card.lines.push(`+${Math.round(OVER_BONUS[card.tier] * 100)}% damage from rarity`);
        if (inst.level + 1 === S.MAX_LEVEL && def.evo) card.lines.push(`Max level. Evolves with the ${D.TOMES[def.evo.tome].name}.`);
      } else if (type === 'evolve') {
        const inst = p.hasSkill(id), def = inst.def;
        card.tier = 4; card.special = 'evolve';
        card.icon = def.icon; card.title = def.evo.name; card.el = def.el;
        card.tag = `Evolution of ${def.name}`;
        card.desc = def.evo.desc;
      } else if (type === 'over') {
        const inst = p.hasSkill(id), def = inst.def;
        card.tier = D.rollRarity(luck);
        card.val = 0.08 * D.RARITY[card.tier].mult;
        card.icon = def.icon; card.title = inst.name; card.el = def.el;
        card.tag = 'Overcharge';
        card.desc = `+${Math.round(card.val * 100)}% damage for this skill. No limit.`;
      } else if (type === 'tome') {
        const def = D.TOMES[id], t = p.hasTome(id);
        card.tier = def.fixed ? 3 : D.rollRarity(luck, def.minRar || 0);
        const inc = D.incFor(def, card.tier);
        card.icon = def.icon; card.title = def.name;
        card.tag = t ? `Level ${t.level} to ${t.level + 1}` : 'New tome';
        card.desc = def.cardText || `+${def.fmt(inc)} ${def.stat.toLowerCase()}.`;
        if (def.extra) card.lines.push(def.extra);
        // hint when this tome is the key to an evolution
        for (const inst of p.skills) {
          if (inst.def.evo && inst.def.evo.tome === id && !inst.evolved) card.lines.push(`Evolves ${inst.def.name} into ${inst.def.evo.name}.`);
        }
      } else if (type === 'heal') {
        card.icon = 'potion'; card.title = 'Rift Tonic'; card.tag = 'Supplies'; card.desc = `Restore ${Math.round(40 * PS.G.rules.heal * (1 + (p.stats.m.healMore || 0)))}% of your health.`;
      } else if (type === 'gold') {
        card.icon = 'coin'; card.title = 'Coin Purse'; card.tag = 'Supplies'; card.val = 30 + p.level * 2; card.desc = `Gain ${card.val} gold.`;
      }
      return card;
    },

    /** one option per branch: the next unlearned node */
    talentChoices(p) {
      const cards = [];
      // only one path may reach its final tier: taking a capstone closes the other two
      const capped = p.talents.some((r, i) => r >= p.cls.branches[i].nodes.length);
      p.cls.branches.forEach((br, bi) => {
        const rank = p.talents[bi];
        if (rank >= br.nodes.length) return;
        if (capped && rank >= br.nodes.length - 1) return;
        const node = br.nodes[rank];
        cards.push({
          type: 'talent', id: bi, tier: 3, special: 'talent', icon: node.icon, title: node.name, color: br.color,
          tag: `${br.name}, tier ${rank + 1} of ${br.nodes.length}`, desc: node.desc,
          lines: rank === br.nodes.length - 1 ? ['Final tier. Choosing it closes the other two capstones.'] : [],
        });
      });
      return cards;
    },

    /* ------------------------------------------------------------ relics */
    rollRelic(p, minTier, exclude) {
      const f = 1 + Math.max(0, p.stats.luck) / 100;
      const byTier = [[], [], [], [], []];
      for (const id in D.RELICS) {
        const r = D.RELICS[id];
        if ((p.relics[id] || 0) >= r.max) continue;
        if (exclude && exclude.has(id)) continue;
        byTier[r.tier].push(r);
      }
      const ws = RELIC_W.map((w, i) => ({ w: i >= (minTier || 0) && byTier[i].length ? w * Math.pow(f, i) : 0, i }));
      if (!ws.some((x) => x.w > 0)) {
        for (let i = 0; i < 5; i++) if (byTier[i].length) return U.pick(byTier[i], LOOT);
        return null;
      }
      return U.pick(byTier[U.weighted(ws, LOOT).i], LOOT);
    },
    relicChoices(p, n, minTier) {
      const cards = [], seen = new Set();
      for (let i = 0; i < n; i++) {
        const r = R.rollRelic(p, i === 0 ? minTier : 0, seen);
        if (!r) break;
        seen.add(r.id);
        const have = p.relics[r.id] || 0;
        cards.push({ type: 'relic', id: r.id, tier: r.tier, icon: r.icon, title: r.name, tag: have ? `Relic, you own ${have}` : 'Relic', desc: r.desc,
          lines: (!have && !PS.G.bot && !PS.Save.data.codex.relics[r.id] ? ['New to your codex'] : []).concat(have ? [] : (D.SETS_OF[r.id] || []).map((st) => {
            const got = st.ids.filter((id) => p.relics[id] > 0).length;
            return got === st.ids.length - 1 ? `Completes ${st.name}: ${st.text}` : `Part of ${st.name} (${got + 1} of ${st.ids.length})`;
          })) });
      }
      if (!cards.length) cards.push(R.card(p, 'gold', null, 0));
      return cards;
    },

    /* ------------------------------------------------------------ shrine boons */
    boonChoices(p) {
      const ids = U.shuffle(Object.keys(D.BOONS), LOOT).slice(0, 3);
      return ids.map((id) => {
        const def = D.BOONS[id], tier = D.rollRarity(p.stats.luck + 25);
        return { type: 'boon', id, tier, icon: def.icon, title: def.name, tag: 'Shrine blessing', desc: `+${def.fmt(D.incFor(def, tier))} ${def.stat.toLowerCase()}, permanently.`, lines: [] };
      });
    },

    /* ------------------------------------------------------------ the forge: a level for a skill you choose */
    forgeChoices(p) {
      const S = PS.Skills;
      // every skill is on the table: a level while it has one to gain, an overcharge after (an evolution still needs its tome)
      return p.skills.map((inst) => {
        const c = R.card(p, inst.level < S.MAX_LEVEL ? 'skillup' : 'over', inst.id, p.stats.luck);
        c.tier = Math.max(c.tier, 1);
        return c;
      });
    },

    /* ------------------------------------------------------------ altar pacts */
    pactChoices(p) {
      const ids = U.shuffle(Object.keys(D.PACTS).filter((id) => !p.pacts.includes(id)), LOOT).slice(0, 3);
      return ids.map((id) => {
        const def = D.PACTS[id];
        return { type: 'pact', id, tier: 3, special: 'pact', icon: def.icon, title: def.name, color: '#ff5a7a', tag: 'Pact', desc: def.gift, price: def.price, lines: [] };
      });
    },

    /* ------------------------------------------------------------ apply */
    apply(p, card) {
      const S = PS.Skills;
      switch (card.type) {
        case 'skill': {
          const inst = p.addSkill(card.id);
          inst.over += OVER_BONUS[card.tier];
          break;
        }
        case 'skillup': {
          const inst = p.hasSkill(card.id);
          inst.level++;
          inst.over += OVER_BONUS[card.tier];
          S.rebuild(inst);
          p.recalc();
          break;
        }
        case 'evolve': {
          const inst = p.hasSkill(card.id);
          inst.evolved = true;
          S.rebuild(inst);
          p.recalc();
          PS.Audio.play('evolve');
          PS.FX.flash(D.ELEMENTS[inst.def.el].color, 0.4);
          PS.FX.surge(p.x, p.y, D.ELEMENTS[inst.def.el].glow, true);
          PS.UI.toast(inst.name + ' awakened', inst.def.icon);
          break;
        }
        case 'over': p.hasSkill(card.id).over += card.val; break;
        case 'tome': p.addTome(card.id, card.tier); break;
        case 'talent':
          p.talents[card.id]++;
          p.recalc();
          PS.Audio.play('ascend');
          PS.FX.flash(p.cls.color, 0.35);
          PS.FX.surge(p.x, p.y, p.cls.color, false);
          break;
        case 'relic': p.addRelic(card.id); PS.Audio.play('relic'); break;
        case 'boon': p.addBoon(card.id, card.tier); break;
        case 'pact': p.addPact(card.id); PS.G.pactsStruck++; PS.G.pactsAtAltar.push(card.id); PS.Audio.play('ascend', { pitch: 0.7 }); PS.FX.flash('#ff2846', 0.3); PS.FX.surge(p.x, p.y, '#ff5a7a', false); break;
        case 'heal': p.heal(p.stats.maxHp * 0.4 * PS.G.rules.heal * (1 + (p.stats.m.healMore || 0))); PS.Audio.play('heal'); break;
        case 'gold': p.gold += card.val; PS.Audio.play('gold'); break;
      }
      PS.G.picks.push({ t: Math.floor(PS.G.time), type: card.type, title: card.title });
    },
  };

  PS.Rewards = R;
})();
