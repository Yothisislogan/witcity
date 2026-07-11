'use strict';
/* =========================================================================
   VEHICLES — arcade driving physics tuned for feel:
   instant throttle response, speed-sensitive steering, split forward /
   lateral grip so the handbrake kicks the tail out, and a nitro boost.
   All vehicles drawn top-down facing +X, monster riding on top.
   ========================================================================= */

const VEHICLES = [
  {
    id: 'moped', name: 'WIT MOPED',
    desc: 'Company issue. Smells like fries.',
    accel: 950, top: 620, rev: 240, turn: 3.1, grip: 9.0, driftGrip: 2.6,
    radius: 22, boost: 1.0,
    stats: { spd: 0.55, acc: 0.7, grip: 0.75 },
    unlock: { deliveries: 0 },
  },
  {
    id: 'golf', name: 'LUCKY CART',
    desc: 'Borrowed from hole 7. Corners like a dream.',
    accel: 1050, top: 580, rev: 260, turn: 3.6, grip: 10.5, driftGrip: 3.0,
    radius: 23, boost: 1.0,
    stats: { spd: 0.5, acc: 0.8, grip: 0.95 },
    unlock: { deliveries: 10 },
  },
  {
    id: 'taco', name: 'TACO TITAN',
    desc: 'A truck-sized taco. Traffic bounces off it.',
    accel: 800, top: 660, rev: 220, turn: 2.5, grip: 8.0, driftGrip: 2.4,
    radius: 30, boost: 1.05, heavy: true,
    stats: { spd: 0.62, acc: 0.5, grip: 0.6 },
    unlock: { deliveries: 25 },
  },
  {
    id: 'caddy', name: "PINK CADDY '59",
    desc: 'All fins, no brakes. Drift machine.',
    accel: 1150, top: 780, rev: 260, turn: 2.9, grip: 7.2, driftGrip: 1.9,
    radius: 27, boost: 1.15,
    stats: { spd: 0.85, acc: 0.85, grip: 0.5 },
    unlock: { deliveries: 60 },
  },
  {
    id: 'wiener', name: 'THE BIG WIENER',
    desc: 'Top speed: yes. Subtlety: no.',
    accel: 1250, top: 880, rev: 280, turn: 2.7, grip: 8.4, driftGrip: 2.2,
    radius: 30, boost: 1.25,
    stats: { spd: 1.0, acc: 0.95, grip: 0.65 },
    unlock: { deliveries: 120 },
  },
];

const vehicleById = id => VEHICLES.find(v => v.id === id) || VEHICLES[0];

class PlayerCar {
  constructor(spec, x, y, heading) {
    this.spec = spec;
    this.x = x; this.y = y;
    this.heading = heading;
    this.vx = 0; this.vy = 0;
    this.angVel = 0;
    this.drifting = false;
    this.driftAmt = 0;      // 0..1 how sideways we are
    this.throttle = 0;
    this.boosting = false;
    this.steerVis = 0;      // smoothed, for drawing lean
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  /* input: {up,down,left,right,brake,boost} · mods: run upgrade multipliers
     solids: from city.solidsNear · returns {impact, wallHit} */
  update(input, dt, mods, solids, bounds) {
    const sp = this.spec;
    const cos = Math.cos(this.heading), sin = Math.sin(this.heading);

    // decompose into forward / lateral components
    let vf = this.vx * cos + this.vy * sin;
    let vr = -this.vx * sin + this.vy * cos;

    const bm = this.boostMult || 1;
    const topSpeed = sp.top * mods.top * (this.boosting ? 1.34 * sp.boost * bm : 1);
    const accel = sp.accel * mods.accel * (this.boosting ? 1.6 * sp.boost * bm : 1);

    // throttle / brake / reverse
    this.throttle = 0;
    if (input.up) {
      vf += accel * dt;
      this.throttle = 1;
    } else if (input.down) {
      if (vf > 40) vf -= 1500 * dt;            // brake
      else vf = Math.max(vf - accel * 0.55 * dt, -sp.rev); // reverse
      this.throttle = 0.4;
    }
    // engine drag / speed cap (soft cap so boost decay feels natural)
    const over = Math.abs(vf) - topSpeed;
    if (over > 0) vf -= Math.sign(vf) * Math.min(over, over * 4 * dt + 40 * dt);
    vf -= vf * 0.28 * dt;                      // rolling resistance
    if (!input.up && !input.down && Math.abs(vf) < 18) vf = 0;

    // steering — speed sensitive, reversed in reverse
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.steerVis = damp(this.steerVis, steer, 10, dt);
    const spd = Math.abs(vf);
    const speedFac = clamp(spd / 110, 0, 1) * (1 - 0.32 * clamp(spd / 900, 0, 1));
    const targetAV = steer * sp.turn * mods.turn * speedFac * Math.sign(vf || 1);
    this.angVel = damp(this.angVel, targetAV, 12, dt);
    this.heading += this.angVel * dt * (1 + this.driftAmt * 0.5);

    // grip: bleed lateral velocity; handbrake loosens it
    const grip = (input.brake ? sp.driftGrip : sp.grip) * mods.grip;
    vr -= vr * Math.min(1, grip * dt);
    // handbrake also scrubs a little forward speed
    if (input.brake && spd > 80) vf -= vf * 0.55 * dt;

    this.driftAmt = clamp(Math.abs(vr) / 240, 0, 1);
    this.drifting = Math.abs(vr) > 85 && spd > 120;

    // recompose with the (possibly new) heading
    const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading);
    this.vx = c2 * vf - s2 * vr;
    this.vy = s2 * vf + c2 * vr;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // ------- collisions -------
    let impact = 0;
    const r = sp.radius;
    for (const s of solids) {
      let nx = 0, ny = 0, pen = 0;
      if (s.shape === 'rect') {
        const cxp = clamp(this.x, s.x, s.x + s.w);
        const cyp = clamp(this.y, s.y, s.y + s.h);
        let dx = this.x - cxp, dy = this.y - cyp;
        let d = Math.hypot(dx, dy);
        if (d >= r) continue;
        if (d < 0.001) { // center inside rect: push out the nearest face
          const l = this.x - s.x, rt = s.x + s.w - this.x, tp = this.y - s.y, bt = s.y + s.h - this.y;
          const m = Math.min(l, rt, tp, bt);
          if (m === l) { nx = -1; ny = 0; pen = r + l; }
          else if (m === rt) { nx = 1; ny = 0; pen = r + rt; }
          else if (m === tp) { nx = 0; ny = -1; pen = r + tp; }
          else { nx = 0; ny = 1; pen = r + bt; }
        } else {
          nx = dx / d; ny = dy / d; pen = r - d;
        }
      } else {
        const dx = this.x - s.x, dy = this.y - s.y;
        const d = Math.hypot(dx, dy), rr = r + s.r;
        if (d >= rr) continue;
        nx = d > 0.001 ? dx / d : 1; ny = d > 0.001 ? dy / d : 0;
        pen = rr - d;
      }
      // push out
      this.x += nx * pen;
      this.y += ny * pen;
      // reflect: kill normal velocity with restitution, keep tangent
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        const rest = 0.35;
        this.vx -= (1 + rest) * vn * nx;
        this.vy -= (1 + rest) * vn * ny;
        this.vx *= 0.9; this.vy *= 0.9;
      }
    }

    // world bounds
    if (this.x < bounds.pad) { this.x = bounds.pad; if (this.vx < 0) { impact = Math.max(impact, -this.vx); this.vx *= -0.4; } }
    if (this.x > bounds.w - bounds.pad) { this.x = bounds.w - bounds.pad; if (this.vx > 0) { impact = Math.max(impact, this.vx); this.vx *= -0.4; } }
    if (this.y < bounds.pad) { this.y = bounds.pad; if (this.vy < 0) { impact = Math.max(impact, -this.vy); this.vy *= -0.4; } }
    if (this.y > bounds.h - bounds.pad) { this.y = bounds.h - bounds.pad; if (this.vy > 0) { impact = Math.max(impact, this.vy); this.vy *= -0.4; } }

    return { impact };
  }

  /* rear wheel world positions, for skid marks */
  rearWheels() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const bx = this.x - c * this.spec.radius * 0.7;
    const by = this.y - s * this.spec.radius * 0.7;
    const wx = -s, wy = c;
    const hw = this.spec.radius * 0.55;
    return [
      { x: bx + wx * hw, y: by + wy * hw },
      { x: bx - wx * hw, y: by - wy * hw },
    ];
  }

  draw(ctx, t, carrying) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // headlight cone (under the car sprite, additive)
    ctx.save();
    ctx.rotate(this.heading);
    ctx.globalCompositeOperation = 'lighter';
    const hl = ctx.createRadialGradient(20, 0, 4, 150, 0, 150);
    hl.addColorStop(0, 'rgba(255,235,170,.20)');
    hl.addColorStop(1, 'rgba(255,235,170,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.arc(16, 0, 165, -0.42, 0.42);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.rotate(this.heading);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath();
    ctx.ellipse(0, 4, this.spec.radius * 1.25, this.spec.radius * 0.85, 0, 0, TAU);
    ctx.fill();

    // boost flames
    if (this.boosting) {
      const fl = 18 + Math.sin(t * 40) * 7;
      const grad = ctx.createLinearGradient(-this.spec.radius - fl, 0, -this.spec.radius * 0.6, 0);
      grad.addColorStop(0, 'rgba(255,120,40,0)');
      grad.addColorStop(0.6, 'rgba(255,170,60,.85)');
      grad.addColorStop(1, 'rgba(255,240,180,.95)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-this.spec.radius - fl, 0);
      ctx.lineTo(-this.spec.radius * 0.6, -7);
      ctx.lineTo(-this.spec.radius * 0.6, 7);
      ctx.closePath(); ctx.fill();
    }

    drawVehicleBody(ctx, this.spec.id, t);

    // the monster himself
    MONSTER.drawRider(ctx, this.spec.radius / 16, this.steerVis, t);

    // glowing food crate on the back when carrying
    if (carrying) {
      ctx.save();
      ctx.translate(-this.spec.radius * 0.72, 0);
      ctx.fillStyle = '#b5541e';
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2;
      ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 10 + Math.sin(t * 6) * 4;
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.shadowBlur = 0;
      ctx.font = '12px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(carrying, 0, 1);
      // steam wiggles
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.5;
      for (const off of [-5, 0, 5]) {
        ctx.beginPath();
        ctx.moveTo(off, -10);
        ctx.quadraticCurveTo(off + Math.sin(t * 5 + off) * 3, -16, off, -21);
        ctx.stroke();
      }
      ctx.restore();
    }

    // taillights
    ctx.fillStyle = this.throttle < 0.5 && this.speed > 50 ? '#ff5252' : 'rgba(255,60,60,.55)';
    ctx.fillRect(-this.spec.radius * 0.95, -this.spec.radius * 0.45, 3, 6);
    ctx.fillRect(-this.spec.radius * 0.95, this.spec.radius * 0.45 - 6, 3, 6);

    ctx.restore();
  }
}

/* top-down bodies, all facing +X */
function drawVehicleBody(ctx, id, t) {
  switch (id) {
    case 'moped': {
      ctx.fillStyle = '#35c8f5';
      roundRect(ctx, -20, -9, 34, 18, 7); ctx.fill();
      ctx.fillStyle = '#131320';
      roundRect(ctx, -24, -6, 10, 12, 3); ctx.fill();      // rear rack
      ctx.fillStyle = '#e8e8f0';
      roundRect(ctx, 10, -8, 10, 16, 4); ctx.fill();        // front shield
      ctx.fillStyle = '#131320';
      ctx.fillRect(17, -10, 4, 20);                          // handlebars
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(20, 0, 3, 0, TAU); ctx.fill(); // headlight
      break;
    }
    case 'golf': {
      ctx.fillStyle = '#e8e8f0';
      roundRect(ctx, -22, -13, 44, 26, 6); ctx.fill();
      ctx.strokeStyle = '#5cff8a'; ctx.lineWidth = 2.5;
      roundRect(ctx, -22, -13, 44, 26, 6); ctx.stroke();
      ctx.fillStyle = '#131320';
      ctx.fillRect(-24, -14, 6, 28);                        // bag rack
      ctx.fillStyle = 'rgba(53,200,245,.4)';
      roundRect(ctx, 4, -11, 14, 22, 4); ctx.fill();        // windshield
      break;
    }
    case 'taco': {
      ctx.fillStyle = '#ffb347';
      roundRect(ctx, -30, -16, 60, 32, 9); ctx.fill();
      ctx.fillStyle = '#e8912e';
      ctx.beginPath(); ctx.ellipse(0, 0, 26, 12, 0, Math.PI, 0); ctx.fill(); // taco shell hump
      ctx.fillStyle = '#4caf50';
      for (let i = -16; i <= 16; i += 8) ctx.fillRect(i, -3, 5, 6);          // lettuce
      ctx.fillStyle = '#e53935';
      ctx.beginPath(); ctx.arc(-8, 1, 3, 0, TAU); ctx.arc(8, -1, 3, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(53,200,245,.4)';
      roundRect(ctx, 18, -12, 10, 24, 3); ctx.fill();
      break;
    }
    case 'caddy': {
      ctx.fillStyle = '#ff7ac8';
      roundRect(ctx, -32, -13, 62, 26, 8); ctx.fill();
      ctx.fillStyle = '#ffa8dc';
      roundRect(ctx, -10, -10, 26, 20, 5); ctx.fill();      // interior
      ctx.fillStyle = '#fff';
      ctx.fillRect(-32, -13, 5, 26);                        // rear chrome
      // tail fins
      ctx.fillStyle = '#ff4fd8';
      ctx.beginPath(); ctx.moveTo(-32, -13); ctx.lineTo(-40, -16); ctx.lineTo(-32, -6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-32, 13); ctx.lineTo(-40, 16); ctx.lineTo(-32, 6); ctx.fill();
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(29, -8, 2.6, 0, TAU); ctx.arc(29, 8, 2.6, 0, TAU); ctx.fill();
      break;
    }
    case 'wiener': {
      ctx.fillStyle = '#e8b06a'; // bun
      roundRect(ctx, -34, -14, 68, 28, 13); ctx.fill();
      ctx.fillStyle = '#b5502e'; // dog
      roundRect(ctx, -30, -7, 64, 14, 7); ctx.fill();
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2.5; // mustard zigzag
      ctx.beginPath();
      for (let x = -26; x <= 28; x += 7) ctx.lineTo(x, (x / 7) % 2 ? -3 : 3);
      ctx.stroke();
      break;
    }
  }
  // wheels hint
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(-16, -17, 9, 4); ctx.fillRect(-16, 13, 9, 4);
  ctx.fillRect(10, -17, 9, 4); ctx.fillRect(10, 13, 9, 4);
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* small preview used by the garage cards */
function drawVehiclePreview(canvas, id) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(2, 2);
  drawVehicleBody(ctx, id, 0);
  MONSTER.drawRider(ctx, vehicleById(id).radius / 16, 0, 0);
  ctx.restore();
}
