'use strict';
/* =========================================================================
   THE MONSTER — drawn 100% in code. Black fuzzy body, blue face, googly
   eyes, striped horns, questionable driving license.
   ========================================================================= */

const MONSTER = (() => {
  const BLUE = '#35c8f5';
  const BLACK = '#141418';

  // pre-baked fuzz so the fur doesn't flicker every frame
  const fuzzRng = mulberry32(777);
  const FUZZ = [];
  for (let i = 0; i < 64; i++) {
    FUZZ.push({ a: (i / 64) * TAU, len: 0.55 + fuzzRng() * 0.75, wob: fuzzRng() * TAU });
  }
  const FACE_WOBBLE = [];
  for (let i = 0; i < 24; i++) FACE_WOBBLE.push(0.92 + fuzzRng() * 0.16);

  function fuzzyEllipse(ctx, cx, cy, rx, ry, hair, t) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
    // hair spikes
    ctx.lineWidth = Math.max(1, hair * 0.32);
    ctx.lineCap = 'round';
    ctx.strokeStyle = BLACK;
    ctx.beginPath();
    for (const h of FUZZ) {
      const wig = Math.sin(t * 2 + h.wob) * 0.06;
      const a = h.a + wig;
      const x0 = cx + Math.cos(a) * rx * 0.97, y0 = cy + Math.sin(a) * ry * 0.97;
      const x1 = cx + Math.cos(a) * (rx + hair * h.len), y1 = cy + Math.sin(a) * (ry + hair * h.len);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }

  function horn(ctx, x, y, s, dir, t) {
    // striped party horn. dir = -1 left, +1 right
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dir * 0.36 + Math.sin(t * 1.7) * 0.02 * dir);
    const w = 11 * s, h = 30 * s;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(-w * 0.6, -h * 0.6, dir * w * 0.35, -h);
    ctx.quadraticCurveTo(w * 0.75, -h * 0.45, w, 0);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = BLUE;
    ctx.fillRect(-w * 1.2, -h * 1.1, w * 2.6, h * 1.3);
    ctx.fillStyle = BLACK;
    ctx.fillRect(-w * 1.2, -h * 0.78, w * 2.6, h * 0.24);
    ctx.fillRect(-w * 1.2, -h * 0.34, w * 2.6, h * 0.24);
    ctx.restore();
    ctx.restore();
  }

  function eye(ctx, x, y, r, px, py, mood, t) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (mood === 'dizzy') {
      ctx.strokeStyle = BLACK; ctx.lineWidth = r * 0.22;
      ctx.beginPath();
      for (let a = 0; a < TAU * 2.2; a += 0.25)
        ctx.lineTo(x + Math.cos(a + t * 6) * a * r * 0.13, y + Math.sin(a + t * 6) * a * r * 0.13);
      ctx.stroke();
    } else if (mood === 'happy') {
      ctx.strokeStyle = BLACK; ctx.lineWidth = r * 0.3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y + r * 0.35, r * 0.6, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    } else {
      const pr = mood === 'scared' ? r * 0.24 : r * 0.42;
      ctx.fillStyle = BLACK;
      ctx.beginPath(); ctx.arc(x + px * r * 0.4, y + py * r * 0.4, pr, 0, TAU); ctx.fill();
    }
  }

  function shades(ctx, x1, x2, y, r) {
    ctx.fillStyle = '#0a0a10';
    ctx.strokeStyle = '#0a0a10'; ctx.lineWidth = r * 0.28;
    ctx.beginPath(); ctx.arc(x1, y, r * 0.95, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x2, y, r * 0.95, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x1 + r * 0.8, y); ctx.lineTo(x2 - r * 0.8, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.arc(x1 - r * 0.3, y - r * 0.3, r * 0.22, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x2 - r * 0.3, y - r * 0.3, r * 0.22, 0, TAU); ctx.fill();
  }

  function mouth(ctx, s, mood) {
    ctx.fillStyle = BLACK;
    if (mood === 'wow' || mood === 'scared') {
      ctx.beginPath(); ctx.ellipse(0, 9 * s, 8 * s, 10 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-5 * s, 1.5 * s, 10 * s, 3.4 * s);
      return;
    }
    // trademark grin
    ctx.beginPath();
    ctx.moveTo(-24 * s, 1 * s);
    ctx.quadraticCurveTo(0, -6 * s, 24 * s, 1.5 * s);
    ctx.quadraticCurveTo(14 * s, 15 * s, 0, 15.5 * s);
    ctx.quadraticCurveTo(-14 * s, 15 * s, -24 * s, 1 * s);
    ctx.closePath();
    ctx.fill();
    // teeth
    ctx.fillStyle = '#fff';
    const teeth = 7;
    for (let i = 0; i < teeth; i++) {
      const tx = -19 * s + (38 * s * i) / (teeth - 1);
      const ty = -1.4 * s + Math.abs(tx) * 0.13;
      ctx.beginPath();
      ctx.moveTo(tx - 2.4 * s, ty);
      ctx.lineTo(tx + 2.4 * s, ty);
      ctx.lineTo(tx + 1.7 * s, ty + 5.4 * s);
      ctx.lineTo(tx - 1.7 * s, ty + 5.4 * s);
      ctx.closePath(); ctx.fill();
    }
  }

  /* ---------------- full standing monster (menus) ---------------- */
  function drawFull(ctx, x, y, s, t, mood = 'normal', look = { x: 0, y: 0 }) {
    ctx.save();
    ctx.translate(x, y + Math.sin(t * 2.1) * 3 * s);

    const armWave = Math.sin(t * 2.4) * 0.25;

    // legs + feet
    ctx.strokeStyle = BLACK; ctx.lineWidth = 7 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-16 * s, 52 * s); ctx.lineTo(-18 * s, 74 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16 * s, 52 * s); ctx.lineTo(18 * s, 74 * s); ctx.stroke();
    ctx.fillStyle = BLACK;
    ctx.beginPath(); ctx.ellipse(-24 * s, 78 * s, 17 * s, 8 * s, -0.08, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(24 * s, 78 * s, 17 * s, 8 * s, 0.08, 0, TAU); ctx.fill();

    // arms + hands (waving)
    ctx.lineWidth = 6 * s;
    for (const dir of [-1, 1]) {
      const hx = dir * 82 * s, hy = (-46 - (dir > 0 ? armWave : -armWave) * 22) * s;
      ctx.beginPath();
      ctx.moveTo(dir * 48 * s, -4 * s);
      ctx.quadraticCurveTo(dir * 72 * s, -14 * s, hx, hy);
      ctx.stroke();
      // fingers
      for (let f = -1.5; f <= 1.5; f++) {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + Math.cos(-Math.PI / 2 + f * 0.5 + dir * 0.35) * 13 * s,
                   hy + Math.sin(-Math.PI / 2 + f * 0.5 + dir * 0.35) * 13 * s);
        ctx.lineWidth = 3.6 * s; ctx.stroke();
      }
      ctx.lineWidth = 6 * s;
    }

    // horns behind the body silhouette
    horn(ctx, -23 * s, -50 * s, s, -1, t);
    horn(ctx, 23 * s, -50 * s, s, 1, t);

    // fuzzy body
    ctx.fillStyle = BLACK;
    fuzzyEllipse(ctx, 0, 0, 54 * s, 60 * s, 7 * s, t);

    // blue face
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * TAU;
      const w = FACE_WOBBLE[i % 24];
      const fx = Math.cos(a) * 40 * s * w, fy = -16 * s + Math.sin(a) * 34 * s * w;
      i ? ctx.lineTo(fx, fy) : ctx.moveTo(fx, fy);
    }
    ctx.closePath(); ctx.fill();

    // face bits
    ctx.save();
    ctx.translate(0, -16 * s);
    if (mood === 'cool') {
      shades(ctx, -14 * s, 15 * s, -11 * s, 10 * s);
    } else {
      eye(ctx, -14 * s, -10 * s, 9.5 * s, look.x, look.y, mood, t);
      eye(ctx, 15 * s, -12 * s, 11.5 * s, look.x, look.y, mood, t);
    }
    // nose
    ctx.fillStyle = BLACK;
    ctx.beginPath();
    ctx.moveTo(-5 * s, 1 * s); ctx.lineTo(5 * s, 1 * s); ctx.lineTo(0, 7.5 * s);
    ctx.closePath(); ctx.fill();
    ctx.translate(0, 10 * s);
    mouth(ctx, s * 0.9, mood);
    ctx.restore();

    ctx.restore();
  }

  /* ---------------- HUD portrait (head only, round frame) -------------- */
  function drawPortrait(ctx, x, y, r, t, mood = 'normal', look = { x: 0, y: 0 }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
    ctx.fillStyle = 'rgba(8,10,22,.85)';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    drawFull(ctx, 0, r * 0.8, r / 70, t, mood, look);
    ctx.restore();
    ctx.strokeStyle = BLUE; ctx.lineWidth = 2.5;
    ctx.shadowColor = BLUE; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /* ---------------- top-down rider on the vehicle ----------------------
     drawn at origin, vehicle faces +X. Small but unmistakably him. */
  function drawRider(ctx, s, lean, t) {
    ctx.save();
    ctx.rotate(lean * 0.25);
    // arms reaching forward to handlebars
    ctx.strokeStyle = BLACK; ctx.lineWidth = 3.4 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(2 * s, -6 * s); ctx.lineTo(12 * s, -8.5 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2 * s, 6 * s); ctx.lineTo(12 * s, 8.5 * s); ctx.stroke();
    // fuzzy round body from above
    ctx.fillStyle = BLACK;
    ctx.beginPath(); ctx.ellipse(-2 * s, 0, 9.5 * s, 8.5 * s, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + Math.sin(t * 3) * 0.05;
      ctx.moveTo(-2 * s + Math.cos(a) * 9 * s, Math.sin(a) * 8 * s);
      ctx.lineTo(-2 * s + Math.cos(a) * 12 * s, Math.sin(a) * 10.6 * s);
    }
    ctx.stroke();
    // horns poke out sideways-forward
    for (const d of [-1, 1]) {
      ctx.save();
      ctx.translate(0.5 * s, d * 6.5 * s);
      ctx.rotate(d * 0.9);
      const w = 2.6 * s, h = 7 * s;
      ctx.beginPath();
      ctx.moveTo(-w, 0); ctx.lineTo(0, -h); ctx.lineTo(w, 0); ctx.closePath();
      ctx.save(); ctx.clip();
      ctx.fillStyle = BLUE; ctx.fillRect(-w, -h, w * 2, h);
      ctx.fillStyle = BLACK; ctx.fillRect(-w, -h * 0.66, w * 2, h * 0.22);
      ctx.restore();
      ctx.restore();
    }
    // sliver of blue face + eyes visible from above at the front
    ctx.fillStyle = BLUE;
    ctx.beginPath(); ctx.ellipse(4.5 * s, 0, 3.6 * s, 5.6 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(6 * s, -2.2 * s, 1.7 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(6 * s, 2.4 * s, 2 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = BLACK;
    ctx.beginPath(); ctx.arc(6.7 * s, -2.2 * s, 0.75 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(6.7 * s, 2.4 * s, 0.85 * s, 0, TAU); ctx.fill();
    ctx.restore();
  }

  return { drawFull, drawPortrait, drawRider, BLUE, BLACK };
})();
