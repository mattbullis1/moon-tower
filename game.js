/* ============================================================
   MOON TOWER — Lunar Module Stacker
   ------------------------------------------------------------
   Drop lunar modules onto the stack. Land dead-center for a
   PERFECT bonus (your astronaut celebrates with a golf swing).
   Land too far off and centre-of-mass physics tips the module,
   and moon gravity drags the whole tower down. No trimming.
   ============================================================ */
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 480
  const H = canvas.height;  // 720

  // ---------------- DOM ----------------
  const el = {
    height: document.getElementById('height'),
    score: document.getElementById('score'),
    combo: document.getElementById('combo'),
    comboN: document.getElementById('comboN'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toastText'),
    stabWrap: document.getElementById('stabilityWrap'),
    stabBar: document.getElementById('stabilityBar'),
    overlay: document.getElementById('overlay'),
    gameover: document.getElementById('gameover'),
    finalHeight: document.getElementById('finalHeight'),
    finalNote: document.getElementById('finalNote'),
    startBtn: document.getElementById('startBtn'),
    retryBtn: document.getElementById('retryBtn'),
    muteBtn: document.getElementById('muteBtn'),
  };

  // ---------------- Constants ----------------
  const FLOOR_H   = 26;
  const BASE_W    = 170;
  const MIN_W     = 14;
  const MAX_W     = 230;
  const PERFECT_PX = 7;         // dead-center window
  const MOON_G    = 620;        // px/s^2 — moon-ish, slow & floaty
  const TIP_TORQUE = 1.0;       // how fast an off-balance module tips
  const BEST_KEY  = 'moontower.v2.best';
  const SCORE_KEY = 'moontower.v2.score';

  // ---------------- Utils ----------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand  = (a, b) => a + Math.random() * (b - a);
  const pick  = a => a[(Math.random() * a.length) | 0];
  const lerp  = (a, b, t) => a + (b - a) * t;

  // ============================================================
  //  AUDIO — Web Audio synth, zero asset files
  // ============================================================
  const Audio_ = {
    ctx: null,
    master: null,
    muted: false,
    hum: null,
    humGain: null,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    },

    resume() {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
    },

    // generic tone
    tone({ freq = 440, dur = 0.2, type = 'sine', vol = 0.3, slideTo = null, delay = 0, attack = 0.005 }) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },

    // filtered noise burst (thud / dust)
    noise({ dur = 0.25, vol = 0.3, freq = 800, q = 1, type = 'lowpass', delay = 0 }) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t0); src.stop(t0 + dur + 0.02);
    },

    // ---- named SFX ----
    land() {
      // metal-on-metal clunk
      this.tone({ freq: 150, slideTo: 62, dur: 0.22, type: 'triangle', vol: 0.42 });
      this.noise({ dur: 0.16, vol: 0.2, freq: 1300, q: 0.8 });
      // little metallic ring
      this.tone({ freq: 720, slideTo: 660, dur: 0.18, type: 'square', vol: 0.045, delay: 0.01 });
    },

    perfect(streak) {
      const base = 880 * Math.pow(1.06, Math.min(streak, 12));
      [0, 1, 2].forEach(i =>
        this.tone({ freq: base * [1, 1.25, 1.5][i], dur: 0.5, type: 'sine', vol: 0.2, delay: i * 0.06 })
      );
      this.tone({ freq: 1760, dur: 0.8, type: 'triangle', vol: 0.08, delay: 0.18 });
    },

    golfSwing() {
      // whoosh: quick downward filtered noise
      this.noise({ dur: 0.18, vol: 0.22, freq: 2600, q: 1.5, type: 'bandpass' });
      // "tock" of club on ball
      this.tone({ freq: 900, slideTo: 1500, dur: 0.1, type: 'square', vol: 0.18, delay: 0.17 });
      this.noise({ dur: 0.08, vol: 0.16, freq: 3000, q: 2, type: 'bandpass', delay: 0.17 });
    },

    tip() {
      this.tone({ freq: 210, slideTo: 90, dur: 0.5, type: 'sawtooth', vol: 0.16 });
    },

    collapse() {
      this.noise({ dur: 1.5, vol: 0.5, freq: 260, q: 0.6 });
      this.tone({ freq: 120, slideTo: 34, dur: 1.4, type: 'sawtooth', vol: 0.28 });
      for (let i = 0; i < 6; i++)
        this.tone({ freq: rand(180, 520), slideTo: 60, dur: 0.5, type: 'triangle', vol: 0.12, delay: 0.05 * i });
    },

    gameOver() {
      [392, 330, 262, 196].forEach((f, i) =>
        this.tone({ freq: f, dur: 0.6, type: 'sine', vol: 0.22, delay: i * 0.16 })
      );
    },

    start() {
      [330, 440, 587, 784].forEach((f, i) =>
        this.tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.2, delay: i * 0.09 })
      );
    },

    click() { this.tone({ freq: 660, dur: 0.06, type: 'square', vol: 0.12 }); },

    startHum() {
      if (!this.ctx || this.hum) return;
      const o1 = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      o1.type = 'sine'; o1.frequency.value = 55;
      o2.type = 'sine'; o2.frequency.value = 82.5;
      const g = this.ctx.createGain();
      g.gain.value = 0.0;
      g.gain.linearRampToValueAtTime(0.05, this.ctx.currentTime + 2);
      o1.connect(g); o2.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this.hum = [o1, o2];
      this.humGain = g;
    },
    stopHum() {
      if (!this.hum) return;
      const t = this.ctx.currentTime;
      this.humGain.gain.cancelScheduledValues(t);
      this.humGain.gain.linearRampToValueAtTime(0, t + 0.6);
      const h = this.hum;
      setTimeout(() => h.forEach(o => { try { o.stop(); } catch (e) {} }), 800);
      this.hum = null;
    },
  };

  // ============================================================
  //  MODULE FACTORY — random lunar-module-looking shapes
  // ============================================================
  // Every module keeps its own silhouette recipe so the tower looks
  // like a jumble of real lunar landers / habitats / labs.
  const SILHOUETTES = [
    { id: 'lander',    name: 'LM Descent Stage' },
    { id: 'habitat',   name: 'Hab Module' },
    { id: 'lab',       name: 'Science Lab' },
    { id: 'dome',      name: 'Observation Dome' },
    { id: 'rover-bay', name: 'Rover Bay' },
    { id: 'antenna',   name: 'Comms Mast' },
    { id: 'tank',      name: 'Fuel Tank' },
    { id: 'solar',     name: 'Solar Array' },
    { id: 'capsule',   name: 'Crew Capsule' },
    { id: 'airlock',   name: 'Airlock Node' },
  ];

  const PALETTES = [
    { body: '#c9d3e0', trim: '#8b98ad', accent: '#ff5c7a', glass: '#7fe6ff' }, // lunar white/grey
    { body: '#d8c9a8', trim: '#a3917a', accent: '#ffb347', glass: '#ffe9a8' }, // gold foil
    { body: '#b8c3d6', trim: '#6f7c96', accent: '#6ee7ff', glass: '#9ff3ff' }, // blue steel
    { body: '#c2b6d4', trim: '#7d6d97', accent: '#c98bff', glass: '#e0c8ff' }, // violet alloy
    { body: '#a8b6a0', trim: '#6d7a67', accent: '#9dff8b', glass: '#d6ffd0' }, // olive
    { body: '#d4b0a0', trim: '#9a7a6b', accent: '#ff8a5c', glass: '#ffd0b8' }, // rust
  ];

  function makeModule(width, prevCx) {
    const sil = pick(SILHOUETTES);
    const pal = pick(PALETTES);
    const b = {
      sil: sil.id,
      silName: sil.name,
      pal,
      w: clamp(width, MIN_W, MAX_W),
      h: FLOOR_H,
      x: 0,
      y: 0,
      // animation / physics
      lean: 0,        // current visual tilt
      leanV: 0,
      offset: 0,      // horizontal lean offset of the visual
      fallVy: 0,
      fallVx: 0,
      rot: 0,
      rotV: 0,
      downY: 0,
      placed: false,
      // detail seeds
      seed: Math.random(),
      windows: 1 + ((Math.random() * 6) | 0),
      strut: Math.random() < 0.5,
      dish: Math.random() < 0.4,
      // moving-block params (filled by spawn)
      speed: 0,
      dir: 1,
      wobbleAmp: 0,
      wobblePhase: Math.random() * Math.PI * 2,
      // physical placement
      cx: 0,          // center on the platform below
      cxm: 0,         // center of mass x (== cx for a uniform block)
      settled: false,
    };
    return b;
  }

  // ============================================================
  //  STATE
  // ============================================================
  const S = {
    mode: 'menu',        // menu | playing | over | collapsing
    stack: [],           // placed modules {cx,w,sil,pal,lean,offset,...}
    active: null,
    base: null,
    score: 0,
    best: +(localStorage.getItem(BEST_KEY) || 0),
    bestScore: +(localStorage.getItem(SCORE_KEY) || 0),
    combo: 0,
    maxCombo: 0,
    t: 0,
    camY: 0,
    camTarget: 0,
    shake: 0,
    globalLean: 0,       // whole-tower sway
    globalLeanV: 0,
    particles: [],
    dust: [],
    stars: [],
    earthX: W * 0.72,
    earthY: 140,
    golferX: 62,
    golferY: 0,
    golfer: { swing: 0, swingT: 0, cheer: 0, cheerT: 0, face: 1 },
    ball: null,
    note: '',
    collapsing: false,
    lastStability: 1,
    shownStability: 1,
  };

  // ============================================================
  //  SCENERY
  // ============================================================
  function buildStars() {
    S.stars = [];
    for (let i = 0; i < 130; i++) {
      S.stars.push({
        x: Math.random() * W,
        y: Math.random() * H * 5,
        r: Math.random() * 1.5 + 0.25,
        tw: Math.random() * Math.PI * 2,
        bright: Math.random() < 0.16,
      });
    }
  }
  buildStars();

  // ============================================================
  //  SETUP
  // ============================================================
  function reset() {
    S.stack = [];
    S.particles = [];
    S.dust = [];
    S.score = 0;
    S.combo = 0;
    S.maxCombo = 0;
    S.t = 0;
    S.camY = 0;
    S.camTarget = 0;
    S.shake = 0;
    S.globalLean = 0;
    S.globalLeanV = 0;
    S.collapsing = false;
    S.ball = null;
    S.note = '';
    S.lastStability = 1;
    S.shownStability = 1;
    S.earthFlash = 0;
    S.earthPulse = 0;
    S.golfer.swing = 0; S.golfer.swingT = 0;
    S.golfer.cheer = 0; S.golfer.cheerT = 0;

    // ground slab — the landing pad
    const pad = makeModule(BASE_W);
    pad.sil = 'pad';
    pad.silName = 'Landing Pad';
    pad.pal = { body: '#8f9bb3', trim: '#5a6478', accent: '#ffd479', glass: '#9ff3ff' };
    pad.cx = W / 2;
    pad.worldY = H - 96;
    pad.placed = true;
    pad.settled = true;
    pad.fixed = true;
    S.stack.push(pad);
    S.base = pad;

    spawnFirst();
    updateHUD();
  }

  function spawnFirst() {
    const m = makeModule(BASE_W * 0.72, W / 2);
    beginSweep(m);
  }

  function beginSweep(m) {
    const speed = clamp(120 + S.stack.length * 5.5 + rand(0, 40), 80, 460);
    m.speed = speed;
    m.dir = Math.random() < 0.5 ? 1 : -1;
    m.x = m.dir > 0 ? -m.w * 0.6 : W + m.w * 0.6;
    const top = topModule();
    m.y = top.worldY - FLOOR_H;
    m.worldY = m.y;
    S.active = m;
  }

  function topModule() { return S.stack[S.stack.length - 1]; }

  // ============================================================
  //  INPUT
  // ============================================================
  function drop() {
    Audio_.resume();
    if (S.mode === 'menu') { startGame(); return; }
    if (S.mode === 'over') { startGame(); return; }
    if (S.mode !== 'playing' || !S.active) return;
    resolveDrop();
  }

  // ============================================================
  //  DROP RESOLUTION — physics instead of trimming
  // ============================================================
  function resolveDrop() {
    const m = S.active;
    S.active = null;
    const top = topModule();

    // centers
    const mCx  = m.x + m.w / 2;
    const tCx  = top.cx;
    const off  = mCx - tCx;                 // signed error
    const absOff = Math.abs(off);

    // Does the module actually rest on the platform at all?
    const topL = tCx - top.w / 2;
    const topR = tCx + top.w / 2;
    const mL = mCx - m.w / 2;
    const mR = mCx + m.w / 2;
    const overlapL = Math.max(mL, topL);
    const overlapR = Math.min(mR, topR);
    const overlap = Math.max(0, overlapR - overlapL);
    const supportFrac = overlap / m.w;      // 0..1 how much of the module is supported

    m.cx = mCx;
    m.worldY = top.worldY - FLOOR_H;
    m.x = m.cx - m.w / 2;

    // ---- PERFECT ----
    if (absOff <= PERFECT_PX) {
      m.lean = 0; m.offset = 0;
      m.settled = true;
      placeOnStack(m);
      S.combo++;
      S.maxCombo = Math.max(S.maxCombo, S.combo);
      S.lastStability = 1;
      const bonus = 10 * S.combo;
      S.score += 100 + bonus;
      Audio_.perfect(S.combo);
      showCombo(S.combo);
      spawnBurst(mCx, m.worldY, m.pal.accent, 26);
      S.shake = Math.min(12, 4 + S.combo);
      triggerGolfSwing();
      toast(`PERFECT · +${100 + bonus}`);
      // Earth glows a little brighter briefly
      flashEarth();
      spawnNext();
      return;
    }

    // ---- NO SUPPORT AT ALL -> free fall off the tower ----
    if (supportFrac <= 0.02 || overlap <= 1) {
      toppleAndFall(m, 'MISSED THE TOWER');
      return;
    }

    // ---- Off-center: decide stable vs tips over ----
    // Physics gate: a uniform box stays put while its centre of mass
    // sits inside the support footprint. Stability margin shrinks as
    // the tower grows (cumulative sway).
    const supportWidth = overlap;                       // effective contact
    const margin = (supportWidth / 2) - absOff;         // >0 means stable
    // the taller we get, the twitchier the tower
    const heightPenalty = Math.min(0.55, S.stack.length * 0.006);
    const stability = clamp(0.5 + margin / Math.max(30, m.w * 0.5) - heightPenalty, 0, 1);

    if (margin > -(m.w * 0.06)) {
      // STABLE, but it sits leaning toward the overhang
      m.settled = true;
      m.lean = clamp(off / Math.max(60, m.w) * 0.35, -0.35, 0.35);
      m.offset = clamp(off * 0.12, -14, 14);
      placeOnStack(m);
      S.combo = 0;
      S.score += 40;
      Audio_.land();
      spawnDust(mCx, m.worldY, 12);
      S.shake = Math.min(9, 2 + absOff / 12);
      // nudge global sway
      S.globalLeanV += m.lean * 0.9;
      S.lastStability = stability;
      if (stability < 0.28) toast('WOBBLING…');
      spawnNext();
      return;
    }

    // ---- TOO FAR OFF -> tips and drags the stack down ----
    toppleAndFall(m, 'TOO FAR OFF-CENTER');
  }

  function placeOnStack(m) {
    m.placed = true;
    S.stack.push(m);
    updateHUD();
  }

  function spawnNext() {
    if (S.mode !== 'playing') return;
    const top = topModule();
    // gentle width drift so the tower tapers/variates naturally
    const drift = 1 + rand(-0.10, 0.06);
    const nextW = clamp(top.w * drift, 46, MAX_W);
    const m = makeModule(nextW, top.cx);
    beginSweep(m);
  }

  // ---- Failure: tip over then fall under moon gravity ----
  function toppleAndFall(m, reason) {
    S.mode = 'collapsing';
    S.collapsing = true;
    const below = topModule();          // capture BEFORE pushing
    const side = m.cx < below.cx ? -1 : 1;
    m.placed = true;
    m.settled = false;
    m.falling = true;
    m.fallVy = 0;
    m.fallVx = side * rand(40, 130);
    m.rotV = side * rand(1.6, 3.2);
    S.stack.push(m);   // it's on the pile, just leaving
    toast(reason);
    Audio_.tip();
    setTimeout(() => Audio_.collapse(), 220);
    S.shake = 20;

    // the whole stack loses it after a beat
    setTimeout(() => {
      for (const s of S.stack) {
        if (s.fixed) continue;
        s.falling = true;
        s.fallVy = rand(-20, 40);
        s.fallVx = rand(-160, 160);
        s.rotV = rand(-3, 3);
      }
    }, 380);

    setTimeout(() => die(), 2100);
  }

  // ============================================================
  //  UPDATE
  // ============================================================
  function update(dt) {
    S.t += dt;

    // camera
    S.camTarget = Math.max(0, (S.stack.length - 4) * FLOOR_H);
    S.camY = lerp(S.camY, S.camTarget, Math.min(1, dt * 5));

    // whole-tower sway (spring toward upright)
    S.globalLeanV += -S.globalLean * 9 * dt;
    S.globalLeanV *= Math.pow(0.03, dt);
    S.globalLean += S.globalLeanV * dt;
    S.globalLean = clamp(S.globalLean, -0.22, 0.22);

    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 34);

    // moon in the sky drifts very slowly (Earth)
    S.earthX = W * 0.7 + Math.sin(S.t * 0.05) * 40;

    // active sweeping module
    if (S.mode === 'playing' && S.active) {
      const b = S.active;
      b.x += b.dir * b.speed * dt;
      const margin = b.w * 0.4;
      if (b.x + b.w > W + margin && b.dir > 0) { b.dir = -1; b.x = W + margin - b.w; }
      if (b.x < -margin && b.dir < 0) { b.dir = 1; b.x = -margin; }
      b.worldY = topModule().worldY - FLOOR_H;
      b.y = b.worldY;
    }

    // falling debris (collapse)
    for (const s of S.stack) {
      if (!s.falling) continue;
      s.fallVy += MOON_G * dt;
      s.worldY += s.fallVy * dt;
      s.cx += s.fallVx * dt;
      s.rot += s.rotV * dt;
      s.offset += s.fallVx * dt * 0.2;
    }

    // placed modules settle their lean back toward the resting lean
    for (const s of S.stack) {
      if (s.falling || !s.placed || s.fixed) continue;
      s.leanV = 0;
    }

    // golfer
    const g = S.golfer;
    if (g.swingT > 0) { g.swingT -= dt; g.swing = Math.sin(clamp(1 - g.swingT / 0.5, 0, 1) * Math.PI); }
    else g.swing *= Math.pow(0.02, dt);
    if (g.cheerT > 0) { g.cheerT -= dt; g.cheer = clamp(g.cheerT / 1.0, 0, 1); }
    else g.cheer *= Math.pow(0.05, dt);
    g.face = 1;

    // golf ball flight
    if (S.ball) {
      const b = S.ball;
      b.vy += MOON_G * 0.55 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += dt * 6;
      b.life -= dt;
      if (b.life <= 0) S.ball = null;
    }

    // particles
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) S.particles.splice(i, 1);
    }
    for (let i = S.dust.length - 1; i >= 0; i--) {
      const d = S.dust[i];
      d.vy -= 60 * dt;                 // low-gravity dust floats UP slowly
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= Math.pow(0.2, dt);
      d.life -= dt;
      if (d.life <= 0) S.dust.splice(i, 1);
    }

    // earth flash decay
    S.earthFlash = Math.max(0, (S.earthFlash || 0) - dt * 1.8);
    S.earthPulse = Math.max(0, (S.earthPulse || 0) - dt * 2.5);

    updateStability();
  }

  function updateStability() {
    if (S.mode !== 'playing') { el.stabWrap.classList.remove('show'); return; }
    el.stabWrap.classList.add('show');
    // Move the bar gradually toward the last computed stability so it
    // reads as a live gauge rather than snapping.
    S.shownStability = lerp(S.shownStability, S.lastStability, 0.12);
    el.stabBar.style.transform = `scaleX(${clamp(S.shownStability, 0.03, 1).toFixed(3)})`;
  }

  // ============================================================
  //  FX
  // ============================================================
  function spawnBurst(x, y, c, n) {
    for (let i = 0; i < n; i++) {
      S.particles.push({
        x, y,
        vx: rand(-180, 180),
        vy: rand(-320, -60),
        s: rand(2, 5),
        c,
        life: rand(0.4, 1.0),
      });
    }
  }
  function spawnDust(x, y, n) {
    for (let i = 0; i < n; i++) {
      S.dust.push({
        x: x + rand(-16, 16), y,
        vx: rand(-40, 40),
        vy: rand(-10, 20),
        r: rand(1.5, 3.5),
        c: 'rgba(200,205,225,',
        life: rand(0.8, 2.0),
      });
    }
  }
  function flashEarth() { S.earthFlash = 1; S.earthPulse = 1; }

  function triggerGolfSwing() {
    S.golfer.swingT = 0.5;
    S.golfer.cheerT = 1.4;
    Audio_.golfSwing();
    // ball launches from the tee, off into the lunar sky
    S.ball = {
      x: S.golferX + 20,
      y: H - 46,
      vx: rand(150, 215),
      vy: rand(-250, -180),
      rot: 0,
      life: 3.4,
    };
  }

  function showCombo(n) {
    el.comboN.textContent = n;
    el.combo.classList.remove('hidden');
    el.combo.classList.remove('pop');
    void el.combo.offsetWidth;
    el.combo.classList.add('pop');
  }

  let toastT = null;
  function toast(text) {
    el.toastText.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.toast.classList.remove('show'), 1500);
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function render() {
    // ---- sky ----
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#02010a');
    sky.addColorStop(0.5, '#050a22');
    sky.addColorStop(1, '#0b1030');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    drawStars();
    drawEarth();

    const sx = (Math.random() - 0.5) * S.shake;
    const sy = (Math.random() - 0.5) * S.shake;

    // ---- world (camera + sway) ----
    ctx.save();
    // sway pivots around the pad
    const pivotX = W / 2;
    const pivotScreenY = (H - 96 + FLOOR_H) + S.camY;
    ctx.translate(pivotX, pivotScreenY);
    ctx.rotate(S.globalLean);
    ctx.translate(-pivotX, -pivotScreenY);
    ctx.translate(sx, sy + S.camY);

    drawGround();
    drawStack();
    drawActive();
    drawParticles();
    ctx.restore();

    // ---- foreground astronaut (screen space, no sway) ----
    drawGolfer(sx, sy);

    drawVignette();
    drawCollapseFlash();
  }

  function drawStars() {
    for (const s of S.stars) {
      const y = (((s.y - S.camY * 0.13) % (H * 5)) + H * 5) % (H * 5);
      if (y > H + 4) continue;
      const a = s.bright
        ? 0.55 + 0.45 * Math.abs(Math.sin(S.t * 2.2 + s.tw))
        : 0.25 + 0.4 * Math.abs(Math.sin(S.t * 1.2 + s.tw));
      ctx.globalAlpha = a;
      ctx.fillStyle = s.bright ? '#cfe0ff' : '#ffffff';
      const r = s.bright ? s.r * 1.7 : s.r;
      ctx.beginPath(); ctx.arc(s.x, y, r, 0, Math.PI * 2); ctx.fill();
      if (s.bright) {
        ctx.globalAlpha = a * 0.35;
        ctx.beginPath(); ctx.arc(s.x, y, r * 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- EARTH in the sky ----
  function drawEarth() {
    const cx = S.earthX, cy = S.earthY, R = 52;
    ctx.save();

    // atmosphere glow (brighter on perfect)
    const glow = 1 + (S.earthFlash || 0) * 0.9 + (S.earthPulse || 0) * 0.3;
    const atmo = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 2.3 * glow);
    atmo.addColorStop(0, `rgba(110,190,255,${0.55 * glow})`);
    atmo.addColorStop(0.4, 'rgba(70,150,255,0.22)');
    atmo.addColorStop(1, 'rgba(40,90,255,0)');
    ctx.fillStyle = atmo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 2.3 * glow, 0, Math.PI * 2); ctx.fill();

    // ocean
    const ocean = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.2, cx, cy, R);
    ocean.addColorStop(0, '#4fa8ff');
    ocean.addColorStop(0.6, '#1f6fd6');
    ocean.addColorStop(1, '#0b3a8c');
    ctx.fillStyle = ocean;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // continents (clipped blobs, slowly rotating)
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    const rot = S.t * 0.06;
    const blobs = [
      [-0.35, -0.30, 0.42, 0.34], [0.20, -0.10, 0.34, 0.44],
      [-0.10, 0.40, 0.36, 0.26], [0.45, 0.30, 0.24, 0.30],
      [0.05, -0.55, 0.22, 0.18],
    ];
    ctx.fillStyle = '#3f9e5c';
    for (const [bx, by, bw, bh] of blobs) {
      const ang = rot + bx * 0.2;
      const px = cx + Math.cos(ang) * bx * R * 1.15 + Math.sin(rot + by) * 4;
      const py = cy + by * R * 1.05;
      ctx.beginPath();
      ctx.ellipse(px, py, bw * R * 0.55, bh * R * 0.55, ang * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // sand highlights
    ctx.fillStyle = 'rgba(214,196,130,0.55)';
    for (const [bx, by, bw, bh] of blobs) {
      const px = cx + bx * R * 1.1;
      const py = cy + by * R * 0.95;
      ctx.beginPath();
      ctx.ellipse(px, py, bw * R * 0.28, bh * R * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // cloud swirls
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    for (let i = 0; i < 5; i++) {
      const a = rot * 1.9 + i * 1.3;
      const px = cx + Math.cos(a) * R * 0.55;
      const py = cy + Math.sin(a * 0.7 + i) * R * 0.6;
      ctx.beginPath();
      ctx.ellipse(px, py, R * 0.30, R * 0.11, a * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // terminator shading (night side)
    const term = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    term.addColorStop(0, 'rgba(0,0,0,0)');
    term.addColorStop(0.55, 'rgba(0,0,0,0)');
    term.addColorStop(1, 'rgba(0,0,20,0.5)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = term;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    // rim light
    ctx.strokeStyle = `rgba(160,220,255,${0.5 + (S.earthFlash || 0) * 0.5})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // tiny moon orbiting Earth (a wink at where you are)
    const oa = S.t * 0.9;
    const ox = cx + Math.cos(oa) * 78;
    const oy = cy + Math.sin(oa) * 30;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#d8d8e0';
    ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawGround() {
    const pad = S.base;
    const padTop = pad.worldY;
    // regolith surface
    const surfY = pad.worldY + FLOOR_H;
    const g = ctx.createLinearGradient(0, surfY - 30, 0, surfY + 120);
    g.addColorStop(0, 'rgba(120,130,170,0.25)');
    g.addColorStop(1, 'rgba(20,24,50,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-100, surfY - 30, W + 200, 140);

    // lunar ground line
    ctx.strokeStyle = 'rgba(160,170,210,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-100, surfY);
    // gentle ridges
    for (let x = -100; x <= W + 100; x += 20) {
      const y = surfY + Math.sin(x * 0.03) * 5 + Math.sin(x * 0.011 + 2) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    // craters on the surface
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    const craters = [40, 150, 300, 420];
    for (const cx0 of craters) {
      const y = surfY + Math.sin(cx0 * 0.03) * 5 + Math.sin(cx0 * 0.011 + 2) * 8;
      ctx.beginPath();
      ctx.ellipse(cx0, y + 4, 22 + (cx0 % 30), 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawStack() {
    for (const m of S.stack) drawModule(m, false);
  }

  function drawActive() {
    if (!S.active) return;
    const m = S.active;
    // trajectory guide to current top
    const top = topModule();
    ctx.save();
    ctx.setLineDash([4, 7]);
    const mCx = m.x + m.w / 2;
    const near = Math.abs(mCx - top.cx) <= PERFECT_PX;
    ctx.globalAlpha = near ? 0.95 : 0.3;
    ctx.strokeStyle = near ? '#9ff3ff' : '#ffffff';
    ctx.lineWidth = near ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(mCx, m.worldY + FLOOR_H + 3);
    ctx.lineTo(top.cx, top.worldY);
    ctx.stroke();
    ctx.restore();

    // perfect landing zone on top surface
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(S.t * 6));
    ctx.fillStyle = '#9ff3ff';
    ctx.fillRect(top.cx - PERFECT_PX, top.worldY - 2, PERFECT_PX * 2, 3);
    ctx.restore();

    drawModule(m, true);
    drawModuleShadow(m);
  }

  function drawModuleShadow(m) {
    const top = topModule();
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    const mCx = m.x + m.w / 2;
    const dist = clamp(Math.abs(mCx - top.cx) / 200, 0, 1);
    ctx.beginPath();
    ctx.ellipse(mCx, top.worldY - 2, m.w * 0.45 * (1 - dist * 0.3), 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- Draw one module (the star of the show) ----
  function drawModule(m, isActive) {
    const x = (isActive ? m.x : m.cx - m.w / 2) + (m.offset || 0);
    const y = m.worldY;
    const w = m.w;
    const h = FLOOR_H;
    const pal = m.pal;

    ctx.save();
    if (m.falling) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(m.rot);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    } else if (!m.fixed) {
      // lean rendering: rotate slightly around the bottom-center
      ctx.translate(x + w / 2, y + h);
      ctx.rotate((m.lean || 0) * 0.5);
      ctx.translate(-(x + w / 2), -(y + h));
    }

    drawBody(m, x, y, w, h, pal);

    ctx.restore();
  }

  function drawBody(m, x, y, w, h, pal) {
    const s = m.seed;
    const sil = m.sil;
    const r = Math.min(h / 2, 5);

    // ---- base hull: rounded metallic slab ----
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(pal.body, 1.18));
    g.addColorStop(0.45, pal.body);
    g.addColorStop(1, shade(pal.body, 0.68));
    ctx.fillStyle = g;
    roundRect(x, y, w, h, r);
    ctx.fill();

    // hull plating seams
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    const seams = Math.max(2, Math.floor(w / 26));
    for (let i = 1; i < seams; i++) {
      const sx = x + (w / seams) * i;
      ctx.beginPath(); ctx.moveTo(sx, y + 3); ctx.lineTo(sx, y + h - 3); ctx.stroke();
    }

    // top rim highlight
    ctx.fillStyle = shade(pal.body, 1.45);
    roundRect(x + 1, y + 1, w - 2, 3, 2); ctx.fill();

    // bottom shadow
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    roundRect(x + 1, y + h - 4, w - 2, 3, 2); ctx.fill();

    // ---- silhouette-specific details ----
    if (sil === 'pad') {
      // landing pad: bright apron + hazard stripes + landing legs
      ctx.fillStyle = pal.accent;
      ctx.fillRect(x + 4, y + 4, w - 8, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (let i = 0; i < w; i += 16) ctx.fillRect(x + i + 2, y + h - 8, 8, 4);
      // legs
      ctx.strokeStyle = shade(pal.trim, 0.8);
      ctx.lineWidth = 3;
      const legs = [-1, 0, 1];
      for (const L of legs) {
        const lx = x + w / 2 + L * (w * 0.36);
        ctx.beginPath();
        ctx.moveTo(lx, y + h);
        ctx.lineTo(lx + L * 10, y + h + 16);
        ctx.stroke();
      }
    } else if (sil === 'lander') {
      // descent stage: gold foil + nozzles underneath
      ctx.fillStyle = 'rgba(255,215,120,0.5)';
      ctx.fillRect(x + 3, y + h * 0.35, w - 6, h * 0.4);
      ctx.fillStyle = shade(pal.trim, 0.7);
      const nN = Math.max(1, Math.floor(w / 40));
      for (let i = 0; i < nN; i++) {
        const nx = x + (w / (nN + 1)) * (i + 1);
        ctx.beginPath();
        ctx.moveTo(nx - 4, y + h);
        ctx.lineTo(nx + 4, y + h);
        ctx.lineTo(nx + 7, y + h + 7);
        ctx.lineTo(nx - 7, y + h + 7);
        ctx.closePath();
        ctx.fill();
      }
    } else if (sil === 'dome') {
      // observation dome bulge on top
      ctx.fillStyle = shade(pal.body, 1.25);
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + 3, w * 0.32, 8, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.glass;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + 3, w * 0.2, 5, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (sil === 'solar') {
      // solar panels sticking out sideways
      ctx.fillStyle = '#1c2a5e';
      ctx.strokeStyle = '#4360b8';
      ctx.lineWidth = 1;
      const pw = 22, ph = 11;
      ctx.fillRect(x - pw + 3, y + h / 2 - ph / 2, pw, ph);
      ctx.strokeRect(x - pw + 3, y + h / 2 - ph / 2, pw, ph);
      ctx.fillRect(x + w - 3, y + h / 2 - ph / 2, pw, ph);
      ctx.strokeRect(x + w - 3, y + h / 2 - ph / 2, pw, ph);
      ctx.fillStyle = 'rgba(120,180,255,0.4)';
      ctx.fillRect(x - pw + 3, y + h / 2 - ph / 2, pw, 3);
      ctx.fillRect(x + w - 3, y + h / 2 - ph / 2, pw, 3);
    } else if (sil === 'antenna') {
      // comms mast + dish on top
      ctx.strokeStyle = shade(pal.trim, 0.85);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + w / 2, y + 2); ctx.lineTo(x + w / 2, y - 14); ctx.stroke();
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y - 14, 9, 5, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(pal.accent, 1.4);
      ctx.beginPath(); ctx.arc(x + w / 2, y - 14, 2, 0, Math.PI * 2); ctx.fill();
    } else if (sil === 'tank') {
      // cylindrical fuel tank: strong horizontal bands
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x + 2, y + 4, w - 4, 3);
      ctx.fillRect(x + 2, y + h / 2, w - 4, 3);
      ctx.fillStyle = pal.accent;
      ctx.beginPath(); ctx.arc(x + 7, y + h / 2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w - 7, y + h / 2, 3, 0, Math.PI * 2); ctx.fill();
    } else if (sil === 'capsule') {
      // bell-shaped crew capsule
      ctx.fillStyle = shade(pal.body, 0.85);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.16, y + h);
      ctx.lineTo(x + w * 0.30, y + 2);
      ctx.lineTo(x + w * 0.70, y + 2);
      ctx.lineTo(x + w * 0.84, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
      // heat shield
      ctx.fillStyle = shade(pal.trim, 0.6);
      ctx.fillRect(x + w * 0.12, y + h - 5, w * 0.76, 5);
    } else if (sil === 'airlock') {
      // node with a hatch + docking ring
      ctx.fillStyle = pal.accent;
      ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, Math.min(8, h * 0.32), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(pal.accent, 0.6);
      ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, Math.min(5, h * 0.2), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(pal.body, 1.4); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, Math.min(11, h * 0.42), 0, Math.PI * 2); ctx.stroke();
    } else if (sil === 'rover-bay') {
      // open bay door on the right
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + w - 22, y + 6, 16, h - 12);
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 1;
      ctx.strokeRect(x + w - 22, y + 6, 16, h - 12);
      // tiny rover hint
      ctx.fillStyle = pal.accent;
      ctx.beginPath(); ctx.arc(x + w - 10, y + h - 6, 2.4, 0, Math.PI * 2); ctx.fill();
    } else {
      // habitat / lab / default: banded hull with windows
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 2, y + h * 0.5, w - 4, 3);
    }

    // ---- lit windows (most modules get some) ----
    const showWindows = ['habitat', 'lab', 'rover-bay', 'tank', 'airlock'].includes(sil) || (s > 0.5 && sil !== 'solar');
    if (showWindows && w > 30) {
      const n = clamp(Math.floor(w / 26), 1, 6);
      const gap = w / (n + 1);
      for (let i = 1; i <= n; i++) {
        const wx = x + gap * i - 3;
        const wy = y + h * 0.34;
        const lit = Math.sin(s * 20 + i * 3.3) > -0.3;
        ctx.fillStyle = lit ? pal.glass : 'rgba(40,60,90,0.9)';
        if (lit) { ctx.shadowColor = pal.glass; ctx.shadowBlur = 6; }
        roundRect(wx, wy, 6, 6, 1.5);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // ---- struts on some modules ----
    if (m.strut && w > 40) {
      ctx.strokeStyle = shade(pal.trim, 0.75);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + h);
      ctx.lineTo(x + 3, y + h + 12);
      ctx.moveTo(x + w - 3, y + h);
      ctx.lineTo(x + w - 3, y + h + 12);
      ctx.stroke();
      // feet
      ctx.fillStyle = shade(pal.trim, 0.7);
      ctx.beginPath(); ctx.ellipse(x + 3, y + h + 12, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + w - 3, y + h + 12, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
    }

    // ---- outline ----
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();

    // danger flash on falling modules
    if (m.falling) {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#ff5c7a';
      ctx.lineWidth = 2;
      roundRect(x, y, w, h, r);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ============================================================
  //  ASTRONAUT GOLFING ON THE MOON
  // ============================================================
  function drawGolfer(sx, sy) {
    const gx = S.golferX;
    const gy = H - 40;           // stands on the near ridge, screen space
    const g = S.golfer;

    // ground mound the astronaut stands on
    ctx.save();
    ctx.fillStyle = 'rgba(150,160,200,0.5)';
    ctx.beginPath();
    ctx.moveTo(gx - 46, gy + 22);
    ctx.quadraticCurveTo(gx, gy - 6, gx + 52, gy + 22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,190,230,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(gx, gy);

    const bob = Math.sin(S.t * 1.6) * 0.6;
    ctx.translate(0, bob);

    // --- golf ball ---
    if (!S.ball) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(20, -3, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // --- shadow ---
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 24, 13, 4, 0, 0, Math.PI * 2); ctx.fill();

    // --- golf club (drawn behind body when swinging back) ---
    drawClub(g.swing, 1);

    // --- legs ---
    ctx.strokeStyle = '#e2e8f5';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-3, 8); ctx.lineTo(-5, 23); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 8);  ctx.lineTo(7, 23); ctx.stroke();
    // boot soles
    ctx.strokeStyle = '#8b98ad';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-8, 23); ctx.lineTo(-2, 23); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, 23);  ctx.lineTo(11, 23); ctx.stroke();

    // --- suit torso ---
    const suit = ctx.createLinearGradient(-12, -14, 12, 14);
    suit.addColorStop(0, '#ffffff');
    suit.addColorStop(0.5, '#e6ebf5');
    suit.addColorStop(1, '#b9c2d4');
    ctx.fillStyle = suit;
    roundRect(-11, -12, 22, 22, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    roundRect(-11, -12, 22, 22, 8); ctx.stroke();

    // chest pack / mission patch
    ctx.fillStyle = '#42506b';
    roundRect(-6, -8, 12, 8, 2); ctx.fill();
    ctx.fillStyle = '#ffd479';
    ctx.beginPath(); ctx.arc(-2, -4, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6ee7ff';
    ctx.beginPath(); ctx.arc(2, -4, 1.6, 0, Math.PI * 2); ctx.fill();

    // --- arms ---
    const swingA = -0.9 + g.swing * 2.4;    // radians
    ctx.strokeStyle = '#e8edf7';
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    // back arm
    ctx.save();
    ctx.translate(-6, -6);
    ctx.rotate(-0.5);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 11); ctx.stroke();
    ctx.restore();
    // front arm on club
    ctx.save();
    ctx.translate(7, -6);
    ctx.rotate(swingA * 0.55);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 11); ctx.stroke();
    ctx.restore();

    // --- helmet ---
    ctx.fillStyle = '#f4f7ff';
    ctx.beginPath(); ctx.arc(0, -20, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    // visor — gold, facing the tower (right)
    const visor = ctx.createLinearGradient(-6, -26, 8, -14);
    visor.addColorStop(0, '#8f6a1f');
    visor.addColorStop(0.5, '#ffd479');
    visor.addColorStop(1, '#7d5a18');
    ctx.fillStyle = visor;
    ctx.beginPath();
    ctx.ellipse(2.5, -20, 8, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // visor glint
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(-0.5, -23, 2.4, 1.6, -0.5, 0, Math.PI * 2); ctx.fill();
    // antenna nub
    ctx.strokeStyle = '#cfd6e6'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-6, -29); ctx.lineTo(-9, -34); ctx.stroke();

    // --- celebration sparks ---
    if (g.cheer > 0.05) {
      ctx.globalAlpha = g.cheer;
      for (let i = 0; i < 4; i++) {
        const a = S.t * 6 + i * 1.6;
        const px = Math.cos(a) * (18 + i * 2);
        const py = -34 + Math.sin(a * 1.3) * 5;
        ctx.fillStyle = i % 2 ? '#ffd479' : '#6ee7ff';
        ctx.beginPath(); ctx.arc(px, py, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // --- the flying golf ball (world-ish screen space) ---
    if (S.ball) {
      const b = S.ball;
      ctx.save();
      ctx.globalAlpha = clamp(b.life, 0, 1);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120,200,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawClub(swing, dir) {
    // club rotates from backswing (-1) to follow-through (+1)
    const a = -1.1 + swing * 2.6;
    ctx.save();
    ctx.translate(7, -4);
    ctx.rotate(a);
    ctx.strokeStyle = '#c8d0e0';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 30); ctx.stroke();
    // club head
    ctx.fillStyle = '#b9c2d4';
    roundRect(-4, 29, 9, 5, 2); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of S.particles) {
      ctx.globalAlpha = clamp(p.life * 1.6, 0, 1);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    for (const d of S.dust) {
      ctx.globalAlpha = clamp(d.life, 0, 1) * 0.7;
      ctx.fillStyle = d.c + '0.8)';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.28, W / 2, H * 0.5, H * 0.9);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawCollapseFlash() {
    if (S.mode !== 'collapsing') return;
    const a = clamp(Math.abs(Math.sin(S.t * 5)) * 0.18, 0, 0.18);
    ctx.fillStyle = `rgba(255,60,90,${a})`;
    ctx.fillRect(0, 0, W, H);
  }

  // ============================================================
  //  DRAW HELPERS
  // ============================================================
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shade(hex, f) {
    // hex like #rrggbb
    const c = hex.replace('#', '');
    let r = parseInt(c.substr(0, 2), 16);
    let g = parseInt(c.substr(2, 2), 16);
    let b = parseInt(c.substr(4, 2), 16);
    r = clamp(Math.round(r * f), 0, 255);
    g = clamp(Math.round(g * f), 0, 255);
    b = clamp(Math.round(b * f), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  // ============================================================
  //  HUD / FLOW
  // ============================================================
  function updateHUD() {
    el.height.textContent = Math.max(0, S.stack.length - 1);
    el.score.textContent = S.score;
  }

  function startGame() {
    Audio_.resume();
    Audio_.click();
    reset();
    S.mode = 'playing';
    el.overlay.classList.add('hidden');
    el.gameover.classList.add('hidden');
    Audio_.start();
    Audio_.startHum();
    updateHUD();
  }

  function die() {
    S.mode = 'over';
    Audio_.stopHum();
    Audio_.gameOver();
    const h = Math.max(0, S.stack.length - 1);
    if (h > S.best) { S.best = h; localStorage.setItem(BEST_KEY, S.best); S.note = 'NEW HEIGHT RECORD!'; }
    if (S.score > S.bestScore) { S.bestScore = S.score; localStorage.setItem(SCORE_KEY, S.bestScore); S.note = 'NEW SCORE RECORD!'; }
    updateHUD();
    el.finalHeight.textContent = h;
    el.finalNote.innerHTML = `${S.note || '&nbsp;'}<br>score ${S.score} · best streak ${S.maxCombo}`;
    el.gameover.classList.remove('hidden');
  }

  // ============================================================
  //  LOOP
  // ============================================================
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ============================================================
  //  EVENTS
  // ============================================================
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); drop(); });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); drop(); }
  });
  el.startBtn.addEventListener('click', e => { e.stopPropagation(); startGame(); });
  el.retryBtn.addEventListener('click', e => { e.stopPropagation(); startGame(); });
  el.muteBtn.addEventListener('click', e => {
    e.stopPropagation();
    Audio_.resume();
    Audio_.setMuted(!Audio_.muted);
    el.muteBtn.textContent = 'SOUND: ' + (Audio_.muted ? 'OFF' : 'ON');
  });

  // boot
  reset();
  S.mode = 'menu';
  updateHUD();
  requestAnimationFrame(loop);

  // Debug/test hook (harmless in production): lets a harness read state.
  window.__MT = {
    S,
    drop,
    start: startGame,
    top: topModule,
    get active() { return S.active; },
  };
})();
