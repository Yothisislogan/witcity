'use strict';
/* =========================================================================
   UPGRADES — roguelike perk draft. Every level-up deals three cards;
   pick one, stack them, break the game a little. Resets each run.
   ========================================================================= */

const UPGRADES = [
  { id: 'turbofries', icon: '🍟', name: 'TURBO FRIES', rarity: 0, max: 3,
    desc: '+12% top speed. The fries whisper "faster".',
    apply: m => { m.top *= 1.12; } },
  { id: 'sticky', icon: '🛞', name: 'STICKY TIRES', rarity: 0, max: 3,
    desc: '+20% grip. Made of gum from under the blackjack table.',
    apply: m => { m.grip *= 1.2; } },
  { id: 'thumbs', icon: '👍', name: 'EXTRA THUMBS', rarity: 0, max: 2,
    desc: '+15% steering. You grew two more thumbs. Congrats?',
    apply: m => { m.turn *= 1.15; } },
  { id: 'hotbag', icon: '🧤', name: 'HOT BAG', rarity: 0, max: 3,
    desc: '+20% tips. Food arrives suspiciously warm.',
    apply: m => { m.tip *= 1.2; } },
  { id: 'espresso', icon: '☕', name: 'MONSTER ESPRESSO', rarity: 0, max: 3,
    desc: '+15% acceleration. You can hear colors now.',
    apply: m => { m.accel *= 1.15; } },
  { id: 'loosechange', icon: '🪙', name: 'LOOSE CHANGE', rarity: 0, max: 5,
    desc: '+$25 flat per delivery, found in the seat cushions.',
    apply: m => { m.flat += 25; } },
  { id: 'nitro', icon: '🔥', name: 'NITRO SLUSHIE', rarity: 1, max: 2,
    desc: '+35% boost power and boost recharges 40% faster.',
    apply: m => { m.boostPow *= 1.35; m.boostRegen *= 1.4; } },
  { id: 'timeshare', icon: '⏰', name: 'TIME SHARE', rarity: 1, max: 3,
    desc: '+25% shift time from every delivery. (No tour required.)',
    apply: m => { m.time *= 1.25; } },
  { id: 'magnet', icon: '🧲', name: 'MONSTER MAGNET', rarity: 1, max: 2,
    desc: '+35% bigger pickup & drop-off zones. Food leaps at you.',
    apply: m => { m.radius *= 1.35; } },
  { id: 'gps', icon: '🗺️', name: 'SHADY SHORTCUTS', rarity: 1, max: 2,
    desc: 'Jobs spawn 25% closer. A pigeon draws your routes.',
    apply: m => { m.jobDist *= 0.75; } },
  { id: 'premium', icon: '🛡️', name: 'PREMIUM POLICY', rarity: 2, max: 1,
    desc: 'Crashes no longer reset your combo. We insure things. Like you.',
    apply: m => { m.comboShield = true; } },
  { id: 'jackpot', icon: '🎰', name: 'JACKPOT CLAUSE', rarity: 2, max: 1,
    desc: 'Every 7th delivery pays TRIPLE. Ding ding ding.',
    apply: m => { m.jackpot = true; } },
  { id: 'ghostpepper', icon: '🌶️', name: 'GHOST PEPPER TANK', rarity: 2, max: 1,
    desc: 'Boost never fully empties — always keeps a 30% ember.',
    apply: m => { m.boostFloor = 30; } },
];

const RARITY = [
  { name: 'COMMON', color: '#35c8f5', weight: 62 },
  { name: 'RARE', color: '#ff4fd8', weight: 28 },
  { name: 'JACKPOT', color: '#ffd24a', weight: 10 },
];

function freshMods() {
  return {
    top: 1, accel: 1, grip: 1, turn: 1,
    boostPow: 1, boostRegen: 1, boostFloor: 0,
    tip: 1, time: 1, radius: 1, jobDist: 1,
    flat: 0, comboShield: false, jackpot: false,
  };
}

/* deal three distinct cards, weighted by rarity, respecting stack caps */
function rollChoices(taken) {
  const counts = {};
  for (const id of taken) counts[id] = (counts[id] || 0) + 1;
  const pool = UPGRADES.filter(u => (counts[u.id] || 0) < u.max);
  const picks = [];
  let guard = 0;
  while (picks.length < Math.min(3, pool.length) && guard++ < 200) {
    const totalW = pool.reduce((s, u) => picks.includes(u) ? s : s + RARITY[u.rarity].weight, 0);
    let roll = Math.random() * totalW;
    for (const u of pool) {
      if (picks.includes(u)) continue;
      roll -= RARITY[u.rarity].weight;
      if (roll <= 0) { picks.push(u); break; }
    }
  }
  return picks;
}
