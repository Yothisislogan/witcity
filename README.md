# WIT CITY — Vegas Delivery 🍔🎰

An open-world arcade delivery game starring the **We Insure Things** monster,
tearing around a neon Las Vegas on a company moped. **100% code — zero assets.**
No images, no 3D models, no audio files: every casino, palm tree, tumbleweed,
chiptune note and kazoo honk is generated at runtime. The whole game is a
handful of JavaScript files well under 5 MB.

## Play

Open `index.html` in any modern browser. That's it — no build, no server, no
dependencies. (If your browser blocks `file://` scripts, run any static server,
e.g. `python3 -m http.server`, and open `http://localhost:8000`.)

## The game

- **Open world** — an 8×8-block procedurally decorated Las Vegas: the Strip
  with landmark casinos (a pyramid with a sky-beam, a giant sphere that watches
  you, a ferris wheel, dancing fountains), glowing downtown, suburbs with
  pools, and desert full of tumbleweeds and questionable billboards.
- **Deliveries** — grab food at the blue beacon, drop it at the green one.
  Tips decay, fragile cakes hate crashing, every delivery adds shift time
  (Crazy-Taxi rules). Shift ends when the clock hits zero.
- **Scoring** — pay + tip × combo multiplier. Combos build with each delivery
  and shatter when you crash… unless you're *insured*.
- **Roguelike levels** — score is XP. Every level-up deals three random perk
  cards (Turbo Fries, Premium Policy, Jackpot Clause…). Stack them, break the
  run. Perks reset each shift; career deliveries persistently unlock five
  vehicles in the Garage, from golf cart to hot-dog car.
- **Driving** — arcade physics with speed-sensitive steering, handbrake
  drifting (refills your nitro), boost, traffic, and comedy pedestrians who
  always dodge.
- **8-bit soundtrack** — a synthesized chiptune driving theme, lounge menu
  theme, engine/drift/crash/cash-register sound effects, and a kazoo horn.
  All WebAudio, no samples.
- **Free Roam** — no timer, just vibes.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | Gas |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake (drift) |
| `Shift` | Nitro boost |
| `H` | Honk (kazoo) |
| `M` | Mute music |
| `Esc` / `P` | Pause |

Gamepads and touch screens are also supported.

## Code layout

| File | What it does |
| --- | --- |
| `js/util.js` | math helpers, seeded RNG, safe localStorage |
| `js/audio.js` | WebAudio chiptune tracker + synthesized SFX |
| `js/monster.js` | the mascot, drawn from canvas paths (menu, HUD portrait, rider) |
| `js/city.js` | procedural city generation + chunked renderer + animated neon |
| `js/vehicle.js` | arcade driving physics and the five vehicles |
| `js/missions.js` | delivery job generation, tips, payouts |
| `js/upgrades.js` | the roguelike perk pool |
| `js/ui.js` | menus, garage, level-up draft, game-over report |
| `js/game.js` | main loop, traffic, tourists, HUD, camera, particles |
