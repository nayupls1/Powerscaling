/* POWERSCALING — DOM interface: menus, HUD, reward cards, pause sheet, results */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const U = PS.U, D = PS.Data;
  const $ = (id) => document.getElementById(id);
  const esc = U.esc;
  const ico = (name, size, color) => PS.Icons.svg(name, { size: size || 20, color: color || 'currentColor' });
  const CLASS_ICON = { vanguard: 'sword', pyromancer: 'flame', ranger: 'bow', reaper: 'scythe', stormcaller: 'thunder' };

  let hudT = 0, loadoutSig = '', affSig = '', dashSig = null, curSpec = null, choiceAt = 0, banishMode = false;
  let selClass = 'vanguard', selNode = 'm1', boardTab = 'all', bannerT = 0, lastScreen = 'scrTitle', padCard = 1;

  function hydrate(root) {
    (root || document).querySelectorAll('i[data-icon]').forEach((el) => {
      if (!el.firstChild) el.innerHTML = ico(el.dataset.icon, +el.dataset.size || 18);
    });
  }
  function click(el, fn) {
    el.addEventListener('click', (e) => { PS.Audio.play('uiClick', { vol: 0.5 }); fn(e); });
  }
  function elColor(el) { return el ? D.ELEMENTS[el].color : '#efe8d8'; }
  /** which element a damage source belongs to (skills, their evolutions, statuses, affinity procs, reactions), or null */
  let SRC_EL = null;
  function srcEl(name) {
    if (!SRC_EL) {
      SRC_EL = { Burn: 'fire', Poison: 'venom', Bleed: 'steel', Tempest: 'storm', 'Ember burst': 'fire', Shatter: 'frost', Implosion: 'void' };
      for (const id in PS.Skills.DEFS) { const k = PS.Skills.DEFS[id]; SRC_EL[k.name] = k.el; if (k.evo) SRC_EL[k.evo.name] = k.el; }
      for (const key in D.REACTIONS) SRC_EL[D.REACTIONS[key].name] = D.REACTIONS[key].els[1];
    }
    return SRC_EL[name] || null;
  }
  /** a round axis maximum at or above v (1, 2, 2.5 or 5 times a power of ten) */
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  const mmss = (sec) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

  const UI = {
    /* ================================================================ boot */
    init() {
      hydrate();
      // logo: each letter larger than the last
      const word = 'POWERSCALING';
      $('logo').innerHTML = word.split('').map((ch, i) => {
        const t = i / (word.length - 1);
        return `<span style="font-size:${(0.42 + Math.pow(t, 1.6) * 1.18).toFixed(3)}em;font-weight:${t < 0.3 ? 700 : t < 0.65 ? 800 : 900};--t:${t.toFixed(3)}">${ch}</span>`;
      }).join('');

      click($('navPlay'), () => this.showScreen('scrClass'));
      click($('navDaily'), () => this.showScreen('scrDaily'));
      click($('navTree'), () => this.showScreen('scrTree'));
      click($('navFeats'), () => this.showScreen('scrFeats'));
      click($('navBoard'), () => this.showScreen('scrBoard'));
      click($('navHelp'), () => this.showScreen('scrHelp'));
      click($('navSettings'), () => this.showScreen('scrSettings'));
      document.querySelectorAll('[data-back]').forEach((b) => click(b, () => this.showScreen('scrTitle')));
      click($('btnPause'), () => PS.Game.pause());
      click($('pauseResume'), () => PS.Game.resume());
      click($('pauseSettings'), () => this.openSettingsOverlay());
      click($('ovSettingsClose'), () => { $('ovSettings').hidden = true; });
      const quit = $('pauseQuit');
      click(quit, () => {
        if (quit.dataset.armed) { delete quit.dataset.armed; quit.textContent = 'End run'; this.hidePause(); PS.Game.endRun(true); }
        else { quit.dataset.armed = '1'; quit.textContent = 'Really end the run?'; }
      });

      // tooltips
      const tip = $('tooltip');
      document.addEventListener('mouseover', (e) => {
        const t = e.target.closest && e.target.closest('[data-tip]');
        if (!t) { tip.hidden = true; return; }
        tip.innerHTML = t.dataset.tip;
        tip.hidden = false;
        const r = t.getBoundingClientRect();
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 10;
        if (y < 8) y = r.bottom + 10;
        tip.style.left = U.clamp(x, 8, window.innerWidth - tw - 8) + 'px';
        tip.style.top = y + 'px';
      });
      document.addEventListener('mouseover', (e) => {
        if (e.target.closest && e.target.closest('button') && e.relatedTarget && !e.target.closest('button').contains(e.relatedTarget)) PS.Audio.play('uiHover', { vol: 0.25 });
      });

      // server sync: progress or board rows can arrive after the menu is already on screen
      window.addEventListener('ps:sync', () => { if (PS.Game.state === 'menu') this.showScreen(lastScreen); });
      window.addEventListener('ps:board', (e) => {
        if (PS.Game.state !== 'menu') return;
        if (lastScreen === 'scrBoard' && e.detail && e.detail.cls === boardTab) this.renderBoard(true);
        if (lastScreen === 'scrDaily' && e.detail && e.detail.cls === 'daily') this.renderDaily(true);
        if (lastScreen === 'scrTitle' && e.detail && e.detail.cls === 'all') this.renderTitle();
      });
      window.addEventListener('ps:run', (e) => this.showWorldRank(e.detail));
      if (PS.Save.ready) PS.Save.ready.then(() => { if (PS.Game.state === 'menu' && lastScreen === 'scrTitle') this.renderTitle(); });

      selClass = D.CLASSES[PS.Save.data.lastClass] && PS.Save.data.unlocked[PS.Save.data.lastClass] ? PS.Save.data.lastClass : 'vanguard';
      this.showMenu();
      if (/[?&]bot=1/.test(location.search)) setTimeout(() => PS.Game.start(selClass, { bot: {} }), 300);
    },

    /* ================================================================ menu screens */
    showMenu() {
      $('hud').hidden = true;
      $('touch').hidden = true;
      $('ovChoice').hidden = true; $('ovPause').hidden = true; $('ovOver').hidden = true;
      $('screens').hidden = false;
      this.showScreen('scrTitle');
    },
    showScreen(id) {
      document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
      lastScreen = id;
      if (id === 'scrTitle') this.renderTitle();
      if (id === 'scrClass') this.renderClasses();
      if (id === 'scrDaily') this.renderDaily();
      if (id === 'scrTree') this.renderTree();
      if (id === 'scrBoard') this.renderBoard();
      if (id === 'scrHelp') this.renderHelp();
      if (id === 'scrFeats') this.renderFeats();
      if (id === 'scrSettings') this.renderSettings($('settingsBody'));
    },
    renderTitle() {
      const d = PS.Save.data, st = d.stats;
      $('navEssence').innerHTML = `${ico('essence', 14)} ${U.fmtNum(d.essence)}`;
      const affordable = D.META.some((n) => (d.tree[n.id] || 0) < n.max && this.nodeOpen(n) && d.essence >= D.metaCost(n, d.tree[n.id] || 0));
      $('navTree').classList.toggle('has-news', affordable);
      const fs = PS.Feats.summary();
      $('navFeatsPill').innerHTML = `${ico('trophy', 13)} ${fs.done} / ${fs.total}`;
      const scope = PS.Save.boardScope ? PS.Save.boardScope('all') : 'device';
      const top = PS.Save.board().slice(0, 5);
      const day = this.dailyInfo();
      $('navDailyPill').textContent = day.cls.name;
      $('navDaily').classList.toggle('has-news', !day.mine.attempts);
      $('titleSide').innerHTML = `
        <div class="side-card">
          <div class="board-head"><h3>Today's rift</h3><span class="scope">Resets in ${day.left}</span></div>
          <p class="daily-line"><span class="swatch" style="--c:${day.cls.color}"></span><b>${day.cls.name}</b> with ${esc(day.mut.name)}</p>
          <p class="muted">${esc(day.mut.text)}</p>
          ${day.mine.attempts ? `<p class="hint">Your best today: ${U.fmtNum(day.mine.best)}</p>` : ''}
        </div>
        <div class="side-card">
          <h3>Your record</h3>
          ${st.runs ? `
          <dl class="record">
            <div><dt>Best score</dt><dd>${U.fmtNum(st.bestScore)}</dd></div>
            <div><dt>Longest run</dt><dd>${U.fmtTime(st.bestTime)}</dd></div>
            <div><dt>Runs</dt><dd>${st.runs}</dd></div>
            <div><dt>Bosses slain</dt><dd>${st.bosses}</dd></div>
          </dl>` : `<p class="muted">No runs yet. The first boss arrives at 3:00. Last that long and the Reaper is yours.</p>`}
          ${affordable ? `<p class="hint">${ico('essence', 14)} You can afford a skill tree upgrade.</p>` : ''}
        </div>
        ${top.length ? `<div class="side-card">
          <div class="board-head"><h3>Top runs</h3><span class="scope ${scope}">${scope === 'global' ? 'Everyone' : 'This device'}</span></div>
          <ol class="mini-board">${top.map((r) => {
            const c = D.CLASSES[r.cls];
            return `<li class="${r.mine ? 'mine' : ''}"><span>${esc(r.name)}<small style="--c:${c ? c.color : ''}">${c ? c.name : ''}</small></span><b>${U.fmtNum(r.score)}</b></li>`;
          }).join('')}</ol>
        </div>` : ''}`;
    },

    renderClasses() {
      const d = PS.Save.data;
      const grid = $('classGrid');
      grid.innerHTML = D.CLASS_IDS.map((id) => {
        const c = D.CLASSES[id], locked = !d.unlocked[id], clear = d.depth.clear[id];
        return `<button class="class-card${id === selClass ? ' sel' : ''}${locked ? ' locked' : ''}" data-cls="${id}" style="--c:${c.color}">
          <span class="class-ico">${ico(locked ? 'lock' : CLASS_ICON[id], 34)}</span>
          <span class="class-name">${c.name}</span>
          <span class="class-title">${locked ? c.unlock.text : c.title}</span>
          ${clear >= 0 ? `<span class="class-clear">${ico('crown', 13)} ${clear > 0 ? 'Depth ' + clear + ' cleared' : 'Rift Lord slain'}</span>` : ''}
        </button>`;
      }).join('');
      grid.querySelectorAll('.class-card').forEach((b) => click(b, () => { selClass = b.dataset.cls; this.renderClasses(); }));
      const c = D.CLASSES[selClass], locked = !d.unlocked[selClass];
      const prim = PS.Skills.DEFS[c.primary], el = D.ELEMENTS[prim.el];
      const base = Object.assign({ maxHp: 100, speed: 210, armor: 0 }, c.base);
      $('classDetail').innerHTML = `
        <div class="cd-main" style="--c:${c.color}">
          <p class="cd-blurb">${c.blurb}</p>
          <div class="cd-stats">
            <span>${ico('heart', 16)} ${base.maxHp} health</span>
            <span>${ico('boot', 16)} ${base.speed} speed</span>
            ${base.armor ? `<span>${ico('shield', 16)} ${base.armor} armor</span>` : ''}
            <span>${ico('swords', 16)} ${c.difficulty} to play</span>
          </div>
          <div class="cd-kit">
            <div class="kit"><span class="kit-ico" style="--c:${el.color}">${ico(prim.icon, 26)}</span><div><b>${prim.name}</b><small>Attack, ${el.name}</small><p>${prim.desc}</p></div></div>
            <div class="kit"><span class="kit-ico" style="--c:${c.color}">${ico(c.ability.icon, 26)}</span><div><b>${c.ability.name}</b><small>Ability, ${c.ability.cd}s cooldown</small><p>${c.ability.desc}</p></div></div>
            <div class="kit"><span class="kit-ico" style="--c:#bcd0ff">${ico('dash', 26)}</span><div><b>${c.dashName}</b><small>Dash</small><p>A quick burst of movement. You cannot be hurt while dashing.${c.passive ? ' ' + c.passive : ''}</p></div></div>
          </div>
          ${this.depthPicker()}
          <button class="btn btn-primary btn-big" id="btnBegin" ${locked ? 'disabled' : ''}>${locked ? c.unlock.text : d.depth.sel ? 'Begin at depth ' + d.depth.sel : 'Begin run'}</button>
        </div>
        <div class="cd-tree">
          <h3>Ascension paths <small>one talent every 6 levels, and only one path can reach its final tier</small></h3>
          <div class="branches">${c.branches.map((br) => `
            <div class="branch" style="--c:${br.color}">
              <h4>${ico(br.icon, 18)} ${br.name}</h4>
              <ol>${br.nodes.map((n) => `<li><b>${n.name}</b><span>${n.desc}</span></li>`).join('')}</ol>
            </div>`).join('')}
          </div>
        </div>`;
      const begin = $('btnBegin');
      if (!locked) click(begin, () => PS.Game.start(selClass));
      const step = (id, by) => { const b = $(id); if (b) click(b, () => { d.depth.sel = U.clamp(d.depth.sel + by, 0, d.depth.max); PS.Save.save(); this.renderClasses(); }); };
      step('depthDown', -1); step('depthUp', 1);
    },
    /** Rift Depth stepper on the class screen: the modifiers stack, so the list shows everything in force */
    depthPicker() {
      const dp = PS.Save.data.depth;
      if (!dp.max) return `<p class="depth-hint">${ico('lock', 14)} Slay the Rift Lord to open Rift Depth 1: a harder rift, for more score and Essence.</p>`;
      const n = dp.sel, pct = (v) => '+' + Math.round((v - 1) * 100) + '%', r = D.rules(n);
      return `<div class="depth">
        <div class="depth-head">
          <span><b>Rift Depth</b><small>${n ? `${pct(D.depthScore(n))} score, ${pct(D.depthEssence(n))} Essence` : 'The rift as you first met it'}</small></span>
          <span class="stepper"><button class="btn btn-small" id="depthDown" aria-label="Shallower" ${n <= 0 ? 'disabled' : ''}>−</button><b class="depth-num" aria-live="polite">${n}</b><button class="btn btn-small" id="depthUp" aria-label="Deeper" ${n >= dp.max ? 'disabled' : ''}>+</button></span>
        </div>
        ${n ? `<ul class="mods">${D.DEPTHS.slice(0, n).map((m, i) => `<li>${ico(m.icon, 15)}<b>${i + 1}. ${m.name}</b><span>${m.text}</span></li>`).join('')}</ul>
        <p class="depth-total">With the rift hardening at every depth, the horde has <b>${pct(r.hp)}</b> health and hits <b>${pct(r.dmg)}</b> harder in all.</p>` : ''}
        <small class="muted">${n < dp.max ? `Depth ${dp.max} is your deepest so far.` : dp.max < D.DEPTH_MAX ? `Win at depth ${dp.max} to open depth ${dp.max + 1}: ${D.DEPTHS[dp.max].name}.` : 'This is the bottom of the rift.'}</small>
      </div>`;
    },

    /* ---------------------------------------------------------------- daily rift */
    dailyInfo() {
      const d = PS.Save.data, date = PS.Save.today(), spec = PS.Daily.spec(date);
      const ms = PS.Save.untilReset(), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      return {
        date, spec, cls: D.CLASSES[spec.cls], mut: D.MUTATORS[spec.mutator],
        mine: d.daily.date === date ? d.daily : { best: 0, attempts: 0, runs: [] },
        left: h ? `${h}h ${m}m` : `${Math.max(1, m)}m`,
      };
    },
    renderDaily(fromServer) {
      const day = this.dailyInfo(), c = day.cls, mut = day.mut;
      if (!fromServer && PS.Save.fetchBoard) PS.Save.fetchBoard('daily');
      const global = PS.Save.boardScope('daily') === 'global', rows = PS.Save.board('daily').slice(0, 20);
      $('dailyDate').textContent = new Date(day.date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
      $('dailyBody').innerHTML = `
        <div class="cd-main" style="--c:${c.color}">
          <div class="daily-class"><span class="class-ico">${ico(CLASS_ICON[day.spec.cls], 40)}</span><div><small>Today's class</small><b>${c.name}</b><span>${c.title}</span></div></div>
          <div class="kit"><span class="kit-ico" style="--c:#f0b94a">${ico(mut.icon, 26)}</span><div><b>${esc(mut.name)}</b><small>Today's mutator</small><p>${esc(mut.text)}</p></div></div>
          <ul class="rules">
            <li>Everyone plays the same seed: the same hordes and the same elites, in the same order.</li>
            <li>Every hero gets the full skill tree, so the board compares play, not grind.</li>
            <li>Play as often as you like. Your best run of the day counts.</li>
            <li>Your first run each day pays double Essence.</li>
          </ul>
          <dl class="record three">
            <div><dt>Your best today</dt><dd>${day.mine.attempts ? U.fmtNum(day.mine.best) : 'None yet'}</dd></div>
            <div><dt>Runs today</dt><dd>${day.mine.attempts}</dd></div>
            <div><dt>Resets in</dt><dd>${day.left}</dd></div>
          </dl>
          <button class="btn btn-primary btn-big" id="btnDaily">Enter today's rift</button>
        </div>
        <div class="cd-tree">
          <div class="board-head"><h3>Today's board</h3><span class="scope ${global ? 'global' : ''}">${global ? 'Everyone, best run each' : 'This device'}</span></div>
          ${rows.length ? `<table class="board-table compact"><thead><tr><th>#</th><th>Name</th><th class="num">Score</th><th class="num">Time</th><th class="num">Level</th></tr></thead>
            <tbody>${rows.map((r, i) => `<tr class="${i < 3 ? 'top' + (i + 1) : ''}${r.mine ? ' mine' : ''}"><td>${i + 1}</td><td class="nm">${esc(r.name)}${r.won ? ` <span class="won" data-tip="Slew the Rift Lord">${ico('crown', 14)}</span>` : ''}</td>
              <td class="num score">${Math.round(r.score).toLocaleString('en-US')}</td><td class="num">${U.fmtTime(r.time)}</td><td class="num">${r.level}</td></tr>`).join('')}</tbody></table>`
            : '<p class="muted">Nobody has entered today\'s rift yet. Set the mark.</p>'}
        </div>`;
      click($('btnDaily'), () => PS.Game.start(day.spec.cls, { daily: true }));
    },

    /* ---------------------------------------------------------------- meta tree */
    nodeOpen(n) {
      const tree = PS.Save.data.tree;
      return n.req.some((r) => r === 'core' || (tree[r] || 0) > 0);
    },
    renderTree() {
      const d = PS.Save.data, tree = d.tree;
      $('treeEssence').textContent = U.fmtNum(d.essence);
      const SPAN = 6.9; // layout units from centre to edge
      const pos = (v) => (50 + (v / SPAN) * 50).toFixed(2) + '%';
      let lines = '';
      for (const n of D.META) {
        for (const r of n.req) {
          const a = r === 'core' ? { x: 0, y: 0 } : D.META_BY_ID[r];
          const lit = (tree[n.id] || 0) > 0;
          lines += `<line x1="${a.x}" y1="${a.y}" x2="${n.x}" y2="${n.y}" class="${lit ? 'lit' : ''}" style="--c:${D.META_ARMS[n.arm].color}"/>`;
        }
      }
      const nodes = D.META.map((n) => {
        const rank = tree[n.id] || 0, open = this.nodeOpen(n), cost = D.metaCost(n, rank);
        const cls = rank >= n.max ? 'max' : rank > 0 ? 'own' : open ? (d.essence >= cost ? 'can' : 'open') : 'locked';
        return `<button class="tnode ${cls}${n.id === selNode ? ' sel' : ''}${n.max === 1 && n.cost >= 400 ? ' cap' : ''}" data-node="${n.id}" style="left:${pos(n.x)};top:${pos(n.y)};--c:${D.META_ARMS[n.arm].color}" aria-label="${esc(n.name)}">
          ${ico(n.icon, 24)}<span class="trank">${rank}/${n.max}</span></button>`;
      }).join('');
      $('treeCanvas').innerHTML = `
        <div class="tree-square">
          <svg viewBox="${-SPAN} ${-SPAN} ${SPAN * 2} ${SPAN * 2}" class="tree-lines" aria-hidden="true">${lines}</svg>
          <div class="tcore" style="left:50%;top:50%">${ico('essence', 30)}</div>
          ${Object.keys(D.META_ARMS).map((k) => {
            const a = D.META_ARMS[k];
            const p = { might: [0, -6.75], vitality: [-5.4, -2.0], fortune: [5.4, -2.0], mastery: [0, 6.75] }[k];
            return `<span class="tarm" style="left:${pos(p[0])};top:${pos(p[1])};color:${a.color}">${a.name}</span>`;
          }).join('')}
          ${nodes}
        </div>`;
      $('treeCanvas').querySelectorAll('.tnode').forEach((b) => {
        b.addEventListener('click', () => {
          if (selNode === b.dataset.node) this.buyNode(selNode);
          else { selNode = b.dataset.node; PS.Audio.play('uiClick', { vol: 0.5 }); this.renderTree(); }
        });
      });
      this.renderTreeInfo();
    },
    renderTreeInfo() {
      const d = PS.Save.data, n = D.META_BY_ID[selNode], rank = d.tree[n.id] || 0;
      const open = this.nodeOpen(n), cost = D.metaCost(n, rank), maxed = rank >= n.max;
      const arm = D.META_ARMS[n.arm];
      const spent = D.META.reduce((sum, m) => { let s = 0; for (let i = 0; i < (d.tree[m.id] || 0); i++) s += D.metaCost(m, i); return sum + s; }, 0);
      $('treeInfo').innerHTML = `
        <div class="ti-head" style="--c:${arm.color}">
          <span class="ti-ico">${ico(n.icon, 30)}</span>
          <div><h3>${n.name}</h3><small style="color:${arm.color}">${arm.name}, rank ${rank} of ${n.max}</small></div>
        </div>
        <dl class="ti-effects">
          ${rank > 0 ? `<div><dt>Now</dt><dd>${n.desc(rank)}</dd></div>` : ''}
          ${!maxed ? `<div><dt>Next rank</dt><dd>${n.desc(rank + 1)}</dd></div>` : ''}
        </dl>
        ${maxed ? `<p class="ti-note">Fully mastered.</p>`
          : !open ? `<p class="ti-note">Locked. Buy a connected upgrade first.</p>`
          : `<button class="btn btn-primary btn-big" id="btnBuy" ${d.essence < cost ? 'disabled' : ''}>${d.essence < cost ? `Need ${U.fmtNum(cost - d.essence)} more Essence` : `Buy for ${U.fmtNum(cost)} Essence`}</button>`}
        <p class="ti-foot">Essence is earned at the end of every run, win or lose. Upgrades are permanent and apply to every class.</p>
        ${spent > 0 ? `<button class="btn btn-ghost" id="btnRefund">Refund all (${U.fmtNum(spent)} Essence)</button>` : ''}`;
      const buy = $('btnBuy');
      if (buy) buy.addEventListener('click', () => this.buyNode(n.id));
      const refund = $('btnRefund');
      if (refund) click(refund, () => {
        if (!refund.dataset.armed) { refund.dataset.armed = '1'; refund.textContent = 'Refund everything?'; return; }
        d.essence += spent; d.tree = {}; PS.Save.save(); this.renderTree();
      });
    },
    buyNode(id) {
      const d = PS.Save.data, n = D.META_BY_ID[id], rank = d.tree[id] || 0, cost = D.metaCost(n, rank);
      if (rank >= n.max || !this.nodeOpen(n) || d.essence < cost) { PS.Audio.play('deny', { vol: 0.5 }); return; }
      d.essence -= cost;
      d.tree[id] = rank + 1;
      PS.Save.save();
      PS.Audio.play('buy');
      this.renderTree();
    },

    /* ---------------------------------------------------------------- leaderboard */
    renderBoard(fromServer) {
      const tabs = ['all'].concat(D.CLASS_IDS, 'daily'), daily = boardTab === 'daily';
      $('boardTabs').innerHTML = tabs.map((t) => `<button class="tab${t === boardTab ? ' sel' : ''}" data-tab="${t}">${t === 'all' ? 'All classes' : t === 'daily' ? 'Daily rift' : D.CLASSES[t].name}</button>`).join('');
      $('boardTabs').querySelectorAll('.tab').forEach((b) => click(b, () => { boardTab = b.dataset.tab; this.renderBoard(); }));
      // show what we have now; the global rows re-render this when they arrive
      if (!fromServer && PS.Save.fetchBoard) PS.Save.fetchBoard(boardTab);
      const global = PS.Save.boardScope && PS.Save.boardScope(boardTab) === 'global';
      $('boardScope').textContent = daily ? (global ? 'Everyone today, best run each' : 'Your runs today') : global ? 'Everyone, worldwide' : 'Saved on this device';
      $('boardScope').classList.toggle('global', global);
      const rows = PS.Save.board(boardTab);
      if (!rows.length) {
        $('boardBody').innerHTML = `<div class="empty"><p>No runs recorded${boardTab === 'all' ? '' : daily ? ' in today\'s rift' : ' for this class'} yet.</p><button class="btn btn-primary" id="boardPlay">${daily ? 'See today\'s rift' : 'Enter the rift'}</button></div>`;
        click($('boardPlay'), () => this.showScreen(daily ? 'scrDaily' : 'scrClass'));
        return;
      }
      $('boardBody').innerHTML = `<table class="board-table">
        <thead><tr><th>#</th><th>Name</th><th>Class</th><th class="num">Depth</th><th class="num">Score</th><th class="num">Time</th><th class="num">Level</th><th class="num">Kills</th><th class="num">Bosses</th><th>Top damage</th><th>Date</th></tr></thead>
        <tbody>${rows.map((r, i) => {
          const c = D.CLASSES[r.cls] || { name: r.cls, color: '#fff' };
          return `<tr class="${i < 3 ? 'top' + (i + 1) : ''}${r.mine ? ' mine' : ''}">
            <td>${i + 1}</td><td class="nm">${esc(r.name)}${r.won ? ` <span class="won" data-tip="Slew the Rift Lord">${ico('crown', 14)}</span>` : ''}</td>
            <td style="color:${c.color}">${c.name}</td><td class="num">${r.depth ? r.depth : '<span class="muted">0</span>'}</td>
            <td class="num score">${Math.round(r.score).toLocaleString('en-US')}</td><td class="num">${U.fmtTime(r.time)}</td><td class="num">${r.level}</td>
            <td class="num">${Math.round(r.kills).toLocaleString('en-US')}</td><td class="num">${r.bosses}</td>
            <td class="muted">${esc((r.build || []).slice(0, 2).join(', '))}</td>
            <td class="muted">${new Date(r.date).toLocaleDateString()}</td></tr>`;
        }).join('')}</tbody></table>`;
    },

    renderFeats() {
      const have = PS.Save.data.feats, F = PS.Feats, s = F.summary();
      $('featsScope').innerHTML = `${s.done} of ${s.total} earned` + (s.left ? `, ${ico('essence', 13)} ${U.fmtNum(s.left)} Essence still to claim` : '');
      $('featsBody').innerHTML = Object.keys(F.GROUPS).map((g) => {
        const list = F.LIST.filter((f) => f.group === g);
        return `<section class="feat-group"><h3>${F.GROUPS[g]} <small>${list.filter((f) => have[f.id]).length} / ${list.length}</small></h3><ul class="feat-list">${list.map((f) => `
          <li class="feat${have[f.id] ? ' done' : ''}">
            <span class="feat-ico">${ico(have[f.id] ? f.icon : 'lock', 22)}</span>
            <span class="feat-text"><b>${esc(f.name)}</b><span>${esc(f.text)}</span></span>
            <span class="feat-ess">${have[f.id] ? ico('check', 14) : ico('essence', 13) + ' ' + f.essence}</span>
          </li>`).join('')}</ul></section>`;
      }).join('');
    },
    renderHelp() {
      const k = (s) => `<kbd>${s}</kbd>`;
      $('helpBody').innerHTML = `
        <div class="help-col">
          <h3>Controls</h3>
          <ul class="keys">
            <li>${k('W')}${k('A')}${k('S')}${k('D')}<span>Move</span></li>
            <li>${k('Mouse')}<span>Aim your attack. It fires on its own, or on click if you turn auto-attack off.</span></li>
            <li>${k('Space')}<span>Dash. Nothing can hurt you mid-dash. The bar under your hero fills as the next one recharges.</span></li>
            <li>${k('Shift')} or ${k('F')}<span>Ward. A shield pulse that reflects bullets and staggers the crowd.</span></li>
            <li>${k('Q')} or ${k('Right click')}<span>Class ability</span></li>
            <li>${k('T')}<span>Toggle auto-aim</span></li>
            <li>${k('Esc')}<span>Pause and inspect your build</span></li>
            <li>${k('1')}${k('2')}${k('3')}<span>Pick a reward card</span></li>
          </ul>
          <p class="muted">Touch screens get a movement stick and auto-aim. On a gamepad: left stick moves, right stick aims, A dashes, B wards, X uses your ability, Start pauses; in menus A confirms and B goes back.</p>
        </div>
        <div class="help-col">
          <h3>The run</h3>
          <p>Kill enemies, collect the gems they drop, level up. Every level offers three rewards: a new skill, an upgrade, or a tome that boosts your stats. Rarer cards are stronger. You start with only your class attack: new skill and tome slots open as you level, and the HUD shows when.</p>
          <p>Every 6 levels your class ascends: pick which of its three paths to advance. Only one path can reach its final tier, so choose your capstone with care.</p>
          <p>Gold opens chests on the map for relics. Elites and bosses drop them for free. Shrines grant a blessing if you hold the circle.</p>
          <p>Dark altars offer a pact: a strong gift with a price, both for the rest of the run. Step into a breach to wake it, then slay enough of what pours out before its timer burns down, and it leaves a relic.</p>
          <p>Your class attack cuts enemy bullets out of the air, and a well-timed Ward throws them back; both recharge your ability. Keep moving: the rift shells the ground wherever you stand.</p>
          <p>A boss arrives every 3 minutes. Beat the Rift Lord at 12:00 to win, then keep going for a bigger score.</p>
          <p>When a run ends, the summary charts your damage over time, lists every source of it, and shows what hurt you.</p>
        </div>
        <div class="help-col">
          <h3>Building power</h3>
          <p>Each skill belongs to one of six elements. Owning 2, 4 and 6 skills of the same element unlocks set bonuses, so a focused build is far stronger than a scattered one.</p>
          <ul class="els">${D.ELEMENT_IDS.map((id) => `<li style="--c:${D.ELEMENTS[id].color}">${ico(D.ELEMENTS[id].icon, 16)}<b>${D.ELEMENTS[id].name}</b><span>${D.AFFINITY[id][1].text}</span></li>`).join('')}</ul>
          <p>A skill at level 6 evolves if you own its matching tome. An evolved skill counts twice toward its element, and can then be overcharged without limit.</p>
        </div>
        <div class="help-col">
          <h3>Reactions</h3>
          <p>Mixing elements pays too. Hit one enemy with two different elements within 4 seconds and they react. Each enemy can react once every 3 seconds; your own skills set reactions off, relic and affinity procs do not.</p>
          <ul class="rxs">${Object.keys(D.REACTIONS).map((k) => { const r = D.REACTIONS[k]; return `<li><span class="rx-els">${r.els.map((e) => `<i style="--c:${D.ELEMENTS[e].color}" title="${D.ELEMENTS[e].name}">${ico(D.ELEMENTS[e].icon, 13)}</i>`).join('')}</span><b>${r.name}</b><span>${r.text}</span></li>`; }).join('')}</ul>
        </div>
        <div class="help-col">
          <h3>Elites and hordes</h3>
          <p>An elite arrives about once a minute and drops a relic chest. Every elite carries an affix, and its name tells you which:</p>
          <ul class="rxs">${D.AFFIX_IDS.map((id) => `<li><span class="rx-els"><i style="--c:${D.AFFIXES[id].color}"></i></span><b>${D.AFFIXES[id].name}</b><span>${D.AFFIXES[id].text}</span></li>`).join('')}</ul>
          <p>Hordes break over you in four shapes: a closing ring, a stampede from one side, a pincer from two, and a wall that sweeps the whole screen with a single gap to slip through.</p>
        </div>
        <div class="help-col">
          <h3>Going deeper</h3>
          <p>Slay the Rift Lord and Rift Depth 1 opens. Each depth adds one modifier on top of the ones before it, hardens the horde a little more (${Math.round((D.DEPTH_HP - 1) * 100)}% health and ${Math.round((D.DEPTH_DMG - 1) * 100)}% damage a depth), and multiplies your score and Essence. Win at your deepest depth to open the next; there are ${D.DEPTH_MAX}.</p>
          <ul class="rxs">${D.DEPTHS.map((m, i) => `<li><span class="rx-els"><i style="--c:#9b6bff">${i + 1}</i></span><b>${m.name}</b><span>${m.text}</span></li>`).join('')}</ul>
          <p>The daily rift is one seed a day, the same for everyone: a set class, a mutator that bends the rules, and the full skill tree for every hero. Your best run of the day goes on the daily board.</p>
        </div>`;
    },

    renderSettings(root) {
      const d = PS.Save.data, s = d.settings;
      const tog = (key, label, hint) => `<label class="set-row"><span><b>${label}</b><small>${hint}</small></span><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''}><i class="switch"></i></label>`;
      const sl = (key, label) => `<label class="set-row"><span><b>${label}</b></span><input type="range" min="0" max="1" step="0.05" value="${s[key]}" data-set="${key}"></label>`;
      root.innerHTML = `
        <label class="set-row"><span><b>Name</b><small>Shown on the leaderboard</small></span><input type="text" maxlength="14" value="${esc(d.name)}" placeholder="Wanderer" data-name></label>
        ${sl('sfx', 'Sound effects')}
        ${sl('music', 'Music')}
        ${tog('autoAim', 'Auto-aim', 'Attacks target the nearest enemy instead of where you point')}
        ${tog('autoFire', 'Auto-attack', 'Attack continuously without holding a button')}
        ${tog('heroBars', 'Hero bars', 'Health and dash charges shown under your hero')}
        ${tog('shake', 'Screen shake', 'Camera shake on impacts')}
        ${tog('dmgNums', 'Damage numbers', 'Floating numbers over enemies')}
        <label class="set-row"><span><b>Graphics</b><small>Auto lowers the resolution while frames run slow, and raises it again when they recover</small></span>
          <select data-quality>${[['auto', 'Auto'], ['high', 'Sharp'], ['low', 'Fast']].map(([v, l]) => `<option value="${v}"${(s.quality || 'auto') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${PS.Save.syncCode && PS.Save.syncCode() ? `<div class="set-row set-link"><span><b>Play on another device</b><small>Copy this code there to share your Essence, upgrades and unlocks. Treat it like a password.</small></span>
          <span class="link-tools"><button class="btn btn-small" data-copy>Copy code</button><input type="text" placeholder="Paste a code" data-code aria-label="Code from your other device"><button class="btn btn-small" data-link>Link</button></span></div>` : ''}
        ${PS.Game.state === 'menu' ? `<div class="set-row"><span><b>Erase progress</b><small>Deletes Essence, upgrades, unlocks and the leaderboard</small></span><button class="btn btn-danger" data-reset>Erase</button></div>` : ''}`;
      root.querySelectorAll('[data-set]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const key = inp.dataset.set;
          s[key] = inp.type === 'checkbox' ? inp.checked : +inp.value;
          if (key === 'sfx') { PS.Audio.setSfxVolume(s.sfx); PS.Audio.play('uiClick'); }
          if (key === 'music') PS.Audio.setMusicVolume(s.music);
          PS.Save.save();
        });
      });
      const nm = root.querySelector('[data-name]');
      nm.addEventListener('input', () => { d.name = nm.value.trim().slice(0, 14); PS.Save.save(); });
      const q = root.querySelector('[data-quality]');
      q.addEventListener('change', () => { s.quality = q.value; PS.Render.setQuality(q.value); PS.Save.save(); });
      const copy = root.querySelector('[data-copy]');
      if (copy) {
        click(copy, () => {
          const code = PS.Save.syncCode();
          const done = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy code'; }, 1600); };
          if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => window.prompt('Your code', code));
          else window.prompt('Your code', code);
        });
        const link = root.querySelector('[data-link]'), field = root.querySelector('[data-code]');
        click(link, async () => {
          link.disabled = true; link.textContent = 'Linking';
          const ok = await PS.Save.useSyncCode(field.value);
          link.disabled = false;
          link.textContent = ok ? 'Linked' : 'Link';
          if (!ok) { field.value = ''; field.placeholder = 'That code did not match a profile'; }
          else this.renderSettings(root);
        });
      }
      const reset = root.querySelector('[data-reset]');
      if (reset) click(reset, () => {
        if (!reset.dataset.armed) { reset.dataset.armed = '1'; reset.textContent = 'Erase everything?'; return; }
        PS.Save.reset(); this.renderSettings(root);
      });
    },
    openSettingsOverlay() {
      this.renderSettings($('ovSettingsBody'));
      $('ovSettings').hidden = false;
    },
    toggleAutoAim() {
      const s = PS.Save.data.settings;
      s.autoAim = !s.autoAim;
      PS.Save.save();
      this.toast(s.autoAim ? 'Auto-aim on' : 'Auto-aim off', 'crosshair');
    },

    /* ================================================================ HUD */
    startRun() {
      $('screens').hidden = true;
      $('ovOver').hidden = true; $('ovPause').hidden = true; $('ovChoice').hidden = true;
      $('hud').hidden = false;
      $('touch').hidden = !PS.Input.touch;
      $('toasts').innerHTML = '';
      $('banner').hidden = true;
      $('bossBar').hidden = true;
      loadoutSig = ''; affSig = ''; dashSig = null; hudT = 0;
      const G = PS.G, p = G.player, c = p.cls;
      const mode = G.daily ? 'Daily rift: ' + D.MUTATORS[G.rules.mutator].name : G.depth ? 'Depth ' + G.depth : '';
      $('hudMode').textContent = mode;
      $('hudMode').hidden = !mode;
      $('actWard').hidden = G.rules.noWard;
      $('tWard').hidden = G.rules.noWard;
      const abil = ico(c.ability.icon, 26);
      $('actAbility').querySelector('i').innerHTML = abil;
      $('actAbility').style.setProperty('--c', c.color);
      $('tAbility').querySelector('i').innerHTML = ico(c.ability.icon, 30);
      $('tAbility').style.setProperty('--c', c.color);
      hydrate($('touch'));
      this.updateHud(1);
      if (!PS.Save.data.seenTutorial) {
        PS.Save.data.seenTutorial = true;
        PS.Save.save();
        this.banner('Survive', PS.Input.touch ? 'Drag to move. Your attacks aim themselves.' : 'WASD to move, mouse to aim, Space to dash, Shift to ward off bullets, Q for your ability.', 5.5);
      }
    },
    updateHud(dt) {
      const G = PS.G, p = G.player, s = p.stats;
      $('xpFill').style.transform = `scaleX(${Math.min(1, p.xp / p.xpNext).toFixed(4)})`;
      $('hpFill').style.transform = `scaleX(${Math.max(0, p.hp / s.maxHp).toFixed(4)})`;
      const ab = $('actAbility'), da = $('actDash');
      const ap = p.abilityCd > 0 ? p.abilityCd / p.abilityMax : 0;
      ab.style.setProperty('--p', ap.toFixed(3));
      ab.classList.toggle('ready', ap <= 0);
      // the sweep tracks the charge that is coming back, even while others are still in hand
      const dp = p.dashCharges < s.dashCharges ? U.clamp(p.dashRecharge / s.dashCd, 0, 1) : 0;
      da.style.setProperty('--p', dp.toFixed(3));
      da.classList.toggle('ready', p.dashCharges > 0);
      const dc = s.dashCharges > 1 ? String(p.dashCharges) : '';
      if (dc !== dashSig) { dashSig = dc; const n = $('dashCount'); n.textContent = dc; n.hidden = !dc; }
      const wa = $('actWard'), wp = p.wardCd > 0 ? Math.min(1, p.wardCd / p.wardMax) : 0;
      wa.style.setProperty('--p', wp.toFixed(3));
      wa.classList.toggle('ready', wp <= 0);
      if (PS.Input.touch) $('tWard').classList.toggle('cooling', wp > 0);
      if (G.boss) $('bossFill').style.transform = `scaleX(${Math.max(0, G.boss.hp / G.boss.maxHp).toFixed(4)})`;

      if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').hidden = true; }
      hudT -= dt;
      if (hudT > 0) return;
      hudT = 0.12;
      $('hudLevel').textContent = p.level;
      $('hudTime').textContent = U.fmtTime(G.time);
      $('hudKills').textContent = U.fmtNum(G.kills);
      $('hudGold').textContent = U.fmtNum(p.gold);
      $('hpText').textContent = Math.ceil(Math.max(0, p.hp)) + ' / ' + s.maxHp;
      $('hpFill').parentNode.classList.toggle('low', p.hp < s.maxHp * 0.3);
      // next boss
      const Dr = PS.Director;
      let next = '';
      if (G.boss) next = '';
      else if (Dr.bossIdx < Dr.BOSS_TIMES.length) next = 'Boss in ' + U.fmtTime(Dr.BOSS_TIMES[Dr.bossIdx] - G.time);
      else if (Dr.victory) next = 'Beyond the rift';
      $('hudNext').textContent = next;
      $('bossBar').hidden = !G.boss;

      // loadout tiles only re-render when something changed
      const sig = p.skills.map((k) => k.id + k.level + (k.evolved ? 'e' : '') + Math.round(k.over * 100)).join() + '|' + p.tomes.map((t) => t.id + t.level).join() + '|' + p.relicOrder.length + '|' + p.skillSlots + '/' + p.tomeSlots;
      if (sig !== loadoutSig) {
        loadoutSig = sig;
        $('hudSkills').innerHTML = p.skills.map((k) => this.skillTile(k)).join('') + '<span class="slot empty"></span>'.repeat(Math.max(0, p.skillSlots - p.skills.length))
          + this.lockedSlots(p, 'skill', '');
        $('hudTomes').innerHTML = p.tomes.map((t) => `<span class="slot tome" data-tip="<b>${esc(t.def.name)}</b><br>Level ${t.level}: +${t.def.fmt(t.val)} ${t.def.stat.toLowerCase()}">${ico(t.def.icon, 16)}<em>${t.level}</em></span>`).join('')
          + '<span class="slot tome empty"></span>'.repeat(Math.max(0, p.tomeSlots - p.tomes.length))
          + this.lockedSlots(p, 'tome', ' tome');
      }
      const asig = D.ELEMENT_IDS.map((e) => p.aff[e]).join();
      if (asig !== affSig) {
        affSig = asig;
        $('hudAff').innerHTML = D.ELEMENT_IDS.filter((e) => p.aff[e] > 0).map((e) => {
          const el = D.ELEMENTS[e], n = p.aff[e];
          const tip = `<b>${el.name} ${n}</b>` + D.AFFINITY[e].map((a) => `<br><span class='${n >= a.n ? 'on' : 'off'}'>${a.n}: ${a.text}</span>`).join('');
          return `<div class="aff${n >= 2 ? ' lit' : ''}" style="--c:${el.color}" data-tip="${tip}">${ico(el.icon, 16)}<b>${n}</b><span class="pips">${[2, 4, 6].map((t) => `<i class="${n >= t ? 'on' : ''}"></i>`).join('')}</span></div>`;
        }).join('');
      }
    },
    /** slots the hero has not grown into yet, each labelled with the level that opens it */
    lockedSlots(p, kind, cls) {
      return PS.SLOT_LEVELS[kind].filter((l) => l > p.claimedLevel).map((l) => `<span class="slot${cls} locked" data-tip="<b>Locked ${kind} slot</b><br>Opens at level ${l}">${ico('lock', kind === 'tome' ? 12 : 16)}<em>${l}</em></span>`).join('');
    },
    skillTile(k) {
      const def = k.def, col = elColor(def.el);
      const tip = `<b>${esc(k.name)}</b><br>${D.ELEMENTS[def.el].name} · Level ${k.level}${k.over > 0 ? ` · +${Math.round(k.over * 100)}% damage` : ''}<br>${esc(k.evolved ? def.evo.desc : def.desc)}`;
      return `<span class="slot skill${k.evolved ? ' evo' : ''}" style="--c:${col}" data-tip="${tip}">${ico(def.icon, 24)}<em>${k.level >= PS.Skills.MAX_LEVEL ? (k.evolved ? '★' : 'MAX') : k.level}</em></span>`;
    },

    toast(text, icon) {
      if (!PS.G) return;
      const box = $('toasts');
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = `${icon ? ico(icon, 16) : ''}<span>${esc(text)}</span>`;
      box.appendChild(el);
      const max = window.innerWidth < 760 || window.innerHeight < 520 ? 2 : 4;
      while (box.children.length > max) box.removeChild(box.firstChild);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3200);
    },
    /** one-time hint the first time a mechanic shows up (remembered across runs) */
    tip(key, text, icon) {
      const d = PS.Save.data;
      if (!d.tips) d.tips = {};
      if (d.tips[key] || !PS.G || PS.G.bot) return;
      d.tips[key] = 1;
      PS.Save.save();
      this.toast(text, icon);
    },
    banner(title, sub, dur) {
      $('bannerTitle').textContent = title;
      $('bannerSub').textContent = sub || '';
      const b = $('banner');
      b.hidden = false;
      b.classList.remove('boss');
      b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
      bannerT = dur || 3.5;
    },
    bossIntro(def) {
      this.banner(def.name, def.title, 2.6);
      $('banner').classList.add('boss');
      $('bossName').textContent = def.name + ', ' + def.title;
      $('bossBar').hidden = false;
      $('bossBar').style.setProperty('--c', def.color);
    },

    /* ================================================================ reward cards */
    showChoice(spec) {
      curSpec = spec;
      banishMode = false;
      padCard = Math.min(1, spec.cards.length - 1);
      choiceAt = performance.now();
      const ov = $('ovChoice');
      ov.hidden = false;
      ov.className = 'overlay kind-' + spec.kind;
      $('choiceTitle').textContent = spec.title;
      $('choiceSub').textContent = spec.sub;
      this.renderCards();
      PS.Audio.play(spec.kind === 'talent' ? 'shrine' : 'pick', { vol: 0.4 });
    },
    renderCards() {
      const spec = curSpec, p = PS.G.player;
      const box = $('choiceCards');
      box.innerHTML = spec.cards.map((c, i) => {
        const rar = D.RARITY[c.tier] || D.RARITY[0];
        const col = c.color || (c.el ? elColor(c.el) : rar.color);
        const kind = c.special === 'evolve' ? 'Evolution' : c.special === 'talent' ? 'Ascension' : c.special === 'pact' ? 'Pact' : rar.name;
        const canBan = spec.kind === 'level' && (c.type === 'skill' || c.type === 'tome');
        return `<button class="card r-${rar.id}${c.special ? ' sp-' + c.special : ''} ${canBan ? 'can-ban' : 'no-ban'}${i === padCard && PS.Input.pad ? ' pad-focus' : ''}" data-i="${i}" style="--rc:${c.special === 'talent' || c.special === 'pact' ? col : rar.color};--c:${col};--d:${i * 70}ms">
          <span class="card-key">${i + 1}</span>
          <span class="card-ban">${ico('ban', 22)}</span>
          <span class="card-tag">${esc(c.tag)}</span>
          <span class="card-ico">${ico(c.icon, 44)}</span>
          <span class="card-title">${esc(c.title)}</span>
          ${c.el ? `<span class="card-el">${ico(D.ELEMENTS[c.el].icon, 13)} ${D.ELEMENTS[c.el].name}</span>` : ''}
          <span class="card-desc">${esc(c.desc)}</span>
          ${c.price ? `<span class="card-price">${esc(c.price)}</span>` : ''}
          ${c.lines.map((l) => `<span class="card-line">${esc(l)}</span>`).join('')}
          <span class="card-rar">${kind}</span>
        </button>`;
      }).join('');
      box.querySelectorAll('.card').forEach((b) => {
        b.addEventListener('click', () => this.pickCard(+b.dataset.i, true));
      });
      const act = $('choiceActions');
      if (spec.kind === 'level') {
        act.innerHTML = `
          <button class="btn btn-small" id="actReroll" ${p.rerolls <= 0 && p.gold < PS.Game.rerollCost() ? 'disabled' : ''}>${ico('dice', 16)} Reroll ${p.rerolls > 0 ? `<b>${p.rerolls}</b>` : `for <b>${PS.Game.rerollCost()}</b> gold`} <kbd>R</kbd></button>
          <button class="btn btn-small${banishMode ? ' on' : ''}" id="actBanish" ${p.banishes <= 0 ? 'disabled' : ''}>${ico('ban', 16)} ${banishMode ? 'Pick a card to banish' : 'Banish'} <b>${p.banishes}</b> <kbd>B</kbd></button>
          <button class="btn btn-small btn-ghost" id="actSkip">${ico('skip', 16)} Skip for 10 gold</button>`;
        click($('actReroll'), () => { if (!this.clickGuard()) this.rerollCards(); });
        click($('actBanish'), () => { if (!this.clickGuard()) { banishMode = !banishMode; this.renderCards(); } });
        click($('actSkip'), () => { if (!this.clickGuard()) PS.Game.choose(curSpec, null); });
      } else if (spec.kind === 'pact') {
        act.innerHTML = `<button class="btn btn-small btn-ghost" id="actSkip">${ico('skip', 16)} Walk away</button>`;
        click($('actSkip'), () => { if (!this.clickGuard()) PS.Game.choose(curSpec, null); });
      } else act.innerHTML = '';
      box.classList.toggle('banishing', banishMode);
    },
    rerollCards() {
      if (PS.Game.reroll(curSpec)) { PS.Audio.play('uiClick'); this.renderCards(); }
    },
    /** mouse clicks need a longer settle time and must not be part of a click burst, so attack spam never takes a card */
    clickGuard() { return performance.now() - choiceAt < 600 || PS.Input.spamClick(); },
    pickCard(i, viaMouse) {
      if (PS.Game.state !== 'choice' || !curSpec || performance.now() - choiceAt < 350) return;
      if (viaMouse && this.clickGuard()) return;
      const card = curSpec.cards[i];
      if (!card) return;
      if (banishMode) {
        if (PS.Game.banish(curSpec, card)) { banishMode = false; PS.Audio.play('uiBack'); this.renderCards(); }
        else PS.Audio.play('deny', { vol: 0.5 });
        return;
      }
      PS.Audio.play('pick');
      PS.Game.choose(curSpec, card);
    },
    hideChoice() {
      $('ovChoice').hidden = true;
      curSpec = null;
      loadoutSig = '';
    },

    /* ================================================================ pause sheet */
    showPause() {
      const q = $('pauseQuit');
      delete q.dataset.armed; q.textContent = 'End run';
      $('pauseBody').innerHTML = this.buildSheet(PS.G);
      $('ovPause').hidden = false;
    },
    hidePause() {
      $('ovPause').hidden = true;
      $('ovSettings').hidden = true;
    },
    dmgBars(G, limit) {
      const rows = Object.entries(G.dmgBy).sort((a, b) => b[1] - a[1]).slice(0, limit || 10);
      if (!rows.length) return '<p class="muted">No damage dealt yet.</p>';
      const max = rows[0][1], total = G.dmgTotal || 1;
      return `<ul class="dmg">${rows.map(([name, v]) => this.barRow(name, v, max, total, srcEl(name) ? D.ELEMENTS[srcEl(name)].color : '#a49bbd')).join('')}</ul>`;
    },
    /** one labelled bar: the name and numbers stay in text colours, the bar carries the element */
    barRow(name, v, max, total, color) {
      return `<li><span class="dmg-name">${esc(name)}</span><span class="dmg-bar"><i style="width:${Math.max(1, (v / max) * 100).toFixed(1)}%;background:${color}"></i></span><span class="dmg-val">${U.fmtNum(v)}</span><span class="dmg-pct">${Math.round((v / total) * 100)}%</span></li>`;
    },
    buildSheet(G) {
      const p = G.player, s = p.stats, c = p.cls;
      const pct = (v) => Math.round(v * 100) + '%';
      const stats = [
        ['Damage', pct(p.dm)], ['Attack speed', pct(p.as)], ['Critical chance', pct(Math.min(1, s.crit))], ['Critical damage', pct(s.critMult)],
        ['Area', pct(s.area)], ['Extra projectiles', '+' + s.proj], ['Max health', s.maxHp], ['Regeneration', s.regen.toFixed(1) + '/s'],
        ['Armor', Math.round(s.armor) + ' (' + pct(1 - 60 / (60 + Math.max(0, s.armor))) + ' less damage)'], ['Move speed', Math.round(s.speed)],
        ['Luck', Math.round(s.luck)], ['Experience', pct(s.xp)], ['Gold', pct(s.gold)], ['Lifesteal', (s.lifesteal * 100).toFixed(1) + '%'],
      ];
      return `
        <div class="sheet-col">
          <h3>Skills <small>and damage dealt</small></h3>
          <div class="sk-list">${p.skills.map((k) => `<div class="sk" style="--c:${elColor(k.def.el)}"><span class="sk-ico">${ico(k.def.icon, 22)}</span><div><b>${esc(k.name)}</b><small>${D.ELEMENTS[k.def.el].name}, level ${k.level}${k.evolved ? ', evolved' : ''}${k.over > 0 ? `, +${Math.round(k.over * 100)}% damage` : ''}</small></div></div>`).join('')}</div>
          ${this.dmgBars(G, 10)}
        </div>
        <div class="sheet-col">
          <h3>${c.name} paths</h3>
          <div class="paths">${c.branches.map((br, bi) => `<div class="path" style="--c:${br.color}"><b>${br.name}</b><span>${br.nodes.map((n, i) => `<i class="${i < p.talents[bi] ? 'on' : ''}" data-tip="<b>${esc(n.name)}</b><br>${esc(n.desc)}">${ico(n.icon, 16)}</i>`).join('')}</span></div>`).join('')}</div>
          <h3>Affinities</h3>
          <div class="aff-list">${D.ELEMENT_IDS.filter((e) => p.aff[e] > 0).map((e) => `<div class="affrow" style="--c:${D.ELEMENTS[e].color}"><b>${ico(D.ELEMENTS[e].icon, 15)} ${D.ELEMENTS[e].name} ${p.aff[e]}</b>${D.AFFINITY[e].map((a) => `<span class="${p.aff[e] >= a.n ? 'on' : ''}">${a.n}: ${a.text}</span>`).join('')}</div>`).join('') || '<p class="muted">Collect skills of the same element to unlock set bonuses.</p>'}</div>
          <h3>Reactions <small>two elements on one enemy within 4 seconds</small></h3>
          ${this.reactionList(G)}
        </div>
        <div class="sheet-col">
          <h3>Tomes</h3>
          <div class="chips">${p.tomes.map((t) => `<span class="chip" data-tip="+${t.def.fmt(t.val)} ${t.def.stat.toLowerCase()}">${ico(t.def.icon, 15)} ${t.def.name.replace('Tome of ', '')} <em>${t.level}</em></span>`).join('') || '<span class="muted">None yet.</span>'}</div>
          <h3>Relics</h3>
          <div class="chips">${p.relicOrder.map((id) => { const r = D.RELICS[id]; return `<span class="chip r-${D.RARITY[r.tier].id}" style="--rc:${D.RARITY[r.tier].color}" data-tip="${esc(r.desc)}">${ico(r.icon, 15)} ${esc(r.name)}${p.relics[id] > 1 ? ` <em>×${p.relics[id]}</em>` : ''}</span>`; }).join('') || '<span class="muted">Open chests to find relics.</span>'}</div>
          ${p.pacts.length ? `<h3>Pacts</h3><div class="chips">${p.pacts.map((id) => { const b = D.PACTS[id]; return `<span class="chip pact" data-tip="<b>${esc(b.name)}</b><br>${esc(b.gift)}<br><span class='off'>${esc(b.price)}</span>">${ico(b.icon, 15)} ${esc(b.name)}</span>`; }).join('')}</div>` : ''}
          ${Object.keys(p.boons).length ? `<h3>Blessings</h3><div class="chips">${Object.keys(p.boons).map((id) => { const b = D.BOONS[id]; return `<span class="chip">${ico(b.icon, 15)} +${b.fmt(p.boons[id])} ${b.stat.toLowerCase()}</span>`; }).join('')}</div>` : ''}
          <h3>Stats</h3>
          <dl class="statlist">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
          <h3>This rift</h3>
          ${this.riftInfo(G)}
        </div>`;
    },
    /** the reactions this build can set off: one per pair of elements the hero has a skill in */
    reactionList(G) {
      const els = D.ELEMENT_IDS.filter((e) => G.player.skills.some((k) => k.def.el === e));
      const rows = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) rows.push(D.reaction(els[i], els[j]));
      if (!rows.length) return '<p class="muted">Take skills of two different elements and they will react on any enemy both of them hit.</p>';
      return `<div class="rx-list">${rows.map((r) => `<div class="rx"><span class="rx-els">${r.els.map((e) => `<i style="--c:${D.ELEMENTS[e].color}">${ico(D.ELEMENTS[e].icon, 13)}</i>`).join('')}</span><div><b>${r.name}</b>${G.reactions[r.name] ? `<em>${U.fmtNum(G.reactions[r.name])}</em>` : ''}<span>${r.text}</span></div></div>`).join('')}</div>`;
    },
    /** depth modifiers or the day's mutator, and the seed */
    riftInfo(G) {
      const mut = G.rules.mutator && D.MUTATORS[G.rules.mutator];
      const mods = mut ? [mut] : D.DEPTHS.slice(0, G.depth);
      const pct = (v) => '+' + Math.round((v - 1) * 100) + '%';
      return `${G.daily ? `<p class="muted">Daily rift for ${G.daily}. Everyone has the full skill tree.</p>` : G.depth ? `<p class="muted">Depth ${G.depth}: score ×${D.depthScore(G.depth).toFixed(2)}. In all, the horde has ${pct(G.rules.hp)} health and hits ${pct(G.rules.dmg)} harder.</p>` : ''}
        ${mods.length ? `<ul class="mods">${mods.map((m) => `<li>${ico(m.icon, 15)}<b>${esc(m.name)}</b><span>${esc(m.text)}</span></li>`).join('')}</ul>` : ''}
        <p class="muted seed">Seed ${esc(G.seed)}</p>`;
    },

    /* ================================================================ results */
    showOver(res) {
      const G = PS.G, r = res.run, c = D.CLASSES[r.cls], d = PS.Save.data;
      $('ovChoice').hidden = true; $('ovPause').hidden = true;
      $('hud').hidden = true; $('touch').hidden = true;
      const title = r.won ? 'The rift is broken' : res.retired ? 'Run ended' : 'You fell';
      const sub = r.won ? `You slew the Rift Lord and pushed ${U.fmtTime(Math.max(0, r.time - 720))} beyond.` : res.retired ? `You walked away after ${U.fmtTime(r.time)}.`
        : G.boss ? `Slain by ${G.boss.def.name}, ${G.boss.def.title}.` : `Overrun after ${U.fmtTime(r.time)}${G.lastHurt ? '. The last blow: ' + esc(G.lastHurt) : ''}.`;
      const sources = Object.keys(G.dmgBy).length;
      const hurt = Object.entries(G.hurtBy).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const rx = Object.entries(G.reactions).sort((a, b) => b[1] - a[1]);
      $('overBody').innerHTML = `
        <header class="over-head${r.won ? ' won' : ''}">
          <h2>${title}</h2>
          <p>${sub}</p>
        </header>
        <div class="over-score">
          <div class="score-num" id="scoreNum">0</div>
          <div class="score-tags">
            ${res.unlockedDepth ? `<span class="tag gold">${ico('key', 14)} Rift Depth ${res.unlockedDepth} unlocked</span>` : ''}
            ${res.unlockedClass ? `<span class="tag gold">${ico(CLASS_ICON[res.unlockedClass], 14)} ${D.CLASSES[res.unlockedClass].name} unlocked</span>` : ''}
            ${res.best ? `<span class="tag gold">${G.daily ? 'Your best today' : 'New best score'}</span>` : ''}
            ${G.daily ? `<span class="tag">${ico('timer', 14)} Daily rift, ${esc(D.MUTATORS[G.rules.mutator].name)}</span>` : ''}
            ${G.depth ? `<span class="tag">${ico('vortex', 14)} Depth ${G.depth}, score ×${D.depthScore(G.depth).toFixed(2)}</span>` : ''}
            ${res.rank && !G.daily ? `<span class="tag" id="overRank">Rank ${res.rank} on this device</span>` : ''}
            <span class="tag world" id="overWorld" hidden></span>
            <span class="tag ess">${ico('essence', 14)} +${U.fmtNum(res.essence)} Essence${res.firstDaily ? ', doubled for your first daily' : ''}</span>
          </div>
        </div>
        ${res.feats && res.feats.length ? `<section class="over-feats"><h3>Feats earned <small>+${U.fmtNum(res.feats.reduce((n, id) => n + PS.Feats.BY_ID[id].essence, 0))} Essence</small></h3>
          <div class="chips">${res.feats.map((id) => { const f = PS.Feats.BY_ID[id]; return `<span class="chip feat-chip" data-tip="${esc(f.text)}">${ico(f.icon, 15)} ${esc(f.name)} <em>+${f.essence}</em></span>`; }).join('')}</div></section>` : ''}
        <div class="over-grid">
          <dl class="over-stats">
            <div><dt>Class</dt><dd style="color:${c.color}">${c.name}</dd></div>
            <div><dt>Survived</dt><dd>${U.fmtTime(r.time)}</dd></div>
            <div><dt>Level</dt><dd>${r.level}</dd></div>
            <div><dt>Enemies slain</dt><dd>${U.fmtNum(r.kills)}</dd></div>
            <div><dt>Bosses slain</dt><dd>${r.bosses}</dd></div>
            <div><dt>Damage dealt</dt><dd>${U.fmtNum(G.dmgTotal)}</dd></div>
          </dl>
          <div class="over-dmg">
            <h3>Where your damage came from</h3>
            <div id="overDmg">${this.dmgBars(G, 6)}</div>
            ${sources > 6 ? `<button class="btn btn-small btn-ghost" id="overDmgAll">Show all ${sources} sources</button>` : ''}
          </div>
        </div>
        <section class="over-run">
          <h3>How the run went <small>every 10 seconds</small></h3>
          <div class="runchart" id="overChart"></div>
        </section>
        <div class="over-grid">
          <div class="over-dmg">
            <h3>What hurt you <small>${U.fmtNum(G.dmgTaken)} damage taken</small></h3>
            ${hurt.length ? `<ul class="dmg">${hurt.map(([name, v]) => this.barRow(name, v, hurt[0][1], G.dmgTaken || 1, '#ff6a3d')).join('')}</ul>` : '<p class="muted">Nothing laid a finger on you.</p>'}
          </div>
          <div class="over-dmg">
            <h3>Reactions set off</h3>
            ${rx.length ? `<div class="chips">${rx.map(([name, n]) => `<span class="chip"><i class="dot" style="background:${elColor(srcEl(name))}"></i>${esc(name)} <em>${U.fmtNum(n)}</em></span>`).join('')}</div>`
              : '<p class="muted">None. Skills of two different elements react when both hit the same enemy.</p>'}
            <p class="muted seed">Seed ${esc(G.seed)}</p>
          </div>
        </div>
        <div class="over-name">
          <label for="overName">Name for the leaderboard</label>
          <input id="overName" type="text" maxlength="14" value="${esc(d.name)}" placeholder="Wanderer">
        </div>
        <div class="over-btns">
          <button class="btn btn-primary btn-big" id="overAgain">Play again</button>
          <button class="btn" id="overTree">Spend Essence</button>
          <button class="btn" id="overBoard">Leaderboard</button>
          <button class="btn btn-ghost" id="overMenu">Main menu</button>
        </div>`;
      $('ovOver').hidden = false;
      this.runChart($('overChart'), G);
      const all = $('overDmgAll');
      if (all) click(all, () => { $('overDmg').innerHTML = this.dmgBars(G, 99); all.remove(); });
      // count the score up
      const el = $('scoreNum'), t0 = performance.now(), target = r.score;
      const tick = () => {
        const t = Math.min(1, (performance.now() - t0) / 1200);
        el.textContent = Math.round(target * U.easeOutCubic(t)).toLocaleString('en-US');
        if (t < 1 && !$('ovOver').hidden) requestAnimationFrame(tick);
      };
      tick();
      const nm = $('overName');
      nm.addEventListener('input', () => { d.name = nm.value.trim().slice(0, 14); r.name = d.name || 'Wanderer'; PS.Save.save(); });
      click($('overAgain'), () => PS.Game.again());
      click($('overTree'), () => { PS.Game.toMenu(); this.showScreen('scrTree'); });
      click($('overBoard'), () => { PS.Game.toMenu(); boardTab = G.daily ? 'daily' : boardTab === 'daily' ? 'all' : boardTab; this.showScreen('scrBoard'); });
      click($('overMenu'), () => PS.Game.toMenu());
    },

    /**
     * The run as two small charts on one time axis: damage per second above, damage taken below (two measures, so two
     * charts rather than two scales on one). Boss kills and evolutions are marked; hover or arrow keys read out a slice.
     */
    runChart(box, G) {
      const tl = G.timeline;
      if (tl.length < 2) { box.innerHTML = '<p class="muted">The run was over too quickly to chart.</p>'; return; }
      // cumulative rows -> one slice per row
      const pts = tl.map((row, i) => {
        const prev = i ? tl[i - 1] : { t: 0, dmg: 0, taken: 0, kills: 0 };
        const span = Math.max(0.5, row.t - prev.t);
        return { t0: prev.t, t1: row.t, dps: (row.dmg - prev.dmg) / span, taken: row.taken - prev.taken, kills: row.kills - prev.kills, lvl: row.lvl };
      });
      const W = Math.max(300, box.clientWidth || 760), L = 46, R = 12, T = 40, H1 = 150, GAP = 34, H2 = 56, B = 24;
      const H = T + H1 + GAP + H2 + B, pw = W - L - R, end = tl[tl.length - 1].t;
      const x = (t) => L + (t / end) * pw;
      const yMax = niceMax(Math.max(...pts.map((p) => p.dps))), tMax = niceMax(Math.max(1, ...pts.map((p) => p.taken)));
      const y1 = (v) => T + H1 - (v / yMax) * H1, base2 = T + H1 + GAP + H2, y2 = (v) => base2 - (v / tMax) * H2;
      const num = (v) => (v >= 10000 ? U.fmtNum(v).replace('.0k', 'k').replace('.00M', 'M') : Math.round(v).toLocaleString('en-US'));
      // time ticks: about six, on round minutes where the run is long enough
      const stepT = [30, 60, 120, 180, 300, 600, 900, 1800].find((s) => end / s <= Math.min(7, Math.floor(pw / 60))) || 3600;
      let grid = '', marks = '';
      for (let t = 0; t <= end + 0.01; t += stepT) grid += `<text class="rc-tick" x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${t === 0 ? 'start' : 'middle'}">${mmss(t)}</text>`;
      for (const f of [0, 0.5, 1]) {
        grid += `<line class="rc-grid" x1="${L}" x2="${W - R}" y1="${y1(yMax * f).toFixed(1)}" y2="${y1(yMax * f).toFixed(1)}"/><text class="rc-tick" x="${L - 7}" y="${(y1(yMax * f) + 4).toFixed(1)}" text-anchor="end">${num(yMax * f)}</text>`;
      }
      grid += `<line class="rc-grid" x1="${L}" x2="${W - R}" y1="${base2}" y2="${base2}"/><text class="rc-tick" x="${L - 7}" y="${base2 + 4}" text-anchor="end">0</text><text class="rc-tick" x="${L - 7}" y="${(y2(tMax) + 4).toFixed(1)}" text-anchor="end">${num(tMax)}</text>`;
      // boss kills: a hairline through both charts, named where there is room
      let lastLabel = -1e9;
      for (const b of G.bossLog) {
        const bx = x(Math.min(end, b.at + b.took));
        marks += `<line class="rc-boss" x1="${bx.toFixed(1)}" x2="${bx.toFixed(1)}" y1="${T - 4}" y2="${base2}"/>`;
        if (bx - lastLabel > 74) { marks += `<text class="rc-label" x="${(bx - 5).toFixed(1)}" y="${T - 8}" text-anchor="end">${esc(b.name)}</text>`; lastLabel = bx; }
      }
      // evolutions: a diamond on the baseline of the damage chart
      for (const k of G.picks) {
        if (k.type !== 'evolve') continue;
        const ex = x(Math.min(end, k.t)), ey = T + H1;
        marks += `<path class="rc-evo" d="M${ex.toFixed(1)} ${ey - 6}l5 6l-5 6l-5 -6z"><title>${esc(k.title)} at ${mmss(k.t)}</title></path>`;
      }
      const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p.t1).toFixed(1) + ' ' + y1(p.dps).toFixed(1)).join('');
      const area = `M${x(pts[0].t1).toFixed(1)} ${T + H1}` + pts.map((p) => 'L' + x(p.t1).toFixed(1) + ' ' + y1(p.dps).toFixed(1)).join('') + `L${x(end).toFixed(1)} ${T + H1}Z`;
      const bw = Math.max(1.5, Math.min(24, pw / pts.length - 2));
      const bars = pts.map((p) => {
        if (p.taken <= 0) return '';
        const h = Math.max(1.5, base2 - y2(p.taken)), cx = (x(p.t0) + x(p.t1)) / 2, rr = Math.min(3, bw / 2, h);
        return `<path class="rc-bar" d="M${(cx - bw / 2).toFixed(1)} ${base2}v${(-(h - rr)).toFixed(1)}q0 ${-rr} ${rr} ${-rr}h${(bw - 2 * rr).toFixed(1)}q${rr} 0 ${rr} ${rr}v${(h - rr).toFixed(1)}z"/>`;
      }).join('');
      // one direct label: the peak
      const peak = pts.reduce((a, p) => (p.dps > a.dps ? p : a), pts[0]);
      const px = x(peak.t1), right = px > W - R - 120;
      const evos = G.picks.some((k) => k.type === 'evolve');
      // per-minute table: the same numbers without hovering
      const mins = [];
      for (const p of pts) { const m = Math.floor(p.t0 / 60); (mins[m] = mins[m] || { dmg: 0, span: 0, taken: 0, kills: 0, lvl: 0 }); mins[m].dmg += p.dps * (p.t1 - p.t0); mins[m].span += p.t1 - p.t0; mins[m].taken += p.taken; mins[m].kills += p.kills; mins[m].lvl = p.lvl; }
      box.innerHTML = `
        <svg class="rc" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="Damage per second and damage taken over the run. Use the left and right arrow keys to read each 10 second slice.">
          <text class="rc-title" x="${L}" y="14">Damage per second</text>
          <text class="rc-title" x="${L}" y="${T + H1 + GAP - 8}">Damage taken</text>
          ${grid}${marks}
          <path class="rc-area" d="${area}"/><path class="rc-line" d="${line}"/>
          ${bars}
          <circle class="rc-peak" cx="${px.toFixed(1)}" cy="${y1(peak.dps).toFixed(1)}" r="4"/>
          <text class="rc-label strong" x="${(px + (right ? -9 : 9)).toFixed(1)}" y="${Math.max(T + 10, y1(peak.dps) + 4).toFixed(1)}" text-anchor="${right ? 'end' : 'start'}">Peak ${num(peak.dps)}</text>
          <g class="rc-hover" hidden><line class="rc-cross" y1="${T - 4}" y2="${base2}"/><circle class="rc-dot" r="4.5"/></g>
          <rect class="rc-hit" x="${L}" y="0" width="${pw}" height="${H}" fill="transparent"/>
        </svg>
        <div class="rc-tip" hidden></div>
        <p class="rc-key"><span><i class="k-line"></i>Damage per second</span><span><i class="k-bar"></i>Damage taken</span>${G.bossLog.length ? '<span><i class="k-boss"></i>Boss slain</span>' : ''}${evos ? '<span><i class="k-evo"></i>Skill evolved</span>' : ''}</p>
        <details class="rc-table"><summary>Show the numbers, minute by minute</summary>
          <table class="board-table compact"><thead><tr><th>Minute</th><th class="num">Damage per second</th><th class="num">Damage taken</th><th class="num">Kills</th><th class="num">Level</th></tr></thead>
          <tbody>${mins.map((m, i) => `<tr><td>${i}:00</td><td class="num">${num(m.dmg / Math.max(1, m.span))}</td><td class="num">${num(m.taken)}</td><td class="num">${num(m.kills)}</td><td class="num">${m.lvl}</td></tr>`).join('')}</tbody></table>
        </details>`;
      // hover layer: a crosshair that snaps to the nearest slice, one readout for both charts
      const svg = box.querySelector('svg'), hov = box.querySelector('.rc-hover'), tip = box.querySelector('.rc-tip');
      const cross = hov.querySelector('line'), dot = hov.querySelector('circle');
      let cur = -1;
      const show = (i) => {
        cur = U.clamp(i, 0, pts.length - 1);
        const p = pts[cur], cx = x(p.t1), k = (svg.getBoundingClientRect().width || W) / W;
        hov.removeAttribute('hidden');
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
        dot.setAttribute('cx', cx); dot.setAttribute('cy', y1(p.dps));
        tip.textContent = '';
        const add = (cls, text) => { const el = document.createElement('span'); el.className = cls; el.textContent = text; tip.appendChild(el); };
        add('rc-when', mmss(p.t0) + ' to ' + mmss(p.t1));
        add('rc-val', num(p.dps)); add('rc-what', 'damage per second');
        add('rc-val', num(p.taken)); add('rc-what', 'damage taken');
        add('rc-val', num(p.kills)); add('rc-what', 'kills, at level ' + p.lvl);
        tip.hidden = false;
        const tw = tip.offsetWidth, left = cx * k + 14 + tw > box.clientWidth ? cx * k - 14 - tw : cx * k + 14;
        tip.style.left = Math.max(0, left) + 'px';
      };
      const hide = () => { hov.setAttribute('hidden', ''); tip.hidden = true; cur = -1; };
      const at = (e) => {
        const b = svg.getBoundingClientRect(), t = ((e.clientX - b.left) / b.width * W - L) / pw * end;
        let best = 0;
        for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t1 - t) < Math.abs(pts[best].t1 - t)) best = i;
        show(best);
      };
      svg.addEventListener('pointermove', at);
      svg.addEventListener('pointerdown', at);
      svg.addEventListener('pointerleave', hide);
      svg.addEventListener('blur', hide);
      svg.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? (e.key === 'ArrowRight' ? 0 : pts.length - 1) : cur + (e.key === 'ArrowRight' ? 1 : -1)); }
      });
    },

    /** the server answered a posted run: show where it landed among everyone's */
    showWorldRank(d) {
      const el = $('overWorld');
      if (!el || $('ovOver').hidden || !d || !d.rank) return;
      el.innerHTML = `${ico('crown', 14)} #${d.rank.toLocaleString('en-US')} of ${d.total.toLocaleString('en-US')} ${d.run && d.run.daily ? 'in today\'s rift' : 'worldwide'}`;
      el.hidden = false;
    },

    /* ================================================================ gamepad (menus, cards, pause) */
    onPad(btn) {
      const st = PS.Game.state;
      if (btn === 'start') { this.onEscape(); return; }
      if (st === 'choice' && curSpec) {
        const n = curSpec.cards.length;
        if (btn === 'left' || btn === 'right') { padCard = (padCard + (btn === 'left' ? n - 1 : 1)) % n; this.renderCards(); PS.Audio.play('uiHover'); }
        else if (btn === 'a') this.pickCard(padCard);
        else if (btn === 'y' && curSpec.kind === 'level') this.rerollCards();
        else if (btn === 'x' && curSpec.kind === 'level' && PS.G.player.banishes > 0) { banishMode = !banishMode; this.renderCards(); }
      } else if (st === 'paused') {
        if (btn === 'b' || btn === 'a') PS.Game.resume();
      } else if (st === 'over') {
        if (btn === 'a') PS.Game.again();
        else if (btn === 'b') PS.Game.toMenu();
      } else if (st === 'menu') {
        if (lastScreen === 'scrTitle') { if (btn === 'a') this.showScreen('scrClass'); else if (btn === 'x') this.showScreen('scrTree'); else if (btn === 'y') this.showScreen('scrBoard'); }
        else if (btn === 'b') this.showScreen('scrTitle');
        else if (lastScreen === 'scrClass') {
          const ids = D.CLASS_IDS, i = ids.indexOf(selClass);
          if (btn === 'left' || btn === 'right') { selClass = ids[(i + (btn === 'left' ? ids.length - 1 : 1)) % ids.length]; this.renderClasses(); PS.Audio.play('uiHover'); }
          else if (btn === 'a' && PS.Save.data.unlocked[selClass]) PS.Game.start(selClass);
        } else if (lastScreen === 'scrTree' && btn === 'a') this.buyNode(selNode);
        else if (lastScreen === 'scrTree' && (btn === 'left' || btn === 'right')) {
          const i = D.META.findIndex((m) => m.id === selNode);
          selNode = D.META[(i + (btn === 'left' ? D.META.length - 1 : 1)) % D.META.length].id;
          this.renderTree();
        }
      }
    },

    /* ================================================================ keys */
    onEscape() {
      const st = PS.Game.state;
      if (!$('ovSettings').hidden) { $('ovSettings').hidden = true; return; }
      if (st === 'play') PS.Game.pause();
      else if (st === 'paused') PS.Game.resume();
      else if (st === 'menu' && lastScreen !== 'scrTitle') this.showScreen('scrTitle');
    },
    onKey(code) {
      const st = PS.Game.state;
      if (st === 'choice' && curSpec) {
        if (code === 'Digit1' || code === 'Numpad1') this.pickCard(0);
        else if (code === 'Digit2' || code === 'Numpad2') this.pickCard(1);
        else if (code === 'Digit3' || code === 'Numpad3') this.pickCard(2);
        else if (code === 'KeyR' && curSpec.kind === 'level') this.rerollCards();
        else if (code === 'KeyB' && curSpec.kind === 'level' && PS.G.player.banishes > 0) { banishMode = !banishMode; this.renderCards(); }
      } else if (st === 'over' && code === 'Enter' && (!document.activeElement || document.activeElement === document.body)) {
        PS.Game.again();
      }
    },
  };

  PS.UI = UI;
})();
