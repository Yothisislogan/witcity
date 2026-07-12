'use strict';
/* =========================================================================
   GAME — main loop, world state, traffic, scoring, HUD, camera, juice.
   ========================================================================= */

const QUIPS = {
  start: ['Another shift, another shrimp.', 'The city is HUNGRY tonight.', 'Insurance? Paid. Helmet? Lost. LET\'S GO.', 'I can smell the tips from here.'],
  pickup: ['Hot! Hot! Okay it\'s in the crate.', 'Smells like a five-star tip.', 'Precious cargo secured!', 'If I eat one fry, is that stealing? Asking for me.'],
  deliver: ['Hot and fresh! Mostly hot!', 'Another satisfied human!', 'Tip me or fear me. Kidding! (Tip me.)', 'They said "keep the change." I AM the change.', 'Delivered with only minor screaming.'],
  crash: ['Good thing we\'re insured!', 'That\'s coming out of the deductible.', 'I\'ll file the claim later. DRIVE.', 'We insure things. Like that lamppost.', 'The building came out of NOWHERE.'],
  fragile: ['THE CAKE. WATCH THE CAKE.', 'It\'s leaning! IT\'S LEANING!', 'Careful! That food has feelings!'],
  levelup: ['I feel... fuzzier. STRONGER.', 'New perk! Who dis?', 'The horns are tingling. That means yes.'],
  water: ['BLUB. Wrong lane. BLUB.', 'The fountain show was NOT scheduled.', 'My socks. My beautiful socks.'],
  lowtime: ['Clock\'s melting! MOVE!', 'No no no not the overtime paperwork—', 'Faster, past me! FASTER!'],
  scare: ['Sorry! Free cardio!', 'Pedestrians have great reflexes here.', 'You\'re welcome for the story!'],
  jackpot: ['DING DING DING! TRIPLE PAY!', 'The claw remembers lucky number seven!'],
  cold: ['The tip has left the chat.', 'Cold fries, cold hearts.', 'They can TELL when it\'s cold. They always know.'],
};

const GAME = {
  state: 'menu',          // menu | play | over
  freeRoam: false,
  city: null,
  car: null,
  cam: { x: 0, y: 0, zoom: 1, shakeX: 0, shakeY: 0, shakeAmt: 0 },
  input: { up: false, down: false, left: false, right: false, brake: false, boost: false },
  gp: { up: false, down: false, left: false, right: false, brake: false, boost: false, pauseEdge: false },
  mods: null,
  taken: [],
  save: null,

  score: 0, level: 1, xpInto: 0,
  combo: 0, timeLeft: 75, boost: 100,
  job: null,
  stats: null,

  traffic: [],
  tourists: [],
  skids: [],
  parts: [],
  texts: [],
  announces: [],
  quip: null, quipT: 0,
  mood: 'normal', moodT: 0,

  paused: false,
  time: 0,               // global clock (seconds since boot)
  crashCd: 0, bumpCd: 0, warnT: 0, waterIn: false,
  menuLook: { x: 0, y: 0 },
};

/* =========================================================================
   BOOT
   ========================================================================= */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const IS_TOUCH = 'ontouchstart' in window; // HUD lifts clear of the touch pads

const defaultSave = () => ({
  high: 0, totalDeliv: 0, totalScore: 0,
  vehicles: ['moped'], vehicle: 'moped',
  settings: { music: 0.7, sfx: 0.9, shake: true },
});

/* merge whatever is on disk over the defaults — a save from an older build
   (missing fields) must never be able to crash boot into a black screen */
function normalizeSave(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const s = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
  if (!Array.isArray(s.vehicles) || !s.vehicles.length) s.vehicles = ['moped'];
  if (!s.vehicles.includes(s.vehicle)) s.vehicle = s.vehicles[0];
  for (const k of ['high', 'totalDeliv', 'totalScore'])
    if (!Number.isFinite(s[k])) s[k] = 0;
  return s;
}

function boot() {
  GAME.save = normalizeSave(store.get('witcity_v1', null));
  AUDIO.setMusicVol(GAME.save.settings.music);
  AUDIO.setSfxVol(GAME.save.settings.sfx);

  GAME.city = new City(8888);
  resize();
  window.addEventListener('resize', resize);

  UI.init(GAME);
  UI.show('menu', false);
  AUDIO.playMusic('menu'); // queued until first gesture unlocks audio

  bindKeys();
  // not {once}: the first key could be Escape, which grants no activation —
  // init() is idempotent and resumes a suspended context on later gestures
  document.addEventListener('pointerdown', () => AUDIO.init());
  document.addEventListener('keydown', () => AUDIO.init());
  window.addEventListener('blur', () => {
    // keyups go to the other app — unlatch everything or the car drives itself on resume
    for (const k in GAME.input) GAME.input[k] = false;
    if (GAME.state === 'play' && !UI.isOpen()) GAME.togglePause();
  });
  document.addEventListener('mousemove', e => {
    GAME.menuLook.x = clamp((e.clientX / window.innerWidth - 0.5) * 2, -1, 1);
    GAME.menuLook.y = clamp((e.clientY / window.innerHeight - 0.5) * 2, -1, 1);
  });

  // menu attract camera starts mid-strip
  GAME.cam.x = GAME.city.playerStart.x;
  GAME.cam.y = GAME.city.playerStart.y;

  requestAnimationFrame(frame);
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

/* =========================================================================
   INPUT
   ========================================================================= */
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'brake',
  ShiftLeft: 'boost', ShiftRight: 'boost',
};

function bindKeys() {
  document.addEventListener('keydown', e => {
    // a focused slider/checkbox owns its keys (arrows, Space) — don't hijack
    const ae = document.activeElement;
    if (UI.isOpen() && ae && ae.tagName === 'INPUT') return;
    if (e.repeat) { if (KEYMAP[e.code]) e.preventDefault(); return; }
    // menus swallow navigation keys
    if (UI.isOpen() && UI.menuKey(e)) { e.preventDefault(); return; }

    if (e.code === 'Escape' || e.code === 'KeyP') {
      const cur = UI.current();
      if (cur === 'levelup') return;                       // no escaping the draft
      if (GAME.state === 'play') {
        if (cur && cur !== 'pause') { UI.back(); return; } // settings-on-pause etc.
        GAME.togglePause();
      } else if (cur && cur !== 'menu' && cur !== 'over') {
        UI.back();                                          // back out of sub-screens
      }
      return;
    }
    if (e.code === 'KeyM') {
      const muted = AUDIO.toggleMusicMute();
      UI.toast(muted ? '🔇 MUSIC OFF' : '🎵 MUSIC ON');
      return;
    }
    if (e.code === 'KeyH' && GAME.state === 'play') { AUDIO.sfx.honk(); say(choice(['HONK!', 'Beep beep, I\'m a monster.', 'HONK (affectionate)'])); return; }

    if (KEYMAP[e.code]) {
      GAME.input[KEYMAP[e.code]] = true;
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', e => {
    if (KEYMAP[e.code]) { GAME.input[KEYMAP[e.code]] = false; e.preventDefault(); }
  });
}

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && pads[0];
  const g = GAME.gp;
  const wasPause = g._pauseHeld;
  g.up = g.down = g.left = g.right = g.brake = g.boost = false;
  g._pauseHeld = false;
  if (!p) return;
  const ax = p.axes[0] || 0;
  if (ax < -0.35) g.left = true;
  if (ax > 0.35) g.right = true;
  if (p.buttons[14]?.pressed) g.left = true;
  if (p.buttons[15]?.pressed) g.right = true;
  if (p.buttons[7]?.pressed || p.buttons[12]?.pressed) g.up = true;
  if (p.buttons[6]?.pressed || p.buttons[13]?.pressed) g.down = true;
  if (p.buttons[1]?.pressed) g.brake = true;
  if (p.buttons[0]?.pressed) g.boost = true;
  g._pauseHeld = !!p.buttons[9]?.pressed;
  if (g._pauseHeld && !wasPause && GAME.state === 'play' && UI.current() !== 'levelup') GAME.togglePause();
}

function liveInput() {
  const k = GAME.input, g = GAME.gp;
  return {
    up: k.up || g.up, down: k.down || g.down,
    left: k.left || g.left, right: k.right || g.right,
    brake: k.brake || g.brake, boost: k.boost || g.boost,
  };
}

/* =========================================================================
   RUN LIFECYCLE
   ========================================================================= */
GAME.startRun = function (freeRoam) {
  if (this.state === 'play') this.bankRun(); // restart mid-run still banks career progress
  const start = this.city.playerStart;
  this.freeRoam = freeRoam;
  this.statsBanked = false;
  this.car = new PlayerCar(vehicleById(this.save.vehicle), start.x, start.y, start.heading);
  this.mods = freshMods();
  this.taken = [];
  this.score = 0; this.level = 1; this.xpInto = 0;
  this.combo = 0; this.timeLeft = 75; this.boost = 100;
  this.stats = { deliveries: 0, crashes: 0, tips: 0, distance: 0, scares: 0, bestCombo: 0 };
  this.pendingLevels = [];
  this.skids.length = 0; this.parts.length = 0; this.texts.length = 0; this.announces.length = 0;
  this.traffic.length = 0; this.tourists.length = 0;
  this.paused = false;
  this.job = newJob(this);
  this.state = 'play';
  this.quip = null; this.mood = 'normal';
  AUDIO.playMusic('game');
  announce(freeRoam ? 'FREE ROAM — CRUISE!' : 'SHIFT START!', '#ffd24a', 1.6);
  say(choice(QUIPS.start));
  UI.refreshTouch();
};

/* fold the run's stats into the persistent save; safe to call once per run
   from ANY exit path (timer death, quit-to-menu, restart, free roam quit) */
GAME.bankRun = function () {
  if (!this.stats || this.statsBanked) return;
  this.statsBanked = true;
  const s = this.save;
  s.totalDeliv += this.stats.deliveries;
  s.totalScore += Math.round(this.score);
  // roguelite meta-unlocks
  for (const v of VEHICLES) {
    if (!s.vehicles.includes(v.id) && s.totalDeliv >= v.unlock.deliveries) {
      s.vehicles.push(v.id);
      UI.toast(`🔓 NEW RIDE UNLOCKED: ${v.name}`);
      AUDIO.sfx.unlock();
    }
  }
  this.persist();
};

GAME.endRun = function () {
  this.state = 'over';
  AUDIO.engineOff();
  AUDIO.sfx.gameover();
  AUDIO.playMusic('menu');
  const s = this.save;
  const newRecord = this.score > s.high && !this.freeRoam;
  if (!this.freeRoam) s.high = Math.max(s.high, Math.round(this.score));
  this.bankRun();
  UI.refreshMenuFoot();
  UI.showGameOver({
    score: Math.round(this.score), newRecord,
    deliveries: this.stats.deliveries, bestCombo: this.stats.bestCombo,
    tips: Math.round(this.stats.tips), level: this.level,
    crashes: this.stats.crashes, distance: this.stats.distance, scares: this.stats.scares,
  });
};

GAME.quitToMenu = function () {
  if (this.state === 'play') this.bankRun(); // free-roam & abandoned shifts count too
  this.state = 'menu';
  this.paused = false;
  AUDIO.engineOff();
  AUDIO.playMusic('menu');
  UI.closeAll();
  UI.refreshMenuFoot();
  UI.show('menu', false);
};

GAME.togglePause = function () {
  if (this.state !== 'play') return;
  this.paused = !this.paused;
  if (this.paused) { UI.show('pause', false); AUDIO.engineOff(); AUDIO.sfx.uiSelect(); }
  else { UI.closeAll(); }
};

GAME.persist = function () { store.set('witcity_v1', this.save); };
GAME.wipeSave = function () {
  store.del('witcity_v1');
  this.save = defaultSave();
  AUDIO.setMusicVol(this.save.settings.music); // resync live audio to the fresh defaults
  AUDIO.setSfxVol(this.save.settings.sfx);
  this.persist();
};

/* =========================================================================
   JUICE HELPERS
   ========================================================================= */
function say(txt) { GAME.quip = txt; GAME.quipT = 4; }
function setMood(m, t = 2.5) { GAME.mood = m; GAME.moodT = t; }
function announce(txt, color = '#fff', life = 1.3) {
  GAME.announces.push({ txt, color, t: life, life });
}
function fText(x, y, txt, color = '#fff', size = 18) {
  GAME.texts.push({ x, y, txt, color, size, t: 1.6 });
}
function burst(x, y, n, opts = {}) {
  for (let i = 0; i < n; i++) {
    const a = rand(TAU), sp = rand(opts.spMin ?? 40, opts.spMax ?? 260);
    GAME.parts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(0.4, opts.life ?? 1), t: 0,
      size: rand(2, opts.size ?? 5),
      color: opts.colors ? choice(opts.colors) : '#ffd24a',
      type: opts.type || 'spark', rot: rand(TAU), vr: rand(-8, 8),
      drag: opts.drag ?? 2,
    });
  }
}
function shake(amt) {
  if (!GAME.save.settings.shake) return;
  GAME.cam.shakeAmt = Math.min(24, GAME.cam.shakeAmt + amt);
}

/* =========================================================================
   TRAFFIC
   ========================================================================= */
const TRAFFIC_COLORS = ['#5a6b7a', '#7a5a6b', '#4a5a4a', '#6b6b58', '#39485c', '#5c3948'];
const DIRV = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function laneCoord(city, lineIdx, vertical, dir) {
  // right-hand traffic lane offset from the line center
  const off = city.laneOff(lineIdx, vertical);
  if (!vertical) return dir === 0 ? off : -off;    // horizontal travel: offset in y
  return dir === 1 ? -off : off;                    // vertical travel: offset in x
}

function spawnTrafficCar(cityRef, px, py) {
  const c = cityRef;
  for (let tries = 0; tries < 8; tries++) {
    const vertical = Math.random() < 0.55;
    let x, y, dir, line;
    if (vertical) {
      line = clamp(Math.round((px + rand(-1800, 1800)) / c.G), 1, c.N - 1);
      dir = Math.random() < 0.5 ? 1 : 3;
      x = line * c.G + laneCoord(c, line, true, dir);
      y = clamp(py + rand(-1800, 1800), 100, c.H - 100);
    } else {
      line = clamp(Math.round((py + rand(-1800, 1800)) / c.G), 1, c.N - 1);
      dir = Math.random() < 0.5 ? 0 : 2;
      y = line * c.G + laneCoord(c, line, false, dir);
      x = clamp(px + rand(-1800, 1800), 100, c.W - 100);
    }
    const d = dist(x, y, px, py);
    if (d < 650 || d > 2400) continue;
    return {
      x, y, dir, line,
      speed: 0, base: rand(150, 250),
      color: choice(TRAFFIC_COLORS), honkCd: 0, radius: 22,
    };
  }
  return null;
}

function updateTraffic(dt) {
  const g = GAME, c = g.city;
  const px = g.car ? g.car.x : g.cam.x, py = g.car ? g.car.y : g.cam.y;

  while (g.traffic.length < 18) {
    const t = spawnTrafficCar(c, px, py);
    if (!t) break;
    g.traffic.push(t);
  }

  for (let i = g.traffic.length - 1; i >= 0; i--) {
    const t = g.traffic[i];
    if (dist(t.x, t.y, px, py) > 2700) { g.traffic.splice(i, 1); continue; }
    t.honkCd = Math.max(0, t.honkCd - dt);

    const [dx, dy] = DIRV[t.dir];
    // brake for obstacles ahead (player or other traffic)
    let blocked = false;
    const lookX = t.x + dx * 120, lookY = t.y + dy * 120;
    if (g.car && dist(lookX, lookY, g.car.x, g.car.y) < 85) blocked = true;
    if (!blocked) for (const o of g.traffic) {
      if (o === t) continue;
      if (dist(lookX, lookY, o.x, o.y) < 60) { blocked = true; break; }
    }
    t.speed = damp(t.speed, blocked ? 0 : t.base, blocked ? 8 : 2, dt);

    const oldA = t.dir % 2 === 0 ? t.x : t.y;   // coordinate along travel axis
    t.x += dx * t.speed * dt;
    t.y += dy * t.speed * dt;
    const newA = t.dir % 2 === 0 ? t.x : t.y;

    // intersection crossings: maybe turn
    const G = c.G;
    const lo = Math.min(oldA, newA), hi = Math.max(oldA, newA);
    const cross = Math.floor(hi / G) * G;
    if (cross > lo && cross <= hi && cross >= 0 && cross <= c.W) {
      const iLine = Math.round(cross / G); // the line we're crossing
      const r = Math.random();
      if (r < 0.42) {
        const turnRight = Math.random() < 0.5;
        const newDir = (t.dir + (turnRight ? 1 : 3)) % 4;
        const vertical = newDir === 1 || newDir === 3;
        // snap onto the new line's lane through this intersection
        // pivot around the car's own lane position — snapping to the road
        // center would visibly teleport it ~80px sideways mid-turn
        const interX = t.dir % 2 === 0 ? cross : t.line * G;
        const interY = t.dir % 2 === 0 ? t.line * G : cross;
        t.dir = newDir;
        t.line = vertical ? Math.round(interX / G) : Math.round(interY / G);
        if (vertical) {
          t.x = t.line * G + laneCoord(c, t.line, true, newDir);
          t.y += DIRV[newDir][1] * 40;
        } else {
          t.y = t.line * G + laneCoord(c, t.line, false, newDir);
          t.x += DIRV[newDir][0] * 40;
        }
      }
    }
    // u-turn at world's edge — test only the travel-axis coordinate; the
    // lane offset on rim roads would otherwise trip this every single step
    const along = t.dir % 2 === 0 ? t.x : t.y;
    if (along < 70 || along > c.W - 70) {
      t.dir = (t.dir + 2) % 4;
      const vertical = t.dir === 1 || t.dir === 3;
      if (vertical) {
        t.x = t.line * G + laneCoord(c, t.line, true, t.dir);
        t.y = clamp(t.y, 72, c.H - 72);
      } else {
        t.y = t.line * G + laneCoord(c, t.line, false, t.dir);
        t.x = clamp(t.x, 72, c.W - 72);
      }
    }

    // collide with player
    if (g.car && g.state === 'play') {
      const rr = t.radius + g.car.spec.radius;
      const d = dist(t.x, t.y, g.car.x, g.car.y);
      if (d < rr && d > 0.001) {
        const nx = (g.car.x - t.x) / d, ny = (g.car.y - t.y) / d;
        const pen = rr - d;
        const heavy = g.car.spec.heavy ? 0.85 : 0.5;
        g.car.x += nx * pen * heavy; g.car.y += ny * pen * heavy;
        t.x -= nx * pen * (1 - heavy) * 0.8; t.y -= ny * pen * (1 - heavy) * 0.8;
        const vn = g.car.vx * nx + g.car.vy * ny;
        if (vn < 0) {
          g.car.vx -= 1.4 * vn * nx; g.car.vy -= 1.4 * vn * ny;
          onImpact(-vn * (g.car.spec.heavy ? 0.5 : 1));
        }
        if (t.honkCd <= 0) { AUDIO.sfx.carHonk(); t.honkCd = 2.5; }
        t.speed = 0;
      }
    }
  }
}

function drawTraffic() {
  for (const t of GAME.traffic) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(Math.atan2(DIRV[t.dir][1], DIRV[t.dir][0]));
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(0, 3, 26, 15, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = t.color;
    roundRect(ctx, -24, -11, 48, 22, 6); ctx.fill();
    ctx.fillStyle = 'rgba(140,200,255,.30)';
    roundRect(ctx, 2, -9, 12, 18, 3); ctx.fill();
    roundRect(ctx, -14, -9, 10, 18, 3); ctx.fill();
    ctx.fillStyle = '#ffd987';
    ctx.fillRect(22, -8, 3, 5); ctx.fillRect(22, 3, 3, 5);
    ctx.fillStyle = 'rgba(255,70,70,.8)';
    ctx.fillRect(-25, -8, 3, 5); ctx.fillRect(-25, 3, 3, 5);
    ctx.restore();
  }
}

/* =========================================================================
   TOURISTS
   ========================================================================= */
function spawnTourist(cityRef, px, py) {
  const c = cityRef;
  for (let tries = 0; tries < 6; tries++) {
    const vertical = Math.random() < 0.5;
    const line = clamp(Math.round(((vertical ? px : py) + rand(-1200, 1200)) / c.G), 1, c.N - 1);
    const side = Math.random() < 0.5 ? -1 : 1;
    const hw = vertical ? c.lineHalfV(line) : c.lineHalfH();
    const along = clamp((vertical ? py : px) + rand(-1200, 1200), 120, c.W - 120);
    const x = vertical ? line * c.G + side * (hw + 14) : along;
    const y = vertical ? along : line * c.G + side * (hw + 14);
    if (dist(x, y, px, py) < 350) continue;
    return {
      x, y, vertical, dir: Math.random() < 0.5 ? 1 : -1,
      speed: rand(16, 42), scared: 0, yelpCd: 0,
      shirt: choice(PALETTE), skin: choice(['#e8b88a', '#c68d5c', '#8a5a34', '#f0cfa8']),
    };
  }
  return null;
}

function updateTourists(dt) {
  const g = GAME;
  const px = g.car ? g.car.x : g.cam.x, py = g.car ? g.car.y : g.cam.y;
  while (g.tourists.length < 12) {
    const t = spawnTourist(g.city, px, py);
    if (!t) break;
    g.tourists.push(t);
  }
  for (let i = g.tourists.length - 1; i >= 0; i--) {
    const t = g.tourists[i];
    if (dist(t.x, t.y, px, py) > 1900) { g.tourists.splice(i, 1); continue; }
    t.yelpCd = Math.max(0, t.yelpCd - dt);
    if (t.scared > 0) {
      t.scared -= dt;
    } else {
      if (t.vertical) t.y += t.dir * t.speed * dt;
      else t.x += t.dir * t.speed * dt;
      if (Math.random() < 0.005) t.dir *= -1;
    }
    // comedy dodge
    if (g.car && g.state === 'play' && t.yelpCd <= 0) {
      const d = dist(t.x, t.y, g.car.x, g.car.y);
      if (d < 130 && g.car.speed > 260) {
        const away = Math.atan2(t.y - g.car.y, t.x - g.car.x);
        t.x += Math.cos(away) * 46; t.y += Math.sin(away) * 46;
        t.scared = 1.2; t.yelpCd = 4;
        g.stats.scares++;
        AUDIO.sfx.yelp();
        fText(t.x, t.y - 24, choice(['!!', 'WHOA', 'MY SLUSHIE!', '😱', 'HEY!']), '#ffd24a', 15);
        if (Math.random() < 0.25) say(choice(QUIPS.scare));
      }
    }
  }
}

function drawTourists(t) {
  for (const p of GAME.tourists) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.scared > 0) ctx.translate(0, -Math.sin(p.scared * 10) * 4);
    const step = Math.sin((p.vertical ? p.y : p.x) * 0.15) * 2;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(0, 4, 7, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.shirt;
    ctx.fillRect(-4, -6 + step * 0.2, 8, 9);
    ctx.fillStyle = p.skin;
    ctx.beginPath(); ctx.arc(0, -9 + step * 0.2, 4, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* =========================================================================
   GAMEPLAY UPDATE
   ========================================================================= */
function onImpact(impact) {
  const g = GAME;
  if (impact < 60) return;
  if (impact < 190) {
    // light bump — its own debounce, so it can't mask a real crash behind it
    if (g.crashCd > 0 || g.bumpCd > 0) return;
    AUDIO.sfx.bump();
    shake(impact * 0.02);
    g.bumpCd = 0.25;
    return;
  }
  // real crash
  if (g.crashCd > 0) return;
  g.crashCd = 0.5;
  const k = clamp((impact - 190) / 500, 0, 1);
  AUDIO.sfx.crash(k);
  shake(6 + k * 14);
  burst(g.car.x, g.car.y, 10 + k * 14, { colors: ['#ffd24a', '#ff7a3c', '#fff'], spMax: 320 });
  g.stats.crashes++;
  setMood('dizzy');
  if (g.job && g.job.phase === 'drop' && g.job.fragile) {
    g.job.tipLeft *= 0.6;
    say(choice(QUIPS.fragile));
    fText(g.car.x, g.car.y - 40, 'THE FOOD!!', '#ff5c5c', 20);
  } else if (g.combo > 0 && !g.mods.comboShield) {
    g.combo = 0;
    fText(g.car.x, g.car.y - 40, 'COMBO LOST!', '#ff5c5c', 20);
    say(choice(QUIPS.crash));
  } else {
    if (g.mods.comboShield && g.combo > 0) fText(g.car.x, g.car.y - 40, 'INSURED! COMBO SAFE', '#5cff8a', 16);
    else say(choice(QUIPS.crash));
  }
}

function beaconInfo() {
  const j = GAME.job;
  if (!j) return null;
  const spot = j.phase === 'pickup' ? j.rest.door : j.target.door;
  const r = (j.phase === 'pickup' ? 66 : 62) * GAME.mods.radius;
  return { x: spot.x, y: spot.y, r, phase: j.phase };
}

function updatePlay(dt) {
  const g = GAME;
  const inp = liveInput();

  // ---- boost meter ----
  const floor = g.mods.boostFloor; // ghost pepper: fast recharge back to the ember
  // hysteresis: needs 15% to ignite, then burns down to fumes — otherwise the
  // on/off state would flicker at ~18Hz when the meter runs dry under Shift
  const wantBoost = inp.boost && (g.car.boosting ? g.boost > 0.5 : g.boost > 15);
  if (wantBoost && !g.car.boosting) AUDIO.sfx.boostFire();
  g.car.boosting = wantBoost;
  g.car.boostMult = g.mods.boostPow;
  if (g.car.boosting) {
    g.boost = Math.max(0, g.boost - 40 * dt);
    setMood('cool', 0.3);
  } else {
    const emberRate = g.boost < floor ? 4 : 1;
    g.boost = Math.min(100, g.boost + (7 + (g.car.drifting ? 15 : 0)) * g.mods.boostRegen * emberRate * dt);
  }

  // ---- drive ----
  const solids = g.city.solidsNear(g.car.x, g.car.y, g.car.spec.radius + 60);
  const ev = g.car.update(inp, dt, g.mods, solids, { w: g.city.W, h: g.city.H, pad: 40 });
  g.stats.distance += g.car.speed * dt;
  if (ev.impact) onImpact(ev.impact);
  g.crashCd = Math.max(0, g.crashCd - dt);
  g.bumpCd = Math.max(0, (g.bumpCd || 0) - dt);

  // skid marks
  if (g.car.drifting || (inp.brake && g.car.speed > 140)) {
    for (const w of g.car.rearWheels())
      g.skids.push({ x: w.x, y: w.y, a: 0.5, heading: g.car.heading });
    if (g.skids.length > 500) g.skids.splice(0, g.skids.length - 500);
  }
  for (let i = g.skids.length - 1; i >= 0; i--) {
    g.skids[i].a -= dt * 0.09;
    if (g.skids[i].a <= 0) g.skids.splice(i, 1);
  }

  // water zones
  let inWater = false;
  for (const w of g.city.waterZones) {
    if (dist(g.car.x, g.car.y, w.x, w.y) < w.r) { inWater = true; break; }
  }
  if (inWater) {
    g.car.vx -= g.car.vx * 2.6 * dt;
    g.car.vy -= g.car.vy * 2.6 * dt;
    if (!g.waterIn && g.car.speed > 120) {
      AUDIO.sfx.splash();
      burst(g.car.x, g.car.y, 18, { colors: ['#7fd4ff', '#b8e8ff'], spMax: 220, type: 'drop' });
      say(choice(QUIPS.water));
    }
    if (Math.random() < 0.3 && g.car.speed > 60)
      burst(g.car.x, g.car.y, 2, { colors: ['#7fd4ff'], spMax: 120, type: 'drop', life: 0.5 });
  }
  g.waterIn = inWater;

  // ---- job logic ----
  if (g.job) {
    tickJob(g.job, dt);
    if (g.job.phase === 'drop' && g.job.tipLeft <= 0 && !g.job.coldSaid) {
      g.job.coldSaid = true;
      say(choice(QUIPS.cold));
    }
    const b = beaconInfo();
    const d = dist(g.car.x, g.car.y, b.x, b.y);
    if (d < b.r) {
      if (g.car.speed < 150) {
        if (g.job.phase === 'pickup') {
          g.job.phase = 'drop';
          AUDIO.sfx.pickup();
          setMood('happy', 1.5);
          fText(b.x, b.y - 50, `${g.job.emoji} GOT IT!`, '#35c8f5', 22);
          say(choice(QUIPS.pickup));
          burst(b.x, b.y, 12, { colors: ['#35c8f5', '#fff'], spMax: 180 });
        } else {
          completeDelivery(b);
        }
      } else if (Math.random() < 0.08) {
        fText(b.x, b.y - 60, 'SLOW DOWN!', '#ff5c5c', 16);
      }
    }
  }

  // ---- shift timer ----
  if (!g.freeRoam) {
    g.timeLeft -= dt;
    if (g.timeLeft <= 10.5) {
      g.warnT -= dt;
      if (g.warnT <= 0) {
        g.warnT = 1;
        AUDIO.sfx.tickWarn();
        if (g.timeLeft > 1) setMood('scared', 1);
        if (Math.abs(g.timeLeft - 9) < 0.5) say(choice(QUIPS.lowtime));
      }
    }
    if (g.timeLeft <= 0) { g.timeLeft = 0; g.endRun(); return; }
  }

  updateTraffic(dt);
  updateTourists(dt);
  updateParticles(dt);

  // moods / quips decay
  g.quipT -= dt; if (g.quipT <= 0) g.quip = null;
  g.moodT -= dt; if (g.moodT <= 0) g.mood = g.timeLeft < 10 && !g.freeRoam ? 'scared' : 'normal';

  // engine audio
  AUDIO.engine(
    clamp(g.car.speed / 900, 0, 1),
    g.car.throttle,
    g.car.drifting ? clamp(g.car.driftAmt, 0, 1) : 0,
    g.car.boosting ? 1 : 0
  );
}

function completeDelivery(b) {
  const g = GAME;
  const out = jobPayout(g.job, g);
  g.combo++;
  g.stats.bestCombo = Math.max(g.stats.bestCombo, g.combo);
  g.stats.deliveries++;
  let total = out.total;
  let jackpotMult = 1;

  // jackpot clause: every 7th delivery triples
  if (g.mods.jackpot && g.stats.deliveries % 7 === 0) {
    jackpotMult = 3;
    total *= 3;
    announce('🎰 JACKPOT! TRIPLE PAY!', '#ffd24a', 2);
    AUDIO.sfx.unlock();
    say(choice(QUIPS.jackpot));
  }

  g.score += total;
  g.xpInto += total;
  g.stats.tips += out.tip * out.comboMult * jackpotMult; // what the player actually earned

  // time bonus
  if (!g.freeRoam) {
    const bonus = clamp(7 + g.job.runDist * 0.004, 8, 20) * g.mods.time;
    g.timeLeft = Math.min(160, g.timeLeft + bonus);
    fText(b.x, b.y - 72, `+${Math.round(bonus)}s`, '#7dff8a', 16);
  }
  g.boost = Math.min(100, g.boost + 18);

  AUDIO.sfx.deliver(g.combo);
  setMood('happy', 2);
  fText(b.x, b.y - 46, `+${fmtMoney(total)}`, '#ffd24a', 24);
  if (out.tip > 1) fText(b.x + 30, b.y - 20, `tip ${fmtMoney(out.tip * out.comboMult * jackpotMult)}`, '#5cff8a', 14);
  if (g.combo > 1) announce(`COMBO x${g.combo}`, '#ff4fd8', 1.1);
  say(choice(QUIPS.deliver));
  burst(b.x, b.y, 26, { colors: ['#ffd24a', '#5cff8a', '#ff4fd8', '#fff'], spMax: 300, type: 'confetti', life: 1.4 });
  burst(b.x, b.y, 8, { colors: ['#5cff8a'], spMax: 160, type: 'bill', life: 1.6 });

  // level ups
  let need = xpNeed(g.level);
  while (g.xpInto >= need) {
    g.xpInto -= need;
    g.level++;
    need = xpNeed(g.level);
    openLevelUp();
  }

  g.job = newJob(g);
}

const xpNeed = level => 420 * Math.pow(level, 1.35);

function openLevelUp() {
  GAME.pendingLevels.push(GAME.level);
  if (UI.current() !== 'levelup') showNextLevelUp();
}

function showNextLevelUp() {
  const g = GAME;
  const lvl = g.pendingLevels.shift();
  if (lvl === undefined) return;
  AUDIO.sfx.levelup();
  setMood('wow', 3);
  const choices = rollChoices(g.taken);
  if (!choices.length) { UI.toast('ALL PERKS MAXED. ABSOLUTE UNIT.'); showNextLevelUp(); return; }
  UI.showLevelUp(lvl, choices, u => {
    u.apply(g.mods);
    g.taken.push(u.id);
    AUDIO.sfx.uiSelect();
    UI.toast(`${u.icon} ${u.name}`);
    say(choice(QUIPS.levelup));
    showNextLevelUp();
  });
}

/* =========================================================================
   PARTICLES / TEXT
   ========================================================================= */
function updateParticles(dt) {
  const g = GAME;
  for (let i = g.parts.length - 1; i >= 0; i--) {
    const p = g.parts[i];
    p.t += dt;
    if (p.t >= p.life) { g.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt;
    if (p.type === 'confetti' || p.type === 'bill') p.rot += p.vr * dt;
  }
  for (let i = g.texts.length - 1; i >= 0; i--) {
    const t = g.texts[i];
    t.t -= dt; t.y -= 26 * dt;
    if (t.t <= 0) g.texts.splice(i, 1);
  }
  for (let i = g.announces.length - 1; i >= 0; i--) {
    g.announces[i].t -= dt;
    if (g.announces[i].t <= 0) g.announces.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of GAME.parts) {
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = a;
    if (p.type === 'confetti') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
      ctx.restore();
    } else if (p.type === 'bill') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = '#2f9e57';
      ctx.fillRect(-6, -3.5, 12, 7);
      ctx.fillStyle = '#bff2cf';
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    } else if (p.type === 'drop') {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.6, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
}

/* =========================================================================
   CAMERA + RENDER
   ========================================================================= */
function updateCamera(dt) {
  const g = GAME, cam = g.cam;
  if (g.state === 'play' && g.car) {
    const look = 0.33;
    const tx = g.car.x + clamp(g.car.vx * look, -240, 240);
    const ty = g.car.y + clamp(g.car.vy * look, -240, 240);
    cam.x = damp(cam.x, tx, 5, dt);
    cam.y = damp(cam.y, ty, 5, dt);
    const targetZoom = 1.02 - clamp(g.car.speed / 900, 0, 1) * 0.18 - (g.car.boosting ? 0.03 : 0);
    cam.zoom = damp(cam.zoom, targetZoom, 3, dt);
  } else {
    // attract mode: drift along the Strip (sweep sized to fit the chunk cache)
    const t = g.time * 0.05;
    cam.x = g.city.STRIP * g.city.G + Math.sin(t * 0.7) * 300;
    cam.y = 3.5 * g.city.G + Math.sin(t) * 1300;
    cam.zoom = 0.8;
  }
  cam.shakeAmt = Math.max(0, cam.shakeAmt - 40 * dt);
  cam.shakeX = rand(-1, 1) * cam.shakeAmt;
  cam.shakeY = rand(-1, 1) * cam.shakeAmt;
}

function render() {
  const g = GAME;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, w, h);

  const scale = (h / 760) * g.cam.zoom;
  const viewW = w / scale, viewH = h / scale;
  const view = {
    x: g.cam.x - viewW / 2, y: g.cam.y - viewH / 2, w: viewW, h: viewH,
    px: g.car ? g.car.x : g.cam.x, py: g.car ? g.car.y : g.cam.y,
  };

  ctx.save();
  ctx.translate(w / 2 + g.cam.shakeX, h / 2 + g.cam.shakeY);
  ctx.scale(scale, scale);
  ctx.translate(-g.cam.x, -g.cam.y);

  // static chunks — bake at most 2 per frame; a fresh column of misses at a
  // chunk boundary would otherwise stack several 5-15ms bakes in one frame
  const C = g.city.CHUNK;
  const cx0 = Math.floor(view.x / C), cx1 = Math.floor((view.x + view.w) / C);
  const cy0 = Math.floor(view.y / C), cy1 = Math.floor((view.y + view.h) / C);
  let bakeBudget = 2;
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      let chunk = g.city.peekChunk(cx, cy);
      if (!chunk) {
        if (bakeBudget <= 0) continue;      // stays dark this frame, bakes next
        bakeBudget--;
        chunk = g.city.getChunk(cx, cy);
      }
      ctx.drawImage(chunk, cx * C, cy * C);
    }

  // skid marks
  ctx.lineCap = 'round';
  for (const s of GAME.skids) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#0c0c12';
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.4, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // beacon under everything moving
  if (g.state === 'play' && g.job) drawBeacon();

  drawTourists(g.time);
  drawTraffic();
  if (g.state === 'play' && g.car) g.car.draw(ctx, g.time, g.job && g.job.phase === 'drop' ? g.job.emoji : null);
  drawParticles();

  // animated city neon on top
  g.city.drawDynamic(ctx, view, g.time);

  // floating world texts
  for (const t of g.texts) {
    ctx.globalAlpha = clamp(t.t / 0.4, 0, 1);
    ctx.font = `bold ${t.size}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = t.color;
    ctx.shadowColor = t.color; ctx.shadowBlur = 8;
    ctx.fillText(t.txt, t.x, t.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,10,.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  if (g.state === 'play') drawHUD(w, h);
  if (g.state === 'menu') drawMenuMonster();
}

function drawBeacon() {
  const g = GAME;
  const b = beaconInfo();
  const col = b.phase === 'pickup' ? '#35c8f5' : '#5cff8a';
  const pulse = 0.85 + Math.sin(g.time * 4) * 0.15;

  // light column
  const grad = ctx.createLinearGradient(b.x, b.y - 260, b.x, b.y);
  grad.addColorStop(0, col + '00');
  grad.addColorStop(1, col + '55');
  ctx.fillStyle = grad;
  ctx.fillRect(b.x - 16, b.y - 260, 32, 260);

  ctx.strokeStyle = col;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.9;
  ctx.setLineDash([14, 10]);
  ctx.lineDashOffset = -g.time * 40;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r * pulse, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r * pulse, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  // bobbing emoji
  ctx.font = '30px serif';
  ctx.textAlign = 'center';
  ctx.fillText(g.job.emoji, b.x, b.y - 264 - Math.sin(g.time * 3) * 8);

  // guide arrow orbiting the car
  const dx = b.x - g.car.x, dy = b.y - g.car.y;
  const d = Math.hypot(dx, dy);
  if (d > 180) {
    const a = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(g.car.x + Math.cos(a) * 76, g.car.y + Math.sin(a) * 76);
    ctx.rotate(a);
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.rotate(-a);
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#dff6ff';
    ctx.fillText(Math.round(d / 10) + 'm', 0, 26);
    ctx.restore();
  }
}

/* =========================================================================
   HUD
   ========================================================================= */
function drawHUD(w, h) {
  const g = GAME;
  const lift = IS_TOUCH ? 128 : 0; // keep bottom HUD visible above the touch pads
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ---- score (top-left) ----
  ctx.textAlign = 'left';
  ctx.font = 'bold 34px "Courier New", monospace';
  ctx.fillStyle = '#ffd24a';
  ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 12;
  ctx.fillText(fmtMoney(g.score), 20, 44);
  ctx.shadowBlur = 0;
  if (g.combo > 1) {
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#ff4fd8';
    ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 10;
    ctx.fillText(`COMBO x${g.combo}  (pay +${Math.round(25 * Math.min(g.combo, 12))}%)`, 20, 70);
    ctx.shadowBlur = 0;
  }

  // ---- timer (top-center) ----
  if (!g.freeRoam) {
    const tw = 220;
    const urgent = g.timeLeft < 10;
    ctx.fillStyle = 'rgba(8,10,24,.75)';
    roundRect(ctx, w / 2 - tw / 2, 12, tw, 44, 10); ctx.fill();
    ctx.strokeStyle = urgent ? '#ff5c5c' : '#35c8f5';
    ctx.lineWidth = 2;
    if (urgent && Math.floor(g.time * 4) % 2 === 0) ctx.strokeStyle = '#fff';
    roundRect(ctx, w / 2 - tw / 2, 12, tw, 44, 10); ctx.stroke();
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = urgent ? '#ff5c5c' : '#dff6ff';
    ctx.fillText('⏱ ' + fmtTime(g.timeLeft), w / 2, 43);
  } else {
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(160,220,255,.7)';
    ctx.fillText('🌴 FREE ROAM', w / 2, 34);
  }

  // ---- level + xp (top-right) ----
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px "Courier New", monospace';
  ctx.fillStyle = '#35c8f5';
  ctx.fillText('LV ' + g.level, w - 22, 34);
  const xw = 150;
  ctx.fillStyle = 'rgba(8,10,24,.7)';
  roundRect(ctx, w - 22 - xw, 42, xw, 10, 5); ctx.fill();
  ctx.fillStyle = '#35c8f5';
  const frac = clamp(g.xpInto / xpNeed(g.level), 0, 1);
  if (frac > 0.01) { roundRect(ctx, w - 22 - xw, 42, xw * frac, 10, 5); ctx.fill(); }

  // ---- job card (under level) ----
  if (g.job) {
    const j = g.job;
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.fillStyle = j.phase === 'pickup' ? '#35c8f5' : '#5cff8a';
    const line1 = j.phase === 'pickup' ? `${j.emoji} PICK UP: ${j.rest.name}` : `${j.emoji} DELIVER: ${j.food}`;
    ctx.fillText(line1, w - 22, 78);
    ctx.font = '13px "Courier New", monospace';
    ctx.fillStyle = '#9fc6dc';
    const line2 = j.phase === 'pickup' ? `${j.food} for ${j.customer}` : `to ${j.where}`;
    ctx.fillText(line2.slice(0, 46), w - 22, 96);
    if (j.fragile) {
      ctx.fillStyle = '#ff5c5c';
      ctx.fillText('⚠ FRAGILE — drive gently!', w - 22, 114);
    }
    // tip meter while carrying
    if (j.phase === 'drop') {
      const tw2 = 150, ty = j.fragile ? 122 : 106;
      ctx.fillStyle = 'rgba(8,10,24,.7)';
      roundRect(ctx, w - 22 - tw2, ty, tw2, 8, 4); ctx.fill();
      ctx.fillStyle = j.tipLeft > 0.4 ? '#5cff8a' : (j.tipLeft > 0.15 ? '#ffd24a' : '#ff5c5c');
      if (j.tipLeft > 0.02) { roundRect(ctx, w - 22 - tw2, ty, tw2 * j.tipLeft, 8, 4); ctx.fill(); }
      ctx.font = '11px "Courier New", monospace';
      ctx.fillStyle = '#9fc6dc';
      ctx.fillText('TIP', w - 26 - tw2, ty + 8);
    }
  }

  // ---- boost (bottom-center) ----
  const bw = 190, by = h - 40 - lift;
  ctx.fillStyle = 'rgba(8,10,24,.75)';
  roundRect(ctx, w / 2 - bw / 2, by, bw, 16, 8); ctx.fill();
  const bfrac = g.boost / 100;
  const bcol = g.boost > 99 ? '#ffd24a' : '#ff7a3c';
  ctx.fillStyle = bcol;
  ctx.shadowColor = bcol; ctx.shadowBlur = g.boost > 99 ? 12 : 0;
  if (bfrac > 0.02) { roundRect(ctx, w / 2 - bw / 2 + 2, by + 2, (bw - 4) * bfrac, 12, 6); ctx.fill(); }
  ctx.shadowBlur = 0;
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9c9';
  ctx.fillText(IS_TOUCH ? '🔥 NITRO' : '🔥 NITRO (SHIFT)', w / 2, by - 6);

  // ---- minimap (bottom-right) ----
  const mm = 158, mx = w - mm - 16, my = h - mm - 16 - lift;
  ctx.drawImage(g.city.minimap(mm), mx, my);
  ctx.strokeStyle = 'rgba(53,200,245,.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(mx, my, mm, mm);
  const ms = mm / g.city.W;
  if (g.job) {
    const b = beaconInfo();
    if (Math.floor(g.time * 3) % 2 === 0) {
      ctx.fillStyle = b.phase === 'pickup' ? '#35c8f5' : '#5cff8a';
      ctx.beginPath(); ctx.arc(mx + b.x * ms, my + b.y * ms, 4, 0, TAU); ctx.fill();
    }
  }
  ctx.save();
  ctx.translate(mx + g.car.x * ms, my + g.car.y * ms);
  ctx.rotate(g.car.heading);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3.6); ctx.lineTo(-4, 3.6); ctx.closePath(); ctx.fill();
  ctx.restore();

  // ---- monster portrait + speech (bottom-left) ----
  const py2 = h - 70 - lift;
  MONSTER.drawPortrait(ctx, 66, py2, 46, g.time, g.mood,
    { x: clamp(GAME.car.vx / 600, -1, 1), y: clamp(GAME.car.vy / 600, -1, 1) });
  if (g.quip) {
    ctx.font = 'bold 13px "Courier New", monospace';
    const padX = 10, tw3 = ctx.measureText(g.quip).width + padX * 2;
    ctx.fillStyle = 'rgba(8,10,24,.85)';
    roundRect(ctx, 124, py2 - 36, tw3, 30, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(53,200,245,.5)'; ctx.lineWidth = 1.5;
    roundRect(ctx, 124, py2 - 36, tw3, 30, 8); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(124, py2 - 18); ctx.lineTo(114, py2 - 10); ctx.lineTo(126, py2 - 14);
    ctx.fillStyle = 'rgba(8,10,24,.85)'; ctx.fill();
    ctx.fillStyle = '#dff6ff';
    ctx.textAlign = 'left';
    ctx.fillText(g.quip, 124 + padX, py2 - 16);
  }

  // ---- center announcements ----
  let ay = h * 0.3;
  for (const a of g.announces) {
    const k = a.t / a.life;
    const pop = 1 + (1 - Math.min(1, (a.life - a.t) * 8)) * 0.8;
    ctx.globalAlpha = clamp(k * 3, 0, 1);
    ctx.font = `bold ${Math.round(38 * pop)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = a.color;
    ctx.shadowColor = a.color; ctx.shadowBlur = 18;
    ctx.fillText(a.txt, w / 2, ay);
    ctx.shadowBlur = 0;
    ay += 52;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* menu screen monster (drawn on its own little canvas) */
const menuMonsterCanvas = document.getElementById('menuMonster');
const menuMonsterCtx = menuMonsterCanvas ? menuMonsterCanvas.getContext('2d') : null;
function drawMenuMonster() {
  if (!menuMonsterCtx) return;
  const c = menuMonsterCanvas, g2 = menuMonsterCtx;
  const mx = c.width / 2, my = c.height / 2 - 8;
  g2.clearRect(0, 0, c.width, c.height);

  // neon spotlight — the black fur needs something to stand against
  const pulse = 1 + Math.sin(GAME.time * 1.6) * 0.06;
  const glow = g2.createRadialGradient(mx, my, 6, mx, my, 118 * pulse);
  glow.addColorStop(0, 'rgba(255,79,216,.38)');
  glow.addColorStop(0.55, 'rgba(53,200,245,.18)');
  glow.addColorStop(1, 'rgba(53,200,245,0)');
  g2.fillStyle = glow;
  g2.fillRect(0, 0, c.width, c.height);

  // stage ring under his feet
  g2.strokeStyle = 'rgba(255,210,74,.55)';
  g2.lineWidth = 3;
  g2.shadowColor = '#ffd24a'; g2.shadowBlur = 12;
  g2.beginPath(); g2.ellipse(mx, my + 74, 76, 13, 0, 0, TAU); g2.stroke();
  g2.shadowBlur = 0;

  // cyan rim-glow silhouette: every shape he's drawn from casts neon
  g2.save();
  g2.shadowColor = 'rgba(53,200,245,.9)';
  g2.shadowBlur = 20;
  MONSTER.drawFull(g2, mx, my, 0.88, GAME.time, 'normal', GAME.menuLook);
  g2.restore();
}

/* =========================================================================
   MAIN LOOP — fixed timestep physics, render every frame
   ========================================================================= */
let lastT = 0, acc = 0;
const STEP = 1 / 120;

function frame(ts) {
  requestAnimationFrame(frame);
  const t = ts / 1000;
  let dt = t - (lastT || t);
  lastT = t;
  if (dt > 0.1) dt = 0.1;
  GAME.time += dt;

  pollGamepad();

  const simRunning = GAME.state === 'play' && !GAME.paused && !UI.isOpen();
  if (simRunning) {
    acc += dt;
    while (acc >= STEP) {
      updatePlay(STEP);
      if (GAME.state !== 'play' || UI.isOpen()) { acc = 0; break; } // level-up draft freezes time
      acc -= STEP;
    }
  } else {
    acc = 0;
    if (GAME.state !== 'play') {
      // idle world still breathes behind the menu
      updateTraffic(dt);
      updateParticles(dt);
    }
    if (GAME.state === 'play') AUDIO.engineOff();
  }

  updateCamera(dt);
  render();
}

document.addEventListener('DOMContentLoaded', boot);
