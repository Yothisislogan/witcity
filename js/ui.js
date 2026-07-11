'use strict';
/* =========================================================================
   UI — menu screens, garage, level-up draft, game-over report, toasts,
   touch controls. DOM overlay; the game world stays on canvas.
   ========================================================================= */

const UI = (() => {
  let game = null;
  const $ = id => document.getElementById(id);
  const screens = {};
  let stack = [];          // screen history (settings can return to pause)
  let focusIdx = 0;

  const OVER_QUIPS = [
    '"The monster has logged off. The city grows hungry." — local news',
    'Your moped is being towed with great respect.',
    'Somewhere, a shrimp cocktail arrives cold. A tear is shed.',
    'The casino owners send their regards. And a parking ticket.',
    'HR says the horns must be OSHA-certified by Monday.',
    'You can stop doing the drift noises with your mouth now.',
  ];

  function current() { return stack[stack.length - 1] || null; }

  function show(name, push = true) {
    const cur = current();
    if (cur) screens[cur].classList.remove('open');
    if (push) stack.push(name);
    else stack = [name];
    screens[name].classList.add('open');
    focusIdx = 0;
    highlight();
    refreshTouch();
  }

  function back() {
    const cur = stack.pop();
    if (cur) screens[cur].classList.remove('open');
    const prev = current();
    if (prev) { screens[prev].classList.add('open'); focusIdx = 0; highlight(); }
    refreshTouch();
    return prev;
  }

  function closeAll() {
    for (const k of stack) screens[k].classList.remove('open');
    stack = [];
    refreshTouch();
  }

  function isOpen() { return stack.length > 0; }

  /* ------- keyboard focus for menus ------- */
  function focusables() {
    const scr = current();
    if (!scr) return [];
    return [...screens[scr].querySelectorAll('button, .ucard, .vcard:not(.locked)')]
      .filter(el => el.offsetParent !== null && !el.disabled);
  }
  function highlight() {
    const els = focusables();
    els.forEach((el, i) => el.classList.toggle('focus', i === focusIdx));
  }
  function menuKey(e) {
    if (!isOpen()) return false;
    const els = focusables();
    if (!els.length) return false;
    const scr = current();
    const horizontal = scr === 'levelup' || scr === 'garage';
    const fwd = horizontal ? 'ArrowRight' : 'ArrowDown';
    const bck = horizontal ? 'ArrowLeft' : 'ArrowUp';
    if (e.key === fwd || (horizontal && e.key === 'ArrowDown') || (!horizontal && e.key === 'ArrowRight')) {
      focusIdx = (focusIdx + 1) % els.length; highlight(); AUDIO.sfx.uiMove(); return true;
    }
    if (e.key === bck || (horizontal && e.key === 'ArrowUp') || (!horizontal && e.key === 'ArrowLeft')) {
      focusIdx = (focusIdx - 1 + els.length) % els.length; highlight(); AUDIO.sfx.uiMove(); return true;
    }
    if (e.key === 'Enter' || e.key === ' ') { els[focusIdx]?.click(); return true; }
    if (scr === 'levelup' && ['1', '2', '3'].includes(e.key)) {
      els[+e.key - 1]?.click(); return true;
    }
    return false;
  }

  /* ------- toasts ------- */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ------- menu footer stats ------- */
  function refreshMenuFoot() {
    const s = game.save;
    $('menuFoot').innerHTML =
      `HIGH SCORE <b>${fmtMoney(s.high)}</b> &nbsp;·&nbsp; CAREER DELIVERIES <b>${s.totalDeliv}</b><br>` +
      `rides unlocked <b>${s.vehicles.length}/${VEHICLES.length}</b> — deliver more food to unlock more rides`;
  }

  /* ------- garage ------- */
  function buildGarage() {
    const grid = $('garageGrid');
    grid.innerHTML = '';
    for (const v of VEHICLES) {
      const owned = game.save.vehicles.includes(v.id);
      const card = document.createElement('div');
      card.className = 'vcard' + (owned ? '' : ' locked') + (game.save.vehicle === v.id ? ' sel' : '');
      const cv = document.createElement('canvas');
      cv.width = 190; cv.height = 86;
      card.appendChild(cv);
      const h = document.createElement('h3'); h.textContent = v.name; card.prepend(h);
      const stats = [['SPD', v.stats.spd], ['ACC', v.stats.acc], ['GRIP', v.stats.grip]];
      for (const [label, val] of stats) {
        const row = document.createElement('div'); row.className = 'vstat';
        row.innerHTML = `<span>${label}</span><span class="bar"><i style="width:${Math.round(val * 100)}%"></i></span>`;
        card.appendChild(row);
      }
      const perk = document.createElement('div'); perk.className = 'vperk'; perk.textContent = v.desc;
      card.appendChild(perk);
      if (!owned) {
        const lock = document.createElement('div'); lock.className = 'vlock';
        lock.innerHTML = `🔒<br>${v.unlock.deliveries} career deliveries<br>(you have ${game.save.totalDeliv})`;
        card.appendChild(lock);
      }
      card.addEventListener('click', () => {
        if (!owned) { AUDIO.sfx.denied(); return; }
        game.save.vehicle = v.id;
        game.persist();
        AUDIO.sfx.uiSelect();
        buildGarage();
      });
      grid.appendChild(card);
      drawVehiclePreview(cv, v.id);
    }
    if (current() === 'garage') {           // rebuild loses the keyboard focus ring
      focusIdx = Math.min(focusIdx, Math.max(0, focusables().length - 1));
      highlight();
    }
  }

  /* ------- level up draft ------- */
  function showLevelUp(level, choices, cb) {
    $('lvlHead').textContent = `LEVEL ${level}!`;
    const wrap = $('cards');
    wrap.innerHTML = '';
    choices.forEach((u, i) => {
      const r = RARITY[u.rarity];
      const el = document.createElement('div');
      el.className = 'ucard';
      el.style.setProperty('--rar', r.color);
      el.innerHTML = `<div class="uicon">${u.icon}</div><h3>${u.name}</h3><p>${u.desc}</p>` +
        `<span class="rar">◆ ${r.name}</span><div class="keyhint">[${i + 1}]</div>`;
      el.addEventListener('click', () => { closeAll(); cb(u); });
      wrap.appendChild(el);
    });
    show('levelup', false);
  }

  /* ------- game over ------- */
  function showGameOver(st) {
    $('overScore').textContent = fmtMoney(st.score);
    $('overRec').style.display = st.newRecord ? '' : 'none';
    const rows = [
      ['Deliveries', st.deliveries],
      ['Best combo', 'x' + st.bestCombo],
      ['Tips earned', fmtMoney(st.tips)],
      ['Level reached', st.level],
      ['Insurance claims filed', st.crashes],
      ['Distance driven', (st.distance / 1000).toFixed(1) + ' km'],
      ['Tourists startled', st.scares],
    ];
    $('overStats').innerHTML = rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
    $('overQuip').textContent = choice(OVER_QUIPS);
    show('over', false);
  }

  /* ------- settings ------- */
  function syncSettings() {
    $('set-music').value = Math.round(game.save.settings.music * 100);
    $('set-sfx').value = Math.round(game.save.settings.sfx * 100);
    $('set-shake').checked = game.save.settings.shake;
  }

  /* ------- touch controls ------- */
  let touchAvail = false;
  function initTouch(input) {
    if (!('ontouchstart' in window)) return;
    touchAvail = true;
    const bind = (id, key) => {
      const el = $(id);
      const on = e => { e.preventDefault(); AUDIO.init(); input[key] = true; el.classList.add('press'); };
      const off = e => { e.preventDefault(); input[key] = false; el.classList.remove('press'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
    };
    bind('tLeft', 'left'); bind('tRight', 'right');
    bind('tGas', 'up'); bind('tBrake', 'down'); bind('tBoost', 'boost');
    $('tPause').addEventListener('touchstart', e => {
      e.preventDefault();
      AUDIO.init();
      if (game.state === 'play' && current() !== 'levelup') game.togglePause();
    }, { passive: false });
  }

  /* touch pads only exist while actually driving — over menus they'd both
     cover the buttons and swallow the taps */
  function refreshTouch() {
    if (!touchAvail) return;
    $('touch').classList.toggle('on', game.state === 'play' && !isOpen());
  }

  /* ------- wire everything ------- */
  function init(g) {
    game = g;
    for (const el of document.querySelectorAll('.screen'))
      screens[el.id.replace('scr-', '')] = el;

    const click = (id, fn) => $(id).addEventListener('click', () => { AUDIO.init(); AUDIO.sfx.uiSelect(); fn(); });

    click('btn-start', () => { closeAll(); game.startRun(false); });
    click('btn-freeroam', () => { closeAll(); game.startRun(true); });
    click('btn-garage', () => { buildGarage(); show('garage'); });
    click('btn-garage-back', back);
    click('btn-howto', () => show('howto'));
    click('btn-howto-back', back);
    click('btn-settings', () => { syncSettings(); show('settings'); });
    click('btn-settings-back', back);
    click('btn-pause-settings', () => { syncSettings(); show('settings'); });
    let wipeArm = 0;
    click('btn-wipe', () => {
      const btn = $('btn-wipe');
      if (Date.now() > wipeArm) {           // first press only arms it
        wipeArm = Date.now() + 3000;
        btn.textContent = '⚠ SURE? PRESS AGAIN TO WIPE';
        setTimeout(() => { if (Date.now() > wipeArm) btn.textContent = '🗑 RESET SAVE DATA'; }, 3200);
        return;
      }
      wipeArm = 0;
      btn.textContent = '🗑 RESET SAVE DATA';
      game.wipeSave();
      syncSettings();                        // sliders/checkbox reflect the fresh defaults
      refreshMenuFoot();
      toast('SAVE DATA RESET');
    });
    click('btn-resume', () => game.togglePause());
    click('btn-restart', () => { closeAll(); game.startRun(game.freeRoam); });
    click('btn-quit', () => game.quitToMenu());
    click('btn-again', () => { closeAll(); game.startRun(game.freeRoam); });
    click('btn-over-menu', () => game.quitToMenu());

    $('set-music').addEventListener('input', e => {
      game.save.settings.music = e.target.value / 100;
      AUDIO.setMusicVol(game.save.settings.music);
      game.persist();
    });
    $('set-sfx').addEventListener('input', e => {
      game.save.settings.sfx = e.target.value / 100;
      AUDIO.setSfxVol(game.save.settings.sfx);
      game.persist();
    });
    $('set-shake').addEventListener('change', e => {
      game.save.settings.shake = e.target.checked;
      game.persist();
    });

    initTouch(game.input);
    refreshMenuFoot();
  }

  return {
    init, show, back, closeAll, isOpen, current, menuKey, refreshTouch,
    toast, refreshMenuFoot, buildGarage, showLevelUp, showGameOver, syncSettings,
  };
})();
