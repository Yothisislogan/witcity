'use strict';
/* =========================================================================
   MISSIONS — Crazy-Taxi-style delivery jobs.
   Pick up at a restaurant beacon, drop at a hungry customer. Tips decay,
   fragile food hates crashes, everything pays in delicious dollars.
   ========================================================================= */

const CUSTOMERS = [
  'a sunburned tourist', 'an Elvis impersonator', 'a bachelorette party',
  'a poker champion on a heater', 'a magician (do NOT be late)', 'two showgirls on break',
  'a guy who "knows the owner"', 'a very hungry mime', 'the night-shift pit boss',
  'a conspiracy podcaster', 'an off-duty clown', 'a slot machine whisperer',
  'somebody\'s nana (jackpot winner)', 'a tiger. just a tiger.', 'the world\'s calmest bride',
  'a DJ who peaked in 2009', 'an alien "on vacation"', 'a pigeon influencer\'s manager',
];

const FRAGILE_HINTS = ['(FRAGILE!)', 'Cake', 'Tower', 'Cocktail', '3-Tier'];

function jobIsFragile(food) {
  return FRAGILE_HINTS.some(h => food.includes(h)) || Math.random() < 0.12;
}

/* create a new delivery job near-ish the player */
function newJob(game) {
  const city = game.city;
  const px = game.car.x, py = game.car.y;

  // pickup: prefer restaurants in a comfortable ring around the player
  const ranked = city.restaurants
    .map(r => ({ r, d: dist(px, py, r.door.x, r.door.y) }))
    .sort((a, b) => a.d - b.d);
  const near = ranked.filter(o => o.d > 350 && o.d < 2000 * game.mods.jobDist);
  const rest = (near.length ? choice(near) : ranked[randInt(1, Math.min(6, ranked.length - 1))]).r;

  // dropoff: any other building at a level-scaled distance (capped — the
  // built-up area is finite, an ever-growing minimum would starve the loop)
  const minD = Math.min(600 + game.level * 60, 2400), maxD = 1500 + game.level * 220;
  let target = null;
  for (let tries = 0; tries < 40 && !target; tries++) {
    const b = choice(city.buildings);
    if (b === rest || b.kind === 'restaurant') continue;
    const d = dist(rest.door.x, rest.door.y, b.door.x, b.door.y);
    if (d > minD && d < maxD) target = b;
  }
  if (!target) {
    // fallback still needs real distance, or pickup and drop beacons can
    // overlap into a zero-drive instant-delivery loop
    const far = city.buildings.filter(b =>
      b !== rest && b.kind !== 'restaurant' &&
      dist(rest.door.x, rest.door.y, b.door.x, b.door.y) > 500);
    target = far.length ? choice(far) : choice(city.buildings.filter(b => b !== rest));
  }

  const food = choice(rest.foods);
  const runDist = dist(rest.door.x, rest.door.y, target.door.x, target.door.y);
  const fragile = jobIsFragile(food);

  const base = 40 + runDist * 0.055;
  const customer = choice(CUSTOMERS);
  const where = target.kind === 'house'
    ? target.name
    : (target.kind === 'casino' ? `Room ${randInt(2, 38)}${randInt(0, 9)}${randInt(0, 9)}, ${target.name}` : `${target.name} (side door)`);

  return {
    phase: 'pickup',
    rest, target, food, emoji: rest.emoji, customer, where, fragile,
    pay: base * (fragile ? 1.6 : 1),
    tipMax: base * 1.25 * (fragile ? 1.5 : 1),
    // generous par time: distance at ~340px/s plus slack
    tipTime: runDist / 340 + 14,
    tipLeft: 1,          // fraction of tip remaining (starts full)
    started: false,       // tip clock runs after pickup
    runDist,
  };
}

/* tick the job's tip decay once food is picked up */
function tickJob(job, dt) {
  if (job.phase === 'drop' && job.tipLeft > 0) {
    job.tipLeft = Math.max(0, job.tipLeft - dt / job.tipTime);
  }
}

function jobPayout(job, game) {
  const tip = job.tipMax * job.tipLeft * game.mods.tip;
  const comboMult = 1 + 0.25 * Math.min(game.combo, 12);
  return {
    pay: job.pay + game.mods.flat,
    tip,
    total: (job.pay + game.mods.flat + tip) * comboMult,
    comboMult,
  };
}
