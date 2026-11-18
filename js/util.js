/* POWERSCALING — shared utilities */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});
  const TAU = Math.PI * 2;

  const U = {
    TAU,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
    randInt: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
    chance: (p) => Math.random() < p,
    pick: (arr) => arr[(Math.random() * arr.length) | 0],
    sign: (v) => (v < 0 ? -1 : 1),
    dist2: (ax, ay, bx, by) => {
      const dx = ax - bx, dy = ay - by;
      return dx * dx + dy * dy;
    },
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    angTo: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
    angDiff: (a, b) => {
      let d = (b - a) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    },
    /** rotate angle a towards b by at most maxStep */
    turnTo: (a, b, maxStep) => {
      const d = U.angDiff(a, b);
      return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    /** items: [{w: weight, ...}] */
    weighted: (items) => {
      let total = 0;
      for (let i = 0; i < items.length; i++) total += items[i].w;
      let r = Math.random() * total;
      for (let i = 0; i < items.length; i++) {
        r -= items[i].w;
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    fmtTime: (sec) => {
      sec = Math.max(0, Math.floor(sec));
      const m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },
    fmtNum: (n) => {
      if (n == null || isNaN(n)) return '0';
      const a = Math.abs(n);
      if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
      return Math.round(n).toLocaleString('en-US');
    },
    pct: (v, digits = 0) => (v * 100).toFixed(digits) + '%',
    easeOut: (t) => 1 - (1 - t) * (1 - t),
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    /** deterministic hash of two ints -> [0,1) */
    hash2: (x, y) => {
      let h = (x * 374761393 + y * 668265263) | 0;
      h = (h ^ (h >>> 13)) * 1274126177;
      h = h ^ (h >>> 16);
      return ((h >>> 0) % 100000) / 100000;
    },
    /** remove items flagged dead from array in place (order not preserved) */
    compact: (arr) => {
      let n = arr.length;
      for (let i = n - 1; i >= 0; i--) {
        if (arr[i].dead) {
          arr[i] = arr[n - 1];
          n--;
        }
      }
      arr.length = n;
    },
    /** segment (x1,y1)-(x2,y2) vs circle */
    segCircle: (x1, y1, x2, y2, cx, cy, r) => {
      const dx = x2 - x1, dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x1 + dx * t - cx, py = y1 + dy * t - cy;
      return px * px + py * py <= r * r;
    },
  };

  /** Uniform spatial hash for circle queries. Rebuilt every frame. */
  class Grid {
    constructor(cell) {
      this.cell = cell;
      this.map = new Map();
      this.pool = [];
      this.used = [];
    }
    clear() {
      for (let i = 0; i < this.used.length; i++) {
        const a = this.used[i];
        a.length = 0;
        this.pool.push(a);
      }
      this.used.length = 0;
      this.map.clear();
    }
    _key(cx, cy) {
      return ((cx & 0xffff) << 16) | (cy & 0xffff);
    }
    insert(o) {
      const k = this._key(Math.floor(o.x / this.cell), Math.floor(o.y / this.cell));
      let a = this.map.get(k);
      if (!a) {
        a = this.pool.pop() || [];
        this.map.set(k, a);
        this.used.push(a);
      }
      a.push(o);
    }
    /** call fn(o) for every object whose circle may overlap (x,y,r). fn returning true stops early. */
    query(x, y, r, fn) {
      const c = this.cell;
      const pad = 40; // max entity radius allowance
      const x0 = Math.floor((x - r - pad) / c), x1 = Math.floor((x + r + pad) / c);
      const y0 = Math.floor((y - r - pad) / c), y1 = Math.floor((y + r + pad) / c);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const a = this.map.get(this._key(cx, cy));
          if (!a) continue;
          for (let i = 0; i < a.length; i++) {
            const o = a[i];
            if (o.dead) continue;
            const dx = o.x - x, dy = o.y - y, rr = r + o.r;
            if (dx * dx + dy * dy <= rr * rr) {
              if (fn(o) === true) return;
            }
          }
        }
      }
    }
    /** nearest live object within maxR (optionally filtered) */
    nearest(x, y, maxR, filter) {
      let best = null, bd = maxR * maxR;
      const c = this.cell;
      const x0 = Math.floor((x - maxR) / c), x1 = Math.floor((x + maxR) / c);
      const y0 = Math.floor((y - maxR) / c), y1 = Math.floor((y + maxR) / c);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const a = this.map.get(this._key(cx, cy));
          if (!a) continue;
          for (let i = 0; i < a.length; i++) {
            const o = a[i];
            if (o.dead || (filter && !filter(o))) continue;
            const dx = o.x - x, dy = o.y - y, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = o; }
          }
        }
      }
      return best;
    }
  }

  U.Grid = Grid;
  PS.U = U;
})();
