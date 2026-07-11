'use strict';
/* =========================================================================
   AUDIO — 8-bit soundtrack + SFX, all synthesized with WebAudio.
   No audio files anywhere. The tracker plays note tables through square /
   triangle oscillators and shaped noise, scheduled ahead of time.
   ========================================================================= */

const AUDIO = (() => {
  let ctx = null;
  let master, musicBus, sfxBus;
  let noiseBuf = null;

  let musicVol = 0.7, sfxVol = 0.9, musicMuted = false;

  /* ---------------- boot (must happen on a user gesture) --------------- */
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume(); // some gestures don't auto-start it
    master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = musicMuted ? 0 : musicVol; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxVol; sfxBus.connect(master);

    // shared noise buffer (2s of white noise)
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    buildEngineNodes();
    if (pendingSong) { playMusic(pendingSong); pendingSong = null; }
  }
  const ready = () => !!ctx && ctx.state === 'running';

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  /* ---------------- generic voices ---------------- */
  function blip(bus, type, freq, t0, dur, vol, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noiseHit(bus, t0, dur, vol, filterType, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter(); f.type = filterType || 'bandpass';
    f.frequency.value = freq || 4000; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t0, Math.random() * 1.2); src.stop(t0 + dur + 0.02);
  }

  function kick(bus, t0, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t0);
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.11);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + 0.16);
  }

  /* =====================================================================
     MUSIC TRACKER
     Songs are note grids at 8 steps per bar (8th notes). 0 = rest.
     drums: 1 kick · 2 snare · 3 closed hat · 4 open hat
     ===================================================================== */
  const SONGS = {
    /* -------- driving theme: pushy A-minor chiptune -------- */
    game: {
      bpm: 168, swing: 0,
      lead: [
        69,0,76,74, 72,74,76,0,   77,0,76,72, 69,0,72,74,
        76,0,72,76, 79,0,76,72,   74,0,71,74, 79,74,71,67,
        69,0,76,74, 72,74,76,79,  81,0,79,77, 76,0,74,72,
        76,72,76,79, 81,0,83,0,   84,0,81,79, 76,74,71,74,
      ],
      arp: [
        57,60,64,60, 57,60,64,60, 53,57,60,57, 53,57,60,57,
        48,52,55,52, 48,52,55,52, 55,59,62,59, 55,59,62,59,
        57,60,64,60, 57,60,64,60, 53,57,60,57, 53,57,60,57,
        48,52,55,52, 48,52,55,52, 55,59,62,59, 55,62,59,55,
      ],
      bass: [
        45,0,45,57, 45,0,57,45,  41,0,41,53, 41,0,53,41,
        48,0,48,60, 48,0,60,48,  43,0,43,55, 43,0,55,43,
        45,0,45,57, 45,0,57,45,  41,0,41,53, 41,0,53,41,
        48,0,48,60, 48,0,60,48,  43,43,55,43, 55,43,55,55,
      ],
      drum: [
        1,3,2,3, 1,3,2,4,  1,3,2,3, 1,3,2,4,
        1,3,2,3, 1,3,2,4,  1,3,2,3, 1,3,2,4,
        1,3,2,3, 1,3,2,4,  1,3,2,3, 1,3,2,4,
        1,3,2,3, 1,3,2,4,  1,3,2,2, 1,2,2,2,
      ],
    },
    /* -------- menu theme: smoky lounge swing -------- */
    menu: {
      bpm: 104, swing: 0.16,
      lead: [
        76,0,0,74, 72,0,67,0,   0,72,0,69, 0,0,64,0,
        74,0,72,0, 69,0,65,0,   67,0,71,74, 0,0,79,0,
        76,0,0,74, 72,0,79,0,   0,77,0,76, 0,72,0,0,
        74,0,72,74, 77,0,74,0,  72,0,0,0,  67,0,0,0,
      ],
      arp: [
        0,64,0,64, 0,64,0,64,  0,64,0,64, 0,64,0,64,
        0,65,0,65, 0,65,0,65,  0,65,0,65, 0,62,0,62,
        0,64,0,64, 0,64,0,64,  0,64,0,64, 0,64,0,64,
        0,65,0,65, 0,65,0,65,  0,64,0,64, 0,62,0,59,
      ],
      bass: [
        48,0,52,0, 55,0,57,0,  45,0,48,0, 52,0,55,0,
        50,0,53,0, 57,0,55,0,  43,0,47,0, 50,0,53,0,
        48,0,52,0, 55,0,57,0,  45,0,48,0, 52,0,55,0,
        50,0,53,0, 57,0,53,0,  48,0,43,0, 48,0,0,0,
      ],
      drum: [
        1,0,3,3, 0,3,3,0,  1,0,3,3, 0,3,3,0,
        1,0,3,3, 0,3,3,0,  1,0,3,3, 0,3,4,0,
        1,0,3,3, 0,3,3,0,  1,0,3,3, 0,3,3,0,
        1,0,3,3, 0,3,3,0,  1,0,3,0, 0,0,4,0,
      ],
    },
  };

  let curSong = null, pendingSong = null;
  let step = 0, nextStepTime = 0, schedTimer = null;

  function scheduleStep(song, t0, i) {
    const stepDur = 60 / song.bpm / 2;
    const L = song.lead.length;
    const lead = song.lead[i % L], arp = song.arp[i % L],
          bass = song.bass[i % L], dr = song.drum[i % L];
    if (lead) blip(musicBus, 'square', mtof(lead), t0, stepDur * 0.92, 0.16);
    if (arp)  blip(musicBus, 'square', mtof(arp),  t0 + stepDur * 0.02, stepDur * 0.5, 0.05);
    if (bass) blip(musicBus, 'triangle', mtof(bass), t0, stepDur * 0.95, 0.30);
    if (dr === 1) kick(musicBus, t0, 0.5);
    else if (dr === 2) { noiseHit(musicBus, t0, 0.09, 0.28, 'bandpass', 2200, 0.8); kick(musicBus, t0, 0.12); }
    else if (dr === 3) noiseHit(musicBus, t0, 0.03, 0.12, 'highpass', 7000, 1);
    else if (dr === 4) noiseHit(musicBus, t0, 0.16, 0.10, 'highpass', 6500, 1);
  }

  function schedulerTick() {
    if (!ctx || !curSong) return;
    const song = SONGS[curSong];
    const stepDur = 60 / song.bpm / 2;
    // background tabs throttle setInterval while currentTime keeps running;
    // without this resync every missed step would fire at once on catch-up
    if (nextStepTime < ctx.currentTime - stepDur) {
      const behind = Math.ceil((ctx.currentTime - nextStepTime) / stepDur);
      step += behind;
      nextStepTime += behind * stepDur;
    }
    while (nextStepTime < ctx.currentTime + 0.18) {
      const swingShift = (step % 2 === 1) ? stepDur * song.swing : 0;
      scheduleStep(song, Math.max(nextStepTime + swingShift, ctx.currentTime + 0.005), step);
      step++; nextStepTime += stepDur;
    }
  }

  function playMusic(name) {
    if (!ctx) { pendingSong = name; return; }
    if (curSong === name) return;
    curSong = name;
    step = 0;
    nextStepTime = ctx.currentTime + 0.08;
    if (!schedTimer && name) schedTimer = setInterval(schedulerTick, 40);
    if (!name && schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  }
  function stopMusic() { curSong = null; if (schedTimer) { clearInterval(schedTimer); schedTimer = null; } }

  /* =====================================================================
     ENGINE — continuous vroom, pitch follows speed
     ===================================================================== */
  let eng = null;
  function buildEngineNodes() {
    const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth'; osc2.type = 'square';
    osc1.frequency.value = 55; osc2.frequency.value = 55.8;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    osc1.connect(filt); osc2.connect(filt); filt.connect(g); g.connect(sfxBus);
    osc1.start(); osc2.start();

    // drift screech: filtered noise, gain driven per frame
    const sk = ctx.createBufferSource(); sk.buffer = noiseBuf; sk.loop = true;
    const skF = ctx.createBiquadFilter(); skF.type = 'bandpass'; skF.frequency.value = 1500; skF.Q.value = 2.5;
    const skG = ctx.createGain(); skG.gain.value = 0;
    sk.connect(skF); skF.connect(skG); skG.connect(sfxBus);
    sk.start();

    // boost rumble
    const bo = ctx.createBufferSource(); bo.buffer = noiseBuf; bo.loop = true;
    const boF = ctx.createBiquadFilter(); boF.type = 'lowpass'; boF.frequency.value = 900;
    const boG = ctx.createGain(); boG.gain.value = 0;
    bo.connect(boF); boF.connect(boG); boG.connect(sfxBus);
    bo.start();

    eng = { osc1, osc2, filt, g, skG, skF, boG };
  }

  /* speed01/throttle/drift/boost all 0..1 — called every frame while driving */
  function engine(speed01, throttle, drift, boost) {
    if (!eng || !ready()) return;
    const t = ctx.currentTime;
    const f = 48 + speed01 * 148 + throttle * 22;
    eng.osc1.frequency.setTargetAtTime(f, t, 0.05);
    eng.osc2.frequency.setTargetAtTime(f * 1.007 + 1, t, 0.05);
    eng.filt.frequency.setTargetAtTime(320 + speed01 * 900 + boost * 700, t, 0.08);
    eng.g.gain.setTargetAtTime(0.05 + speed01 * 0.075 + throttle * 0.05, t, 0.07);
    eng.skG.gain.setTargetAtTime(drift * 0.16, t, 0.04);
    eng.skF.frequency.setTargetAtTime(1200 + drift * 900 + speed01 * 400, t, 0.05);
    eng.boG.gain.setTargetAtTime(boost * 0.20, t, 0.06);
  }
  function engineOff() {
    if (!eng || !ctx) return;
    const t = ctx.currentTime;
    eng.g.gain.setTargetAtTime(0, t, 0.08);
    eng.skG.gain.setTargetAtTime(0, t, 0.05);
    eng.boG.gain.setTargetAtTime(0, t, 0.05);
  }

  /* =====================================================================
     ONE-SHOT SFX
     ===================================================================== */
  const now = () => ctx.currentTime;

  const sfx = {
    uiMove()   { if (!ready()) return; blip(sfxBus, 'square', 660, now(), 0.05, 0.12); },
    uiSelect() { if (!ready()) return; blip(sfxBus, 'square', 660, now(), 0.06, 0.15); blip(sfxBus, 'square', 990, now() + 0.07, 0.1, 0.15); },
    denied()   { if (!ready()) return; blip(sfxBus, 'square', 220, now(), 0.09, 0.16); blip(sfxBus, 'square', 174, now() + 0.09, 0.14, 0.16); },

    pickup() {
      if (!ready()) return;
      const t = now();
      [67, 72, 76].forEach((n, i) => blip(sfxBus, 'square', mtof(n), t + i * 0.055, 0.09, 0.2));
    },

    deliver(combo) {
      if (!ready()) return;
      const t = now();
      // cash register ding + coin sparkle, higher with combo
      blip(sfxBus, 'triangle', 1180, t, 0.3, 0.25);
      blip(sfxBus, 'triangle', 1770, t + 0.02, 0.25, 0.18);
      noiseHit(sfxBus, t, 0.05, 0.16, 'highpass', 8000, 1);
      const base = Math.min(combo || 1, 8);
      [72, 76, 79, 84].forEach((n, i) =>
        blip(sfxBus, 'square', mtof(n + base), t + 0.09 + i * 0.05, 0.09, 0.16));
    },

    tip() { if (!ready()) return; blip(sfxBus, 'triangle', 1560, now(), 0.12, 0.14); },

    levelup() {
      if (!ready()) return;
      const t = now();
      [60, 64, 67, 72, 76, 79, 84].forEach((n, i) =>
        blip(sfxBus, 'square', mtof(n), t + i * 0.07, 0.14, 0.18));
      blip(sfxBus, 'square', mtof(88), t + 0.5, 0.35, 0.2);
    },

    unlock() {
      if (!ready()) return;
      const t = now();
      [64, 68, 71, 76, 71, 76, 80, 88].forEach((n, i) =>
        blip(sfxBus, 'square', mtof(n), t + i * 0.09, 0.16, 0.17));
    },

    crash(k) {
      if (!ready()) return;
      const t = now(), v = clamp(0.18 + k * 0.5, 0.18, 0.6);
      noiseHit(sfxBus, t, 0.22, v, 'lowpass', 700, 0.7);
      noiseHit(sfxBus, t, 0.1, v * 0.7, 'bandpass', 2600, 1.2);
      blip(sfxBus, 'sine', 90, t, 0.22, v, 34);
    },

    bump() {
      if (!ready()) return;
      noiseHit(sfxBus, now(), 0.08, 0.15, 'lowpass', 800, 1);
    },

    honk() {
      if (!ready()) return;
      const t = now();
      // sad kazoo. very professional.
      blip(sfxBus, 'sawtooth', 311, t, 0.16, 0.22);
      blip(sfxBus, 'sawtooth', 370, t + 0.02, 0.18, 0.18);
      blip(sfxBus, 'sawtooth', 293, t + 0.2, 0.24, 0.22);
    },

    carHonk() {
      if (!ready()) return;
      const t = now();
      blip(sfxBus, 'square', 440, t, 0.14, 0.1);
      blip(sfxBus, 'square', 349, t, 0.14, 0.1);
    },

    tickWarn() { if (!ready()) return; blip(sfxBus, 'square', 880, now(), 0.06, 0.14); },

    boostFire() {
      if (!ready()) return;
      const t = now();
      noiseHit(sfxBus, t, 0.3, 0.2, 'lowpass', 1200, 0.8);
      blip(sfxBus, 'square', 180, t, 0.34, 0.14, 560);
    },

    splash() {
      if (!ready()) return;
      noiseHit(sfxBus, now(), 0.35, 0.2, 'bandpass', 1100, 0.6);
    },

    yelp() {
      if (!ready()) return;
      blip(sfxBus, 'square', 740, now(), 0.07, 0.12, 1150);
    },

    gameover() {
      if (!ready()) return;
      const t = now();
      [69, 65, 62, 57].forEach((n, i) =>
        blip(sfxBus, 'square', mtof(n), t + i * 0.22, 0.3, 0.2));
      blip(sfxBus, 'triangle', mtof(45), t + 0.88, 0.9, 0.25);
    },
  };

  /* ---------------- volume plumbing ---------------- */
  function setMusicVol(v) { musicVol = clamp(v, 0, 1); if (musicBus && !musicMuted) musicBus.gain.value = musicVol; }
  function setSfxVol(v) { sfxVol = clamp(v, 0, 1); if (sfxBus) sfxBus.gain.value = sfxVol; }
  function toggleMusicMute() {
    musicMuted = !musicMuted;
    if (musicBus) musicBus.gain.value = musicMuted ? 0 : musicVol;
    return musicMuted;
  }

  return {
    init, ready, playMusic, stopMusic, engine, engineOff,
    sfx, setMusicVol, setSfxVol, toggleMusicMute,
    get musicVol() { return musicVol; },
    get sfxVol() { return sfxVol; },
  };
})();
