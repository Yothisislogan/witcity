'use strict';
/* =========================================================================
   WIT CITY — a neon Las Vegas built entirely from math.
   8×8 blocks on a 896px grid. The Strip runs down the middle with landmark
   casinos; downtown glows up north, suburbs and pools to the south, desert
   and tumbleweeds around the rim. Static scenery is baked into 512px chunk
   canvases on demand (LRU-cached); animated neon is drawn per frame.
   ========================================================================= */

const PALETTE = ['#ff4fd8', '#35c8f5', '#ffd24a', '#8f6bff', '#5cff8a', '#ff7a3c', '#ff5c5c', '#4affdf'];

const CASINO_A = ['GOLDEN', 'LUCKY', 'ROYAL', 'NEON', 'SILVER', 'MIRAGE', 'DESERT', 'JACKPOT', 'FLAMINGO', 'MONSTER', 'COSMIC', 'DIAMOND', 'VELVET', 'ATOMIC', 'DOUBLE', 'FUZZY'];
const CASINO_B = ['NUGGET', 'PALACE', 'OASIS', 'STAR', 'CASTLE', 'SANDS', 'TOWER', 'GRAND', 'DUNES', 'SPUR', 'HORSESHOE', 'PARADISE'];
const SHOP_SIGNS = ['SLOTS', 'PAWN', 'LOANS', '24HR BUFFET', 'WEDDING CHAPEL', 'MOTEL', 'BAIL BONDS', 'SOUVENIRS', 'PSYCHIC', 'KARAOKE', 'TATTOO', 'MAGIC SHOW', 'LIQUOR', 'DRY CLEAN', 'GYM???'];
const STREET_NAMES = ['Flamingo', 'Tropicana', 'Sahara', 'Fremont', 'Paradise', 'Koval', 'Jackpot', 'Horseshoe', 'Cactus', 'Neon'];

const RESTAURANT_IDS = [
  { name: 'NOODLE NEBULA',        e: '🍜', foods: ['Comet Ramen', 'Zero-G Udon', 'Meteor Dumplings'] },
  { name: 'BLACKJACK BURGERS',    e: '🍔', foods: ['Double-Down Burger', 'Hit-Me Fries', 'Bust Shake'] },
  { name: 'THE LUCKY TACO',       e: '🌮', foods: ['Jackpot Taco 12-Pack', 'Loaded Dice Nachos', 'Salsa Royale'] },
  { name: "ROLL 'EM SUSHI",       e: '🍣', foods: ['High Roller Roll', 'Snake Eyes Sashimi', 'All-In Bento'] },
  { name: "ELVIS' PB&B PALACE",   e: '🥪', foods: ['Fried PB&Banana', "Hunka Burnin' Melt", 'Blue Suede Smoothie'] },
  { name: '99¢ SHRIMP SHACK',     e: '🍤', foods: ['99¢ Shrimp Cocktail', 'Shrimp Tower Deluxe', 'Mystery Shrimp'] },
  { name: 'PAYOUT PIZZA',         e: '🍕', foods: ['Full House Pizza', 'Pepperoni Progressive', 'Garlic Chips'] },
  { name: 'WAFFLE JACKPOT',       e: '🧇', foods: ['Triple-7 Waffle Stack', 'Syrup Flight', 'Hashbrown Heap'] },
  { name: 'BOTTOMLESS BUFFET',    e: '🍱', foods: ['Buffet Leftovers (all)', 'Crab Leg Mountain', 'The Whole Tray'] },
  { name: "CLUCKY'S FRIED LUCK",  e: '🍗', foods: ['Lucky Bucket', 'Wishbone Wings', 'Gravy Gallon'] },
  { name: 'DOUBLE-DOWN DONUTS',   e: '🍩', foods: ['Dozen Donut Dozen', 'Maple Ace Bar', 'Coffee, Black, Huge'] },
  { name: 'HOT DICE WINGS',       e: '🌶️', foods: ['Volcano Wings', 'Craps-Table Crisps', 'Ranch Bucket'] },
  { name: 'THE WEDDING CAKERY',   e: '🎂', foods: ['3-Tier Wedding Cake (FRAGILE!)', 'Divorce Brownies', 'Anniversary Eclairs'] },
  { name: 'VIVA LAS VEGAN',       e: '🥗', foods: ['Kale Royale', 'Tofu the Hard Way', 'Beet It Bowl'] },
  { name: 'MIDNIGHT NACHOS',      e: '🧀', foods: ['3AM Nacho Trough', 'Queso Lake', 'One Singular Jalapeño'] },
  { name: 'COUNT DRACULA COFFEE', e: '☕', foods: ['Espresso Stake-Out', 'Bat Brew Cold Foam', '13 Biscotti'] },
];

class City {
  constructor(seed = 8888) {
    this.G = 896;                 // block pitch
    this.N = 8;                   // blocks per side
    this.W = this.G * this.N;
    this.H = this.W;
    this.STRIP = 4;               // vertical line index of the Strip
    this.CHUNK = 512;
    this.SW = 26;                 // sidewalk width

    this.buildings = [];
    this.restaurants = [];
    this.byBlock = new Map();     // "bx,by" -> {buildings:[], props:[]}
    this.solidHash = new Map();   // 256px cells -> solids
    this.waterZones = [];
    this.landmarks = [];
    this.signFlickers = [];
    this.tumbles = [];

    this.chunks = new Map();          // insertion order doubles as LRU order
    this.MAX_CHUNKS = 80;             // ~1MB each; menu attract sweep needs ~50

    this.generate(mulberry32(seed));
    this.minimapCache = null;
  }

  /* ---------------- grid helpers ---------------- */
  lineHalfV(i) { return i === this.STRIP ? 150 : 80; }
  lineHalfH() { return 80; }
  laneOff(i, vertical) { return (vertical && i === this.STRIP) ? 60 : 38; }

  district(bx, by) {
    if (bx <= 0 || bx >= this.N - 1 || by <= 0 || by >= this.N - 1) return 'desert';
    if (bx === 3 || bx === 4) return 'strip';
    if (by <= 2) return 'downtown';
    if (by >= 5) return 'resid';
    return 'city';
  }

  blockRect(bx, by) {
    const G = this.G, SW = this.SW;
    return {
      x0: bx * G + this.lineHalfV(bx) + SW,
      y0: by * G + this.lineHalfH() + SW,
      x1: (bx + 1) * G - this.lineHalfV(bx + 1) - SW,
      y1: (by + 1) * G - this.lineHalfH() - SW,
    };
  }

  blockOf(x, y) {
    return [clamp(Math.floor(x / this.G), 0, this.N - 1), clamp(Math.floor(y / this.G), 0, this.N - 1)];
  }

  bucket(bx, by) {
    const k = bx + ',' + by;
    let b = this.byBlock.get(k);
    if (!b) { b = { buildings: [], props: [] }; this.byBlock.set(k, b); }
    return b;
  }

  /* ---------------- collision hash ---------------- */
  addSolid(s) {
    const r = s.shape === 'circle' ? s.r : 0;
    const x0 = Math.floor(((s.x) - r) / 256), x1 = Math.floor(((s.shape === 'rect' ? s.x + s.w : s.x) + r) / 256);
    const y0 = Math.floor(((s.y) - r) / 256), y1 = Math.floor(((s.shape === 'rect' ? s.y + s.h : s.y) + r) / 256);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const k = cx + ',' + cy;
      let cell = this.solidHash.get(k);
      if (!cell) { cell = []; this.solidHash.set(k, cell); }
      cell.push(s);
    }
  }
  solidsNear(x, y, r) {
    const out = [];
    const x0 = Math.floor((x - r) / 256), x1 = Math.floor((x + r) / 256);
    const y0 = Math.floor((y - r) / 256), y1 = Math.floor((y + r) / 256);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.solidHash.get(cx + ',' + cy);
      if (cell) for (const s of cell) if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  /* nearest drivable point on the road grid */
  nearestRoadPoint(x, y) {
    const G = this.G;
    const iv = clamp(Math.round(x / G), 0, this.N);
    const ih = clamp(Math.round(y / G), 0, this.N);
    const dv = Math.abs(x - iv * G), dh = Math.abs(y - ih * G);
    let px, py;
    if (dv <= dh) {
      px = iv * G; py = clamp(y, 90, this.H - 90);
      if (iv === this.STRIP) px += (x < iv * G ? -95 : 95); // keep clear of the median palms
    } else {
      px = clamp(x, 90, this.W - 90); py = ih * G;
    }
    return { x: px, y: py };
  }

  get playerStart() {
    return { x: this.STRIP * this.G - 95, y: 4.5 * this.G, heading: -Math.PI / 2 };
  }

  /* =====================================================================
     GENERATION
     ===================================================================== */
  generate(rng) {
    const G = this.G;
    let rIdx = 0; // restaurant identity cursor

    const addBuilding = (b) => {
      b.cx = b.x + b.w / 2; b.cy = b.y + b.h / 2;
      b.door = this.nearestRoadPoint(b.cx, b.cy);
      b.seed = rint(rng, 1, 1e9);
      this.buildings.push(b);
      this.bucket(...this.blockOf(b.cx, b.cy)).buildings.push(b);
      if (b.solid !== false) this.addSolid({ shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h });
    };
    const addProp = (p) => {
      this.bucket(...this.blockOf(p.x, p.y)).props.push(p);
      if (p.solid) this.addSolid({ shape: 'circle', x: p.x, y: p.y, r: p.r });
    };
    const makeRestaurant = (b) => {
      const id = RESTAURANT_IDS[rIdx % RESTAURANT_IDS.length];
      const nth = Math.floor(rIdx / RESTAURANT_IDS.length);
      rIdx++;
      b.kind = 'restaurant';
      b.name = id.name + (nth ? ' ' + (nth + 1) : '');
      b.emoji = id.e; b.foods = id.foods;
      this.restaurants.push(b);
    };

    // landmark homes: block coords
    const landmarkBlocks = { '3,5': 'pyramid', '3,3': 'fountain', '4,3': 'eiffel', '5,3': 'sphere', '5,4': 'ferris' };

    for (let by = 0; by < this.N; by++) {
      for (let bx = 0; bx < this.N; bx++) {
        const d = this.district(bx, by);
        const R = this.blockRect(bx, by);
        const bw = R.x1 - R.x0, bh = R.y1 - R.y0;
        if (bw < 60 || bh < 60) continue;
        const lm = landmarkBlocks[bx + ',' + by];

        if (lm) { this.genLandmarkBlock(lm, R, bx, by, rng, addBuilding, addProp, makeRestaurant); continue; }

        if (d === 'strip') this.genStripBlock(R, bx, by, rng, addBuilding, addProp, makeRestaurant);
        else if (d === 'downtown') this.genDowntownBlock(R, rng, addBuilding, addProp, makeRestaurant);
        else if (d === 'city') this.genCityBlock(R, rng, addBuilding, addProp, makeRestaurant);
        else if (d === 'resid') this.genResidBlock(R, bx, by, rng, addBuilding, addProp, makeRestaurant);
        else this.genDesertBlock(R, bx, by, rng, addBuilding, addProp);
      }
    }

    // Strip median palms
    const sx = this.STRIP * G;
    for (let y = G + 90; y < 7 * G - 60; y += 140) {
      if (Math.abs(y - Math.round(y / G) * G) < 170) continue; // keep intersections open
      addProp({ type: 'palm', x: sx, y, r: 13, solid: true, big: true });
    }

    // welcome sign, south of the strip in the desert row — solid kept inside
    // the median footprint so the driving lanes (offset ±60) stay clear
    const wy = 7.42 * G;
    this.landmarks.push({ type: 'welcome', x: sx, y: wy });
    this.addSolid({ shape: 'circle', x: sx, y: wy, r: 32 });

    // Fremont-style canopy downtown (overhead — no collision)
    this.landmarks.push({ type: 'canopy', x: 2 * G, y: 2 * G, len: 1.55 * G });

    // desert tumbleweeds (deterministic loops)
    for (let i = 0; i < 14; i++) {
      const edge = rint(rng, 0, 3);
      const along = rrange(rng, 0.05, 0.95);
      const t0 = { x: 0, y: 0, span: rrange(rng, 900, 2200), speed: rrange(rng, 40, 110), phase: rng() * 1000, r: rrange(rng, 8, 15) };
      if (edge === 0) { t0.x = along * this.W; t0.y = 0.45 * G; t0.horiz = true; }
      else if (edge === 1) { t0.x = along * this.W; t0.y = this.H - 0.45 * G; t0.horiz = true; }
      else if (edge === 2) { t0.x = 0.45 * G; t0.y = along * this.H; t0.horiz = false; }
      else { t0.x = this.W - 0.45 * G; t0.y = along * this.H; t0.horiz = false; }
      this.tumbles.push(t0);
    }
  }

  genLandmarkBlock(kind, R, bx, by, rng, addBuilding, addProp, makeRestaurant) {
    const cx = (R.x0 + R.x1) / 2, cy = (R.y0 + R.y1) / 2;
    if (kind === 'pyramid') {
      const s = 250;
      this.landmarks.push({ type: 'pyramid', x: cx, y: cy, s });
      // diamond footprint ≈ inradius circle + caps on the four points
      this.addSolid({ shape: 'circle', x: cx, y: cy, r: s * 0.71 });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        this.addSolid({ shape: 'circle', x: cx + dx * s * 0.78, y: cy + dy * s * 0.78, r: s * 0.22 });
      this.bucket(bx, by).props.push({ type: 'pyramidBase', x: cx, y: cy, r: s });
    } else if (kind === 'sphere') {
      const r = 165;
      this.landmarks.push({ type: 'sphere', x: cx, y: cy, r });
      this.addSolid({ shape: 'circle', x: cx, y: cy, r: r + 6 });
      this.bucket(bx, by).props.push({ type: 'sphereBase', x: cx, y: cy, r });
    } else if (kind === 'ferris') {
      const r = 130;
      this.landmarks.push({ type: 'ferris', x: cx, y: cy, r });
      this.addSolid({ shape: 'circle', x: cx, y: cy, r: 42 });
      this.bucket(bx, by).props.push({ type: 'ferrisBase', x: cx, y: cy, r });
    } else if (kind === 'eiffel') {
      const s = 150;
      this.landmarks.push({ type: 'eiffel', x: cx, y: cy, s });
      this.addSolid({ shape: 'circle', x: cx, y: cy, r: s * 0.55 });
      this.bucket(bx, by).props.push({ type: 'eiffelBase', x: cx, y: cy, r: s });
      addBuilding({ x: R.x0, y: R.y0, w: R.x1 - R.x0, h: 120, kind: 'casino', name: 'CAFÉ OUI OUI', c: '#ffd24a', floors: 9 });
      makeRestaurant(this.buildings[this.buildings.length - 1]);
    } else if (kind === 'fountain') {
      const r = 95;
      this.landmarks.push({ type: 'fountain', x: cx, y: cy + 60, r });
      this.waterZones.push({ x: cx, y: cy + 60, r: r - 8 });
      this.bucket(bx, by).props.push({ type: 'fountainBase', x: cx, y: cy + 60, r });
      addBuilding({ x: R.x0 + 30, y: R.y0, w: R.x1 - R.x0 - 60, h: 150, kind: 'casino', name: 'THE BELLAGIGGLE', c: '#35c8f5', floors: 12 });
    }
    // filler corners
    for (let i = 0; i < 2; i++) {
      const w = rrange(rng, 80, 130), h = rrange(rng, 70, 110);
      const px = i ? R.x1 - w : R.x0, py = R.y1 - h;
      if (dist(px + w / 2, py + h / 2, cx, cy) > 300)
        addBuilding({ x: px, y: py, w, h, kind: 'shop', name: rchoice(rng, SHOP_SIGNS), c: rchoice(rng, PALETTE) });
    }
  }

  genStripBlock(R, bx, by, rng, addBuilding, addProp, makeRestaurant) {
    // two mega-casinos per block, marquee facing the Strip
    const gap = 46;
    const H2 = (R.y1 - R.y0 - gap) / 2;
    for (let i = 0; i < 2; i++) {
      const y = R.y0 + i * (H2 + gap);
      const name = rchoice(rng, CASINO_A) + ' ' + rchoice(rng, CASINO_B);
      const c = rchoice(rng, PALETTE);
      const b = { x: R.x0 + rrange(rng, 0, 30), y, w: R.x1 - R.x0 - rrange(rng, 10, 60), h: H2, kind: 'casino', name, c, floors: rint(rng, 14, 38) };
      addBuilding(b);
      this.signFlickers.push({ x: b.cx, y: b.y + b.h / 2, w: b.w * 0.8, h: 40, c, period: rrange(rng, 2, 7), phase: rng() * 10 });
      if (rng() < 0.35) makeRestaurant(b);
      // porte-cochère palm on the sidewalk between the door and the building,
      // never on the roadway itself
      addProp({
        type: 'palm',
        x: b.door.x + (b.cx - b.door.x) * 0.42,
        y: b.door.y + (b.cy - b.door.y) * 0.42,
        r: 11, solid: false,
      });
    }
  }

  genDowntownBlock(R, rng, addBuilding, addProp, makeRestaurant) {
    const cols = 3, rows = 3, mx = 22, my = 22;
    const cw = (R.x1 - R.x0 - mx * (cols - 1)) / cols;
    const ch = (R.y1 - R.y0 - my * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (rng() < 0.12) continue; // alley gap
      const b = {
        x: R.x0 + c * (cw + mx) + rrange(rng, 0, 8), y: R.y0 + r * (ch + my) + rrange(rng, 0, 8),
        w: cw - rrange(rng, 0, 16), h: ch - rrange(rng, 0, 16),
        kind: 'shop', name: rchoice(rng, SHOP_SIGNS), c: rchoice(rng, PALETTE), floors: rint(rng, 2, 8),
      };
      addBuilding(b);
      if (rng() < 0.18) makeRestaurant(b);
    }
  }

  genCityBlock(R, rng, addBuilding, addProp, makeRestaurant) {
    if (rng() < 0.22) { // parking lot block
      this.bucket(...this.blockOf((R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2)).props.push({ type: 'parking', x: R.x0, y: R.y0, w: R.x1 - R.x0, h: R.y1 - R.y0 });
      const b = { x: R.x0 + 40, y: R.y0 + 40, w: 120, h: 90, kind: 'shop', name: 'PARK & PRAY', c: '#8f6bff' };
      addBuilding(b);
      return;
    }
    const n = rint(rng, 3, 5);
    for (let i = 0; i < n; i++) {
      const w = rrange(rng, 110, 220), h = rrange(rng, 90, 180);
      const x = rrange(rng, R.x0, Math.max(R.x0 + 1, R.x1 - w));
      const y = rrange(rng, R.y0, Math.max(R.y0 + 1, R.y1 - h));
      // reject overlaps (cheap n²)
      let bad = false;
      for (const o of this.bucket(...this.blockOf(x + w / 2, y + h / 2)).buildings)
        if (x < o.x + o.w + 18 && x + w + 18 > o.x && y < o.y + o.h + 18 && y + h + 18 > o.y) { bad = true; break; }
      if (bad) continue;
      const b = { x, y, w, h, kind: 'shop', name: rchoice(rng, SHOP_SIGNS), c: rchoice(rng, PALETTE), floors: rint(rng, 3, 12) };
      addBuilding(b);
      if (rng() < 0.22) makeRestaurant(b);
    }
  }

  genResidBlock(R, bx, by, rng, addBuilding, addProp, makeRestaurant) {
    const street = rchoice(rng, STREET_NAMES);
    const hs = 74; // house size
    const perRow = Math.floor((R.x1 - R.x0) / (hs + 34));
    for (const edge of [0, 1]) { // two rows: top and bottom of block, facing outward
      for (let i = 0; i < perRow; i++) {
        if (rng() < 0.14) continue;
        const x = R.x0 + 10 + i * (hs + 34);
        const y = edge ? R.y1 - hs : R.y0;
        const b = { x, y, w: hs, h: hs, kind: 'house', name: (i + 1) * 100 + rint(rng, 1, 44) + ' ' + street + ' St', c: rchoice(rng, PALETTE), floors: 1 };
        addBuilding(b);
        if (rng() < 0.4) { // backyard pool = water zone
          const px = x + hs / 2, py = edge ? y - 34 : y + hs + 34;
          addProp({ type: 'pool', x: px, y: py, r: 22, solid: false });
          this.waterZones.push({ x: px, y: py, r: 22 });
        }
      }
    }
    // the occasional home-cooking joint in the middle
    if (rng() < 0.5) {
      const b = { x: (R.x0 + R.x1) / 2 - 60, y: (R.y0 + R.y1) / 2 - 45, w: 120, h: 90, kind: 'restaurant', c: '#5cff8a', floors: 1 };
      addBuilding(b); makeRestaurant(b);
    }
  }

  genDesertBlock(R, bx, by, rng, addBuilding, addProp) {
    const n = rint(rng, 4, 9);
    for (let i = 0; i < n; i++) {
      const x = rrange(rng, R.x0, R.x1), y = rrange(rng, R.y0, R.y1);
      const t = rng();
      if (t < 0.5) addProp({ type: 'cactus', x, y, r: 10, solid: true, seed: rint(rng, 1, 99) });
      else if (t < 0.8) addProp({ type: 'rock', x, y, r: rrange(rng, 9, 18), solid: true });
      else addProp({ type: 'bones', x, y, r: 8, solid: false });
    }
    if (rng() < 0.3) { // gag billboard
      const msgs = ['WE INSURE THINGS®\neven this moped', 'LOOSE SLOTS — 5 MI', 'EAT AT JOE\'S\n(please)', 'ALIEN JERKY\nNEXT EXIT', 'LAWYER UP!\n555-CLAW'];
      addProp({ type: 'billboard', x: rrange(rng, R.x0 + 60, R.x1 - 60), y: rrange(rng, R.y0 + 40, R.y1 - 40), r: 14, solid: true, msg: rchoice(rng, msgs), c: rchoice(rng, PALETTE) });
    }
    if (bx === 6 && by === 7) { // lone gas station south-east
      addBuilding({ x: R.x0 + 40, y: R.y0 + 40, w: 150, h: 100, kind: 'shop', name: 'LAST GAS', c: '#ff7a3c', floors: 1 });
    }
  }

  /* =====================================================================
     CHUNK RENDERING (static scenery, baked once per 512px tile)
     ===================================================================== */
  /* cached chunk or null — refreshes LRU recency, never renders */
  peekChunk(cx, cy) {
    const k = cx + ',' + cy;
    const ch = this.chunks.get(k);
    if (!ch) return null;
    this.chunks.delete(k); this.chunks.set(k, ch); // move to back = most recent
    return ch;
  }

  getChunk(cx, cy) {
    const hit = this.peekChunk(cx, cy);
    if (hit) return hit;
    const ch = this.renderChunk(cx, cy);
    this.chunks.set(cx + ',' + cy, ch);
    if (this.chunks.size > this.MAX_CHUNKS)
      this.chunks.delete(this.chunks.keys().next().value); // evict least recent
    return ch;
  }

  renderChunk(cx, cy) {
    const S = this.CHUNK, G = this.G;
    const can = document.createElement('canvas');
    can.width = S; can.height = S;
    const ctx = can.getContext('2d');
    const ox = cx * S, oy = cy * S;
    ctx.translate(-ox, -oy);

    // out-of-world: desert void with mountain ridges
    ctx.fillStyle = '#181410';
    ctx.fillRect(ox, oy, S, S);
    if (ox + S < -400 || oy + S < -400 || ox > this.W + 400 || oy > this.H + 400) {
      this.paintMountains(ctx, ox, oy, S);
      return can;
    }

    // asphalt base (roads show wherever blocks don't cover)
    ctx.fillStyle = '#1d1d26';
    ctx.fillRect(ox - 4, oy - 4, S + 8, S + 8);

    const bx0 = Math.floor((ox - 80) / G), bx1 = Math.floor((ox + S + 80) / G);
    const by0 = Math.floor((oy - 80) / G), by1 = Math.floor((oy + S + 80) / G);

    // block grounds
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      if (bx < 0 || by < 0 || bx >= this.N || by >= this.N) { // rim: sand
        ctx.fillStyle = '#241f18';
        const x0 = bx * G + this.lineHalfV(clamp(bx, 0, this.N)), y0 = by * G + this.lineHalfH();
        ctx.fillRect(x0, y0, G - 160, G - 160);
        continue;
      }
      const d = this.district(bx, by);
      const swx0 = bx * G + this.lineHalfV(bx), swy0 = by * G + this.lineHalfH();
      const swx1 = (bx + 1) * G - this.lineHalfV(bx + 1), swy1 = (by + 1) * G - this.lineHalfH();
      if (d === 'desert') {
        ctx.fillStyle = '#2b251b';
        ctx.fillRect(swx0, swy0, swx1 - swx0, swy1 - swy0);
        this.speckle(ctx, swx0, swy0, swx1 - swx0, swy1 - swy0, cx * 7 + cy * 13 + bx + by * 31, '#3a3226');
      } else {
        ctx.fillStyle = d === 'strip' ? '#33304a' : '#2c2d36';       // sidewalk
        ctx.fillRect(swx0, swy0, swx1 - swx0, swy1 - swy0);
        ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2;  // curb
        ctx.strokeRect(swx0 + 1, swy0 + 1, swx1 - swx0 - 2, swy1 - swy0 - 2);
        const R = this.blockRect(bx, by);
        ctx.fillStyle = { strip: '#282544', downtown: '#232330', city: '#20222c', resid: '#20291f' }[d] || '#20222c';
        ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
      }
    }

    this.paintRoadMarkings(ctx, ox, oy, S);

    // buildings + props from overlapping blocks
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const cell = this.byBlock.get(bx + ',' + by);
      if (!cell) continue;
      for (const p of cell.props) this.paintProp(ctx, p);
      for (const b of cell.buildings) this.paintBuilding(ctx, b);
    }

    // welcome sign static part lives on the road, outside any block bucket
    for (const lm of this.landmarks) {
      if (lm.type === 'welcome' &&
          lm.x > ox - 200 && lm.x < ox + S + 200 && lm.y > oy - 200 && lm.y < oy + S + 200)
        this.paintWelcomeSign(ctx, lm);
    }
    return can;
  }

  speckle(ctx, x, y, w, h, seed, color) {
    const rng = mulberry32(seed * 2654435761 >>> 0);
    ctx.fillStyle = color;
    const n = Math.floor(w * h / 4200);
    for (let i = 0; i < n; i++) ctx.fillRect(x + rng() * w, y + rng() * h, 2 + rng() * 3, 2 + rng() * 2);
  }

  paintMountains(ctx, ox, oy, S) {
    // faint distant ridge silhouettes for the void beyond the map
    const rng = mulberry32((ox * 31 + oy * 17) >>> 0 || 1);
    ctx.fillStyle = '#221c14';
    for (let i = 0; i < 4; i++) {
      const mx = ox + rng() * S, my = oy + rng() * S, mw = 120 + rng() * 260;
      ctx.beginPath();
      ctx.moveTo(mx - mw, my + 60);
      ctx.lineTo(mx, my - 40 - rng() * 80);
      ctx.lineTo(mx + mw, my + 60);
      ctx.closePath(); ctx.fill();
    }
  }

  paintRoadMarkings(ctx, ox, oy, S) {
    const G = this.G;
    ctx.save();
    // vertical lines
    for (let i = 0; i <= this.N; i++) {
      const x = i * G;
      if (x < ox - 200 || x > ox + S + 200) continue;
      if (i === this.STRIP) {
        // median band + double yellow
        ctx.fillStyle = '#232032';
        ctx.fillRect(x - 32, oy, 64, S);
        ctx.strokeStyle = 'rgba(228,190,80,.5)'; ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x - 34, oy); ctx.lineTo(x - 34, oy + S);
        ctx.moveTo(x + 34, oy); ctx.lineTo(x + 34, oy + S); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 3; ctx.setLineDash([26, 30]);
        ctx.beginPath(); ctx.moveTo(x - 92, oy); ctx.lineTo(x - 92, oy + S);
        ctx.moveTo(x + 92, oy); ctx.lineTo(x + 92, oy + S); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(228,190,80,.34)'; ctx.lineWidth = 3; ctx.setLineDash([26, 34]);
        ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + S); ctx.stroke();
      }
    }
    // horizontal lines
    ctx.setLineDash([26, 34]);
    for (let j = 0; j <= this.N; j++) {
      const y = j * G;
      if (y < oy - 200 || y > oy + S + 200) continue;
      ctx.strokeStyle = 'rgba(228,190,80,.34)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + S, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // crosswalks at intersections
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    for (let j = 0; j <= this.N; j++) for (let i = 0; i <= this.N; i++) {
      const x = i * G, y = j * G;
      if (x < ox - 300 || x > ox + S + 300 || y < oy - 300 || y > oy + S + 300) continue;
      const hv = this.lineHalfV(i), hh = this.lineHalfH();
      for (let s = -3; s <= 3; s++) {
        ctx.fillRect(x + s * 14 - 5, y - hh - 26, 10, 18);
        ctx.fillRect(x + s * 14 - 5, y + hh + 8, 10, 18);
        ctx.fillRect(x - hv - 26, y + s * 14 - 5, 18, 10);
        ctx.fillRect(x + hv + 8, y + s * 14 - 5, 18, 10);
      }
    }
    ctx.restore();
  }

  paintBuilding(ctx, b) {
    const rng = mulberry32(b.seed);
    // drop shadow
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);

    if (b.kind === 'house') {
      ctx.fillStyle = '#2b2530';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y); ctx.lineTo(b.cx, b.cy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = b.c; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
      ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.globalAlpha = 1;
      if (rng() < 0.6) { // porch light
        ctx.fillStyle = '#ffd987';
        ctx.beginPath(); ctx.arc(b.cx, b.y + b.h - 6, 3, 0, TAU); ctx.fill();
      }
      return;
    }

    // tower body
    const base = ['#14141f', '#171728', '#12121c', '#1a1a2c'][b.seed % 4];
    ctx.fillStyle = base;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // lit windows
    const gw = 14, gh = 12;
    for (let yy = b.y + 8; yy < b.y + b.h - 10; yy += gh)
      for (let xx = b.x + 8; xx < b.x + b.w - 10; xx += gw) {
        const v = rng();
        if (v < 0.42) {
          ctx.fillStyle = v < 0.09 ? 'rgba(120,220,255,.5)' : `rgba(255,214,130,${0.16 + v * 0.5})`;
          ctx.fillRect(xx, yy, 8, 6);
        }
      }
    // neon trim
    ctx.strokeStyle = b.c; ctx.lineWidth = b.kind === 'casino' ? 3 : 2;
    ctx.shadowColor = b.c; ctx.shadowBlur = b.kind === 'casino' ? 16 : 8;
    ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
    ctx.shadowBlur = 0;
    // roof furniture
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    for (let i = 0; i < 3; i++) ctx.fillRect(b.x + 10 + rng() * (b.w - 40), b.y + 10 + rng() * (b.h - 40), 16, 12);

    // sign text
    const label = b.name || '';
    if (label) {
      ctx.save();
      ctx.translate(b.cx, b.cy);
      const fs = b.kind === 'casino' ? Math.min(30, b.w / (label.length * 0.62)) : Math.min(15, b.w / (label.length * 0.66));
      ctx.font = `bold ${Math.max(9, fs)}px "Courier New", monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = b.c;
      ctx.shadowColor = b.c; ctx.shadowBlur = 14;
      ctx.fillText(label, 0, b.kind === 'casino' ? -6 : 0);
      if (b.kind === 'restaurant' || b.emoji) {
        ctx.shadowBlur = 0;
        ctx.font = '20px serif';
        ctx.fillText(b.emoji || '🍽️', 0, 18);
      }
      ctx.restore();
    }
    if (b.kind === 'restaurant') { // awning stripes at the door side
      ctx.fillStyle = b.c; ctx.globalAlpha = 0.65;
      for (let i = 0; i < Math.floor(b.w / 22); i++)
        ctx.fillRect(b.x + 4 + i * 22, b.y + b.h - 7, 12, 7);
      ctx.globalAlpha = 1;
    }
  }

  paintProp(ctx, p) {
    switch (p.type) {
      case 'palm': {
        ctx.fillStyle = 'rgba(0,0,0,.4)';
        ctx.beginPath(); ctx.ellipse(p.x + 6, p.y + 7, p.r + 8, (p.r + 8) * 0.6, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#3d2f1e'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y + 4); ctx.lineTo(p.x, p.y - 4); ctx.stroke();
        ctx.strokeStyle = '#2f7d4f'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 4);
          ctx.quadraticCurveTo(p.x + Math.cos(a) * p.r, p.y - 4 + Math.sin(a) * p.r,
            p.x + Math.cos(a) * (p.r + 10), p.y - 2 + Math.sin(a) * (p.r + 10));
          ctx.stroke();
        }
        break;
      }
      case 'cactus': {
        ctx.fillStyle = '#2e5d38'; ctx.strokeStyle = '#2e5d38';
        ctx.lineWidth = 7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y + 10); ctx.lineTo(p.x, p.y - 12); ctx.stroke();
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 2); ctx.lineTo(p.x - 9, p.y - 4); ctx.lineTo(p.x - 9, p.y - 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x, p.y + 2); ctx.lineTo(p.x + 9, p.y); ctx.lineTo(p.x + 9, p.y - 8); ctx.stroke();
        break;
      }
      case 'rock':
        ctx.fillStyle = '#3a332b';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 0.75, 0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        ctx.beginPath(); ctx.ellipse(p.x - p.r * 0.25, p.y - p.r * 0.3, p.r * 0.4, p.r * 0.25, 0.4, 0, TAU); ctx.fill();
        break;
      case 'bones':
        ctx.strokeStyle = '#8d8577'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x - 7, p.y - 3); ctx.lineTo(p.x + 7, p.y + 3); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x + 9, p.y + 4, 3, 0, TAU); ctx.stroke();
        break;
      case 'pool':
        ctx.fillStyle = '#173d52';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r + 4, (p.r + 4) * 0.8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2596be';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 0.8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.beginPath(); ctx.ellipse(p.x - 5, p.y - 3, p.r * 0.3, p.r * 0.16, 0.5, 0, TAU); ctx.fill();
        break;
      case 'parking': {
        ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 2;
        for (let x = p.x + 30; x < p.x + p.w - 20; x += 34) {
          ctx.beginPath(); ctx.moveTo(x, p.y + 30); ctx.lineTo(x, p.y + 90); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, p.y + p.h - 90); ctx.lineTo(x, p.y + p.h - 30); ctx.stroke();
        }
        break;
      }
      case 'billboard': {
        ctx.fillStyle = '#0e0e16';
        ctx.fillRect(p.x - 58, p.y - 34, 116, 52);
        ctx.strokeStyle = p.c; ctx.lineWidth = 2;
        ctx.shadowColor = p.c; ctx.shadowBlur = 10;
        ctx.strokeRect(p.x - 58, p.y - 34, 116, 52);
        ctx.shadowBlur = 0;
        ctx.fillStyle = p.c; ctx.font = 'bold 11px "Courier New", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        p.msg.split('\n').forEach((line, i) => ctx.fillText(line, p.x, p.y - 14 + i * 14));
        break;
      }
      case 'pyramidBase': {
        const s = p.r;
        const grad = ctx.createLinearGradient(p.x - s, p.y - s, p.x + s, p.y + s);
        grad.addColorStop(0, '#141422'); grad.addColorStop(1, '#0c0c16');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#35c8f5'; ctx.lineWidth = 2.5;
        ctx.shadowColor = '#35c8f5'; ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x, p.y + s);
        ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y);
        ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.font = 'bold 22px "Courier New", monospace';
        ctx.fillStyle = '#ffd24a'; ctx.textAlign = 'center';
        ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 12;
        ctx.fillText('THE GIZA GECKO', p.x, p.y + s + 30);
        ctx.shadowBlur = 0;
        break;
      }
      case 'sphereBase': {
        const g2 = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.1, p.x, p.y, p.r);
        g2.addColorStop(0, '#232346'); g2.addColorStop(1, '#0b0b18');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        break;
      }
      case 'ferrisBase':
        ctx.fillStyle = '#191926';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 24, 0, TAU); ctx.fill();
        ctx.fillStyle = '#242438';
        ctx.beginPath(); ctx.arc(p.x, p.y, 40, 0, TAU); ctx.fill();
        break;
      case 'eiffelBase': {
        const s = p.r;
        ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 5;
        ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(p.x - s * 0.6, p.y - s * 0.6); ctx.lineTo(p.x + s * 0.6, p.y + s * 0.6);
        ctx.moveTo(p.x + s * 0.6, p.y - s * 0.6); ctx.lineTo(p.x - s * 0.6, p.y + s * 0.6);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeRect(p.x - s * 0.42, p.y - s * 0.42, s * 0.84, s * 0.84);
        ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.14, 0, TAU); ctx.stroke();
        ctx.shadowBlur = 0;
        break;
      }
      case 'fountainBase':
        ctx.fillStyle = '#2c2c3c';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 10, 0, TAU); ctx.fill();
        ctx.fillStyle = '#10394e';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        break;
    }
  }

  paintWelcomeSign(ctx, lm) {
    ctx.save();
    ctx.translate(lm.x, lm.y);
    ctx.scale(0.85, 0.85); // artwork hugs the median like its collision circle
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(6, 8, 60, 40, 0, 0, TAU); ctx.fill();
    // diamond sign
    ctx.fillStyle = '#101020';
    ctx.beginPath();
    ctx.moveTo(0, -58); ctx.lineTo(52, 0); ctx.lineTo(0, 58); ctx.lineTo(-52, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 3;
    ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillText('WELCOME TO', 0, -22);
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText('FABULOUS', 0, -8);
    ctx.fillStyle = '#35c8f5';
    ctx.fillText('WIT CITY', 0, 8);
    ctx.fillStyle = '#ff4fd8';
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.fillText('POPULATION: 1 MONSTER', 0, 24);
    ctx.restore();
  }

  /* =====================================================================
     DYNAMIC OVERLAY — animated neon, drawn every frame near the camera
     view = {x, y, w, h, px, py}  (world rect + player position)
     ===================================================================== */
  drawDynamic(ctx, view, t) {
    const vis = (x, y, m) => x > view.x - m && x < view.x + view.w + m && y > view.y - m && y < view.y + view.h + m;

    for (const lm of this.landmarks) {
      if (!vis(lm.x, lm.y, 420)) continue;
      switch (lm.type) {
        case 'pyramid': {
          // rotating sky-beam
          ctx.save();
          ctx.translate(lm.x, lm.y);
          ctx.globalCompositeOperation = 'lighter';
          const a = t * 0.35;
          const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 330);
          g.addColorStop(0, 'rgba(190,240,255,.5)'); g.addColorStop(1, 'rgba(190,240,255,0)');
          for (const off of [0, Math.PI]) {
            ctx.save();
            ctx.rotate(a + off);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 330, -0.05, 0.05); ctx.closePath(); ctx.fill();
            ctx.restore();
          }
          ctx.fillStyle = 'rgba(220,250,255,.9)';
          ctx.beginPath(); ctx.arc(0, 0, 7 + Math.sin(t * 5) * 2, 0, TAU); ctx.fill();
          ctx.restore();
          break;
        }
        case 'sphere': {
          ctx.save();
          ctx.translate(lm.x, lm.y);
          const phase = Math.floor(t / 6) % 4;
          const hue = (t * 24) % 360;
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(0, 0, lm.r * 0.2, 0, 0, lm.r);
          g.addColorStop(0, `hsla(${hue},90%,60%,.30)`);
          g.addColorStop(1, `hsla(${(hue + 80) % 360},90%,55%,.06)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, lm.r, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          if (phase === 0) { // giant googly eye that WATCHES YOU
            ctx.fillStyle = 'rgba(255,255,255,.92)';
            ctx.beginPath(); ctx.arc(0, 0, lm.r * 0.55, 0, TAU); ctx.fill();
            const dx = view.px - lm.x, dy = view.py - lm.y;
            const d = Math.hypot(dx, dy) || 1, m = Math.min(lm.r * 0.26, d * 0.05);
            ctx.fillStyle = '#10101c';
            ctx.beginPath(); ctx.arc(dx / d * m, dy / d * m, lm.r * 0.22, 0, TAU); ctx.fill();
          } else if (phase === 1) { // smiley
            ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 9; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.arc(0, 6, lm.r * 0.5, 0.25, Math.PI - 0.25); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            ctx.beginPath(); ctx.arc(-lm.r * 0.3, -lm.r * 0.25, 13, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(lm.r * 0.3, -lm.r * 0.25, 13, 0, TAU); ctx.fill();
          } else if (phase === 2) { // dice
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            for (const [px, py] of [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]])
              { ctx.beginPath(); ctx.arc(px * lm.r * 0.33, py * lm.r * 0.33, 15, 0, TAU); ctx.fill(); }
          } else { // WIT
            ctx.fillStyle = 'rgba(255,255,255,.92)';
            ctx.font = `bold ${Math.round(lm.r * 0.55)}px "Courier New", monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('WIT', 0, 4);
          }
          ctx.restore();
          break;
        }
        case 'ferris': {
          ctx.save();
          ctx.translate(lm.x, lm.y);
          ctx.rotate(t * 0.14);
          ctx.strokeStyle = 'rgba(255,79,216,.65)'; ctx.lineWidth = 4;
          ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(0, 0, lm.r, 0, TAU); ctx.stroke();
          ctx.shadowBlur = 0;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * TAU;
            ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * lm.r, Math.sin(a) * lm.r); ctx.stroke();
            ctx.fillStyle = PALETTE[i % PALETTE.length];
            ctx.beginPath(); ctx.arc(Math.cos(a) * lm.r, Math.sin(a) * lm.r, 9, 0, TAU); ctx.fill();
          }
          ctx.restore();
          break;
        }
        case 'eiffel': {
          if ((t % 7) < 1.6) { // sparkle mode
            const rng = mulberry32(Math.floor(t * 14));
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            for (let i = 0; i < 12; i++) {
              ctx.globalAlpha = 0.3 + rng() * 0.7;
              ctx.fillRect(lm.x + (rng() - 0.5) * lm.s * 1.1, lm.y + (rng() - 0.5) * lm.s * 1.1, 3, 3);
            }
            ctx.globalAlpha = 1;
          }
          break;
        }
        case 'fountain': {
          ctx.save();
          ctx.translate(lm.x, lm.y);
          // choreographed jets
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * TAU;
            const h = (Math.sin(t * 2.2 + i * 0.7) * 0.5 + 0.5) * 34 + 8;
            const jx = Math.cos(a) * lm.r * 0.55, jy = Math.sin(a) * lm.r * 0.55;
            ctx.strokeStyle = 'rgba(160,220,255,.55)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(jx, jy - h); ctx.stroke();
            ctx.fillStyle = 'rgba(200,240,255,.5)';
            ctx.beginPath(); ctx.arc(jx, jy - h, 3.5, 0, TAU); ctx.fill();
          }
          // ripples
          const rp = (t * 0.5) % 1;
          ctx.strokeStyle = `rgba(160,220,255,${0.4 * (1 - rp)})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, lm.r * (0.3 + rp * 0.65), 0, TAU); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'canopy': {
          ctx.save();
          ctx.translate(lm.x, lm.y);
          const w = lm.len, h = 130;
          ctx.globalAlpha = 0.30;
          for (let i = 0; i < 6; i++) {
            const hue = ((t * 60) + i * 60) % 360;
            ctx.fillStyle = `hsl(${hue},90%,55%)`;
            ctx.fillRect(-w / 2 + (i / 6) * w, -h / 2, w / 6, h);
          }
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3;
          ctx.strokeRect(-w / 2, -h / 2, w, h);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 24px "Courier New", monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 14;
          ctx.fillText('★ WIT STREET EXPERIENCE ★', 0, 0);
          ctx.shadowBlur = 0;
          ctx.restore();
          break;
        }
        case 'welcome': {
          // blinking bulbs around the diamond
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * TAU;
            const on = Math.floor(t * 3 + i) % 2 === 0;
            ctx.fillStyle = on ? '#ffd24a' : 'rgba(255,210,74,.2)';
            ctx.beginPath();
            ctx.arc(lm.x + Math.cos(a) * 45, lm.y + Math.sin(a) * 50, 3, 0, TAU);
            ctx.fill();
          }
          // twinkle star on top
          const tw = 0.6 + Math.sin(t * 6) * 0.4;
          ctx.save();
          ctx.translate(lm.x, lm.y - 61);
          ctx.rotate(t * 0.8);
          ctx.fillStyle = `rgba(255,240,180,${tw})`;
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const rr = i % 2 ? 5 : 13;
            const a = (i / 10) * TAU;
            ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
      }
    }

    // casino sign flicker
    for (const f of this.signFlickers) {
      if (!vis(f.x, f.y, 100)) continue;
      const on = Math.sin(t * TAU / f.period + f.phase) > -0.2;
      if (!on) continue;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.10 + 0.06 * Math.sin(t * 9 + f.phase);
      ctx.fillStyle = f.c;
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // tumbleweeds
    for (const tb of this.tumbles) {
      const roll = ((t * tb.speed + tb.phase * 100) % (tb.span * 2));
      const off = roll < tb.span ? roll : tb.span * 2 - roll;
      const x = tb.horiz ? tb.x + off - tb.span / 2 : tb.x;
      const y = tb.horiz ? tb.y : tb.y + off - tb.span / 2;
      if (!vis(x, y, 60)) continue;
      ctx.save();
      ctx.translate(x, y + Math.abs(Math.sin(t * 6 + tb.phase)) * -6);
      ctx.rotate(t * 3 + tb.phase);
      ctx.strokeStyle = '#77653f'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * tb.r, Math.sin(a) * tb.r);
        ctx.arc(0, 0, tb.r * (0.4 + (i % 3) * 0.28), a, a + 1.2);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------------- minimap ---------------- */
  minimap(size) {
    if (this.minimapCache && this.minimapCache.width === size) return this.minimapCache;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const s = size / this.W;
    ctx.fillStyle = 'rgba(8,10,20,.92)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(120,150,190,.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.N; i++) {
      ctx.beginPath(); ctx.moveTo(i * this.G * s, 0); ctx.lineTo(i * this.G * s, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * this.G * s); ctx.lineTo(size, i * this.G * s); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,79,216,.85)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(this.STRIP * this.G * s, 0); ctx.lineTo(this.STRIP * this.G * s, size); ctx.stroke();
    ctx.fillStyle = '#ffd24a';
    for (const lm of this.landmarks) {
      ctx.beginPath(); ctx.arc(lm.x * s, lm.y * s, 2.2, 0, TAU); ctx.fill();
    }
    this.minimapCache = c;
    return c;
  }
}
