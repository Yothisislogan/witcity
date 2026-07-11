'use strict';
/* ---------- tiny math / helper toolkit ---------- */
const TAU = Math.PI * 2;

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

/* smooth exponential approach — framerate independent lerp */
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/* normalize angle to (-PI, PI] */
function angNorm(a) {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}
const angLerp = (a, b, t) => a + angNorm(b - a) * t;

/* deterministic RNG (for reproducible city generation) */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rchoice = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const rrange = (rng, a, b) => a + rng() * (b - a);
const rint = (rng, a, b) => Math.floor(rrange(rng, a, b + 1));

const fmtMoney = n => '$' + Math.round(n).toLocaleString('en-US');
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* safe localStorage */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};
