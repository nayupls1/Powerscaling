/* POWERSCALING — input: keyboard + mouse, touch stick, gamepad */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});

  const keys = new Set();
  const I = {
    mouseX: 0, mouseY: 0, mouseDown: false, touch: false, pad: false,
    dashQ: false, abilityQ: false,
    stick: { id: null, ox: 0, oy: 0, x: 0, y: 0 },

    init(canvas) {
      window.addEventListener('keydown', (e) => {
        if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
        const k = e.code;
        if (PS.Game.state === 'play') {
          if (k === 'Space' || k === 'ShiftLeft' || k === 'ShiftRight') { this.dashQ = true; e.preventDefault(); }
          if (k === 'KeyQ' || k === 'KeyE') this.abilityQ = true;
          if (k === 'KeyT') PS.UI.toggleAutoAim();
          if (k.startsWith('Arrow')) e.preventDefault();
        }
        if (k === 'Escape' || k === 'KeyP') PS.UI.onEscape();
        if (!e.repeat) PS.UI.onKey(k);
        keys.add(k);
      });
      window.addEventListener('keyup', (e) => keys.delete(e.code));
      window.addEventListener('blur', () => { keys.clear(); this.mouseDown = false; if (PS.Game.state === 'play') PS.Game.pause(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden && PS.Game.state === 'play') PS.Game.pause(); });

      canvas.addEventListener('mousemove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; this.touch = false; });
      canvas.addEventListener('mousedown', (e) => {
        this.mouseX = e.clientX; this.mouseY = e.clientY;
        if (e.button === 0) this.mouseDown = true;
        if (e.button === 2) this.abilityQ = true;
      });
      window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      // ---- touch: left side of the screen is a floating stick
      const stickEl = document.getElementById('stick'), knob = document.getElementById('stickKnob');
      const onStart = (e) => {
        this.setTouch(true);
        for (const t of e.changedTouches) {
          if (this.stick.id === null && t.clientX < window.innerWidth * 0.6) {
            this.stick.id = t.identifier; this.stick.ox = t.clientX; this.stick.oy = t.clientY; this.stick.x = 0; this.stick.y = 0;
            stickEl.style.left = t.clientX + 'px'; stickEl.style.top = t.clientY + 'px'; stickEl.classList.add('on');
            knob.style.transform = 'translate(-50%,-50%)';
          }
        }
        e.preventDefault();
      };
      const onMove = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.stick.id) {
            let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
            const d = Math.hypot(dx, dy), max = 56;
            if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
            this.stick.x = dx / max; this.stick.y = dy / max;
            knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
          }
        }
        e.preventDefault();
      };
      const onEnd = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.stick.id) { this.stick.id = null; this.stick.x = 0; this.stick.y = 0; stickEl.classList.remove('on'); }
        }
      };
      canvas.addEventListener('touchstart', onStart, { passive: false });
      canvas.addEventListener('touchmove', onMove, { passive: false });
      canvas.addEventListener('touchend', onEnd);
      canvas.addEventListener('touchcancel', onEnd);
      const bind = (id, fn) => {
        const el = document.getElementById(id);
        el.addEventListener('touchstart', (e) => { fn(); e.preventDefault(); e.stopPropagation(); }, { passive: false });
        el.addEventListener('mousedown', (e) => { fn(); e.preventDefault(); });
      };
      bind('tDash', () => { this.dashQ = true; });
      bind('tAbility', () => { this.abilityQ = true; });
    },
    setTouch(on) {
      if (this.touch === on) return;
      this.touch = on;
      document.getElementById('touch').hidden = !on || PS.Game.state === 'menu';
      document.body.classList.toggle('is-touch', on);
    },

    /** fill the control object the simulation reads */
    read(ctrl, G) {
      let mx = 0, my = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
      const set = PS.Save.data.settings;
      let autoAim = set.autoAim || this.touch;
      let fire = set.autoFire || this.mouseDown;
      let padAim = false;

      // gamepad
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp || !gp.connected) continue;
        const dz = 0.22;
        const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0, rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
        if (Math.hypot(lx, ly) > dz) { mx = lx; my = ly; this.pad = true; }
        if (Math.hypot(rx, ry) > 0.35) {
          const p = G.player;
          ctrl.aimX = p.x + rx * 220; ctrl.aimY = p.y + ry * 220;
          padAim = true; fire = true; this.pad = true;
        }
        const b = gp.buttons;
        const pressed = (i) => b[i] && b[i].pressed;
        if ((pressed(0) || pressed(4) || pressed(6)) && !this._pd) this.dashQ = true;
        if ((pressed(2) || pressed(5) || pressed(7)) && !this._pa) this.abilityQ = true;
        this._pd = pressed(0) || pressed(4) || pressed(6);
        this._pa = pressed(2) || pressed(5) || pressed(7);
        if (pressed(9) && !this._ps) PS.UI.onEscape();
        this._ps = pressed(9);
        break;
      }
      if (this.touch && this.stick.id !== null) { mx = this.stick.x; my = this.stick.y; }
      const l = Math.hypot(mx, my);
      if (l > 1) { mx /= l; my /= l; }
      else if (l < 0.15) { mx = 0; my = 0; }
      ctrl.mx = mx; ctrl.my = my;
      if (this.pad && !padAim && !this.touch && this._padMode) autoAim = true;
      if (padAim) { autoAim = false; this._padMode = true; }
      else if (!autoAim) {
        const w = PS.Render.toWorld(this.mouseX, this.mouseY);
        ctrl.aimX = w.x; ctrl.aimY = w.y;
      }
      ctrl.autoAim = autoAim;
      ctrl.fire = fire;
      ctrl.dash = this.dashQ;
      ctrl.ability = this.abilityQ;
      this.dashQ = false;
      this.abilityQ = false;
    },
    clear() { this.dashQ = false; this.abilityQ = false; },
  };

  PS.Input = I;
})();
