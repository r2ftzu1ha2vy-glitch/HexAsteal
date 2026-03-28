// =========== FIREBASE IMPORTS (add to top of game.js) ===========
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, off } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// =========== FIREBASE CONFIG (REPLACE WITH YOUR CONFIG) ===========
const firebaseConfig = {
  apiKey: "AIzaSyCzTi3UMtCQPm4kXdtAqOzv-zyt1HDsBqo",
  authDomain: "hexasteal.firebaseapp.com",
  projectId: "hexasteal",
  databaseURL: "https://hexasteal-default-rtdb.firebaseio.com/",
  storageBucket: "hexasteal.firebasestorage.app",
  messagingSenderId: "390872116524",
  appId: "1:390872116524:web:67fcc0a61b3f0a7ad8d089"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// =========== GLOBAL FIREBASE VARIABLES ===========
let dbRef = null;
let roomCode = null;
let lastSeenMsgId = null;
let moveListener = null;
let statusListener = null;
let roomListener = null;
const HexAsteal = (function () {
  'use strict';

  // =========== CONSTANTS ===========
  const COLS = 9, ROWS = 7, HEX_R = 30, MAX_POWER = 9, TOTAL_STAGES = 30;
  const HEX_W = Math.sqrt(3) * HEX_R, ROW_H = HEX_R * 1.5;
  const PAD_X = HEX_W / 2 + 14, PAD_Y = HEX_R + 14;
  const PLAYER = 'player', ENEMY = 'enemy', NEUTRAL = 'neutral', BLOCKED = 'blocked';
  const PLAYER2 = 'player2'; // local/online P2
  const DIRS_EVEN = [[-1,-1],[-1,0],[0,1],[1,0],[1,-1],[0,-1]];
  const DIRS_ODD  = [[-1,0],[-1,1],[0,1],[1,1],[1,0],[0,-1]];

  const POWERUPS = {
    surge:  { icon: '⚡' },
    shield: { icon: '🛡' },
    drain:  { icon: '💀' },
    blaze:  { icon: '🔥' },
    freeze: { icon: '❄' },
    spread: { icon: '🌀' }
  };
  const PU_KEYS = Object.keys(POWERUPS);

  // =========== GAME MODE ===========
  // 'ai' | 'local' | 'online'
  let gameMode = 'ai';
  // For local: whose turn — PLAYER or PLAYER2
  let localTurn = PLAYER;
  // For online: which side am I? PLAYER (host) or PLAYER2 (guest)
  let onlineSide = PLAYER;
  let onlineRoomCode = null;

  // =========== ONLINE RELAY (Gun.js + BroadcastChannel fallback) ===========
  // Uses Gun.js decentralized real-time DB — no backend, works cross-device
  let gun = null;
  let gunRoom = null;
  let pollInterval = null;
  let lastSeenMsgId = null;
  let onlineReady = false;

  // =========== SOUND ENGINE ===========
  const SFX = {
    ctx: null, on: true,
    go() {
      if (!this.on) return false;
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    },
    osc(freq, dur, type, vol, freqEnd) {
      if (!this.go()) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur);
    },
    noise(dur, vol) {
      if (!this.go()) return;
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, sr * dur, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      s.buffer = buf;
      g.gain.setValueAtTime(vol || 0.1, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      s.connect(g); g.connect(this.ctx.destination); s.start();
    },
    select()   { this.osc(880, 0.08, 'sine', 0.12); },
    deselect() { this.osc(440, 0.06, 'sine', 0.08); },
    attack()   { this.osc(200, 0.15, 'sawtooth', 0.18, 80); this.noise(0.06, 0.1); },
    capture()  {
      this.osc(523, 0.1, 'sine', 0.18);
      setTimeout(() => this.osc(659, 0.1, 'sine', 0.18), 70);
      setTimeout(() => this.osc(784, 0.12, 'sine', 0.22), 140);
    },
    fail()     { this.osc(300, 0.25, 'sawtooth', 0.12, 100); },
    powerup()  {
      this.osc(600, 0.07, 'sine', 0.18);
      setTimeout(() => this.osc(900, 0.07, 'sine', 0.18), 50);
      setTimeout(() => this.osc(1200, 0.1, 'sine', 0.2), 100);
    },
    grow() { this.osc(330, 0.03, 'sine', 0.02); },
    click() { this.osc(660, 0.03, 'square', 0.06); },
    victory() {
      [523,587,659,784,1047].forEach((f,i) =>
        setTimeout(() => this.osc(f, 0.18, 'sine', 0.18), i * 90));
    },
    defeat() {
      [400,350,300,250,200].forEach((f,i) =>
        setTimeout(() => this.osc(f, 0.22, 'sawtooth', 0.1), i * 120));
    },
    bossIntro() {
      this.osc(55, 1.5, 'sawtooth', 0.25, 35);
      this.osc(58, 1.5, 'sawtooth', 0.18, 38);
      setTimeout(() => { this.noise(0.3, 0.18); this.osc(80, 0.4, 'square', 0.12); }, 800);
    },
    bossDefeat() {
      this.osc(100, 0.3, 'sawtooth', 0.25, 50);
      setTimeout(() => this.noise(0.4, 0.25), 200);
      setTimeout(() => this.victory(), 600);
    },
    aiMove() { this.osc(150, 0.04, 'square', 0.04); },
    stageStart() {
      this.osc(440, 0.08, 'sine', 0.12);
      setTimeout(() => this.osc(660, 0.12, 'sine', 0.15), 70);
    },
    transfer() {
      this.osc(440, 0.08, 'sine', 0.1);
      setTimeout(() => this.osc(660, 0.08, 'sine', 0.1), 60);
      setTimeout(() => this.osc(550, 0.1, 'sine', 0.12), 120);
    }
  };

  // =========== TUTORIAL ===========
  const TUT = [
    { icon: '⬡', title: 'Welcome to HexAsteal!', text: 'A turn-based hex territory conquest game. Outsmart the enemy, capture power-ups, and conquer the board!' },
    { icon: '🟢', title: 'Your Territory', text: 'Green hexes are yours. Each shows a power level (1–9). Grow your army and dominate!' },
    { icon: '👆', title: 'Select & Attack', text: 'Click one of your hexes, then click an adjacent enemy or neutral hex to attack it.' },
    { icon: '🔄', title: 'Transfer Power', text: 'Click your hex, then an adjacent friendly hex to give it power. Source keeps 1, target gains the rest (max 9).' },
    { icon: '⚔️', title: 'Power Wins', text: 'Your power must be HIGHER than the target. Winner keeps the difference. Equal power? Attacker just loses 1.' },
    { icon: '📈', title: 'Growth Phase', text: 'Every turn, all your hexes gain +1 power (max 9). Build up before striking!' },
    { icon: '🎨', title: 'Power-Ups!', text: 'Colored hexes have power-ups: Surge (+3), Shield, Drain, Blaze (2×), Freeze, and Spread. Race to grab them!' },
    { icon: '▲', title: 'Mountains', text: 'Dark hexes with ▲ are impassable. Use them as cover and chokepoints!' },
    { icon: '👹', title: 'Boss Battles', text: 'Every 10th stage is a boss fight against HexAforce! Defeat the demon\'s mega-hex to win.' },
    { icon: '🏆', title: 'Ready?', text: 'Capture all enemy hexes or have the most power when turns run out. Good luck, commander!' }
  ];

  // =========== STAGE CONFIG ===========
  function stageConfig(s) {
    const isBoss = s > 0 && s % 10 === 0;
    const tier = Math.min(Math.floor((s - 1) / 10), 2);
    const p = ((s - 1) % 10) / 9;
    if (isBoss) return {
      maxTurns: [35, 30, 28][tier],
      eHexes: [5, 7, 9][tier],
      ePow: [4, 5, 6][tier],
      pPow: 4,
      blocked: [3, 4, 4][tier],
      pups: 6,
      isBoss: true,
      bossPow: [7, 8, 9][tier],
      bossRegen: 2,
      bossName: ['HEXAFORCE', 'HEXAFORCE II', 'HEXAFORCE SUPREME'][tier]
    };
    return {
      maxTurns: Math.round(40 - tier * 4 - p * 3),
      eHexes: Math.min(Math.round(4 + tier * 1.5 + p * 1.5), 8),
      ePow: Math.min(Math.round(3 + tier * 0.7 + p * 0.8), 7),
      pPow: Math.min(3 + Math.floor(tier * 0.5), 5),
      blocked: Math.min(Math.round(4 + tier + p * 1.5), 8),
      pups: Math.max(Math.round(8 - tier - p * 1.5), 4),
      isBoss: false, bossPow: 0, bossRegen: 1, bossName: null
    };
  }

  // Multiplayer always uses a fixed balanced config
  function mpConfig() {
    return { maxTurns: 50, eHexes: 4, ePow: 4, pPow: 4, blocked: 5, pups: 8,
             isBoss: false, bossPow: 0, bossRegen: 1, bossName: null };
  }

  // =========== PROGRESS ===========
  const SAVE_KEY = 'hexasteal_v1';
  let progress = { stage: 1, completed: [], tutDone: false, soundOn: true };

  function loadProgress() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d) progress = { ...progress, ...d };
    } catch {}
    SFX.on = progress.soundOn;
  }
  function saveProgress() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  }

  // =========== STATE ===========
  let grid = [], turn = 1, phase = 'select';
  let selectedHex = null, validTargets = [], transferTargets = [], hexEls = {};
  let animating = false, currentStage = 1, cfg = stageConfig(1), tutStep = 0;

  // =========== DOM REFS ===========
  let svgEl, statusEl, turnEl, turnMaxEl, stageNumEl, bossBadge, boardEl;
  let pHexesEl, pPowerEl, eHexesEl, ePowerEl, foeLabel, enemyDot, btnSkip, btnSound;
  let pLabel;
  let tutOverlay, tutIcon, tutTitle, tutText, tutDots, tutNextBtn;
  let bossOverlay, bossNameEl, bossSubEl;
  let stagesOverlay, stageGridEl;
  let goOverlay, resultTitle, resultDesc, btnNext, btnRetry;
  let modeOverlay, onlineOverlay, localTurnBanner;

  // =========== HEX GEOMETRY ===========
  function hexCenter(r, c) {
    return [PAD_X + c * HEX_W + (r % 2 === 1 ? HEX_W / 2 : 0), PAD_Y + r * ROW_H];
  }
  function hexPoints(cx, cy) {
    let pts = '';
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i - Math.PI / 2;
      pts += `${(cx + HEX_R * Math.cos(a)).toFixed(1)},${(cy + HEX_R * Math.sin(a)).toFixed(1)} `;
    }
    return pts.trim();
  }
  function getNeighbors(r, c) {
    const dirs = r % 2 === 0 ? DIRS_EVEN : DIRS_ODD;
    return dirs.map(([dr, dc]) => [r + dr, c + dc])
      .filter(([nr, nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc].owner !== BLOCKED);
  }
  function getAttackTargets(r, c) {
    const owner = grid[r][c].owner;
    return getNeighbors(r, c).filter(([nr, nc]) => grid[nr][nc].owner !== owner);
  }
  function getTransferTargets(r, c) {
    if (grid[r][c].power <= 1) return [];
    return getNeighbors(r, c).filter(([nr, nc]) => grid[nr][nc].owner === grid[r][c].owner);
  }

  // Helper: whose owner token for current active player
  function activeOwner() {
    if (gameMode === 'local') return localTurn;
    if (gameMode === 'online') return onlineSide;
    return PLAYER;
  }
  // Helper: the opponent owner for the active player
  function opponentOwner() {
    const ao = activeOwner();
    if (gameMode === 'ai') return ENEMY;
    return ao === PLAYER ? PLAYER2 : PLAYER;
  }

  // =========== MAP GENERATION ===========
  function randInt(n) { return Math.floor(Math.random() * n); }
  function makeCell(owner, power) {
    return { owner, power, powerup: null, blazeBuffed: false, shielded: false, frozen: false, boss: false };
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generateMap() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (let c = 0; c < COLS; c++) grid[r][c] = makeCell(NEUTRAL, 1 + randInt(4));
    }

    const isMP = gameMode !== 'ai';
    // Player 1 cluster — bottom-left
    const pStarts = [[5,0],[5,1],[6,0],[6,1]];
    pStarts.forEach(([r,c]) => { grid[r][c] = makeCell(PLAYER, cfg.pPow + randInt(2)); });

    if (isMP) {
      // Player 2 — top-right (mirror)
      const p2Starts = [[0,7],[0,8],[1,7],[1,8]];
      p2Starts.forEach(([r,c]) => { grid[r][c] = makeCell(PLAYER2, cfg.pPow + randInt(2)); });
    } else if (cfg.isBoss) {
      // Boss hex at center
      const br = 3, bc = 4;
      grid[br][bc] = makeCell(ENEMY, cfg.bossPow);
      grid[br][bc].boss = true;
      const bDirs = br % 2 === 0 ? DIRS_EVEN : DIRS_ODD;
      const bNeigh = shuffle(bDirs.map(([dr,dc]) => [br+dr, bc+dc])
        .filter(([r,c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS));
      let need = cfg.eHexes - 1;
      for (const [r, c] of bNeigh) {
        if (need <= 0) break;
        if (grid[r][c].owner === NEUTRAL) { grid[r][c] = makeCell(ENEMY, cfg.ePow + randInt(2)); need--; }
      }
      if (need > 0) {
        for (const [r, c] of bNeigh) {
          if (need <= 0) break;
          const n2 = getNeighbors(r, c);
          for (const [nr, nc] of shuffle(n2)) {
            if (need <= 0) break;
            if (grid[nr][nc].owner === NEUTRAL) { grid[nr][nc] = makeCell(ENEMY, cfg.ePow + randInt(2)); need--; }
          }
        }
      }
    } else {
      // Normal AI: enemy cluster top-right
      const ePrimary = [[0,7],[0,8],[1,7],[1,8]];
      const used = new Set(ePrimary.map(([r,c]) => `${r},${c}`));
      ePrimary.forEach(([r,c]) => { grid[r][c] = makeCell(ENEMY, cfg.ePow + randInt(2)); });
      let need = cfg.eHexes - ePrimary.length;
      if (need > 0) {
        const extras = [];
        for (let r = 0; r < 4; r++)
          for (let c = COLS - 4; c < COLS; c++) extras.push([r,c]);
        shuffle(extras);
        for (const [r, c] of extras) {
          if (need <= 0) break;
          if (used.has(`${r},${c}`) || grid[r][c].owner !== NEUTRAL) continue;
          grid[r][c] = makeCell(ENEMY, cfg.ePow + randInt(2)); used.add(`${r},${c}`); need--;
        }
      }
    }

    // Mountains
    let placed = 0, att = 0;
    while (placed < cfg.blocked && att < 300) {
      att++;
      const r = randInt(ROWS), c = randInt(COLS);
      if (grid[r][c].owner !== NEUTRAL) continue;
      const nearP = pStarts.some(([sr,sc]) => Math.abs(r-sr)+Math.abs(c-sc) <= 2);
      const nearB = cfg.isBoss && Math.abs(r-3)+Math.abs(c-4) <= 2;
      if (nearP || nearB) continue;
      grid[r][c] = makeCell(BLOCKED, 0);
      placed++;
    }

    // Power-ups
    const neutrals = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c].owner === NEUTRAL) neutrals.push([r, c]);
    shuffle(neutrals);
    const numPU = Math.min(cfg.pups, neutrals.length);
    for (let i = 0; i < numPU; i++) {
      const [r, c] = neutrals[i];
      grid[r][c].powerup = PU_KEYS[i % PU_KEYS.length];
    }
  }

  // =========== SVG BOARD ===========
  function createBoard() {
    const NS = 'http://www.w3.org/2000/svg';
    svgEl.innerHTML = '';
    hexEls = {};

    const defs = document.createElementNS(NS, 'defs');
    ['glow-player:#22c55e:3','glow-player2:#3b82f6:3','glow-enemy:#ef4444:3',
     'glow-select:#fbbf24:5','glow-boss:#ff0000:6','glow-surge:#22d3ee:4',
     'glow-shield:#a8a29e:4','glow-drain:#a855f7:4','glow-blaze:#f97316:4',
     'glow-freeze:#7dd3fc:4','glow-spread:#f472b6:4'].forEach(s => {
      const [id, color, rad] = s.split(':');
      defs.appendChild(makeGlow(NS, id, color, +rad));
    });
    svgEl.appendChild(defs);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const [cx, cy] = hexCenter(r, c);
        const g = document.createElementNS(NS, 'g');
        const poly = document.createElementNS(NS, 'polygon');
        poly.setAttribute('points', hexPoints(cx, cy));

        if (grid[r][c].owner === BLOCKED) {
          poly.setAttribute('class', 'hex hex-blocked');
          g.appendChild(poly);
          const ico = document.createElementNS(NS, 'text');
          ico.setAttribute('x', cx); ico.setAttribute('y', cy);
          ico.setAttribute('dy', '0.38em'); ico.setAttribute('class', 'hex-icon');
          ico.textContent = '▲';
          g.appendChild(ico);
          svgEl.appendChild(g);
          continue;
        }

        poly.setAttribute('class', 'hex');
        g.setAttribute('data-r', r); g.setAttribute('data-c', c);
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => handleClick(r, c));

        const txt = document.createElementNS(NS, 'text');
        txt.setAttribute('x', cx); txt.setAttribute('y', cy);
        txt.setAttribute('dy', '0.05em'); txt.setAttribute('class', 'hex-text');

        const puIcon = document.createElementNS(NS, 'text');
        puIcon.setAttribute('x', cx); puIcon.setAttribute('y', cy);
        puIcon.setAttribute('dy', '1.6em'); puIcon.setAttribute('class', 'hex-powerup-icon');

        const statusIcon = document.createElementNS(NS, 'text');
        statusIcon.setAttribute('x', cx); statusIcon.setAttribute('y', cy);
        statusIcon.setAttribute('dy', '-0.9em'); statusIcon.setAttribute('class', 'hex-powerup-icon');

        const bossIcon = document.createElementNS(NS, 'text');
        bossIcon.setAttribute('x', cx); bossIcon.setAttribute('y', cy);
        bossIcon.setAttribute('dy', '1.6em'); bossIcon.setAttribute('class', 'boss-hex-icon');

        g.appendChild(poly); g.appendChild(txt);
        g.appendChild(puIcon); g.appendChild(statusIcon); g.appendChild(bossIcon);
        svgEl.appendChild(g);
        hexEls[`${r},${c}`] = { group: g, polygon: poly, text: txt, puIcon, statusIcon, bossIcon };
      }
    }

    let maxX = 0, maxY = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const [cx, cy] = hexCenter(r, c);
      if (cx > maxX) maxX = cx; if (cy > maxY) maxY = cy;
    }
    svgEl.setAttribute('viewBox', `0 0 ${Math.ceil(maxX + PAD_X)} ${Math.ceil(maxY + PAD_Y)}`);
  }

  function makeGlow(ns, id, color, radius) {
    const f = document.createElementNS(ns, 'filter');
    f.setAttribute('id', id); f.setAttribute('x', '-50%'); f.setAttribute('y', '-50%');
    f.setAttribute('width', '200%'); f.setAttribute('height', '200%');
    const flood = document.createElementNS(ns, 'feFlood');
    flood.setAttribute('flood-color', color); flood.setAttribute('flood-opacity', '0.6');
    flood.setAttribute('result', 'flood');
    const comp = document.createElementNS(ns, 'feComposite');
    comp.setAttribute('in', 'flood'); comp.setAttribute('in2', 'SourceGraphic');
    comp.setAttribute('operator', 'in'); comp.setAttribute('result', 'mask');
    const blur = document.createElementNS(ns, 'feGaussianBlur');
    blur.setAttribute('in', 'mask'); blur.setAttribute('stdDeviation', radius);
    blur.setAttribute('result', 'blurred');
    const merge = document.createElementNS(ns, 'feMerge');
    const m1 = document.createElementNS(ns, 'feMergeNode'); m1.setAttribute('in', 'blurred');
    const m2 = document.createElementNS(ns, 'feMergeNode'); m2.setAttribute('in', 'SourceGraphic');
    merge.appendChild(m1); merge.appendChild(m2);
    f.appendChild(flood); f.appendChild(comp); f.appendChild(blur); f.appendChild(merge);
    return f;
  }

  // =========== RENDERING ===========
  function render() {
    const ao = activeOwner();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const key = `${r},${c}`;
        if (!hexEls[key]) continue;
        const cell = grid[r][c], el = hexEls[key];
        let cls = 'hex';

        if (cell.powerup && cell.owner === NEUTRAL) cls += ` hex-powerup-${cell.powerup}`;
        else cls += ` hex-${cell.owner}`;

        if (cell.boss && cell.owner === ENEMY) cls += ' hex-boss';
        if (cell.blazeBuffed) cls += ' hex-blaze-buffed';
        if (cell.shielded) cls += ' hex-shielded';
        if (cell.frozen) cls += ' hex-frozen';

        if (selectedHex && selectedHex[0] === r && selectedHex[1] === c) {
          cls += ' hex-selected';
          if (ao === PLAYER2) cls += ' p2-selected';
        } else if (isValidTarget(r, c)) cls += ' hex-valid-target';
        else if (isTransferTarget(r, c)) cls += ' hex-transfer-target';
        else if (phase === 'select' && cell.owner === ao && !cell.frozen &&
          (getAttackTargets(r, c).length > 0 || getTransferTargets(r, c).length > 0)) {
          cls += ' hex-selectable';
          if (ao === PLAYER2) cls += ' p2-selectable';
        }

        el.polygon.setAttribute('class', cls);
        el.text.textContent = cell.power;

        if (cell.powerup && cell.owner === NEUTRAL) {
          el.puIcon.textContent = POWERUPS[cell.powerup].icon;
          if (!cls.includes('hex-valid-target') && !cls.includes('hex-selected'))
            el.polygon.style.filter = `url(#glow-${cell.powerup})`;
          else el.polygon.style.filter = '';
        } else {
          el.puIcon.textContent = '';
          if (!cls.includes('hex-selected') && !cls.includes('hex-selectable') && !cls.includes('hex-boss'))
            el.polygon.style.filter = '';
        }

        el.bossIcon.textContent = (cell.boss && cell.owner === ENEMY) ? '👹' : '';
        if (cell.boss && cell.owner === ENEMY) el.polygon.style.filter = 'url(#glow-boss)';

        let st = '';
        if (cell.blazeBuffed) st += '🔥';
        if (cell.shielded) st += '🛡';
        if (cell.frozen) st += '❄';
        el.statusIcon.textContent = st;
      }
    }
    updateHUD();
    btnSkip.disabled = (phase !== 'select' && phase !== 'target');

    // Board bg for local P2 turn
    if (gameMode === 'local') {
      boardEl.classList.toggle('p2-turn', localTurn === PLAYER2);
    }
  }

  function isValidTarget(r, c)    { return validTargets.some(([vr,vc]) => vr===r && vc===c); }
  function isTransferTarget(r, c) { return transferTargets.some(([vr,vc]) => vr===r && vc===c); }

  function updateHUD() {
    let pH = 0, pP = 0, eH = 0, eP = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = grid[r][c];
      // "player" side = PLAYER always
      if (cell.owner === PLAYER) { pH++; pP += cell.power; }
      // "enemy" side = ENEMY or PLAYER2
      if (cell.owner === ENEMY || cell.owner === PLAYER2) { eH++; eP += cell.power; }
    }
    turnEl.textContent = turn;
    turnMaxEl.textContent = '/ ' + cfg.maxTurns;
    stageNumEl.textContent = gameMode === 'ai' ? currentStage : (gameMode === 'local' ? 'L2P' : 'NET');
    pHexesEl.textContent = pH; pPowerEl.textContent = pP;
    eHexesEl.textContent = eH; ePowerEl.textContent = eP;

    // HUD labels
    if (gameMode === 'local') {
      pLabel.textContent = 'P1';
      foeLabel.textContent = 'P2';
      enemyDot.className = 'color-dot player2-dot';
    } else if (gameMode === 'online') {
      pLabel.textContent = onlineSide === PLAYER ? 'YOU' : 'OPP';
      foeLabel.textContent = onlineSide === PLAYER ? 'OPP' : 'YOU';
      enemyDot.className = 'color-dot player2-dot';
    } else {
      pLabel.textContent = 'YOU';
      foeLabel.textContent = cfg.isBoss ? (cfg.bossName || 'BOSS') : 'FOE';
      enemyDot.className = 'color-dot enemy-dot';
    }

    if (cfg.isBoss && gameMode === 'ai') {
      bossBadge.classList.remove('hidden');
      boardEl.classList.add('boss-mode');
    } else {
      bossBadge.classList.add('hidden');
      boardEl.classList.remove('boss-mode');
    }
  }

  // =========== TUTORIAL ===========
  function showTutorial() {
    tutStep = 0; renderTutStep();
    tutOverlay.classList.remove('hidden');
  }
  function renderTutStep() {
    const s = TUT[tutStep];
    tutIcon.textContent = s.icon; tutTitle.textContent = s.title; tutText.textContent = s.text;
    tutNextBtn.textContent = tutStep === TUT.length - 1 ? '🎮 Play!' : 'Next →';
    tutDots.innerHTML = '';
    TUT.forEach((_, i) => {
      const d = document.createElement('span');
      d.className = 'tut-dot' + (i === tutStep ? ' active' : i < tutStep ? ' done' : '');
      tutDots.appendChild(d);
    });
  }
  function nextTutorial() {
    SFX.click(); tutStep++;
    if (tutStep >= TUT.length) {
      tutOverlay.classList.add('hidden');
      progress.tutDone = true; saveProgress();
      startStage(progress.stage); return;
    }
    renderTutStep();
  }
  function skipTutorial() {
    SFX.click(); tutOverlay.classList.add('hidden');
    progress.tutDone = true; saveProgress();
    startStage(progress.stage);
  }
  function replayTutorial() {
    SFX.click(); stagesOverlay.classList.add('hidden'); showTutorial();
  }

  // =========== BOSS INTRO ===========
  function showBossIntro() {
    bossNameEl.textContent = cfg.bossName;
    bossSubEl.textContent = `Stage ${currentStage} — Boss Battle`;
    bossOverlay.classList.remove('hidden'); SFX.bossIntro();
  }
  function startBoss() {
    SFX.click(); bossOverlay.classList.add('hidden'); generateAndPlay();
  }

  // =========== STAGE SELECT ===========
  function showStages() {
    SFX.click();
    if (gameMode !== 'ai') { setStatus('Stage select is only available in vs Computer mode.'); return; }
    stageGridEl.innerHTML = '';
    for (let s = 1; s <= TOTAL_STAGES; s++) {
      const cell = document.createElement('div');
      cell.className = 'stage-cell';
      const done = progress.completed.includes(s);
      const curr = s === progress.stage;
      const locked = s > progress.stage;
      const boss = s % 10 === 0;
      if (done) cell.classList.add('completed');
      if (curr) cell.classList.add('current');
      if (locked) cell.classList.add('locked');
      if (boss) cell.classList.add('boss-stage');
      cell.innerHTML = boss
        ? `<span class="stage-boss-icon">👹</span><span class="stage-num">${s}</span>`
        : `<span class="stage-num">${s}</span>`;
      if (!locked) {
        cell.addEventListener('click', () => {
          SFX.click(); stagesOverlay.classList.add('hidden'); startStage(s);
        });
      }
      stageGridEl.appendChild(cell);
    }
    stagesOverlay.classList.remove('hidden');
  }
  function closeStages() { SFX.click(); stagesOverlay.classList.add('hidden'); }

  // =========== MODE SELECT ===========
  function showModeSelect() {
    SFX.click();
    // Highlight active mode
    document.getElementById('mode-btn-ai').classList.toggle('active', gameMode === 'ai');
    document.getElementById('mode-btn-local').classList.toggle('active', gameMode === 'local');
    document.getElementById('mode-btn-online').classList.toggle('active', gameMode === 'online');
    modeOverlay.classList.remove('hidden');
  }
  function closeModeSelect() { SFX.click(); modeOverlay.classList.add('hidden'); }

  function selectMode(mode) {
    SFX.click();
    modeOverlay.classList.add('hidden');
    if (mode === gameMode) return; // no change, just close

    gameMode = mode;
    if (mode === 'ai') {
      cleanupOnline();
      startStage(progress.stage);
    } else if (mode === 'local') {
      cleanupOnline();
      startLocalGame();
    } else if (mode === 'online') {
      showOnlineLobby();
    }
  }

  // =========== LOCAL 2P ===========
  function startLocalGame() {
    gameMode = 'local';
    cfg = mpConfig();
    localTurn = PLAYER;
    hideAllOverlays();
    generateAndPlay();
  }

  // Show the pass-and-play banner
  function showLocalTurnBanner() {
    const banner = localTurnBanner;
    const icon = document.getElementById('local-banner-icon');
    const title = document.getElementById('local-banner-title');
    const sub = document.getElementById('local-banner-sub');

    if (localTurn === PLAYER) {
      icon.textContent = '🟢';
      title.textContent = "Player 1's Turn";
      sub.textContent = 'Pass the device to Player 1';
    } else {
      icon.textContent = '🔵';
      title.textContent = "Player 2's Turn";
      sub.textContent = 'Pass the device to Player 2';
    }
    banner.classList.remove('hidden');
  }
  function dismissLocalBanner() {
    SFX.click();
    localTurnBanner.classList.add('hidden');
    phase = 'select';
    const who = localTurn === PLAYER ? 'Player 1 (green)' : 'Player 2 (blue)';
    setStatus(`${who} — select a hex to attack or 🔄 transfer`);
    render();
  }

  // =========== ONLINE MULTIPLAYER (Gun.js relay) ===========
  // Gun.js is a decentralized real-time graph DB that works purely in-browser,
  // no backend required. Falls back to public relay peers automatically.

  function loadGun(cb) {
    if (window.Gun) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/gun/gun.js';
    s.onload = cb;
    s.onerror = () => setOnlineStatus('Network error loading relay. Check connection.', 'error');
    document.head.appendChild(s);
  }

  function initGun() {
    if (gun) return;
    // Use multiple public Gun relay peers for reliability
    gun = Gun({
      peers: [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://peer.wallie.io/gun',
        'https://relay.peer.ooo/gun'
      ],
      localStorage: false
    });
  }

  function showOnlineLobby() {
    onlineOverlay.classList.remove('hidden');
    showCreateJoin();
  }

  function showCreateJoin() {
    document.getElementById('online-create-join').classList.remove('hidden');
    document.getElementById('online-join-form').classList.add('hidden');
    document.getElementById('online-waiting').classList.add('hidden');
    document.getElementById('online-connecting').classList.add('hidden');
    document.getElementById('online-back-btn').style.display = '';
  }

  function showJoinRoom() {
    SFX.click();
    document.getElementById('online-create-join').classList.add('hidden');
    document.getElementById('online-join-form').classList.remove('hidden');
    document.getElementById('online-back-btn').style.display = '';
    setTimeout(() => document.getElementById('cd0').focus(), 100);
    setupCodeInputs();
  }

  function setupCodeInputs() {
    for (let i = 0; i < 4; i++) {
      const el = document.getElementById(`cd${i}`);
      el.value = '';
      el.oninput = () => {
        el.value = el.value.replace(/[^0-9]/g, '').slice(-1);
        if (el.value && i < 3) document.getElementById(`cd${i+1}`).focus();
      };
      el.onkeydown = (e) => {
        if (e.key === 'Backspace' && !el.value && i > 0) document.getElementById(`cd${i-1}`).focus();
      };
    }
  }

  function onlineCreate() {
  SFX.click();
  document.getElementById('online-create-join').classList.add('hidden');
  document.getElementById('online-waiting').classList.remove('hidden');

  const code = String(Math.floor(1000 + Math.random() * 9000));
  roomCode = code;
  document.getElementById('room-code-big').textContent = code;

  onlineSide = PLAYER;
  dbRef = ref(database, `rooms/${code}`);
  
  set(dbRef, {
    status: 'waiting',
    seed: 0,
    p1: onlineSide,
    ts: Date.now()
  }).catch(err => console.error('Create room error:', err));
  
  // ✅ Store listener reference for cleanup
  const statusRef = ref(database, `rooms/${code}/status`);
  statusListener = onValue(statusRef, (snapshot) => {
    const status = snapshot.val();
    if (status === 'joined' && onlineSide === PLAYER) {
      const seed = (Date.now() & 0xffff) + Math.floor(Math.random() * 1000);
      update(ref(database, `rooms/${code}`), { status: 'started', seed });
      
      document.getElementById('waiting-text').textContent = 'Opponent connected! Starting…';
      
      setTimeout(() => {
        // ✅ Clean up this listener before starting
        if (statusListener) off(statusRef);
        statusListener = null;
        
        document.getElementById('online-overlay').classList.add('hidden');
        startOnlineGame(true, seed);
        startOnlineMoveListener();
      }, 600);
    }
  });
}

function onlineJoin() {
  SFX.click();
  const code = [0,1,2,3].map(i => document.getElementById(`cd${i}`).value).join('');
  
  if (code.length !== 4 || !/^\d{4}$/.test(code)) {
    setOnlineStatus('Enter all 4 digits.', 'error');
    return;
  }

  roomCode = code;
  onlineSide = PLAYER2;
  dbRef = ref(database, `rooms/${code}`);

  let joinTimeout = setTimeout(() => {
    setOnlineStatus('Room not found. Check code.', 'error');
  }, 10000);

  const roomRef = ref(database, `rooms/${code}`);
  
  // ✅ Store listener reference
  roomListener = onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    
    if (!data) {
      clearTimeout(joinTimeout);
      setOnlineStatus('Room not found.', 'error');
      if (roomListener) off(roomRef);
      roomListener = null;
      return;
    }

    clearTimeout(joinTimeout);
    
    update(ref(database, `rooms/${code}`), { status: 'joined' }).catch(err => 
      console.error('Join error:', err)
    );

    if (data.status === 'started') {
      // ✅ Clean up this listener before starting
      if (roomListener) off(roomRef);
      roomListener = null;
      
      document.getElementById('online-overlay').classList.add('hidden');
      startOnlineGame(false, data.seed);
      startOnlineMoveListener();
    }
  });
}

function startOnlineMoveListener() {
  if (!dbRef || !roomCode) return;
  
  const myKey = onlineSide === PLAYER ? 'p2_move' : 'p1_move';
  const moveRef = ref(database, `rooms/${roomCode}/${myKey}`);
  
  // ✅ Store listener reference for cleanup
  moveListener = onValue(moveRef, (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.msgId) return;
    if (data.msgId === lastSeenMsgId) return;

    const isOpponent = data.sender && data.sender !== onlineSide;
    if (!isOpponent) return;

    // ✅ NEW: Validate turn number
    if (data.turn !== turn) {
      console.warn('Turn mismatch:', data.turn, 'vs', turn);
      return;
    }

    lastSeenMsgId = data.msgId;
    handleOnlineMessage(data);
  });
}

// =========== FIX: CANCEL ONLINE ===========
function cancelOnline() {
  SFX.click();
  
  // ✅ Clean up all listeners properly
  if (statusListener && roomCode) {
    try {
      off(ref(database, `rooms/${roomCode}/status`));
    } catch (e) {}
    statusListener = null;
  }
  
  if (roomListener && roomCode) {
    try {
      off(ref(database, `rooms/${roomCode}`));
    } catch (e) {}
    roomListener = null;
  }
  
  if (moveListener && roomCode) {
    try {
      const myKey = onlineSide === PLAYER ? 'p2_move' : 'p1_move';
      off(ref(database, `rooms/${roomCode}/${myKey}`));
    } catch (e) {}
    moveListener = null;
  }
  
  // ✅ Delete room if we're the creator
  if (dbRef && roomCode && onlineSide === PLAYER) {
    set(ref(database, `rooms/${roomCode}`), null).catch(err => 
      console.error('Delete error:', err)
    );
  }
  
  dbRef = null;
  roomCode = null;
  lastSeenMsgId = null;
  
  document.getElementById('online-overlay').classList.add('hidden');
  if (gameMode === 'online') gameMode = 'ai';
}
function sendOnline(msg) {
  if (!dbRef || !roomCode) {
    console.error('No active room');
    return;
  }
  
  const myKey = onlineSide === PLAYER ? 'p1_move' : 'p2_move';
  const msgId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  
  const payload = {
    msgId,
    sender: onlineSide,
    type: msg.type,
    move: msg.move || null,
    turn,
    ts: Date.now()
  };
  
  update(ref(database, `rooms/${roomCode}/${myKey}`), payload).catch(err => {
    console.error('Send move error:', err);
    setStatus('⚠️ Connection error. Retrying…');
  });
}


function handleOnlineMessage(data) {
  if (!data || !data.type) return;
  if (data.sender === onlineSide) return;

  if (data.type === 'move') {
    if (phase !== 'wait-online') {
      console.warn('Wrong phase for move:', phase);
      return;
    }
    applyRemoteMove(data.move);
  }
  else if (data.type === 'skip') {
    if (phase !== 'wait-online') {
      console.warn('Wrong phase for skip:', phase);
      return;
    }
    applyRemoteSkip();
  }
}

  // seeded random for sync
  let _rngSeed = 0;
  function seededRand(n) {
    _rngSeed = (_rngSeed * 1664525 + 1013904223) & 0xffffffff;
    return Math.abs(_rngSeed) % n;
  }

function startOnlineGame(isHost, seed) {
  gameMode = 'online';
  cfg = mpConfig();
  hideAllOverlays();
  turn = 1; 
  phase = 'select';
  selectedHex = null; 
  validTargets = []; 
  transferTargets = []; 
  animating = false;

  const useSeed = seed || (Date.now() & 0xffff);
  generateMapSeeded(useSeed);
  createBoard();

  SFX.stageStart();
  render();

  if (onlineSide === PLAYER) {
    setStatus('🌐 Your turn (🟢 P1) — select a hex to attack or 🔄 transfer');
  } else {
    phase = 'wait-online';
    setStatus('🌐 Waiting for P1 to move…');
  }
  render();
}

  // Map generation using seeded random
  function generateMapSeeded(seed) {
    _rngSeed = seed;
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (let c = 0; c < COLS; c++) grid[r][c] = makeCell(NEUTRAL, 1 + seededRand(4));
    }
    const pStarts = [[5,0],[5,1],[6,0],[6,1]];
    pStarts.forEach(([r,c]) => { grid[r][c] = makeCell(PLAYER, cfg.pPow + seededRand(2)); });
    const p2Starts = [[0,7],[0,8],[1,7],[1,8]];
    p2Starts.forEach(([r,c]) => { grid[r][c] = makeCell(PLAYER2, cfg.pPow + seededRand(2)); });

    let placed = 0, att = 0;
    while (placed < cfg.blocked && att < 300) {
      att++;
      const r = seededRand(ROWS), c = seededRand(COLS);
      if (grid[r][c].owner !== NEUTRAL) continue;
      const nearP = pStarts.some(([sr,sc]) => Math.abs(r-sr)+Math.abs(c-sc) <= 2);
      const nearP2 = p2Starts.some(([sr,sc]) => Math.abs(r-sr)+Math.abs(c-sc) <= 2);
      if (nearP || nearP2) continue;
      grid[r][c] = makeCell(BLOCKED, 0);
      placed++;
    }

    const neutrals = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c].owner === NEUTRAL) neutrals.push([r, c]);
    for (let i = neutrals.length - 1; i > 0; i--) {
      const j = seededRand(i + 1);
      [neutrals[i], neutrals[j]] = [neutrals[j], neutrals[i]];
    }
    const numPU = Math.min(cfg.pups, neutrals.length);
    for (let i = 0; i < numPU; i++) {
      const [r, c] = neutrals[i];
      grid[r][c].powerup = PU_KEYS[i % PU_KEYS.length];
    }
  }

  function applyRemoteMove(move) {
    if (!move) return;
    animating = true;
    if (move.type === 'transfer') {
      const src = grid[move.sr][move.sc], dst = grid[move.dr][move.dc];
      if (!src || !dst) { animating = false; return; }
      const actual = Math.min(src.power - 1, MAX_POWER - dst.power);
      if (actual > 0) { src.power -= actual; dst.power += actual; }
      flashHex(move.sr, move.sc, 'flash-transfer-out', 400);
      flashHex(move.dr, move.dc, 'flash-transfer-in', 400);
      render();
      setTimeout(() => { animating = false; if (!checkGameOver()) afterOpponentTurn(); }, 500);
    } else if (move.type === 'attack') {
      const src = grid[move.sr][move.sc], dst = grid[move.dr][move.dc];
      if (!src || !dst) { animating = false; return; }
      let aPow = src.power;
      if (src.blazeBuffed) { aPow = Math.min(aPow*2,18); src.blazeBuffed = false; }
      let dPow = dst.power;
      if (dst.shielded) dPow += 3;
      const capPU = dst.powerup;
      if (aPow > dPow) {
        dst.owner = src.owner; dst.power = Math.min(aPow-dPow, MAX_POWER);
        src.power = 1; dst.powerup = null; dst.shielded = false;
        dst.blazeBuffed = false; dst.frozen = false; dst.boss = false;
        flashHex(move.dr, move.dc, onlineSide === PLAYER ? 'flash-ai-capture' : 'flash-capture', 550);
        SFX.attack();
        if (capPU) applyPowerup(capPU, move.dr, move.dc, src.owner);
        setStatus(`⚔️ Opponent captured! (${aPow} vs ${dPow})`);
      } else if (aPow === dPow) {
        src.power = Math.max(1, src.power-1);
        setStatus('⚔️ Opponent tied!');
      } else {
        src.power = 1; if (dst.power > 1) dst.power -= 1;
        setStatus('⚔️ Opponent attack failed!');
      }
      render();
      setTimeout(() => { animating = false; if (!checkGameOver()) afterOpponentTurn(); }, 700);
    }
  }

  function applyRemoteSkip() {
    setStatus('⚔️ Opponent skipped.');
    afterOpponentTurn();
  }

function afterOpponentTurn() {
  turn++;
  growPhaseOwner(onlineSide);
  phase = 'select';
  const label = onlineSide === PLAYER ? '🟢 P1' : '🔵 P2';
  setStatus(`🌐 Your turn (${label}) — select a hex`);
  render();
}

function sendMove(moveData) {
  sendOnline({ type: 'move', move: moveData });
}

  function copyRoomCode() {
    if (onlineRoomCode) {
      navigator.clipboard.writeText(onlineRoomCode).catch(() => {});
      SFX.click();
    }
  }

  function cancelOnline() {
    SFX.click();
    cleanupOnline();
    onlineOverlay.classList.add('hidden');
    if (gameMode === 'online') gameMode = 'ai';
  }

  function cleanupOnline() {
    onlineReady = false;
    lastSeenMsgId = null;
    gunRoom = null;
    onlineRoomCode = null;
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  function setOnlineStatus(msg, type) {
    const waiting = document.getElementById('waiting-text');
    if (waiting) { waiting.textContent = msg; waiting.style.color = type === 'error' ? '#f87171' : ''; }
  }

  // =========== STAGE MANAGEMENT ===========
  function startStage(s) {
    hideAllOverlays();
    gameMode = 'ai';
    currentStage = s; cfg = stageConfig(s);
    if (cfg.isBoss) showBossIntro();
    else generateAndPlay();
  }

  function generateAndPlay() {
    turn = 1; phase = 'select';
    selectedHex = null; validTargets = []; transferTargets = []; animating = false;

    if (gameMode === 'local') localTurn = PLAYER;

    generateMap();
    createBoard();
    if (gameMode === 'local') {
      growPhaseOwner(PLAYER);
      growPhaseOwner(PLAYER2);
    } else {
      growPhase(PLAYER);
    }
    SFX.stageStart();
    render();

    if (gameMode === 'local') {
      showLocalTurnBanner();
    } else if (gameMode === 'ai') {
      setStatus(cfg.isBoss
        ? `⚔️ Boss battle! Defeat ${cfg.bossName}!`
        : 'Your hexes grew +1 · select a hex to attack or 🔄 transfer');
    }
  }

  function stageWon() {
    if (currentStage === progress.stage) {
      if (!progress.completed.includes(currentStage)) progress.completed.push(currentStage);
      if (currentStage < TOTAL_STAGES) progress.stage = currentStage + 1;
      saveProgress();
    } else {
      if (!progress.completed.includes(currentStage)) { progress.completed.push(currentStage); saveProgress(); }
    }
  }

  function nextStage() {
    SFX.click();
    goOverlay.classList.add('hidden');
    if (gameMode !== 'ai') { startLocalGame(); return; }
    if (currentStage >= TOTAL_STAGES) showStages();
    else startStage(currentStage + 1);
  }

  function restartStage() {
    SFX.click(); hideAllOverlays();
    if (gameMode === 'local') { startLocalGame(); return; }
    if (gameMode === 'online') { /* restart not supported online, just close */ return; }
    startStage(currentStage);
  }

  function hideAllOverlays() {
    [tutOverlay, bossOverlay, stagesOverlay, goOverlay, modeOverlay, onlineOverlay, localTurnBanner]
      .forEach(el => { if (el) el.classList.add('hidden'); });
  }

  // =========== CLICK HANDLING ===========
  function handleClick(r, c) {
    if (animating || phase === 'ai' || phase === 'gameover' || phase === 'wait-online') return;

    // Online: ignore if not our turn
    if (gameMode === 'online') {
      const myOwner = onlineSide;
      if (grid[r][c].owner !== NEUTRAL && grid[r][c].owner !== myOwner && phase === 'select') return;
    }

    const ao = activeOwner();
    const cell = grid[r][c];

    if (phase === 'select') {
      if (cell.owner !== ao) return;
      if (cell.frozen) { setStatus('❄ That hex is frozen.'); SFX.fail(); return; }
      const targets = getAttackTargets(r, c);
      const transfers = getTransferTargets(r, c);
      if (targets.length === 0 && transfers.length === 0) { setStatus('No valid targets from that hex.'); return; }
      selectedHex = [r, c]; validTargets = targets; transferTargets = transfers; phase = 'target';
      SFX.select();
      const bNote = cell.blazeBuffed ? ' 🔥 Blaze active — 2× damage!' : '';
      const tNote = transfers.length > 0 ? ' · 🔄 friendly = transfer' : '';
      setStatus(`Power ${cell.power} selected · choose target${bNote}${tNote}`);
      render(); return;
    }

    if (phase === 'target') {
      if (cell.owner === ao) {
        if (r === selectedHex[0] && c === selectedHex[1]) { deselect(); return; }
        if (isTransferTarget(r, c)) { executeTransfer(selectedHex[0], selectedHex[1], r, c); return; }
        if (cell.frozen) { setStatus('❄ Frozen hex.'); SFX.fail(); return; }
        const targets = getAttackTargets(r, c);
        const transfers = getTransferTargets(r, c);
        if (targets.length === 0 && transfers.length === 0) { setStatus('No targets.'); return; }
        selectedHex = [r, c]; validTargets = targets; transferTargets = transfers;
        SFX.select();
        const bNote = cell.blazeBuffed ? ' 🔥 2×!' : '';
        const tNote = transfers.length > 0 ? ' · 🔄' : '';
        setStatus(`Power ${cell.power} selected${bNote}${tNote}`);
        render(); return;
      }
      if (!isValidTarget(r, c)) return;
      executeAttack(selectedHex[0], selectedHex[1], r, c);
    }
  }

  function deselect() {
    selectedHex = null; validTargets = []; transferTargets = []; phase = 'select';
    SFX.deselect();
    setStatus('Select a hex to attack or 🔄 transfer power');
    render();
  }

  // =========== TRANSFER ===========
  function executeTransfer(sr, sc, dr, dc) {
    animating = true;
    const src = grid[sr][sc], dst = grid[dr][dc];
    const amount = src.power - 1;
    if (amount <= 0) { animating = false; setStatus('Not enough power.'); SFX.fail(); return; }
    const actual = Math.min(amount, MAX_POWER - dst.power);
    if (actual <= 0) { animating = false; setStatus('Target already at max.'); SFX.fail(); return; }
    src.power -= actual; dst.power += actual;
    SFX.transfer();
    flashHex(sr, sc, 'flash-transfer-out', 400);
    flashHex(dr, dc, 'flash-transfer-in', 400);
    setStatus(`🔄 Transferred ${actual} power`);
    selectedHex = null; validTargets = []; transferTargets = [];
    render();

    // Send online
    if (gameMode === 'online') sendMove({ type:'transfer', sr, sc, dr, dc });

    setTimeout(() => {
      animating = false;
      if (checkGameOver()) return;
      afterPlayerTurn();
    }, 500);
  }

  // =========== COMBAT ===========
  function executeAttack(sr, sc, dr, dc) {
    animating = true;
    SFX.attack();
    const src = grid[sr][sc], dst = grid[dr][dc];
    let aPow = src.power;
    const wasBlazed = src.blazeBuffed;
    if (wasBlazed) { aPow = Math.min(aPow * 2, 18); src.blazeBuffed = false; }
    let defPow = dst.power;
    const wasShielded = dst.shielded;
    if (wasShielded) defPow += 3;
    const capturedPU = dst.powerup;
    const wasBoss = dst.boss;

    if (aPow > defPow) {
      dst.owner = src.owner; dst.power = Math.min(aPow - defPow, MAX_POWER);
      src.power = 1; dst.powerup = null; dst.shielded = false;
      dst.blazeBuffed = false; dst.frozen = false; dst.boss = false;

      if (wasBoss) { flashHex(dr, dc, 'flash-boss-die', 800); SFX.bossDefeat(); }
      else { flashHex(dr, dc, 'flash-capture', 550); SFX.capture(); }

      let msg = `✅ Captured! ${wasBlazed ? aPow+' (🔥2×)' : aPow} vs ${wasShielded ? defPow+' (🛡+3)' : defPow}`;
      if (wasBoss) msg = `💀 ${cfg.bossName} DESTROYED! ${msg}`;
      if (capturedPU) { SFX.powerup(); msg += ' · ' + applyPowerup(capturedPU, dr, dc, src.owner); }
      setStatus(msg);
    } else if (aPow === defPow) {
      src.power = Math.max(1, src.power - 1);
      flashHex(sr, sc, 'flash-fail', 550); SFX.fail();
      setStatus(`⚔️ Tied ${aPow} vs ${defPow} — deflected!`);
    } else {
      src.power = 1;
      if (dst.power > 1) dst.power -= 1;
      flashHex(sr, sc, 'flash-fail', 550); SFX.fail();
      setStatus(`❌ Failed ${wasBlazed ? aPow+' (🔥2×)' : aPow} vs ${wasShielded ? defPow+' (🛡+3)' : defPow}`);
    }

    selectedHex = null; validTargets = []; transferTargets = [];
    render();

    // Send online
    if (gameMode === 'online') sendMove({ type:'attack', sr, sc, dr, dc });

    setTimeout(() => {
      animating = false;
      if (wasBoss && grid[dr][dc].owner === PLAYER) {
        showEnd('Boss Defeated!', `You destroyed ${cfg.bossName} on stage ${currentStage}!`, 'win'); return;
      }
      if (checkGameOver()) return;
      afterPlayerTurn();
    }, wasBoss ? 1000 : 700);
  }

  // Called after the active player takes their action
function afterPlayerTurn() {
  if (gameMode === 'ai') {
    beginAITurn();
  } else if (gameMode === 'local') {
    localTurn = localTurn === PLAYER ? PLAYER2 : PLAYER;
    growPhaseOwner(localTurn);
    turn++;
    phase = 'select';
    render();
    showLocalTurnBanner();
  } else if (gameMode === 'online') {
    phase = 'wait-online';
    growPhaseOwner(onlineSide);
    turn++;
    setStatus('🌐 Waiting for opponent…');
    render();
  }
}
  // =========== POWER-UP EFFECTS ===========
  function applyPowerup(type, r, c, owner) {
    const cell = grid[r][c];
    switch (type) {
      case 'surge':
        cell.power = Math.min(cell.power + 3, MAX_POWER);
        flashHex(r, c, 'flash-surge flash-powerup', 600);
        return '⚡ Surge! +3 power';
      case 'shield':
        cell.shielded = true;
        flashHex(r, c, 'flash-shield flash-powerup', 600);
        return '🛡 Shield!';
      case 'drain': {
        const foes = [PLAYER, PLAYER2, ENEMY].filter(o => o !== owner);
        let drained = 0;
        for (const [nr, nc] of getNeighbors(r, c)) {
          if (foes.includes(grid[nr][nc].owner)) {
            const steal = Math.min(2, grid[nr][nc].power - 1);
            if (steal > 0) { grid[nr][nc].power -= steal; drained += steal; flashHex(nr, nc, 'flash-drain flash-powerup', 500); }
          }
        }
        cell.power = Math.min(cell.power + drained, MAX_POWER);
        flashHex(r, c, 'flash-drain flash-powerup', 600);
        return `💀 Drain! Stole ${drained}`;
      }
      case 'blaze':
        cell.blazeBuffed = true;
        flashHex(r, c, 'flash-blaze flash-powerup', 600);
        return '🔥 Blaze! 2×';
      case 'freeze': {
        const foes = [PLAYER, PLAYER2, ENEMY].filter(o => o !== owner);
        let froze = 0;
        for (const [nr, nc] of getNeighbors(r, c)) {
          if (foes.includes(grid[nr][nc].owner)) { grid[nr][nc].frozen = true; froze++; flashHex(nr, nc, 'flash-freeze flash-powerup', 500); }
        }
        flashHex(r, c, 'flash-freeze flash-powerup', 600);
        return `❄ Froze ${froze}`;
      }
      case 'spread': {
        const neutralNeigh = getNeighbors(r, c).filter(([nr,nc]) => grid[nr][nc].owner === NEUTRAL);
        if (neutralNeigh.length > 0) {
          const [nr, nc] = neutralNeigh[randInt(neutralNeigh.length)];
          const sPU = grid[nr][nc].powerup;
          grid[nr][nc] = makeCell(owner, Math.max(1, Math.floor(cell.power / 2)));
          flashHex(nr, nc, 'flash-spread flash-powerup', 600);
          let extra = '';
          if (sPU) extra = ' → ' + applyPowerup(sPU, nr, nc, owner);
          return '🌀 Spread!' + extra;
        }
        return '🌀 Spread! (no neutral)';
      }
      default: return '';
    }
  }

  function flashHex(r, c, cls, dur) {
    const key = `${r},${c}`;
    if (!hexEls[key]) return;
    const classes = cls.split(' ');
    classes.forEach(cl => hexEls[key].polygon.classList.add(cl));
    setTimeout(() => classes.forEach(cl => hexEls[key].polygon.classList.remove(cl)), dur || 500);
  }

  // =========== GROWTH ===========
  function growPhaseOwner(owner) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = grid[r][c];
      if (cell.owner !== owner) continue;
      if (cell.frozen) { cell.frozen = false; flashHex(r, c, 'flash-freeze', 300); continue; }
      const gain = (cell.boss && cell.owner === ENEMY) ? cfg.bossRegen : 1;
      if (cell.power < MAX_POWER) { cell.power = Math.min(cell.power + gain, MAX_POWER); flashHex(r, c, 'flash-grow', 300); SFX.grow(); }
    }
  }

  // Legacy: grow only PLAYER (used in AI mode)
  function growPhase(owner) { growPhaseOwner(owner); }

  // =========== AI ===========
  function beginAITurn() {
    phase = 'ai';
    setStatus('Enemy is thinking…');
    render();
    setTimeout(() => { growPhase(ENEMY); render(); setTimeout(aiAttack, 400); }, 450);
  }

  function aiAttack() {
    const attacks = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].owner !== ENEMY || grid[r][c].frozen) continue;
      for (const [nr, nc] of getAttackTargets(r, c)) {
        const src = grid[r][c];
        let aPow = src.power;
        if (src.blazeBuffed) aPow = Math.min(aPow * 2, 18);
        let dPow = grid[nr][nc].power;
        if (grid[nr][nc].shielded) dPow += 3;
        attacks.push({ sr:r, sc:c, dr:nr, dc:nc, sPow:aPow, dPow, dOwner:grid[nr][nc].owner, dPU:grid[nr][nc].powerup });
      }
    }

    let best = null, bestScore = -Infinity;
    const aggression = Math.min(currentStage * 2, 40);
    for (const a of attacks) {
      let score = 0;
      const diff = a.sPow - a.dPow;
      if (diff > 0) {
        score = 100 + diff * 10;
        if (a.dOwner === PLAYER) score += 50 + aggression;
        score += a.dPow * 3;
        if (a.dPU) {
          score += 35;
          if (a.dPU === 'freeze') score += 25;
          if (a.dPU === 'drain') score += 20;
          if (a.dPU === 'blaze') score += 15;
        }
      } else if (diff === 0) score = -30;
      else score = -100;
      score += Math.random() * Math.max(2, 12 - currentStage * 0.3);
      if (score > bestScore) { bestScore = score; best = a; }
    }

    if (best && bestScore > 50) {
      flashHex(best.sr, best.sc, 'flash-ai-source', 400);
      SFX.aiMove();
      setTimeout(() => {
        const src = grid[best.sr][best.sc], dst = grid[best.dr][best.dc];
        let aPow = src.power;
        const wasBlazed = src.blazeBuffed;
        if (wasBlazed) { aPow = Math.min(aPow*2,18); src.blazeBuffed = false; }
        let dPow = dst.power;
        const wasShielded = dst.shielded;
        if (wasShielded) dPow += 3;
        const capPU = dst.powerup;

        if (aPow > dPow) {
          dst.owner = ENEMY; dst.power = Math.min(aPow-dPow, MAX_POWER);
          src.power = 1; dst.powerup = null; dst.shielded = false;
          dst.blazeBuffed = false; dst.frozen = false;
          flashHex(best.dr, best.dc, 'flash-ai-capture', 500);
          SFX.attack();
          let msg = `⚔️ Enemy captured! (${wasBlazed ? aPow+' 🔥' : aPow} vs ${wasShielded ? dPow+' 🛡' : dPow})`;
          if (capPU) msg += ' · ' + applyPowerup(capPU, best.dr, best.dc, ENEMY);
          setStatus(msg);
        } else if (aPow === dPow) {
          src.power = Math.max(1, src.power-1);
          setStatus('⚔️ Enemy tied!');
        } else {
          src.power = 1; if (dst.power>1) dst.power-=1;
          setStatus('⚔️ Enemy failed!');
        }
        render();
        setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 550);
      }, 400);
    } else {
      setStatus('⚔️ Enemy skipped');
      setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 350);
    }
  }

  // =========== TURN MANAGEMENT ===========
  function startNewTurn() {
    turn++; growPhase(PLAYER); phase = 'select';
    if (!playerHasAttacks(PLAYER)) {
      setStatus('No attacks available — skipping…');
      render();
      setTimeout(() => { if (!checkGameOver()) beginAITurn(); }, 500);
      return;
    }
    setStatus('Your hexes grew +1 · select a hex to attack or 🔄 transfer');
    render();
  }

  function playerHasAttacks(owner) {
    const o = owner || PLAYER;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (grid[r][c].owner === o && !grid[r][c].frozen &&
        (getAttackTargets(r, c).length > 0 || getTransferTargets(r, c).length > 0)) return true;
    return false;
  }

  // =========== WIN / LOSE ===========
  function checkGameOver() {
    if (gameMode === 'local' || gameMode === 'online') return checkGameOverMP();
    return checkGameOverAI();
  }

  function checkGameOverAI() {
    let hasP = false, hasE = false, pS = 0, eS = 0, pH = 0, eH = 0, hasBoss = false;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const o = grid[r][c].owner;
      if (o === PLAYER) { hasP = true; pH++; pS += grid[r][c].power; }
      if (o === ENEMY)  { hasE = true; eH++; eS += grid[r][c].power; if (grid[r][c].boss) hasBoss = true; }
    }
    if (cfg.isBoss && !hasBoss && hasP) { showEnd('Boss Defeated!', `${cfg.bossName} destroyed on stage ${currentStage}!`, 'win'); return true; }
    if (!hasE) { showEnd('Victory!', `Stage ${currentStage} cleared in ${turn} turns!`, 'win'); return true; }
    if (!hasP) { showEnd('Defeat', `Stage ${currentStage} — enemy took all your hexes.`, 'lose'); return true; }
    if (turn >= cfg.maxTurns) {
      if (pS > eS) showEnd('Victory!', `Time's up — you win! ⚡${pS} vs ⚡${eS}`, 'win');
      else if (eS > pS) showEnd('Defeat', `Time's up — enemy wins ⚡${eS} vs ⚡${pS}`, 'lose');
      else showEnd('Draw', `Tied at ⚡${pS}!`, 'draw');
      return true;
    }
    return false;
  }

  function checkGameOverMP() {
    let p1H=0, p2H=0, p1S=0, p2S=0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = grid[r][c];
      if (cell.owner === PLAYER)  { p1H++; p1S += cell.power; }
      if (cell.owner === PLAYER2) { p2H++; p2S += cell.power; }
    }

    // Names
    const p1Name = gameMode === 'online' && onlineSide === PLAYER2 ? 'Opponent' : 'Player 1';
    const p2Name = gameMode === 'online' && onlineSide === PLAYER  ? 'Opponent' : 'Player 2';
    const myName = gameMode === 'online'
      ? 'You'
      : (localTurn === PLAYER ? 'Player 1' : 'Player 2');

    if (p2H === 0) {
      showEnd(`${p1Name} Wins!`, `${p1Name} eliminated ${p2Name}!`, 'win'); return true;
    }
    if (p1H === 0) {
      showEnd(`${p2Name} Wins!`, `${p2Name} eliminated ${p1Name}!`, 'lose'); return true;
    }
    if (turn >= cfg.maxTurns) {
      if (p1S > p2S) showEnd(`${p1Name} Wins!`, `Time's up! ⚡${p1S} vs ⚡${p2S}`, p1Name.includes('You') || gameMode==='local' ? 'win' : 'lose');
      else if (p2S > p1S) showEnd(`${p2Name} Wins!`, `Time's up! ⚡${p2S} vs ⚡${p1S}`, p2Name.includes('You') || (gameMode==='local') ? 'win' : 'lose');
      else showEnd('Draw!', `Tied at ⚡${p1S}!`, 'draw');
      return true;
    }
    return false;
  }

  function showEnd(title, desc, type) {
    phase = 'gameover';
    resultTitle.textContent = title;
    resultTitle.className = type;
    resultDesc.textContent = desc;

    if (type === 'win') {
      SFX.victory();
      if (gameMode === 'ai') stageWon();
      btnNext.textContent = gameMode === 'ai'
        ? (currentStage >= TOTAL_STAGES ? '🏆 All Stages!' : 'Next Stage →')
        : 'Play Again';
      btnNext.classList.remove('hidden');
    } else if (type === 'draw') {
      SFX.defeat();
      btnNext.textContent = 'Play Again';
      btnNext.classList.remove('hidden');
    } else {
      SFX.defeat();
      if (gameMode !== 'ai') {
        btnNext.textContent = 'Play Again'; btnNext.classList.remove('hidden');
      } else {
        btnNext.classList.add('hidden');
      }
    }

    goOverlay.classList.remove('hidden');
    setStatus(title); render();
  }

  // =========== HELPERS ===========
  function setStatus(msg) { statusEl.textContent = msg; }

  // =========== PUBLIC API ===========
  function skipAttack() {
    if (phase !== 'select' && phase !== 'target') return;
    SFX.click();
    selectedHex = null; validTargets = []; transferTargets = [];

    if (gameMode === 'online') sendOnline({ type: 'skip' });

    setStatus('Skipped…');
    render();
    setTimeout(() => {
      if (gameMode === 'ai') beginAITurn();
      else if (gameMode === 'local') {
        localTurn = localTurn === PLAYER ? PLAYER2 : PLAYER;
        growPhaseOwner(localTurn); turn++;
        phase = 'select'; render();
        showLocalTurnBanner();
      } else if (gameMode === 'online') {
        phase = 'wait-online';
        growPhaseOwner(opponentOwner()); turn++;
        setStatus('🌐 Waiting for opponent…'); render();
      }
    }, 300);
  }

  function toggleSound() {
    SFX.on = !SFX.on; progress.soundOn = SFX.on; saveProgress();
    btnSound.textContent = SFX.on ? '🔊' : '🔇';
    if (SFX.on) SFX.click();
  }

// =========== CREATE ROOM - FIREBASE ===========
function onlineCreate() {
  SFX.click();
  document.getElementById('online-create-join').classList.add('hidden');
  document.getElementById('online-waiting').classList.remove('hidden');
  document.getElementById('online-back-btn').style.display = 'none';

  const code = String(Math.floor(1000 + Math.random() * 9000));
  roomCode = code;
  document.getElementById('room-code-big').textContent = code;
  document.getElementById('waiting-text').textContent = 'Waiting for opponent to join…';

  onlineSide = PLAYER;
  dbRef = ref(database, `rooms/${code}`);
  
  const roomData = {
    status: 'waiting',
    seed: 0,
    p1: onlineSide,
    ts: Date.now()
  };
  
  set(dbRef, roomData).catch(err => {
    console.error('Firebase room creation error:', err);
    setOnlineStatus('Connection failed. Check your internet.', 'error');
  });
  
  const statusRef = ref(database, `rooms/${code}/status`);
  onValue(statusRef, (snapshot) => {
    const status = snapshot.val();
    if (status === 'joined' && onlineSide === PLAYER) {
      const seed = (Date.now() & 0xffff) + Math.floor(Math.random() * 1000);
      update(ref(database, `rooms/${code}`), { 
        status: 'started', 
        seed 
      });
      document.getElementById('waiting-text').textContent = 'Opponent connected! Starting…';
      setTimeout(() => {
        document.getElementById('online-overlay').classList.add('hidden');
        startOnlineGame(true, seed);
        startOnlineMoveListener();
      }, 600);
    }
  });
}

// =========== JOIN ROOM - FIREBASE ===========
function onlineJoin() {
  SFX.click();
  const code = [0,1,2,3].map(i => document.getElementById(`cd${i}`).value).join('');
  
  if (code.length !== 4 || !/^\d{4}$/.test(code)) {
    setOnlineStatus('Enter all 4 digits.', 'error');
    return;
  }

  document.getElementById('online-join-form').classList.add('hidden');
  document.getElementById('online-connecting').classList.remove('hidden');
  document.getElementById('online-back-btn').style.display = 'none';
  document.getElementById('online-connecting').innerHTML =
    '<p class="mode-sub">Connecting to room ' + code + '…</p><div class="waiting-dots"><span></span><span></span><span></span></div>';

  roomCode = code;
  onlineSide = PLAYER2;
  dbRef = ref(database, `rooms/${code}`);

  let joinTimeout = setTimeout(() => {
    document.getElementById('online-connecting').innerHTML =
      '<p class="mode-sub" style="color:#f87171">Room not found. Check the code.</p>';
    document.getElementById('online-back-btn').style.display = '';
  }, 10000);

  const roomRef = ref(database, `rooms/${code}`);
  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    
    if (!data) {
      clearTimeout(joinTimeout);
      document.getElementById('online-connecting').innerHTML =
        '<p class="mode-sub" style="color:#f87171">Room not found.</p>';
      document.getElementById('online-back-btn').style.display = '';
      return;
    }

    clearTimeout(joinTimeout);
    
    update(ref(database, `rooms/${code}`), { status: 'joined' }).catch(err => {
      console.error('Error joining room:', err);
    });
    
    document.getElementById('online-connecting').innerHTML =
      '<p class="mode-sub">Joined! Waiting for host to start…</p><div class="waiting-dots"><span></span><span></span><span></span></div>';

    if (data.status === 'started') {
      off(roomRef);
      document.getElementById('online-overlay').classList.add('hidden');
      startOnlineGame(false, data.seed);
      startOnlineMoveListener();
    }
  });
}

// =========== CANCEL ONLINE ===========
function cancelOnline() {
  SFX.click();
  
  if (moveListener) {
    off(moveListener);
    moveListener = null;
  }
  
  if (dbRef && roomCode) {
    set(ref(database, `rooms/${roomCode}`), null).catch(err => {
      console.error('Error deleting room:', err);
    });
  }
  
  dbRef = null;
  roomCode = null;
  lastSeenMsgId = null;
  document.getElementById('online-overlay').classList.add('hidden');
  if (gameMode === 'online') gameMode = 'ai';
}

// =========== COPY ROOM CODE ===========
function copyRoomCode() {
  if (roomCode) {
    navigator.clipboard.writeText(roomCode).then(() => {
      SFX.click();
      alert('Room code copied: ' + roomCode);
    }).catch(() => {
      alert('Room code: ' + roomCode);
    });
  }
}

// =========== SHOW ONLINE LOBBY ===========
function showOnlineLobby() {
  document.getElementById('online-overlay').classList.remove('hidden');
  showCreateJoin();
}

// =========== SHOW CREATE/JOIN ===========
function showCreateJoin() {
  document.getElementById('online-create-join').classList.remove('hidden');
  document.getElementById('online-join-form').classList.add('hidden');
  document.getElementById('online-waiting').classList.add('hidden');
  document.getElementById('online-connecting').classList.add('hidden');
  document.getElementById('online-back-btn').style.display = '';
}

// =========== SHOW JOIN FORM ===========
function showJoinRoom() {
  SFX.click();
  document.getElementById('online-create-join').classList.add('hidden');
  document.getElementById('online-join-form').classList.remove('hidden');
  document.getElementById('online-back-btn').style.display = '';
  setTimeout(() => document.getElementById('cd0').focus(), 100);
  setupCodeInputs();
}

// =========== SETUP CODE INPUTS ===========
function setupCodeInputs() {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`cd${i}`);
    el.value = '';
    el.oninput = () => {
      el.value = el.value.replace(/[^0-9]/g, '').slice(-1);
      if (el.value && i < 3) document.getElementById(`cd${i+1}`).focus();
    };
    el.onkeydown = (e) => {
      if (e.key === 'Backspace' && !el.value && i > 0) document.getElementById(`cd${i-1}`).focus();
    };
  }
}

// =========== SET ONLINE STATUS ===========
function setOnlineStatus(msg, type) {
  const waiting = document.getElementById('waiting-text');
  if (waiting) {
    waiting.textContent = msg;
    waiting.style.color = type === 'error' ? '#f87171' : '';
  }
}

// =========== SELECT MODE ===========
function selectMode(mode) {
  SFX.click();
  document.getElementById('mode-overlay').classList.add('hidden');
  
  if (mode === gameMode) return;

  gameMode = mode;
  if (mode === 'ai') {
    cancelOnline();
    startStage(progress.stage);
  } else if (mode === 'local') {
    cancelOnline();
    startLocalGame();
  } else if (mode === 'online') {
    showOnlineLobby();
  }
}
  
  // =========== INIT ===========
  function init() {
    svgEl       = document.getElementById('grid');
    statusEl    = document.getElementById('status');
    turnEl      = document.getElementById('turn-num');
    turnMaxEl   = document.getElementById('turn-max');
    stageNumEl  = document.getElementById('stage-num');
    bossBadge   = document.getElementById('boss-badge');
    boardEl     = document.getElementById('board');
    pHexesEl    = document.getElementById('p-hexes');
    pPowerEl    = document.getElementById('p-power');
    eHexesEl    = document.getElementById('e-hexes');
    ePowerEl    = document.getElementById('e-power');
    foeLabel    = document.getElementById('foe-label');
    pLabel      = document.getElementById('p-label');
    btnSkip     = document.getElementById('btn-skip');
    btnSound    = document.getElementById('btn-sound');
    enemyDot    = document.getElementById('enemy-dot');

    tutOverlay  = document.getElementById('tut-overlay');
    tutIcon     = document.getElementById('tut-icon');
    tutTitle    = document.getElementById('tut-title');
    tutText     = document.getElementById('tut-text');
    tutDots     = document.getElementById('tut-dots');
    tutNextBtn  = document.getElementById('tut-next');

    bossOverlay = document.getElementById('boss-overlay');
    bossNameEl  = document.getElementById('boss-name');
    bossSubEl   = document.getElementById('boss-sub');

    stagesOverlay = document.getElementById('stages-overlay');
    stageGridEl   = document.getElementById('stage-grid');

    goOverlay   = document.getElementById('go-overlay');
    resultTitle = document.getElementById('result-title');
    resultDesc  = document.getElementById('result-desc');
    btnNext     = document.getElementById('btn-next');
    btnRetry    = document.getElementById('btn-retry');

    modeOverlay   = document.getElementById('mode-overlay');
    onlineOverlay = document.getElementById('online-overlay');
    localTurnBanner = document.getElementById('local-turn-banner');

    loadProgress();
    btnSound.textContent = SFX.on ? '🔊' : '🔇';

    if (!progress.tutDone) showTutorial();
    else startStage(progress.stage);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    skipAttack, restartStage, nextStage, startBoss,
    showStages, closeStages, toggleSound,
    nextTutorial, skipTutorial, replayTutorial,
    showModeSelect, closeModeSelect, selectMode,
    onlineCreate, showJoinRoom, onlineJoin,
    showCreateJoin, cancelOnline, copyRoomCode,
    dismissLocalBanner
  };
})();
