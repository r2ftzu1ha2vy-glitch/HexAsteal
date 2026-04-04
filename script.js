// =========== FIREBASE (loaded as module) ===========
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, off, get } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCzTi3UMtCQPm4kXdtAqOzv-zyt1HDsBqo",
  authDomain: "hexasteal.firebaseapp.com",
  projectId: "hexasteal",
  databaseURL: "https://hexasteal-default-rtdb.firebaseio.com/",
  storageBucket: "hexasteal.firebasestorage.app",
  messagingSenderId: "390872116524",
  appId: "1:390872116524:web:67fcc0a61b3f0a7ad8d089"
};

const _app = initializeApp(firebaseConfig);
const database = getDatabase(_app);

// =========== FIREBASE STATE ===========
let dbRef = null;
let roomCode = null;
let onlineSide = 'player';
let moveListener = null;
let statusListener = null;
let roomListener = null;
let lastSeenMsgId = null;
let chatOpen = false;
let chatListener = null;
let unreadCount = 0;
let rematchVoted = false;
let rematchListener = null;
let rematchTimeout = null;
let _savedRoomCode = null;
let _savedOnlineSide = null;
let _disconnectListener = null;

// =========== SHOP LOADER ===========
(function injectShopLoader() {
  const style = document.createElement('style');
  style.textContent = `
    #shop-loader-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(4px);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      z-index: 9999; gap: 16px;
    }
    #shop-loader-overlay.hidden { display: none; }
    .shop-loader-label {
      font-size: 13px; font-weight: 700; color: #e5e7eb;
      letter-spacing: 0.5px;
    }
    .hex-spinner {
      animation: hex-spin 0.9s linear infinite;
      transform-origin: center;
    }
    @keyframes hex-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes rainbow-hue {
      0%   { filter: hue-rotate(0deg); }
      100% { filter: hue-rotate(360deg); }
    }
    .rainbow-spin {
      animation: rainbow-hue 1.8s linear infinite;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'shop-loader-overlay';
  overlay.className = 'hidden';
  overlay.innerHTML = `
    <svg class="hex-spinner" width="54" height="54" viewBox="0 0 54 54" fill="none">
      <polygon points="27,3 49,15.5 49,38.5 27,51 5,38.5 5,15.5"
        fill="#1e1040" stroke="#c084fc" stroke-width="2.5"/>
      <polygon points="27,11 41,19 41,35 27,43 13,35 13,19"
        fill="none" stroke="#c084fc" stroke-width="1" opacity="0.4"/>
      <polygon points="27,18 35,22.5 35,31.5 27,36 19,31.5 19,22.5"
        fill="#c084fc" opacity="0.15"/>
    </svg>
    <span class="shop-loader-label" id="shop-loader-label">Processing…</span>
  `;
  document.body.appendChild(overlay);
})();

function showShopLoader(label) {
  const overlay = document.getElementById('shop-loader-overlay');
  const lbl = document.getElementById('shop-loader-label');
  if (lbl) lbl.textContent = label || 'Processing…';
  if (overlay) overlay.classList.remove('hidden');
}

function hideShopLoader() {
  const overlay = document.getElementById('shop-loader-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// =========== RAINBOW HEX ANIMATION ===========
let _rainbowHue = 0;
let _rainbowRafId = null;

function startRainbowLoop() {
  if (_rainbowRafId) return;
  function tick() {
    _rainbowHue = (_rainbowHue + 0.8) % 360;
    document.querySelectorAll('.hex-rainbow-cell').forEach(poly => {
      const h = _rainbowHue;
      const fill = `hsl(${h}, 85%, 18%)`;
      const stroke = `hsl(${(h + 30) % 360}, 100%, 60%)`;
      poly.style.fill = fill;
      poly.style.stroke = stroke;
    });
    _rainbowRafId = requestAnimationFrame(tick);
  }
  _rainbowRafId = requestAnimationFrame(tick);
}

function stopRainbowLoop() {
  if (_rainbowRafId) { cancelAnimationFrame(_rainbowRafId); _rainbowRafId = null; }
}

// =========== POWERUP SVG ICONS ===========
const POWERUP_SVG = {
  surge:  `<path d="M2 -8 L-2 0 L1 0 L-2 8 L6 -2 L2 -2 L6 -8 Z" fill="#22d3ee" stroke="#67e8f9" stroke-width="0.4"/>`,
  shield: `<path d="M0 -8 L6 -4 L6 2 Q6 7 0 9 Q-6 7 -6 2 L-6 -4 Z" fill="#a8a29e" stroke="#d6d3d1" stroke-width="0.5"/><path d="M0 -5 L4 -2 L4 2 Q4 5 0 7 Q-4 5 -4 2 L-4 -2 Z" fill="none" stroke="#d6d3d1" stroke-width="0.4" opacity="0.5"/>`,
  drain:  `<circle cx="0" cy="-2" r="5" fill="none" stroke="#a855f7" stroke-width="1.2"/><path d="M-3 -5 L0 -9 L3 -5" fill="none" stroke="#a855f7" stroke-width="1.2" stroke-linecap="round"/><path d="M-3 1 L0 5 L3 1" fill="none" stroke="#a855f7" stroke-width="1.2" stroke-linecap="round"/><circle cx="0" cy="-2" r="2" fill="#a855f7" opacity="0.5"/>`,
  blaze:  `<path d="M0 -9 Q4 -3 2 0 Q6 -2 5 3 Q4 8 0 9 Q3 5 1 3 Q-1 6 -2 9 Q-5 4 -1 1 Q-5 2 -4 -2 Q-2 -5 0 -9 Z" fill="#f97316" stroke="#fdba74" stroke-width="0.4"/>`,
  freeze: `<line x1="0" y1="-8" x2="0" y2="8" stroke="#7dd3fc" stroke-width="1.5" stroke-linecap="round"/><line x1="-7" y1="0" x2="7" y2="0" stroke="#7dd3fc" stroke-width="1.5" stroke-linecap="round"/><line x1="-5" y1="-5" x2="5" y2="5" stroke="#7dd3fc" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="-5" x2="-5" y2="5" stroke="#7dd3fc" stroke-width="1.5" stroke-linecap="round"/><circle cx="0" cy="0" r="2" fill="#bae6fd"/>`,
  spread: `<circle cx="0" cy="0" r="3" fill="#f472b6"/><circle cx="-7" cy="-4" r="2" fill="#f472b6" opacity="0.7"/><circle cx="7" cy="-4" r="2" fill="#f472b6" opacity="0.7"/><circle cx="0" cy="7" r="2" fill="#f472b6" opacity="0.7"/><line x1="-5" y1="-3" x2="-2" y2="-1" stroke="#f472b6" stroke-width="0.8"/><line x1="5" y1="-3" x2="2" y2="-1" stroke="#f472b6" stroke-width="0.8"/><line x1="0" y1="3" x2="0" y2="5" stroke="#f472b6" stroke-width="0.8"/>`
};

// =========== HEXASTEAL IIFE ===========
const HexAsteal = (function () {
  'use strict';

  // =========== CONSTANTS ===========
  const COLS = 9, ROWS = 7, HEX_R = 30, MAX_POWER = 9, TOTAL_STAGES = 30;
  const HEX_W = Math.sqrt(3) * HEX_R, ROW_H = HEX_R * 1.5;
  const PAD_X = HEX_W / 2 + 14, PAD_Y = HEX_R + 14;
  const PLAYER = 'player', ENEMY = 'enemy', NEUTRAL = 'neutral', BLOCKED = 'blocked';
  const PLAYER2 = 'player2';
  const DIRS_EVEN = [[-1,-1],[-1,0],[0,1],[1,0],[1,-1],[0,-1]];
  const DIRS_ODD  = [[-1,0],[-1,1],[0,1],[1,1],[1,0],[0,-1]];
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const POWERUPS = {
    surge:  { label: 'Surge'  },
    shield: { label: 'Shield' },
    drain:  { label: 'Drain'  },
    blaze:  { label: 'Blaze'  },
    freeze: { label: 'Freeze' },
    spread: { label: 'Spread' }
  };
  const PU_KEYS = Object.keys(POWERUPS);

  // =========== GAME MODE ===========
  let gameMode = 'ai';
  let localTurn = PLAYER;

  // =========== AI DIFFICULTY ===========
  const AI_DIFFICULTIES = [
    { id: 'normal',  label: 'Normal',  cls: 'diff-normal',  scoreThresh: 50,  randomFactor: 12, hexoneXMult: 1.0  },
    { id: 'hard',    label: 'Hard',    cls: 'diff-hard',    scoreThresh: 30,  randomFactor: 6,  hexoneXMult: 1.5  },
    { id: 'intense', label: 'Intense', cls: 'diff-intense', scoreThresh: 10,  randomFactor: 3,  hexoneXMult: 2.0  },
    { id: 'extreme', label: 'Extreme', cls: 'diff-extreme', scoreThresh: -20, randomFactor: 1,  hexoneXMult: 3.0  },
    { id: 'easy',    label: 'Easy',    cls: 'diff-easy',    scoreThresh: 80,  randomFactor: 25, hexoneXMult: 0.5  }
  ];
  let aiDiffIndex = 0;

  function currentDiff() { return AI_DIFFICULTIES[aiDiffIndex]; }

  function cycleAIDifficulty() {
    SFX.click();
    aiDiffIndex = (aiDiffIndex + 1) % AI_DIFFICULTIES.length;
    updateDiffButton();
    setStatus(`AI difficulty set to: ${currentDiff().label}`);
  }

  function updateDiffButton() {
    const btn = document.getElementById('btn-ai-diff');
    const lbl = document.getElementById('ai-diff-label');
    if (!btn || !lbl) return;
    const d = currentDiff();
    AI_DIFFICULTIES.forEach(dd => btn.classList.remove(dd.cls));
    btn.classList.add(d.cls);
    lbl.textContent = d.label;
  }

  // =========== ONLINE ROOM SETTINGS ===========
  let onlineRoomSettings = { pups: 8, startHexes: 4, background: 'original' };

  // =========== OPPONENT SKIN DATA ===========
  let opponentSkinData = { color: 'green', design: 'none', cosmetic: 'none' };

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

  // =========== MUSIC ENGINE ===========
  const MUSIC_NORMAL = 'https://raw.githubusercontent.com/r2ftzu1ha2vy-glitch/HexAsteal/main/Untitled.mp3';
  const MUSIC_BOSS   = 'https://raw.githubusercontent.com/r2ftzu1ha2vy-glitch/HexAsteal/main/HexAsteal%20Boss%20Music-%5BAudioTrimmer.com%5D.mp3';

  const BGM = {
    _audio: null, _currentSrc: null, _muted: false,
    play(src) {
      if (this._muted) return;
      if (this._audio && this._currentSrc === src && !this._audio.paused) return;
      if (this._audio) { this._audio.pause(); this._audio.src = ''; }
      this._audio = new Audio(src);
      this._audio.loop = true; this._audio.volume = 0.45;
      this._currentSrc = src;
      const tryPlay = () => this._audio.play().catch(() => {});
      tryPlay();
      const unlock = () => {
        if (!this._muted && this._currentSrc === src) tryPlay();
        document.removeEventListener('click', unlock);
        document.removeEventListener('keydown', unlock);
        document.removeEventListener('touchstart', unlock);
      };
      document.addEventListener('click', unlock, { once: true });
      document.addEventListener('keydown', unlock, { once: true });
      document.addEventListener('touchstart', unlock, { once: true });
    },
    playForStage(isBossStage) { this.play(isBossStage ? MUSIC_BOSS : MUSIC_NORMAL); },
    mute() { this._muted = true; if (this._audio) this._audio.pause(); },
    unmute() { this._muted = false; if (this._audio && this._currentSrc) this._audio.play().catch(() => {}); },
    toggle() { if (this._muted) this.unmute(); else this.mute(); return !this._muted; }
  };

  // =========== TUTORIAL ===========
  const TUT = [
    { icon: '⬡', title: 'Welcome to HexAsteal!', text: 'A turn-based hex territory conquest game. Outsmart the enemy, capture power-ups, and conquer the board!' },
    { icon: '⬤', title: 'Your Territory', text: 'Green hexes are yours. Each shows a power level (1–9). Grow your army and dominate!' },
    { icon: '☞', title: 'Select & Attack', text: 'Click one of your hexes, then click an adjacent enemy or neutral hex to attack it.' },
    { icon: '⇄', title: 'Transfer Power', text: 'Click your hex, then an adjacent friendly hex to give it power. Source keeps 1, target gains the rest (max 9).' },
    { icon: '⚔︎', title: 'Power Wins', text: 'Your power must be HIGHER than the target. Winner keeps the difference. Equal power? Attacker just loses 1.' },
    { icon: '↗', title: 'Growth Phase', text: 'Every turn, all your hexes gain +1 power (max 9). Build up before striking!' },
    { icon: '✦', title: 'Power-Ups!', text: 'Colored hexes have power-ups: Surge (+3), Shield, Drain, Blaze (2×), Freeze, and Spread. Race to grab them!' },
    { icon: '▲', title: 'Mountains', text: 'Dark hexes with ▲ are impassable. Use them as cover and chokepoints!' },
    { icon: '𖤐', title: 'Boss Battles', text: 'Every 10th stage is a boss fight against HexAforce! Defeat the demon\'s mega-hex to win.' },
    { icon: '𐃯', title: 'Ready?', text: 'Capture all enemy hexes or have the most power when turns run out. Good luck, commander!' }
  ];

  // =========== STAGE CONFIG ===========
  function stageConfig(s) {
    const isBoss = s > 0 && s % 10 === 0;
    const tier = Math.min(Math.floor((s - 1) / 10), 2);
    const p = ((s - 1) % 10) / 9;
    if (isBoss) return {
      maxTurns: [35, 30, 28][tier], eHexes: [5, 7, 9][tier], ePow: [4, 5, 6][tier], pPow: 4,
      blocked: [3, 4, 4][tier], pups: 6, isBoss: true,
      bossPow: [7, 8, 9][tier], bossRegen: 2,
      bossName: ['HEXAFORCE', 'HEXAFORCE II', 'HEXAFORCE SUPREME'][tier], background: 'original'
    };
    return {
      maxTurns: Math.round(40 - tier * 4 - p * 3),
      eHexes: Math.min(Math.round(4 + tier * 1.5 + p * 1.5), 8),
      ePow: Math.min(Math.round(3 + tier * 0.7 + p * 0.8), 7),
      pPow: Math.min(3 + Math.floor(tier * 0.5), 5),
      blocked: Math.min(Math.round(4 + tier + p * 1.5), 8),
      pups: Math.max(Math.round(8 - tier - p * 1.5), 4),
      isBoss: false, bossPow: 0, bossRegen: 1, bossName: null, background: 'original'
    };
  }

  function mpConfig(roomSettings) {
    const s = sanitizeRoomSettings(roomSettings || {});
    return {
      maxTurns: 50, eHexes: s.startHexes || 4, ePow: 4, pPow: 4, blocked: 5,
      pups: s.pups !== undefined ? s.pups : 8,
      isBoss: false, bossPow: 0, bossRegen: 1, bossName: null, background: s.background || 'original'
    };
  }

  function sanitizeRoomSettings(raw) {
    const pups = parseInt(raw && raw.pups, 10);
    const startHexes = parseInt(raw && raw.startHexes, 10);
    return {
      pups: isNaN(pups) ? 8 : Math.max(0, Math.min(18, pups)),
      startHexes: isNaN(startHexes) ? 4 : Math.max(2, Math.min(8, startHexes)),
      background: (raw && raw.background) || 'original'
    };
  }

  function roomSettingsSummary(s) {
    return `Power-ups: ${s.pups} · Start hexes: ${s.startHexes} · Board: ${s.background}`;
  }

  function applyBoardTheme(theme) {
    if (!boardEl) return;
    const t = theme || 'original';
    boardEl.classList.remove('theme-original', 'theme-summer', 'theme-spring');
    boardEl.classList.add(`theme-${t}`);
  }

  function visualOwner(owner) {
    if (owner === PLAYER2) return 'player2';
    return owner;
  }

  function onlineOpponentSide() {
    return onlineSide === PLAYER ? PLAYER2 : PLAYER;
  }

  // =========== CODE GENERATION ===========
  function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return code;
  }

  function normalizeCode(str) {
    return str.toUpperCase().replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1').replace(/[^A-Z0-9]/g, '');
  }

  // =========== SKIN HELPERS ===========
  function getEquippedColorSkin() {
    const id = progress.equippedSkins.color || 'green';
    return SKINS.colors.find(s => s.id === id) || SKINS.colors[0];
  }

  function getDesignPatternId() {
    const id = progress.equippedSkins.design || 'none';
    if (id === 'none') return null;
    return `design-${id}`;
  }

  function cosmeticSVGPaths(id) {
    if (id === 'horns') return `
      <path d="M-7 -8 L-10 -20 Q-8 -17 -4 -10 Z" fill="#ef4444" stroke="#fca5a5" stroke-width="0.6"/>
      <path d="M7 -8 L10 -20 Q8 -17 4 -10 Z" fill="#ef4444" stroke="#fca5a5" stroke-width="0.6"/>`;
    if (id === 'halo') return `
      <ellipse cx="0" cy="-14" rx="9" ry="3.5" fill="none" stroke="#fde68a" stroke-width="2"/>
      <ellipse cx="0" cy="-14" rx="9" ry="3.5" fill="rgba(253,230,138,0.15)"/>`;
    if (id === 'crown') return `
      <path d="M-8 -8 L-8 -16 L-4 -12 L0 -18 L4 -12 L8 -16 L8 -8 Z" fill="#92400e" stroke="#fbbf24" stroke-width="1" stroke-linejoin="round"/>
      <circle cx="-8" cy="-16" r="1.5" fill="#fbbf24"/>
      <circle cx="0" cy="-18" r="1.5" fill="#fbbf24"/>
      <circle cx="8" cy="-16" r="1.5" fill="#fbbf24"/>
      <rect x="-8" y="-8" width="16" height="2.5" rx="0.8" fill="#fbbf24"/>`;
    if (id === 'cowboy') return `
      <ellipse cx="0" cy="-6" rx="10" ry="3" fill="#92400e" stroke="#78350f" stroke-width="0.8"/>
      <path d="M-7 -6 Q-14 -3 -13 1 Q-12 3 -8 2 L-6 -4 Z" fill="#92400e" stroke="#78350f" stroke-width="0.6"/>
      <path d="M7 -6 Q14 -3 13 1 Q12 3 8 2 L6 -4 Z" fill="#92400e" stroke="#78350f" stroke-width="0.6"/>
      <path d="M-6 -9 Q-5 -18 0 -20 Q5 -18 6 -9 Q3 -11 0 -11 Q-3 -11 -6 -9 Z" fill="#a16207" stroke="#78350f" stroke-width="0.8"/>
      <path d="M-4 -9 Q0 -7 4 -9" fill="none" stroke="#fbbf24" stroke-width="0.8" stroke-linecap="round"/>`;
    if (id === 'wings') return `
      <path d="M-3 -4 Q-12 -14 -18 -8 Q-14 -2 -8 0 Q-5 1 -3 0 Z" fill="#e0e7ff" stroke="#6366f1" stroke-width="0.7"/>
      <path d="M-3 -4 Q-10 -16 -14 -14 Q-12 -8 -6 -5 Z" fill="#c7d2fe" stroke="#6366f1" stroke-width="0.5"/>
      <path d="M3 -4 Q12 -14 18 -8 Q14 -2 8 0 Q5 1 3 0 Z" fill="#e0e7ff" stroke="#6366f1" stroke-width="0.7"/>
      <path d="M3 -4 Q10 -16 14 -14 Q12 -8 6 -5 Z" fill="#c7d2fe" stroke="#6366f1" stroke-width="0.5"/>
      <ellipse cx="0" cy="-2" rx="3" ry="4" fill="#a5b4fc" stroke="#6366f1" stroke-width="0.6"/>`;
    if (id === 'aura') return `
      <ellipse cx="0" cy="0" rx="18" ry="18" fill="none" stroke="#67e8f9" stroke-width="0.8" opacity="0.25"/>
      <ellipse cx="0" cy="0" rx="13" ry="13" fill="none" stroke="#a78bfa" stroke-width="0.8" opacity="0.4"/>
      <ellipse cx="0" cy="0" rx="8" ry="8" fill="none" stroke="#34d399" stroke-width="1" opacity="0.5"/>
      <circle cx="0" cy="0" r="3" fill="#67e8f9" opacity="0.2"/>
      <circle cx="-10" cy="-10" r="1" fill="#a78bfa" opacity="0.6"/>
      <circle cx="10" cy="-10" r="1" fill="#67e8f9" opacity="0.6"/>
      <circle cx="-10" cy="10" r="1" fill="#34d399" opacity="0.6"/>
      <circle cx="10" cy="10" r="1" fill="#a78bfa" opacity="0.6"/>`;
    return '';
  }

  function getCosmeticId() { return progress.equippedSkins.cosmetic || 'none'; }
  function getCosmeticMeta() { return null; }

  function getOpponentColorSkin() {
    if (gameMode === 'online') {
      const id = opponentSkinData.color || 'green';
      return SKINS.colors.find(s => s.id === id) || SKINS.colors[0];
    }
    return SKINS.colors[1];
  }

  function getOpponentDesignPatternId() {
    if (gameMode === 'online') {
      const id = opponentSkinData.design || 'none';
      if (id === 'none') return null;
      return `design-${id}`;
    }
    return null;
  }

  function getOpponentCosmeticId() {
    if (gameMode === 'online') return opponentSkinData.cosmetic || 'none';
    return 'none';
  }

  function getOpponentCosmeticMeta() { return null; }

  function isViewerOwned(owner) {
    if (gameMode === 'online') return owner === onlineSide;
    return owner === PLAYER;
  }

  function isOpponentOwned(owner) {
    if (gameMode === 'online') return owner === onlineOpponentSide();
    if (gameMode === 'local') return owner === PLAYER2;
    return false;
  }

  // =========== PROGRESS ===========
  const SAVE_KEY = 'hexastealv1';

  let progress = {
    stage: 1, completed: [], tutDone: false, soundOn: true,
    hexoneX: 0, username: 'Player1',
    ownedSkins: { colors: ['green'], designs: ['none'], cosmetics: ['none'] },
    equippedSkins: { color: 'green', design: 'none', cosmetic: 'none' }
  };

  const SKINS = {
    colors: [
      {id: 'green',   name: 'Classic Green', price: 0,   stroke: '#22c55e', fill: '#14532d'},
      {id: 'blue',    name: 'Cyber Blue',    price: 50,  stroke: '#3b82f6', fill: '#172554'},
      {id: 'purple',  name: 'Void Purple',   price: 75,  stroke: '#a855f7', fill: '#2e1065'},
      {id: 'crimson', name: 'Crimson Red',   price: 100, stroke: '#dc143c', fill: '#4a0010'},
      {id: 'gold',    name: 'Golden Glory',  price: 150, stroke: '#fbbf24', fill: '#92400e'},
      {id: 'rainbow', name: 'Rainbow',       price: 300, stroke: '#ef4444', fill: '#991b1b', animated: true},
      {id: 'void',    name: 'Void Rift',     price: 0,   stroke: '#ffffff', fill: '#000010', adminOnly: true},
      {id: 'aurora',  name: 'Aurora',        price: 0,   stroke: '#67e8f9', fill: '#0a1a2e', ownerOnly: true},
    ],
    designs: [
      {id: 'none',    name: 'Plain',   price: 0},
      {id: 'stripes', name: 'Stripes', price: 100},
      {id: 'swirl',   name: 'Swirl',   price: 125},
      {id: 'dots',    name: 'Dots',    price: 175},
      {id: 'zigzag',  name: 'Zigzag',  price: 150},
      {id: 'glitch',  name: 'Glitch',  price: 0,   adminOnly: true},
      {id: 'stars',   name: 'Stars',   price: 0,   ownerOnly: true},
    ],
    cosmetics: [
      {id: 'none',   name: 'None',          price: 0},
      {id: 'horns',  name: 'Devil Horns',   price: 200},
      {id: 'halo',   name: 'Angel Halo',    price: 200},
      {id: 'crown',  name: 'Victory Crown', price: 350},
      {id: 'cowboy', name: 'Cowboy Hat',    price: 275},
      {id: 'wings',  name: 'Admin Wings',   price: 0,   adminOnly: true},
      {id: 'aura',   name: 'Owner Aura',    price: 0,   ownerOnly: true},
    ]
  };

  function awardHexoneX(pHexes, _eHexes, won) {
    const mult = (gameMode === 'ai') ? currentDiff().hexoneXMult : 1.0;
    let earnings;
    if (won) {
      earnings = Math.round(pHexes * 5 * mult);
      progress.hexoneX += earnings;
      const diffTag = gameMode === 'ai' ? ` (${currentDiff().label})` : '';
      setStatus(`+${earnings} HexoneX! (Win Bonus${diffTag})`);
    } else {
      earnings = -(Math.floor(pHexes / 2) * 2);
      progress.hexoneX = Math.max(0, progress.hexoneX + earnings);
      setStatus(`${earnings} HexoneX (Loss Penalty)`);
    }
    saveProgress();
    updateShopButton();
  }

  // =========== BUY SKIN ===========
  function buySkin(type, id, price) {
    const skin = SKINS[type] && SKINS[type].find(s => s.id === id);
    if (!skin) return;
    if (!progress.ownedSkins[type]) progress.ownedSkins[type] = [];

    const isAdmin = window._hexAdminMode === true;
    const isOwner = window._hexOwnerMode === true;

    if (skin.adminOnly && !isAdmin) { setStatus('This item is admin-only!'); return; }
    if (skin.ownerOnly && !isOwner && !skin._gifted) { setStatus('This item is owner-exclusive!'); return; }

    const isOwned = progress.ownedSkins[type].includes(id);
    const label = isOwned ? `Equipping ${skin.name}…` : `Getting ${skin.name}…`;

    const effectivePrice = (skin.adminOnly || skin.ownerOnly) ? 0 : price;
    if (!isOwned && progress.hexoneX < effectivePrice) { setStatus('Not enough HexoneX!'); return; }

    const delay = Math.random() * 2000;
    showShopLoader(label);

    setTimeout(() => {
      hideShopLoader();

      if (!isOwned) {
        progress.ownedSkins[type].push(id);
        progress.hexoneX -= effectivePrice;
        saveProgress();
        setStatus(`Bought ${skin.name}!`);
      } else {
        const key = type === 'colors' ? 'color' : type === 'designs' ? 'design' : 'cosmetic';
        progress.equippedSkins[key] = id;
        saveProgress();
        setStatus(`Equipped ${skin.name}!`);
      }

      showShop();
      updateShopButton();
      render();

      if (type === 'colors') {
        if (id === 'rainbow') startRainbowLoop();
        else stopRainbowLoop();
      }
    }, delay);
  }

  function updateShopButton() {
    const btn = document.getElementById('btn-shop');
    const bal = document.getElementById('shop-bal');
    if (bal) bal.textContent = progress.hexoneX;
  }

  // =========== SHOP SVGs ===========
  function shopColorSVG(skin) {
    const hexPts = "25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5";
    if (skin.id === 'rainbow') {
      return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none" style="overflow:visible">
        <defs>
          <linearGradient id="rg_rainbow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stop-color="#ef4444"/>
            <stop offset="20%"  stop-color="#f97316"/>
            <stop offset="40%"  stop-color="#eab308"/>
            <stop offset="60%"  stop-color="#22c55e"/>
            <stop offset="80%"  stop-color="#3b82f6"/>
            <stop offset="100%" stop-color="#a855f7"/>
          </linearGradient>
        </defs>
        <polygon points="${hexPts}" fill="url(#rg_rainbow)" stroke="#fbbf24" stroke-width="2"
          style="animation: rainbow-hue 2s linear infinite;"/>
      </svg>`;
    }
    if (skin.id === 'aurora') {
      return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
        <defs>
          <linearGradient id="auroragrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#67e8f9"/>
            <stop offset="40%" stop-color="#a78bfa"/>
            <stop offset="80%" stop-color="#34d399"/>
            <stop offset="100%" stop-color="#67e8f9"/>
          </linearGradient>
        </defs>
        <polygon points="${hexPts}" fill="#0a1a2e" stroke="url(#auroragrad)" stroke-width="2.5"/>
        <polygon points="${hexPts}" fill="url(#auroragrad)" opacity="0.12"/>
        <text x="25" y="29" text-anchor="middle" font-size="8" fill="#67e8f9" font-weight="900" font-family="monospace">OWN</text>
      </svg>`;
    }
    if (skin.id === 'void') {
      return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
        <defs>
          <radialGradient id="voidgrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#1a0030"/>
            <stop offset="60%" stop-color="#000010"/>
            <stop offset="100%" stop-color="#000000"/>
          </radialGradient>
        </defs>
        <polygon points="${hexPts}" fill="url(#voidgrad)" stroke="#ffffff" stroke-width="2"/>
        <polygon points="${hexPts}" fill="none" stroke="#6366f1" stroke-width="0.8" stroke-dasharray="3 3"/>
        <circle cx="25" cy="25" r="5" fill="none" stroke="#ffffff" stroke-width="0.8" opacity="0.4"/>
        <text x="25" y="29" text-anchor="middle" font-size="9" fill="#6366f1" font-weight="900" font-family="monospace">ADM</text>
      </svg>`;
    }
    return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <polygon points="${hexPts}" fill="${skin.fill}" stroke="${skin.stroke}" stroke-width="2.5"/>
    </svg>`;
  }

  function shopDesignSVG(id) {
    const baseHex = `<polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5" fill="#1e2433" stroke="#374151" stroke-width="1.5"/>`;
    if (id === 'none') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">${baseHex}</svg>`;
    if (id === 'stripes') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <defs><clipPath id="hclip_s"><polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5"/></clipPath>
      <pattern id="stp" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,255,255,0.3)" stroke-width="3.5"/></pattern></defs>
      ${baseHex}<rect x="0" y="0" width="50" height="50" fill="url(#stp)" clip-path="url(#hclip_s)"/>
      <polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5" fill="none" stroke="#374151" stroke-width="1.5"/></svg>`;
    if (id === 'dots') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <defs><clipPath id="hclip_d"><polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5"/></clipPath>
      <pattern id="dtp" patternUnits="userSpaceOnUse" width="9" height="9"><circle cx="4.5" cy="4.5" r="2" fill="rgba(255,255,255,0.28)"/></pattern></defs>
      ${baseHex}<rect x="0" y="0" width="50" height="50" fill="url(#dtp)" clip-path="url(#hclip_d)"/>
      <polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5" fill="none" stroke="#374151" stroke-width="1.5"/></svg>`;
    if (id === 'swirl') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <defs><clipPath id="hclip_w"><polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5"/></clipPath></defs>
      ${baseHex}
      <g clip-path="url(#hclip_w)">
        <path d="M25 8 Q42 25 25 42 Q8 25 25 8" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.8"/>
        <path d="M25 14 Q38 25 25 36 Q12 25 25 14" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.4"/>
      </g>
      <polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5" fill="none" stroke="#374151" stroke-width="1.5"/></svg>`;
    if (id === 'zigzag') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <defs><clipPath id="hclip_z"><polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5"/></clipPath>
      <pattern id="zzp" patternUnits="userSpaceOnUse" width="12" height="8">
        <polyline points="0,8 6,0 12,8" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.4" stroke-linejoin="round"/>
      </pattern></defs>
      ${baseHex}<rect x="0" y="0" width="50" height="50" fill="url(#zzp)" clip-path="url(#hclip_z)"/>
      <polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5" fill="none" stroke="#374151" stroke-width="1.5"/></svg>`;
    if (id === 'glitch') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <defs><clipPath id="hclip_g"><polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5"/></clipPath></defs>
      ${baseHex}
      <g clip-path="url(#hclip_g)">
        <rect x="7" y="14" width="36" height="3" fill="#6366f1" opacity="0.5"/>
        <rect x="7" y="22" width="28" height="2" fill="#ec4899" opacity="0.6" transform="translate(4,0)"/>
        <rect x="7" y="29" width="36" height="3" fill="#06b6d4" opacity="0.45"/>
        <rect x="7" y="36" width="20" height="2" fill="#6366f1" opacity="0.5" transform="translate(-3,0)"/>
        <rect x="10" y="18" width="8" height="8" fill="#000" opacity="0.3"/>
        <rect x="30" y="26" width="10" height="5" fill="#ec4899" opacity="0.25"/>
      </g>
      <polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5" fill="none" stroke="#6366f1" stroke-width="1.5"/></svg>`;
    if (id === 'stars') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <defs><clipPath id="hclip_st"><polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5"/></clipPath></defs>
      ${baseHex}
      <g clip-path="url(#hclip_st)">
        <circle cx="15" cy="15" r="1.2" fill="#67e8f9" opacity="0.9"/>
        <circle cx="30" cy="12" r="0.8" fill="#a78bfa" opacity="0.9"/>
        <circle cx="38" cy="22" r="1.4" fill="#67e8f9" opacity="0.7"/>
        <circle cx="20" cy="30" r="1" fill="#34d399" opacity="0.9"/>
        <circle cx="35" cy="35" r="1.2" fill="#a78bfa" opacity="0.8"/>
        <circle cx="12" cy="38" r="0.9" fill="#67e8f9" opacity="0.7"/>
        <circle cx="25" cy="20" r="1.6" fill="#fde68a" opacity="0.6"/>
        <path d="M25 17 L25.6 19 L27.5 19 L26 20.2 L26.6 22.2 L25 21 L23.4 22.2 L24 20.2 L22.5 19 L24.4 19 Z" fill="#fde68a" opacity="0.5"/>
      </g>
      <polygon points="25,4 43,14.5 43,35.5 25,46 7,35.5 7,14.5" fill="none" stroke="#67e8f9" stroke-width="1.5"/></svg>`;
    return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">${baseHex}</svg>`;
  }

  function shopCosmeticSVG(id) {
    if (id === 'horns') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <path d="M15 32 L10 10 Q12 16 18 24 Z" fill="#ef4444" stroke="#fca5a5" stroke-width="1.2"/>
      <path d="M35 32 L40 10 Q38 16 32 24 Z" fill="#ef4444" stroke="#fca5a5" stroke-width="1.2"/>
      <path d="M15 32 Q25 28 35 32" stroke="#dc2626" stroke-width="1" fill="none" stroke-linecap="round"/>
    </svg>`;
    if (id === 'halo') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <ellipse cx="25" cy="18" rx="15" ry="6" fill="rgba(253,230,138,0.15)" stroke="#fde68a" stroke-width="3"/>
      <line x1="13" y1="18" x2="10" y2="40" stroke="#fde68a" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.5"/>
      <line x1="37" y1="18" x2="40" y2="40" stroke="#fde68a" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.5"/>
    </svg>`;
    if (id === 'crown') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <path d="M8 38 L8 22 L16 30 L25 12 L34 30 L42 22 L42 38 Z" fill="#92400e" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="8" cy="22" r="3" fill="#fbbf24"/>
      <circle cx="25" cy="12" r="3" fill="#fbbf24"/>
      <circle cx="42" cy="22" r="3" fill="#fbbf24"/>
      <rect x="8" y="38" width="34" height="5" rx="1.5" fill="#fbbf24"/>
    </svg>`;
    if (id === 'cowboy') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <ellipse cx="25" cy="30" rx="18" ry="6" fill="#92400e" stroke="#78350f" stroke-width="1.5"/>
      <path d="M14 28 Q6 22 7 16 Q8 12 14 14 L16 28 Z" fill="#92400e" stroke="#78350f" stroke-width="1"/>
      <path d="M36 28 Q44 22 43 16 Q42 12 36 14 L34 28 Z" fill="#92400e" stroke="#78350f" stroke-width="1"/>
      <path d="M15 28 Q15 12 25 10 Q35 12 35 28 Q30 24 25 24 Q20 24 15 28 Z" fill="#a16207" stroke="#78350f" stroke-width="1.5"/>
      <path d="M17 27 Q25 22 33 27" fill="none" stroke="#fbbf24" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="17" y="26" width="16" height="3" rx="1.5" fill="#b45309"/>
      <rect x="18" y="26.5" width="14" height="2" rx="1" fill="#fbbf24" opacity="0.6"/>
    </svg>`;
    if (id === 'wings') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <path d="M22 30 Q8 18 4 22 Q8 34 16 35 Q19 35 22 33 Z" fill="#e0e7ff" stroke="#6366f1" stroke-width="1.2"/>
      <path d="M22 30 Q10 16 6 18 Q10 26 18 28 Z" fill="#c7d2fe" stroke="#6366f1" stroke-width="0.8"/>
      <path d="M28 30 Q42 18 46 22 Q42 34 34 35 Q31 35 28 33 Z" fill="#e0e7ff" stroke="#6366f1" stroke-width="1.2"/>
      <path d="M28 30 Q40 16 44 18 Q40 26 32 28 Z" fill="#c7d2fe" stroke="#6366f1" stroke-width="0.8"/>
      <ellipse cx="25" cy="32" rx="4" ry="6" fill="#a5b4fc" stroke="#6366f1" stroke-width="1"/>
      <circle cx="25" cy="26" r="2" fill="#6366f1" opacity="0.6"/>
    </svg>`;
    if (id === 'aura') return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <ellipse cx="25" cy="25" rx="20" ry="20" fill="none" stroke="#67e8f9" stroke-width="1" opacity="0.3"/>
      <ellipse cx="25" cy="25" rx="15" ry="15" fill="none" stroke="#a78bfa" stroke-width="1" opacity="0.5"/>
      <ellipse cx="25" cy="25" rx="10" ry="10" fill="none" stroke="#34d399" stroke-width="1.2" opacity="0.6"/>
      <circle cx="25" cy="25" r="4" fill="#67e8f9" opacity="0.35"/>
      <circle cx="25" cy="25" r="2" fill="#ffffff" opacity="0.5"/>
      <circle cx="15" cy="15" r="1.5" fill="#a78bfa" opacity="0.7"/>
      <circle cx="35" cy="15" r="1.5" fill="#67e8f9" opacity="0.7"/>
      <circle cx="15" cy="35" r="1.5" fill="#34d399" opacity="0.7"/>
      <circle cx="35" cy="35" r="1.5" fill="#a78bfa" opacity="0.7"/>
    </svg>`;
    return `<svg width="50" height="50" viewBox="0 0 50 50" fill="none">
      <circle cx="25" cy="25" r="16" fill="#1a1a2e" stroke="#374151" stroke-width="1.5"/>
      <line x1="15" y1="15" x2="35" y2="35" stroke="#4b5563" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="35" y1="15" x2="15" y2="35" stroke="#4b5563" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  }

  function showShop() {
    const overlay = document.getElementById('shop-overlay');
    if (!overlay) return;
    const balEl = document.getElementById('hexoneX-balance');
    if (balEl) balEl.textContent = progress.hexoneX;

    const isAdmin = window._hexAdminMode === true;
    const isOwner = window._hexOwnerMode === true;

    function renderSkinList(type, items) {
      return items
        .filter(skin => {
          if (skin.adminOnly) return isAdmin;
          if (skin.ownerOnly) return isOwner;
          return true;
        })
        .map(skin => {
          const ownedArr = progress.ownedSkins[type] || [];
          const isOwned = ownedArr.includes(skin.id);
          const isEquipped = progress.equippedSkins[type === 'colors' ? 'color' : type === 'designs' ? 'design' : 'cosmetic'] === skin.id;
          const adminBadge = skin.adminOnly
            ? `<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(99,102,241,0.2);border:1px solid #6366f1;color:#a5b4fc;font-weight:800;letter-spacing:0.5px;margin-left:4px;">ADMIN</span>`
            : '';
          const ownerBadge = skin.ownerOnly
            ? `<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(103,232,249,0.15);border:1px solid #67e8f9;color:#67e8f9;font-weight:800;letter-spacing:0.5px;margin-left:4px;">OWNER</span>`
            : '';
          let previewSVG = '';
          if (type === 'colors') previewSVG = shopColorSVG(skin);
          else if (type === 'designs') previewSVG = shopDesignSVG(skin.id);
          else previewSVG = shopCosmeticSVG(skin.id);
          const priceLabel = (skin.adminOnly || skin.ownerOnly) ? 'FREE (Exclusive)' : `${skin.price} HexoneX`;
          return `
            <div class="skin-item ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''}">
              <div class="skin-preview" style="width:50px;height:50px;flex-shrink:0;">${previewSVG}</div>
              <div style="flex:1">
                <div style="font-size:12px;font-weight:700;color:#f3f4f6">${skin.name}${adminBadge}${ownerBadge}</div>
                <small style="color:${skin.adminOnly ? '#a5b4fc' : skin.ownerOnly ? '#67e8f9' : '#fbbf24'}">${priceLabel}</small>
              </div>
              <button class="shop-action-btn" onclick="HexAsteal.buySkin('${type}', '${skin.id}', ${skin.price})">
                ${isOwned ? 'Equip' : 'Get'}
              </button>
            </div>`;
        }).join('');
    }

    const colorsEl = document.getElementById('shop-colors');
    if (colorsEl) colorsEl.innerHTML = renderSkinList('colors', SKINS.colors);
    const designsEl = document.getElementById('shop-designs');
    if (designsEl) designsEl.innerHTML = renderSkinList('designs', SKINS.designs);
    const cosmeticsEl = document.getElementById('shop-cosmetics');
    if (cosmeticsEl) cosmeticsEl.innerHTML = renderSkinList('cosmetics', SKINS.cosmetics);

    overlay.classList.remove('hidden');
  }

  function closeShop() {
    const overlay = document.getElementById('shop-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function switchTab(tab) {
    ['colors', 'designs', 'cosmetics'].forEach(t => {
      const el = document.getElementById(`shop-${t}`);
      if (el) el.style.display = (t === tab) ? '' : 'none';
    });
    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
      const tabs = ['colors', 'designs', 'cosmetics'];
      btn.classList.toggle('active', tabs[i] === tab);
    });
  }

  function loadProgress() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d) {
        progress = { ...progress, ...d };
        if (!progress.ownedSkins) progress.ownedSkins = { colors: ['green'], designs: ['none'], cosmetics: ['none'] };
        if (!progress.ownedSkins.colors)    progress.ownedSkins.colors    = ['green'];
        if (!progress.ownedSkins.designs)   progress.ownedSkins.designs   = ['none'];
        if (!progress.ownedSkins.cosmetics) progress.ownedSkins.cosmetics = ['none'];
        if (!progress.equippedSkins) progress.equippedSkins = { color: 'green', design: 'none', cosmetic: 'none' };
      }
    } catch(e) {}

    if (!progress.username || progress.username === 'Player1' || progress.username === 'Player2') {
      const candidate = generateRandomUsername();
      claimUsername(candidate).then(accepted => {
        progress.username = accepted;
        saveProgress();
        updateUsernameDisplay();
      });
      progress.username = candidate;
    }

    SFX.on = progress.soundOn;
    if (!progress.soundOn) BGM.mute();
    if (progress.equippedSkins.color === 'rainbow') startRainbowLoop();
  }

  function saveProgress() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  }

  // =========== USERNAME SYSTEM ===========
  const USERNAME_ADJECTIVES = [
    'Clever','Silent','Bold','Swift','Lucky','Bright','Sharp','Calm','Fierce','Nimble',
    'Sneaky','Rapid','Wise','Mystic','Chill','Brave','Keen','Smooth','Agile','Steady',
    'Daring','Crisp','Subtle','Flash','Noble','Quick','Vivid','Solid','Prime','True'
  ];

function generateRandomUsername() {
    const adj = USERNAME_ADJECTIVES[Math.floor(Math.random() * USERNAME_ADJECTIVES.length)];
    const num = String(Math.floor(Math.random() * 900) + 100);
    return `${adj}${num}`;
  }

  async function claimUsername(desired) {
    const clean = desired.trim().slice(0, 16);
    if (!clean) return generateRandomUsername();

    const usernameRef = ref(database, `usernames/${clean}`);
    try {
      const snap = await get(usernameRef);
      if (!snap.exists()) {
        if (progress.username && progress.username !== clean) {
          set(ref(database, `usernames/${progress.username}`), null).catch(() => {});
        }
        await set(usernameRef, { claimedAt: Date.now(), prev: progress.username || '' });
        return clean;
      } else {
        let attempt = clean.slice(0, 12);
        for (let tries = 0; tries < 10; tries++) {
          const suf = String(Math.floor(Math.random() * 900) + 100);
          const candidate = attempt + suf;
          const cs = await get(ref(database, `usernames/${candidate}`));
          if (!cs.exists()) {
            if (progress.username && progress.username !== candidate) {
              set(ref(database, `usernames/${progress.username}`), null).catch(() => {});
            }
            await set(ref(database, `usernames/${candidate}`), { claimedAt: Date.now(), prev: progress.username || '' });
            return candidate;
          }
        }
        return clean + Math.floor(Math.random() * 9000 + 1000);
      }
    } catch(e) {
      return clean;
    }
  }

  async function findUserByUsername(username) {
    try {
      const snap = await get(ref(database, `online_users/${username}`));
      if (snap.exists()) return snap.val();
    } catch(e) {}
    return null;
  }

  function registerOnlineUser() {
    if (!progress.username || !roomCode) return;
    set(ref(database, `online_users/${progress.username}`), {
      roomCode, side: onlineSide, ts: Date.now()
    }).catch(() => {});
  }

  function unregisterOnlineUser() {
    if (!progress.username) return;
    set(ref(database, `online_users/${progress.username}`), null).catch(() => {});
  }

  // =========== USERNAME ===========
function showUsernameEdit() {
    SFX.click();
    const overlay = document.getElementById('username-overlay');
    const input = document.getElementById('username-input');
    if (input) {
      input.value = progress.username || '';
      input.placeholder = 'Enter username…';
      input.maxLength = 20;
    }
    const descEl = overlay.querySelector('p');
    if (descEl) descEl.textContent = 'Choose a unique username (3–20 characters). No two players share the same name.';
    overlay.classList.remove('hidden');
    setTimeout(() => input && input.focus(), 50);
  }

function saveUsername() {
    SFX.click();
    const input = document.getElementById('username-input');
    const raw = (input.value || '').trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
    if (raw.length < 3) { setStatus('Username must be at least 3 characters!'); return; }

    const btnSave = document.querySelector('#username-overlay .btn-primary');
    if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Checking…'; }

    claimUsername(raw).then(accepted => {
      progress.username = accepted;
      saveProgress();
      updateUsernameDisplay();
      document.getElementById('username-overlay').classList.add('hidden');
      setStatus(`Username set: ${accepted}`);
      if (btnSave) { btnSave.disabled = false; btnSave.textContent = 'Save'; }
    });
  }

  function closeUsernameEdit() {
    SFX.click();
    document.getElementById('username-overlay').classList.add('hidden');
  }

  function updateUsernameDisplay() {
    const el = document.getElementById('my-username-display');
    if (el) el.textContent = progress.username || 'Me';
  }

  // =========== VS BAR ===========
  function updateVSBar(p1Name, p2Name) {
    const bar = document.getElementById('vs-bar');
    const p1El = document.getElementById('vs-p1-name');
    const p2El = document.getElementById('vs-p2-name');
    if (!bar) return;
    if (p1Name && p2Name) {
      p1El.textContent = p1Name;
      p2El.textContent = p2Name;
      p2El.className = 'vs-name ' + (gameMode === 'local' ? 'vs-p2-blue' : 'vs-p2');
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  }

  // =========== STATE ===========
  let grid = [], turn = 1, phase = 'select';
  let selectedHex = null, validTargets = [], transferTargets = [], hexEls = {};
  let animating = false, currentStage = 1, cfg = stageConfig(1), tutStep = 0;

  // =========== DOM REFS ===========
  let svgEl, statusEl, turnEl, turnMaxEl, stageNumEl, bossBadge, boardEl;
  let pHexesEl, pPowerEl, eHexesEl, ePowerEl, foeLabel, enemyDot, playerDot, btnSkip, btnSound;
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

  function activeOwner() {
    if (gameMode === 'local') return localTurn;
    if (gameMode === 'online') return onlineSide;
    return PLAYER;
  }
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
    const pStarts = [[5,0],[5,1],[6,0],[6,1]];
    const eHexCount = Math.min(cfg.eHexes, 8);
    pStarts.slice(0, Math.min(cfg.pPow > 0 ? 4 : 4, 4)).forEach(([r,c]) => {
      grid[r][c] = makeCell(PLAYER, cfg.pPow + randInt(2));
    });

    if (isMP) {
      const p2Starts = [[0,7],[0,8],[1,7],[1,8]];
      const p2Count = Math.min(cfg.eHexes, p2Starts.length);
      p2Starts.slice(0, p2Count).forEach(([r,c]) => {
        grid[r][c] = makeCell(PLAYER2, cfg.pPow + randInt(2));
      });
      if (cfg.eHexes > 4) {
        const extras = [[1,6],[0,6],[2,7],[2,8]];
        let need = cfg.eHexes - 4;
        for (const [r, c] of extras) {
          if (need <= 0) break;
          if (grid[r][c].owner === NEUTRAL) { grid[r][c] = makeCell(PLAYER2, cfg.pPow + randInt(2)); need--; }
        }
      }
      if (cfg.eHexes > 4) {
        const extras2 = [[4,0],[4,1],[5,2],[6,2]];
        let need2 = cfg.eHexes - 4;
        for (const [r, c] of extras2) {
          if (need2 <= 0) break;
          if (grid[r][c].owner === NEUTRAL) { grid[r][c] = makeCell(PLAYER, cfg.pPow + randInt(2)); need2--; }
        }
      }
    } else if (cfg.isBoss) {
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
    } else {
      const ePrimary = [[0,7],[0,8],[1,7],[1,8]];
      const used = new Set(ePrimary.map(([r,c]) => `${r},${c}`));
      ePrimary.slice(0, Math.min(eHexCount, ePrimary.length)).forEach(([r,c]) => {
        grid[r][c] = makeCell(ENEMY, cfg.ePow + randInt(2));
      });
      let need = eHexCount - Math.min(eHexCount, ePrimary.length);
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

    const p2Starts = [[0,7],[0,8],[1,7],[1,8]];
    let placed = 0, att = 0;
    while (placed < cfg.blocked && att < 300) {
      att++;
      const r = randInt(ROWS), c = randInt(COLS);
      if (grid[r][c].owner !== NEUTRAL) continue;
      const nearP  = pStarts.some(([sr,sc]) => Math.abs(r-sr)+Math.abs(c-sc) <= 2);
      const nearP2 = isMP && p2Starts.some(([sr,sc]) => Math.abs(r-sr)+Math.abs(c-sc) <= 2);
      const nearB  = cfg.isBoss && Math.abs(r-3)+Math.abs(c-4) <= 2;
      if (nearP || nearP2 || nearB) continue;
      grid[r][c] = makeCell(BLOCKED, 0);
      placed++;
    }

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

    const stripePat = document.createElementNS(NS, 'pattern');
    stripePat.setAttribute('id', 'design-stripes');
    stripePat.setAttribute('patternUnits', 'userSpaceOnUse');
    stripePat.setAttribute('width', '8'); stripePat.setAttribute('height', '8');
    stripePat.setAttribute('patternTransform', 'rotate(45)');
    const stripeLine = document.createElementNS(NS, 'line');
    stripeLine.setAttribute('x1', '0'); stripeLine.setAttribute('y1', '0');
    stripeLine.setAttribute('x2', '0'); stripeLine.setAttribute('y2', '8');
    stripeLine.setAttribute('stroke', 'rgba(255,255,255,0.18)'); stripeLine.setAttribute('stroke-width', '4');
    stripePat.appendChild(stripeLine);
    defs.appendChild(stripePat);

    const dotsPat = document.createElementNS(NS, 'pattern');
    dotsPat.setAttribute('id', 'design-dots');
    dotsPat.setAttribute('patternUnits', 'userSpaceOnUse');
    dotsPat.setAttribute('width', '10'); dotsPat.setAttribute('height', '10');
    const dotsCircle = document.createElementNS(NS, 'circle');
    dotsCircle.setAttribute('cx', '5'); dotsCircle.setAttribute('cy', '5'); dotsCircle.setAttribute('r', '1.5');
    dotsCircle.setAttribute('fill', 'rgba(255,255,255,0.22)');
    dotsPat.appendChild(dotsCircle);
    defs.appendChild(dotsPat);

    const swirlPat = document.createElementNS(NS, 'pattern');
    swirlPat.setAttribute('id', 'design-swirl');
    swirlPat.setAttribute('patternUnits', 'userSpaceOnUse');
    swirlPat.setAttribute('width', '20'); swirlPat.setAttribute('height', '20');
    const swirlPath = document.createElementNS(NS, 'path');
    swirlPath.setAttribute('d', 'M10,2 Q18,10 10,18 Q2,10 10,2');
    swirlPath.setAttribute('fill', 'none');
    swirlPath.setAttribute('stroke', 'rgba(255,255,255,0.15)'); swirlPath.setAttribute('stroke-width', '1.5');
    swirlPat.appendChild(swirlPath);
    defs.appendChild(swirlPat);

    const zigzagPat = document.createElementNS(NS, 'pattern');
    zigzagPat.setAttribute('id', 'design-zigzag');
    zigzagPat.setAttribute('patternUnits', 'userSpaceOnUse');
    zigzagPat.setAttribute('width', '12'); zigzagPat.setAttribute('height', '8');
    const zzPolyline = document.createElementNS(NS, 'polyline');
    zzPolyline.setAttribute('points', '0,8 6,0 12,8');
    zzPolyline.setAttribute('fill', 'none');
    zzPolyline.setAttribute('stroke', 'rgba(255,255,255,0.2)');
    zzPolyline.setAttribute('stroke-width', '1.4');
    zzPolyline.setAttribute('stroke-linejoin', 'round');
    zigzagPat.appendChild(zzPolyline);
    defs.appendChild(zigzagPat);

    const glitchPat = document.createElementNS(NS, 'pattern');
    glitchPat.setAttribute('id', 'design-glitch');
    glitchPat.setAttribute('patternUnits', 'userSpaceOnUse');
    glitchPat.setAttribute('width', '60'); glitchPat.setAttribute('height', '12');
    const glitchBands = [
      ['0','0','60','3','#6366f1','0.45'],
      ['4','3','44','2','#ec4899','0.4'],
      ['0','5','60','1','#06b6d4','0.35'],
      ['8','6','30','2','#000','0.25'],
      ['0','8','60','2','#6366f1','0.3'],
      ['16','10','20','2','#ec4899','0.35'],
    ];
    glitchBands.forEach(([x,y,w,h,fill,op]) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('fill', fill); r.setAttribute('opacity', op);
      glitchPat.appendChild(r);
    });
    defs.appendChild(glitchPat);

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

        const puIconGroup = document.createElementNS(NS, 'g');
        puIconGroup.setAttribute('transform', `translate(${cx},${cy + 12})`);
        puIconGroup.style.pointerEvents = 'none';

        const statusIcon = document.createElementNS(NS, 'text');
        statusIcon.setAttribute('x', cx); statusIcon.setAttribute('y', cy);
        statusIcon.setAttribute('dy', '-0.9em'); statusIcon.setAttribute('class', 'hex-powerup-icon');

        const bossIcon = document.createElementNS(NS, 'text');
        bossIcon.setAttribute('x', cx); bossIcon.setAttribute('y', cy);
        bossIcon.setAttribute('dy', '1.6em'); bossIcon.setAttribute('class', 'boss-hex-icon');

        const designOverlay = document.createElementNS(NS, 'polygon');
        designOverlay.setAttribute('points', hexPoints(cx, cy));
        designOverlay.style.fill = 'none';
        designOverlay.style.pointerEvents = 'none';

        const cosmeticGroup = document.createElementNS(NS, 'g');
        cosmeticGroup.setAttribute('transform', `translate(${cx},${cy})`);
        cosmeticGroup.style.pointerEvents = 'none';

        g.appendChild(poly);
        g.appendChild(designOverlay);
        g.appendChild(txt);
        g.appendChild(puIconGroup);
        g.appendChild(statusIcon);
        g.appendChild(bossIcon);
        g.appendChild(cosmeticGroup);
        svgEl.appendChild(g);

        hexEls[`${r},${c}`] = {
          group: g, polygon: poly, text: txt,
          puIcon: puIconGroup,
          statusIcon, bossIcon, designOverlay,
          cosmeticIcon: cosmeticGroup
        };
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
    const isRainbow = (progress.equippedSkins.color === 'rainbow');

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const key = `${r},${c}`;
        if (!hexEls[key]) continue;
        const cell = grid[r][c], el = hexEls[key];
        let cls = 'hex';

        const shownOwner = visualOwner(cell.owner);

        if (cell.powerup && cell.owner === NEUTRAL) cls += ` hex-powerup-${cell.powerup}`;
        else cls += ` hex-${shownOwner}`;

        if (cell.boss && cell.owner === ENEMY) cls += ' hex-boss';
        if (cell.blazeBuffed) cls += ' hex-blaze-buffed';
        if (cell.shielded) cls += ' hex-shielded';
        if (cell.frozen) cls += ' hex-frozen';

        if (selectedHex && selectedHex[0] === r && selectedHex[1] === c) {
          cls += ' hex-selected';
          if (gameMode === 'local' && ao === PLAYER2) cls += ' p2-selected';
        } else if (isValidTarget(r, c)) cls += ' hex-valid-target';
        else if (isTransferTarget(r, c)) cls += ' hex-transfer-target';
        else if (phase === 'select' && cell.owner === ao && !cell.frozen &&
          (getAttackTargets(r, c).length > 0 || getTransferTargets(r, c).length > 0)) {
          cls += ' hex-selectable';
          if (gameMode === 'local' && ao === PLAYER2) cls += ' p2-selectable';
        }

        el.polygon.setAttribute('class', cls);

        if (isViewerOwned(cell.owner)) {
          const colorSkin = getEquippedColorSkin();
          if (isRainbow) {
            el.polygon.classList.add('hex-rainbow-cell');
          } else if (colorSkin.id === 'void') {
            el.polygon.classList.remove('hex-rainbow-cell');
            el.polygon.classList.add('hex-void-cell');
            el.polygon.style.fill = '#000010';
            el.polygon.style.stroke = '#ffffff';
          } else {
            el.polygon.classList.remove('hex-rainbow-cell');
            el.polygon.classList.remove('hex-void-cell');
            el.polygon.style.fill = colorSkin.fill;
            el.polygon.style.stroke = colorSkin.stroke;
          }

          const patternId = getDesignPatternId();
          el.designOverlay.style.fill = patternId ? `url(#${patternId})` : 'none';

          const cid = getCosmeticId();
          el.cosmeticIcon.innerHTML = cosmeticSVGPaths(cid);
        } else if (isOpponentOwned(cell.owner)) {
          el.polygon.classList.remove('hex-rainbow-cell');
          const oppColor = getOpponentColorSkin();
          const isOppRainbow = (gameMode === 'online' && opponentSkinData.color === 'rainbow') ||
                               (gameMode === 'local' && false);
          if (isOppRainbow) {
            el.polygon.classList.add('hex-rainbow-cell');
          } else {
            el.polygon.style.fill = oppColor.fill;
            el.polygon.style.stroke = oppColor.stroke;
          }

          const oppPattern = getOpponentDesignPatternId();
          el.designOverlay.style.fill = oppPattern ? `url(#${oppPattern})` : 'none';

          const ocid = getOpponentCosmeticId();
          el.cosmeticIcon.innerHTML = cosmeticSVGPaths(ocid);
        } else {
          el.polygon.classList.remove('hex-rainbow-cell');
          el.polygon.style.fill = '';
          el.polygon.style.stroke = '';
          el.designOverlay.style.fill = 'none';
          el.cosmeticIcon.innerHTML = '';
        }

        el.text.textContent = cell.power;

        if (cell.powerup && cell.owner === NEUTRAL) {
          el.puIcon.innerHTML = POWERUP_SVG[cell.powerup] || '';
          if (!cls.includes('hex-valid-target') && !cls.includes('hex-selected'))
            el.polygon.style.filter = `url(#glow-${cell.powerup})`;
          else el.polygon.style.filter = '';
        } else {
          el.puIcon.innerHTML = '';
          if (!cls.includes('hex-selected') && !cls.includes('hex-selectable') && !cls.includes('hex-boss'))
            el.polygon.style.filter = '';
        }

        el.bossIcon.textContent = (cell.boss && cell.owner === ENEMY) ? '𖤐' : '';
        if (cell.boss && cell.owner === ENEMY) el.polygon.style.filter = 'url(#glow-boss)';

        let st = '';
        if (cell.blazeBuffed) st += 'ঌ';
        if (cell.shielded) st += '🛡';
        if (cell.frozen) st += '❄';
        el.statusIcon.textContent = st;
      }
    }
    updateHUD();
    btnSkip.disabled = (phase !== 'select' && phase !== 'target');

    if (gameMode === 'local') {
      boardEl.classList.toggle('p2-turn', localTurn === PLAYER2);
    }
  }

  function isValidTarget(r, c)    { return validTargets.some(([vr,vc]) => vr===r && vc===c); }
  function isTransferTarget(r, c) { return transferTargets.some(([vr,vc]) => vr===r && vc===c); }

  function updateHUD() {
    let pH = 0, pP = 0, eH = 0, eP = 0;
    const oppOnline = onlineOpponentSide();

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = grid[r][c];
      if (gameMode === 'online') {
        if (cell.owner === onlineSide) { pH++; pP += cell.power; }
        else if (cell.owner === oppOnline) { eH++; eP += cell.power; }
      } else {
        if (cell.owner === PLAYER) { pH++; pP += cell.power; }
        if (cell.owner === ENEMY || cell.owner === PLAYER2) { eH++; eP += cell.power; }
      }
    }

    turnEl.textContent = turn;
    turnMaxEl.textContent = '/ ' + cfg.maxTurns;
    stageNumEl.textContent = gameMode === 'ai' ? currentStage : (gameMode === 'local' ? 'L2P' : 'NET');
    pHexesEl.textContent = pH;
    pPowerEl.textContent = pP;
    eHexesEl.textContent = eH;
    ePowerEl.textContent = eP;

    const colorSkin = getEquippedColorSkin();
    playerDot.className = 'color-dot';
    playerDot.style.background = colorSkin.stroke;
    playerDot.style.boxShadow = `0 0 6px ${colorSkin.stroke}88`;

    if (gameMode === 'local') {
      pLabel.textContent = 'P1';
      foeLabel.textContent = 'P2';
      const oppColor = getOpponentColorSkin();
      enemyDot.className = 'color-dot';
      enemyDot.style.background = oppColor.stroke;
      enemyDot.style.boxShadow = `0 0 6px ${oppColor.stroke}88`;
      applyBoardTheme(cfg.background || 'original');
    } else if (gameMode === 'online') {
      pLabel.textContent = 'YOU';
      foeLabel.textContent = 'OPP';
      const oppColor = getOpponentColorSkin();
      enemyDot.className = 'color-dot';
      enemyDot.style.background = oppColor.stroke;
      enemyDot.style.boxShadow = `0 0 6px ${oppColor.stroke}88`;
      applyBoardTheme(cfg.background || 'original');
    } else {
      pLabel.textContent = 'YOU';
      foeLabel.textContent = cfg.isBoss ? (cfg.bossName || 'BOSS') : 'FOE';
      enemyDot.className = 'color-dot enemy-dot';
      enemyDot.style.background = '';
      enemyDot.style.boxShadow = '';
      applyBoardTheme('original');
    }

    if (cfg.isBoss && gameMode === 'ai') {
      bossBadge.classList.remove('hidden');
      boardEl.classList.add('boss-mode');
    } else {
      bossBadge.classList.add('hidden');
      boardEl.classList.remove('boss-mode');
    }

    updateShopButton();
  }

  // =========== TUTORIAL ===========
  function showTutorial() { tutStep = 0; renderTutStep(); tutOverlay.classList.remove('hidden'); }
  function renderTutStep() {
    const s = TUT[tutStep];
    tutIcon.textContent = s.icon; tutTitle.textContent = s.title; tutText.textContent = s.text;
    tutNextBtn.textContent = tutStep === TUT.length - 1 ? 'Play!' : 'Next';
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
  function replayTutorial() { SFX.click(); stagesOverlay.classList.add('hidden'); showTutorial(); }

  // =========== BOSS INTRO ===========
  function showBossIntro() {
    bossNameEl.textContent = cfg.bossName;
    bossSubEl.textContent = `Stage ${currentStage} — Boss Battle`;
    bossOverlay.classList.remove('hidden');
    BGM.playForStage(true);
    SFX.bossIntro();
  }
  function startBoss() { SFX.click(); bossOverlay.classList.add('hidden'); generateAndPlay(); }

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
        ? `<span class="stage-boss-icon">𖤐</span><span class="stage-num">${s}</span>`
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
    document.getElementById('mode-btn-ai').classList.toggle('active', gameMode === 'ai');
    document.getElementById('mode-btn-local').classList.toggle('active', gameMode === 'local');
    document.getElementById('mode-btn-online').classList.toggle('active', gameMode === 'online');
    modeOverlay.classList.remove('hidden');
  }
  function closeModeSelect() { SFX.click(); modeOverlay.classList.add('hidden'); }

  function selectMode(mode) {
    SFX.click(); modeOverlay.classList.add('hidden');
    if (mode === gameMode) return;
    gameMode = mode;
    if (mode === 'ai') { cancelOnline(); startStage(progress.stage); }
    else if (mode === 'local') { cancelOnline(); startLocalGame(); }
    else if (mode === 'online') { showOnlineLobby(); }
  }

  // =========== LOCAL 2P ===========
  function startLocalGame() {
    gameMode = 'local'; cfg = mpConfig(); localTurn = PLAYER;
    hideAllOverlays();
    const diffBtn = document.getElementById('btn-ai-diff');
    const leaveBtn = document.getElementById('btn-leave-online');
    if (diffBtn) diffBtn.classList.add('hidden');
    if (leaveBtn) leaveBtn.classList.add('hidden');
    BGM.playForStage(false);
    generateAndPlay();
    updateVSBar('Player 1', 'Player 2');
  }

  function showLocalTurnBanner() {
    const icon  = document.getElementById('local-banner-icon');
    const title = document.getElementById('local-banner-title');
    const sub   = document.getElementById('local-banner-sub');
    const oppColor = getOpponentColorSkin();
    if (localTurn === PLAYER) {
      const myColor = getEquippedColorSkin();
      icon.innerHTML = `<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="${myColor.fill}" stroke="${myColor.stroke}" stroke-width="2"/><circle cx="20" cy="20" r="8" fill="${myColor.stroke}" opacity="0.5"/></svg>`;
      title.textContent = "Player 1's Turn";
      sub.textContent = 'Pass the device to Player 1';
    } else {
      icon.innerHTML = `<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="${oppColor.fill}" stroke="${oppColor.stroke}" stroke-width="2"/><circle cx="20" cy="20" r="8" fill="${oppColor.stroke}" opacity="0.5"/></svg>`;
      title.textContent = "Player 2's Turn";
      sub.textContent = 'Pass the device to Player 2';
    }
    localTurnBanner.classList.remove('hidden');
  }
  function dismissLocalBanner() {
    SFX.click(); localTurnBanner.classList.add('hidden');
    phase = 'select';
    const who = localTurn === PLAYER ? 'Player 1' : 'Player 2';
    setStatus(`${who} — select a hex to attack or transfer`);
    render();
  }

  // =========== ONLINE MULTIPLAYER ===========
  function showOnlineLobby() { onlineOverlay.classList.remove('hidden'); showCreateJoin(); }

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
    setupCodeInputs();
    setTimeout(() => document.getElementById('cd0').focus(), 50);
  }

  function setupCodeInputs() {
    const TOTAL = 6;
    for (let i = 0; i < TOTAL; i++) {
      const el = document.getElementById(`cd${i}`);
      el.value = '';
      el.oninput = () => {
        el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);
        if (el.value && i < TOTAL - 1) document.getElementById(`cd${i+1}`).focus();
      };
      el.onkeydown = (e) => {
        if (e.key === 'Backspace' && !el.value && i > 0) document.getElementById(`cd${i-1}`).focus();
      };
      el.onpaste = (e) => {
        e.preventDefault();
        const pasted = normalizeCode((e.clipboardData || window.clipboardData).getData('text'));
        const chars = pasted.slice(0, TOTAL).split('');
        chars.forEach((ch, idx) => { const t = document.getElementById(`cd${idx}`); if (t) t.value = ch; });
        const focusIdx = Math.min(chars.length, TOTAL - 1);
        const focusEl = document.getElementById(`cd${focusIdx}`);
        if (focusEl) focusEl.focus();
      };
    }
  }

  function getCodeFromInputs() {
    return [0,1,2,3,4,5].map(i => {
      const el = document.getElementById(`cd${i}`);
      return el ? el.value.toUpperCase() : '';
    }).join('');
  }

  function getOnlineRoomSettings() {
    return sanitizeRoomSettings({
      pups: document.getElementById('room-powerups')?.value,
      startHexes: document.getElementById('room-start-hexes')?.value,
      background: document.getElementById('room-background')?.value
    });
  }

  function onlineCreate() {
    SFX.click();
    document.getElementById('online-create-join').classList.add('hidden');
    document.getElementById('online-waiting').classList.remove('hidden');
    document.getElementById('online-back-btn').style.display = 'none';

    const code = generateRoomCode();
    roomCode = code; onlineSide = PLAYER;
    onlineRoomSettings = getOnlineRoomSettings();

    document.getElementById('room-code-big').textContent = code;
    document.getElementById('waiting-text').innerHTML =
      `Waiting for opponent to join…<div class="room-settings-summary">${roomSettingsSummary(onlineRoomSettings)}</div>`;

    const seed = (Date.now() & 0xffff) + Math.floor(Math.random() * 1000);

    dbRef = ref(database, `rooms/${code}`);
    set(dbRef, {
      status: 'waiting', seed, settings: onlineRoomSettings, createdAt: Date.now(),
      p1_username: progress.username || 'Player1',
      p1_skin: { color: progress.equippedSkins.color, design: progress.equippedSkins.design, cosmetic: progress.equippedSkins.cosmetic }
    }).catch(err => { console.error('Create room error:', err); setOnlineStatus('Failed to create room.', 'error'); });

    const statusRef = ref(database, `rooms/${code}/status`);
    statusListener = onValue(statusRef, (snapshot) => {
      if (snapshot.val() === 'joined' && onlineSide === PLAYER) {
        get(dbRef).then(snap => {
          const d = snap.val() || {};
          if (d.p2_skin) opponentSkinData = d.p2_skin;
          const p2name = d.p2_username || 'Player2';
          update(dbRef, { status: 'started' }).catch(console.error);
          document.getElementById('waiting-text').textContent = 'Opponent joined! Starting…';
          setTimeout(() => {
            cleanupListeners();
            onlineOverlay.classList.add('hidden');
            startOnlineGame(true, seed, onlineRoomSettings, progress.username || 'Player1', p2name);
            startOnlineMoveListener();
          }, 700);
        }).catch(() => {
          update(dbRef, { status: 'started' }).catch(console.error);
          setTimeout(() => {
            cleanupListeners();
            onlineOverlay.classList.add('hidden');
            startOnlineGame(true, seed, onlineRoomSettings);
            startOnlineMoveListener();
          }, 700);
        });
      }
    });
  }

  function onlineJoin() {
    SFX.click();
    const code = getCodeFromInputs();
    if (code.length !== 6) { setOnlineStatus('Enter a valid 6-character code.', 'error'); return; }

    document.getElementById('online-join-form').classList.add('hidden');
    const connectingEl = document.getElementById('online-connecting');
    connectingEl.classList.remove('hidden');
    connectingEl.innerHTML = `<p class="mode-sub">Connecting to room ${code}…</p><div class="waiting-dots"><span></span><span></span><span></span></div>`;
    document.getElementById('online-back-btn').style.display = 'none';

    roomCode = code; onlineSide = PLAYER2;
    dbRef = ref(database, `rooms/${code}`);

    const joinTimeout = setTimeout(() => {
      connectingEl.innerHTML = `<p class="mode-sub" style="color:#f87171">Room not found or expired.</p>`;
      document.getElementById('online-back-btn').style.display = '';
    }, 12000);

    roomListener = onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        clearTimeout(joinTimeout);
        connectingEl.innerHTML = `<p class="mode-sub" style="color:#f87171">Room not found.</p>`;
        document.getElementById('online-back-btn').style.display = '';
        return;
      }
      clearTimeout(joinTimeout);

      if (data.status === 'waiting') {
        onlineRoomSettings = sanitizeRoomSettings(data.settings || {});
        if (data.p1_skin) opponentSkinData = data.p1_skin;
        update(dbRef, {
          status: 'joined',
          p2_username: progress.username || 'Player2',
          p2_skin: { color: progress.equippedSkins.color, design: progress.equippedSkins.design, cosmetic: progress.equippedSkins.cosmetic }
        }).catch(console.error);
        connectingEl.innerHTML =
          `<p class="mode-sub">Joined! Waiting for host to start…</p>
           <div class="room-settings-summary">${roomSettingsSummary(onlineRoomSettings)}</div>
           <div class="waiting-dots"><span></span><span></span><span></span></div>`;
      }

      if (data.status === 'started') {
        onlineRoomSettings = sanitizeRoomSettings(data.settings || {});
        if (data.p1_skin) opponentSkinData = data.p1_skin;
        cleanupListeners();
        onlineOverlay.classList.add('hidden');
        const p1name = data.p1_username || 'Player1';
        const p2name = progress.username || 'Player2';
        startOnlineGame(false, data.seed, onlineRoomSettings, p1name, p2name);
        startOnlineMoveListener();
      }
    });
  }

  // =========== RANDOM MATCHMAKING ===========
  async function findRandomMatch() {
    SFX.click();
    document.getElementById('online-create-join').classList.add('hidden');
    const connectingEl = document.getElementById('online-connecting');
    connectingEl.classList.remove('hidden');
    connectingEl.innerHTML = `<p class="mode-sub">Searching for a random opponent…</p><div class="waiting-dots"><span></span><span></span><span></span></div>`;
    document.getElementById('online-back-btn').style.display = 'none';

    try {
      const mmRef = ref(database, 'matchmaking');
      const snap = await get(mmRef);
      const rooms = snap.val();

      if (rooms) {
        const waiting = Object.entries(rooms).find(([code, data]) => data.status === 'waiting');
        if (waiting) {
          const [code, data] = waiting;
          roomCode = code; onlineSide = PLAYER2;
          dbRef = ref(database, `rooms/${code}`);
          if (data.p1_skin) opponentSkinData = data.p1_skin;
          onlineRoomSettings = sanitizeRoomSettings(data.settings || {});

          await set(ref(database, `matchmaking/${code}`), null);
          await update(dbRef, {
            status: 'joined',
            p2_username: progress.username || 'Player2',
            p2_skin: { color: progress.equippedSkins.color, design: progress.equippedSkins.design, cosmetic: progress.equippedSkins.cosmetic }
          });

          connectingEl.innerHTML = `<p class="mode-sub">Found opponent! Starting…</p><div class="waiting-dots"><span></span><span></span><span></span></div>`;

          roomListener = onValue(dbRef, (snapshot) => {
            const d = snapshot.val();
            if (!d) return;
            if (d.status === 'started') {
              if (d.p1_skin) opponentSkinData = d.p1_skin;
              cleanupListeners();
              onlineOverlay.classList.add('hidden');
              const p1name = d.p1_username || 'Player1';
              startOnlineGame(false, d.seed, onlineRoomSettings, p1name, progress.username || 'Player2');
              startOnlineMoveListener();
            }
          });
          return;
        }
      }

      const code = generateRoomCode();
      roomCode = code; onlineSide = PLAYER;
      onlineRoomSettings = getOnlineRoomSettings();
      const seed = (Date.now() & 0xffff) + Math.floor(Math.random() * 1000);

      dbRef = ref(database, `rooms/${code}`);
      await set(dbRef, {
        status: 'waiting', seed, settings: onlineRoomSettings, createdAt: Date.now(),
        p1_username: progress.username || 'Player1',
        p1_skin: { color: progress.equippedSkins.color, design: progress.equippedSkins.design, cosmetic: progress.equippedSkins.cosmetic }
      });
      await set(ref(database, `matchmaking/${code}`), {
        status: 'waiting', createdAt: Date.now(), settings: onlineRoomSettings,
        p1_skin: { color: progress.equippedSkins.color, design: progress.equippedSkins.design, cosmetic: progress.equippedSkins.cosmetic }
      });

      connectingEl.innerHTML = `<p class="mode-sub">Waiting for a random opponent…</p><div class="waiting-dots"><span></span><span></span><span></span></div><button class="btn-ghost" onclick="HexAsteal.cancelOnline()" style="margin-top:14px">Cancel</button>`;

      statusListener = onValue(ref(database, `rooms/${code}/status`), (snapshot) => {
        if (snapshot.val() === 'joined') {
          get(dbRef).then(snap => {
            const d = snap.val();
            if (d && d.p2_skin) opponentSkinData = d.p2_skin;
          });
          set(ref(database, `matchmaking/${code}`), null).catch(console.error);
          update(dbRef, { status: 'started' }).catch(console.error);
          setTimeout(() => {
            cleanupListeners();
            get(dbRef).then(snap => {
              const d = snap.val() || {};
              if (d.p2_skin) opponentSkinData = d.p2_skin;
              onlineOverlay.classList.add('hidden');
              const p2name = d.p2_username || 'Player2';
              startOnlineGame(true, seed, onlineRoomSettings, progress.username || 'Player1', p2name);
              startOnlineMoveListener();
            });
          }, 700);
        }
      });

    } catch (err) {
      console.error('Random match error:', err);
      connectingEl.innerHTML = `<p class="mode-sub" style="color:#f87171">Error finding match. Try again.</p>`;
      document.getElementById('online-back-btn').style.display = '';
    }
  }

  function startOnlineMoveListener() {
    if (!roomCode) return;
    const opponentMoveKey = onlineSide === PLAYER ? 'p2_move' : 'p1_move';
    const moveRef = ref(database, `rooms/${roomCode}/${opponentMoveKey}`);
    moveListener = onValue(moveRef, (snapshot) => {
      const data = snapshot.val();
      if (!data || !data.msgId || data.msgId === lastSeenMsgId) return;
      if (data.sender === onlineSide) return;
      lastSeenMsgId = data.msgId;
      if (data.turn !== turn) { console.warn('Turn mismatch:', data.turn, 'vs local', turn); return; }
      handleOnlineMessage(data);
    });
  }

  function cancelOnline() {
    cleanupListeners(); cleanupRematch(); teardownChat();
    if (_disconnectListener) { try { _disconnectListener(); } catch(e){} _disconnectListener = null; }

    if (dbRef && roomCode && onlineSide === PLAYER) {
      set(ref(database, `rooms/${roomCode}`), null).catch(() => {});
      set(ref(database, `matchmaking/${roomCode}`), null).catch(() => {});
    }

    dbRef = null; roomCode = null; lastSeenMsgId = null;
    _savedRoomCode = null; _savedOnlineSide = null;
    sessionStorage.removeItem('hexasteal_rejoin');
    unregisterOnlineUser();

    onlineOverlay.classList.add('hidden');
    if (gameMode === 'online') gameMode = 'ai';
    updateVSBar(null, null);

    const leaveBtn = document.getElementById('btn-leave-online');
    const diffBtn = document.getElementById('btn-ai-diff');
    if (leaveBtn) leaveBtn.classList.add('hidden');
    if (diffBtn) diffBtn.classList.remove('hidden');
    updateDiffButton();
  }

  function cleanupListeners() {
    if (statusListener && roomCode) {
      try { off(ref(database, `rooms/${roomCode}/status`)); } catch (e) {}
      statusListener = null;
    }
    if (roomListener && dbRef) {
      try { off(dbRef); } catch (e) {}
      roomListener = null;
    }
    if (moveListener && roomCode) {
      try {
        const key = onlineSide === PLAYER ? 'p2_move' : 'p1_move';
        off(ref(database, `rooms/${roomCode}/${key}`));
      } catch (e) {}
      moveListener = null;
    }
  }

  function sendOnline(msg) {
    if (!roomCode) return;
    const myMoveKey = onlineSide === PLAYER ? 'p1_move' : 'p2_move';
    const msgId = Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const payload = { msgId, sender: onlineSide, type: msg.type, move: msg.move || null, turn, ts: Date.now() };
    update(ref(database, `rooms/${roomCode}/${myMoveKey}`), payload).catch(err => console.error('Send move failed:', err));
  }

  function handleOnlineMessage(data) {
    if (!data || !data.type) return;
    if (data.sender === onlineSide) return;
    if (data.type === 'move') {
      if (phase !== 'wait-online') { console.warn('Wrong phase for move:', phase); return; }
      applyRemoteMove(data.move);
    } else if (data.type === 'skip') {
      if (phase !== 'wait-online') { console.warn('Wrong phase for skip:', phase); return; }
      applyRemoteSkip();
    }
  }

  let _rngSeed = 0;
  function seededRand(n) {
    _rngSeed = (_rngSeed * 1664525 + 1013904223) & 0xffffffff;
    return Math.abs(_rngSeed) % n;
  }

  function startOnlineGame(isHost, seed, roomSettings, p1name, p2name) {
    gameMode = 'online';
    onlineRoomSettings = sanitizeRoomSettings(roomSettings || {});
    cfg = mpConfig(onlineRoomSettings);
    hideAllOverlays();
    turn = 1; phase = 'select'; selectedHex = null; validTargets = []; transferTargets = []; animating = false;

    generateMapSeeded(seed || (Date.now() & 0xffff));
    createBoard();
    SFX.stageStart(); BGM.playForStage(false);
    render(); initChat();

    _savedRoomCode = roomCode; _savedOnlineSide = onlineSide;
    sessionStorage.setItem('hexasteal_rejoin', JSON.stringify({ roomCode, onlineSide, seed: seed || 0 }));

    const diffBtn = document.getElementById('btn-ai-diff');
    const leaveBtn = document.getElementById('btn-leave-online');
    if (diffBtn) diffBtn.classList.add('hidden');
    if (leaveBtn) leaveBtn.classList.remove('hidden');

    const myName = progress.username || (onlineSide === PLAYER ? 'Player1' : 'Player2');
    const oppName = (onlineSide === PLAYER ? (p2name || 'Player2') : (p1name || 'Player1'));
    if (onlineSide === PLAYER) updateVSBar(myName, oppName);
    else updateVSBar(p1name || 'Player1', myName);

    if (onlineSide === PLAYER) setStatus('Your turn (P1) — select a hex to attack or transfer');
    else { phase = 'wait-online'; setStatus('Waiting for P1 to move…'); }
    render();
    setupDisconnectDetection();
    startOwnerGiftListener();
    registerOnlineUser();
  }

  // =========== CHAT ===========
  function initChat() {
    const panel = document.getElementById('chat-panel');
    if (!panel) return;
    panel.classList.remove('hidden'); panel.classList.add('collapsed');
    chatOpen = false; unreadCount = 0;
    document.getElementById('chat-messages').innerHTML = '';
    appendSystemMsg('Chat connected · say hi!');

    if (chatListener && roomCode) {
      try { off(ref(database, `rooms/${roomCode}/chat`)); } catch (e) {}
    }

    chatListener = onValue(ref(database, `rooms/${roomCode}/chat`), (snap) => {
      const msgs = snap.val();
      if (!msgs) return;
      const container = document.getElementById('chat-messages');
      const keys = Object.keys(msgs).sort();
      const rendered = new Set([...container.querySelectorAll('[data-msgkey]')].map(el => el.dataset.msgkey));
      let added = 0;
      for (const k of keys) {
        if (rendered.has(k)) continue;
        const m = msgs[k];
        const isMe = m.sender === onlineSide;
        const div = document.createElement('div');
        div.dataset.msgkey = k;
        div.className = 'chat-msg ' + (isMe ? 'chat-msg-me' : 'chat-msg-them');
        const nameDiv = document.createElement('div');
        nameDiv.className = 'chat-msg-name';
        nameDiv.textContent = isMe ? 'You' : 'Opponent';
        div.appendChild(nameDiv);
        div.appendChild(document.createTextNode(m.text));
        container.appendChild(div);
        added++;
      }
      if (added > 0) {
        container.scrollTop = container.scrollHeight;
        if (!chatOpen) {
          unreadCount += added;
          const badge = document.getElementById('chat-unread');
          badge.textContent = unreadCount; badge.classList.remove('hidden');
        }
      }
    });

    const input = document.getElementById('chat-input');
    input.onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  }

  function appendSystemMsg(text) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg-system';
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function toggleChat() {
    SFX.click();
    const panel = document.getElementById('chat-panel');
    chatOpen = !chatOpen;
    panel.classList.toggle('collapsed', !chatOpen);
    if (chatOpen) {
      unreadCount = 0;
      const badge = document.getElementById('chat-unread');
      badge.classList.add('hidden'); badge.textContent = '0';
      setTimeout(() => {
        const container = document.getElementById('chat-messages');
        if (container) container.scrollTop = container.scrollHeight;
        document.getElementById('chat-input').focus();
      }, 50);
    }
  }

  function sendChat() {
    if (!roomCode) return;
    const input = document.getElementById('chat-input');
    const text = (input.value || '').trim();
    if (!text) return;
    input.value = ''; SFX.click();
    const key = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    set(ref(database, `rooms/${roomCode}/chat/${key}`), {
      sender: onlineSide, text: text.slice(0, 80), ts: Date.now()
    }).catch(console.error);
  }

  function teardownChat() {
    const panel = document.getElementById('chat-panel');
    if (panel) panel.classList.add('hidden');
    if (chatListener && roomCode) {
      try { off(ref(database, `rooms/${roomCode}/chat`)); } catch (e) {}
      chatListener = null;
    }
    chatOpen = false; unreadCount = 0;
  }

  // =========== REMATCH ===========
  function showRematch(iWon) {
    rematchVoted = false;
    const overlay = document.getElementById('rematch-overlay');
    const title   = document.getElementById('rematch-title');
    const sub     = document.getElementById('rematch-sub');
    const yesBtn  = document.getElementById('btn-rematch-yes');
    const noBtn   = document.getElementById('btn-rematch-no');
    const dots    = document.getElementById('rematch-dots');

    title.textContent = iWon ? 'You Won!' : 'You Lost!';
    sub.textContent   = 'Waiting for opponent…';
    yesBtn.disabled = false; noBtn.disabled = false;
    dots.classList.add('hidden');
    overlay.classList.remove('hidden');

    update(ref(database, `rooms/${roomCode}`), { [`rematch_${onlineSide}`]: null }).catch(console.error);

    rematchListener = onValue(ref(database, `rooms/${roomCode}`), (snap) => {
      const data = snap.val();
      if (!data) return;
      const myVote  = data[`rematch_${onlineSide}`];
      const oppSide = onlineSide === PLAYER ? PLAYER2 : PLAYER;
      const oppVote = data[`rematch_${oppSide}`];

      if (myVote === true && oppVote === true) {
        cleanupRematch();
        overlay.classList.add('hidden');
        if (onlineSide === PLAYER) {
          const newSeed = (Date.now() & 0xffff) + Math.floor(Math.random() * 1000);
          update(ref(database, `rooms/${roomCode}`), { rematchSeed: newSeed, rematchSeedSet: true }).catch(console.error);
          doOnlineRematch(newSeed);
        } else {
          if (data.rematchSeed) {
            doOnlineRematch(data.rematchSeed);
          } else {
            let seedWaitOff = null;
            const seedRef = ref(database, `rooms/${roomCode}/rematchSeed`);
            seedWaitOff = onValue(seedRef, (seedSnap) => {
              if (seedSnap.val()) {
                if (seedWaitOff) { off(seedRef); seedWaitOff = null; }
                doOnlineRematch(seedSnap.val());
              }
            });
          }
        }
      } else if (myVote === false || oppVote === false) {
        cleanupRematch(); overlay.classList.add('hidden'); cancelOnline();
      }
    });

    rematchTimeout = setTimeout(() => {
      cleanupRematch(); overlay.classList.add('hidden');
      appendSystemMsg('Rematch timed out.'); cancelOnline();
    }, 30000);
  }

  function voteRematch(yes) {
    if (rematchVoted) return;
    rematchVoted = true; SFX.click();
    const yesBtn = document.getElementById('btn-rematch-yes');
    const noBtn  = document.getElementById('btn-rematch-no');
    const sub    = document.getElementById('rematch-sub');
    const dots   = document.getElementById('rematch-dots');
    yesBtn.disabled = true; noBtn.disabled = true;
    update(ref(database, `rooms/${roomCode}`), { [`rematch_${onlineSide}`]: yes }).catch(console.error);
    if (yes) { sub.textContent = 'Waiting for opponent…'; dots.classList.remove('hidden'); }
    else { sub.textContent = 'Leaving…'; }
  }

  function cleanupRematch() {
    if (rematchTimeout) { clearTimeout(rematchTimeout); rematchTimeout = null; }
    if (rematchListener && roomCode) {
      try { off(ref(database, `rooms/${roomCode}`)); } catch (e) {}
      rematchListener = null;
    }
    rematchVoted = false;
  }

  function doOnlineRematch(seed) {
    update(ref(database, `rooms/${roomCode}`), {
      rematch_player: null, rematch_player2: null,
      rematchSeed: null, rematchSeedSet: null,
      p1_move: null, p2_move: null, chat: null
    }).catch(console.error);

    lastSeenMsgId = null;
    document.getElementById('chat-messages').innerHTML = '';
    appendSystemMsg('Rematch started!');
    startOnlineGame(onlineSide === PLAYER, seed);
    startOnlineMoveListener();
  }

  function generateMapSeeded(seed) {
    _rngSeed = seed;
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (let c = 0; c < COLS; c++) grid[r][c] = makeCell(NEUTRAL, 1 + seededRand(4));
    }
    const pStarts  = [[5,0],[5,1],[6,0],[6,1]];
    const p2Starts = [[0,7],[0,8],[1,7],[1,8]];
    pStarts.forEach(([r,c])  => { grid[r][c] = makeCell(PLAYER,  cfg.pPow + seededRand(2)); });
    p2Starts.forEach(([r,c]) => { grid[r][c] = makeCell(PLAYER2, cfg.pPow + seededRand(2)); });

    if (cfg.eHexes > 4) {
      const extras1 = [[4,0],[4,1],[5,2],[6,2]];
      const extras2 = [[1,6],[0,6],[2,7],[2,8]];
      let need = cfg.eHexes - 4;
      for (let i = 0; i < need && i < extras1.length; i++)
        grid[extras1[i][0]][extras1[i][1]] = makeCell(PLAYER, cfg.pPow + seededRand(2));
      for (let i = 0; i < need && i < extras2.length; i++)
        grid[extras2[i][0]][extras2[i][1]] = makeCell(PLAYER2, cfg.pPow + seededRand(2));
    }

    let placed = 0, att = 0;
    while (placed < cfg.blocked && att < 300) {
      att++;
      const r = seededRand(ROWS), c = seededRand(COLS);
      if (grid[r][c].owner !== NEUTRAL) continue;
      const nearP  = pStarts.some(([sr,sc])  => Math.abs(r-sr)+Math.abs(c-sc) <= 2);
      const nearP2 = p2Starts.some(([sr,sc]) => Math.abs(r-sr)+Math.abs(c-sc) <= 2);
      if (nearP || nearP2) continue;
      grid[r][c] = makeCell(BLOCKED, 0); placed++;
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
      if (src.blazeBuffed) { aPow = Math.min(aPow*2, 18); src.blazeBuffed = false; }
      let dPow = dst.power;
      if (dst.shielded) dPow += 3;
      const capPU = dst.powerup;
      if (aPow > dPow) {
        dst.owner = src.owner; dst.power = Math.min(aPow - dPow, MAX_POWER);
        src.power = 1; dst.powerup = null; dst.shielded = false;
        dst.blazeBuffed = false; dst.frozen = false; dst.boss = false;
        flashHex(move.dr, move.dc, 'flash-ai-capture', 550); SFX.attack();
        if (capPU) applyPowerup(capPU, move.dr, move.dc, src.owner);
        setStatus(`Opponent captured! (${aPow} vs ${dPow})`);
      } else if (aPow === dPow) {
        src.power = Math.max(1, src.power - 1); setStatus('Opponent tied!');
      } else {
        src.power = 1; if (dst.power > 1) dst.power -= 1; setStatus('Opponent attack failed!');
      }
      render();
      setTimeout(() => { animating = false; if (!checkGameOver()) afterOpponentTurn(); }, 700);
    }
  }

  function applyRemoteSkip() { setStatus('Opponent skipped.'); afterOpponentTurn(); }

  function afterOpponentTurn() {
    turn++; growPhaseOwner(onlineSide);
    phase = 'select';
    const label = onlineSide === PLAYER ? 'P1' : 'P2';
    setStatus(`Your turn (${label}) — select a hex`);
    render();
  }

  function setOnlineStatus(msg, type) {
    const waiting = document.getElementById('waiting-text');
    if (waiting) { waiting.textContent = msg; waiting.style.color = type === 'error' ? '#f87171' : ''; }
  }

  function copyRoomCode() {
    if (roomCode) { navigator.clipboard.writeText(roomCode).catch(() => {}); SFX.click(); }
  }

  // =========== LEAVE ONLINE GAME ===========
  function leaveOnlineGame() {
    SFX.click();
    if (gameMode !== 'online') return;
    if (dbRef && roomCode) {
      update(ref(database, `rooms/${roomCode}`), {
        [`${onlineSide}_intentional_left`]: true, status: 'abandoned'
      }).catch(() => {});
    }
    sessionStorage.removeItem('hexasteal_rejoin');
    cancelOnline();
    startStage(progress.stage);
  }

  // =========== DISCONNECT DETECTION ===========
  function setupDisconnectDetection() {
    if (!roomCode) return;
    const oppSide = onlineSide === PLAYER ? PLAYER2 : PLAYER;
    const oppLeftRef = ref(database, `rooms/${roomCode}/${oppSide}_intentional_left`);
    if (_disconnectListener) { try { off(oppLeftRef); } catch(e){} }
    _disconnectListener = onValue(oppLeftRef, (snap) => {
      if (snap.val() === true && gameMode === 'online') {
        sessionStorage.removeItem('hexasteal_rejoin');
        teardownChat(); cleanupListeners();
        if (_disconnectListener) { try { off(oppLeftRef); } catch(e){} _disconnectListener = null; }
        gameMode = 'ai'; updateVSBar(null, null);
        const leaveBtn = document.getElementById('btn-leave-online');
        const diffBtn = document.getElementById('btn-ai-diff');
        if (leaveBtn) leaveBtn.classList.add('hidden');
        if (diffBtn) diffBtn.classList.remove('hidden');
        updateDiffButton();
        document.getElementById('opp-left-overlay').classList.remove('hidden');
      }
    });
  }

  function closeOppLeft() {
    SFX.click();
    document.getElementById('opp-left-overlay').classList.add('hidden');
    startStage(progress.stage);
  }

  // =========== REJOIN AFTER DISCONNECT ===========
  function checkRejoinOnLoad() {
    const saved = sessionStorage.getItem('hexasteal_rejoin');
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (!data || !data.roomCode) return;
      _savedRoomCode = data.roomCode;
      _savedOnlineSide = data.onlineSide || PLAYER;
      const overlay = document.getElementById('disconnect-overlay');
      if (overlay) overlay.classList.remove('hidden');
    } catch(e) { sessionStorage.removeItem('hexasteal_rejoin'); }
  }

  function rejoinRoom() {
    SFX.click();
    document.getElementById('disconnect-overlay').classList.add('hidden');
    if (!_savedRoomCode) { startStage(progress.stage); return; }

    const code = _savedRoomCode, side = _savedOnlineSide || PLAYER;
    roomCode = code; onlineSide = side;
    dbRef = ref(database, `rooms/${code}`);

    const connectingEl = document.getElementById('online-connecting');
    onlineOverlay.classList.remove('hidden');
    document.getElementById('online-create-join').classList.add('hidden');
    document.getElementById('online-join-form').classList.add('hidden');
    document.getElementById('online-waiting').classList.add('hidden');
    connectingEl.classList.remove('hidden');
    connectingEl.innerHTML = `<p class="mode-sub">Reconnecting to room ${code}…</p><div class="waiting-dots"><span></span><span></span><span></span></div>`;
    document.getElementById('online-back-btn').style.display = 'none';

    get(dbRef).then(snap => {
      const data = snap.val();
      if (!data || data.status === 'abandoned' || data[`${side}_intentional_left`]) {
        connectingEl.innerHTML = `<p class="mode-sub" style="color:#f87171">Room is no longer active.</p>`;
        document.getElementById('online-back-btn').style.display = '';
        sessionStorage.removeItem('hexasteal_rejoin');
        return;
      }
      if (data.p1_skin && side === PLAYER2) opponentSkinData = data.p1_skin;
      if (data.p2_skin && side === PLAYER)  opponentSkinData = data.p2_skin;
      onlineRoomSettings = sanitizeRoomSettings(data.settings || {});

      update(dbRef, { [`${side}_reconnected`]: true }).catch(console.error);

      onlineOverlay.classList.add('hidden');
      const p1name = data.p1_username || 'Player1';
      const p2name = data.p2_username || 'Player2';
      startOnlineGame(side === PLAYER, data.seed, onlineRoomSettings, p1name, p2name);
      startOnlineMoveListener();
      setupDisconnectDetection();
    }).catch(() => {
      connectingEl.innerHTML = `<p class="mode-sub" style="color:#f87171">Could not reconnect. Room may be gone.</p>`;
      document.getElementById('online-back-btn').style.display = '';
      sessionStorage.removeItem('hexasteal_rejoin');
    });
  }

  function declineRejoin() {
    SFX.click();
    if (_savedRoomCode && _savedOnlineSide) {
      const declinedRef = ref(database, `rooms/${_savedRoomCode}/${_savedOnlineSide}_declined_rejoin`);
      set(declinedRef, true).catch(() => {});
    }
    sessionStorage.removeItem('hexasteal_rejoin');
    _savedRoomCode = null; _savedOnlineSide = null;
    document.getElementById('disconnect-overlay').classList.add('hidden');
  }

  // =========== STAGE MANAGEMENT ===========
  function startStage(s) {
    hideAllOverlays();
    gameMode = 'ai'; currentStage = s; cfg = stageConfig(s);
    updateVSBar(null, null);
    const diffBtn = document.getElementById('btn-ai-diff');
    const leaveBtn = document.getElementById('btn-leave-online');
    if (diffBtn) diffBtn.classList.remove('hidden');
    if (leaveBtn) leaveBtn.classList.add('hidden');
    updateDiffButton();
    if (!cfg.isBoss) BGM.playForStage(false);
    if (cfg.isBoss) showBossIntro();
    else generateAndPlay();
  }

  function generateAndPlay() {
    turn = 1; phase = 'select';
    selectedHex = null; validTargets = []; transferTargets = []; animating = false;
    if (gameMode === 'local') localTurn = PLAYER;
    generateMap(); createBoard();
    if (gameMode === 'local') { growPhaseOwner(PLAYER); growPhaseOwner(PLAYER2); }
    else { growPhase(PLAYER); }
    SFX.stageStart(); render();
    if (gameMode === 'local') showLocalTurnBanner();
    else if (gameMode === 'ai') {
      setStatus(cfg.isBoss
        ? `Boss battle! Defeat ${cfg.bossName}!`
        : 'Your hexes grew +1 · select a hex to attack or transfer');
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
    SFX.click(); goOverlay.classList.add('hidden');
    if (gameMode !== 'ai') { startLocalGame(); return; }
    if (currentStage >= TOTAL_STAGES) showStages();
    else startStage(currentStage + 1);
  }

  function restartStage() {
    SFX.click(); hideAllOverlays();
    if (gameMode === 'local') { startLocalGame(); return; }
    if (gameMode === 'online') return;
    startStage(currentStage);
  }

  function hideAllOverlays() {
    [tutOverlay, bossOverlay, stagesOverlay, goOverlay, modeOverlay, onlineOverlay, localTurnBanner]
      .forEach(el => { if (el) el.classList.add('hidden'); });
    const usernameOv = document.getElementById('username-overlay');
    if (usernameOv) usernameOv.classList.add('hidden');
  }

  // =========== CLICK HANDLING ===========
  function handleClick(r, c) {
    if (animating || phase === 'ai' || phase === 'gameover' || phase === 'wait-online') return;
    if (gameMode === 'online') {
      if (grid[r][c].owner !== NEUTRAL && grid[r][c].owner !== onlineSide && phase === 'select') return;
    }

    const ao = activeOwner();
    const cell = grid[r][c];

    if (phase === 'select') {
      if (cell.owner !== ao) return;
      if (cell.frozen) { setStatus('That hex is frozen.'); SFX.fail(); return; }
      const targets = getAttackTargets(r, c);
      const transfers = getTransferTargets(r, c);
      if (targets.length === 0 && transfers.length === 0) { setStatus('No valid targets from that hex.'); return; }
      selectedHex = [r, c]; validTargets = targets; transferTargets = transfers; phase = 'target';
      SFX.select();
      const bNote = cell.blazeBuffed ? ' Blaze active — 2x damage!' : '';
      const tNote = transfers.length > 0 ? ' · friendly = transfer' : '';
      setStatus(`Power ${cell.power} selected · choose target${bNote}${tNote}`);
      render(); return;
    }

    if (phase === 'target') {
      if (cell.owner === ao) {
        if (r === selectedHex[0] && c === selectedHex[1]) { deselect(); return; }
        if (isTransferTarget(r, c)) { executeTransfer(selectedHex[0], selectedHex[1], r, c); return; }
        if (cell.frozen) { setStatus('Frozen hex.'); SFX.fail(); return; }
        const targets = getAttackTargets(r, c);
        const transfers = getTransferTargets(r, c);
        if (targets.length === 0 && transfers.length === 0) { setStatus('No targets.'); return; }
        selectedHex = [r, c]; validTargets = targets; transferTargets = transfers;
        SFX.select();
        const bNote = cell.blazeBuffed ? ' 2x!' : '';
        const tNote = transfers.length > 0 ? ' · transfer' : '';
        setStatus(`Power ${cell.power} selected${bNote}${tNote}`);
        render(); return;
      }
      if (!isValidTarget(r, c)) return;
      executeAttack(selectedHex[0], selectedHex[1], r, c);
    }
  }

  function deselect() {
    selectedHex = null; validTargets = []; transferTargets = []; phase = 'select';
    SFX.deselect(); setStatus('Select a hex to attack or transfer power'); render();
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
    setStatus(`Transferred ${actual} power`);
    selectedHex = null; validTargets = []; transferTargets = [];
    render();

    if (gameMode === 'online') sendOnline({ type: 'move', move: { type:'transfer', sr, sc, dr, dc } });

    setTimeout(() => {
      animating = false;
      if (checkGameOver()) return;
      afterPlayerTurn();
    }, 500);
  }

  // =========== COMBAT ===========
  function executeAttack(sr, sc, dr, dc) {
    animating = true; SFX.attack();
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

      let msg = `Captured! ${wasBlazed ? aPow+' (2x)' : aPow} vs ${wasShielded ? defPow+' (+3 shield)' : defPow}`;
      if (wasBoss) msg = `${cfg.bossName} DESTROYED! ${msg}`;
      if (capturedPU) { SFX.powerup(); msg += ' · ' + applyPowerup(capturedPU, dr, dc, src.owner); }
      setStatus(msg);
    } else if (aPow === defPow) {
      src.power = Math.max(1, src.power - 1);
      flashHex(sr, sc, 'flash-fail', 550); SFX.fail();
      setStatus(`Tied ${aPow} vs ${defPow} — deflected!`);
    } else {
      src.power = 1;
      if (dst.power > 1) dst.power -= 1;
      flashHex(sr, sc, 'flash-fail', 550); SFX.fail();
      setStatus(`Failed ${wasBlazed ? aPow+' (2x)' : aPow} vs ${wasShielded ? defPow+' (+3 shield)' : defPow}`);
    }

    selectedHex = null; validTargets = []; transferTargets = [];
    render();

    if (gameMode === 'online') sendOnline({ type: 'move', move: { type:'attack', sr, sc, dr, dc } });

    setTimeout(() => {
      animating = false;
      if (checkGameOver()) return;
      afterPlayerTurn();
    }, wasBoss ? 1000 : 700);
  }

  function afterPlayerTurn() {
    if (gameMode === 'ai') {
      beginAITurn();
    } else if (gameMode === 'local') {
      localTurn = localTurn === PLAYER ? PLAYER2 : PLAYER;
      growPhaseOwner(localTurn); turn++;
      phase = 'select'; render(); showLocalTurnBanner();
    } else if (gameMode === 'online') {
      growPhaseOwner(opponentOwner()); turn++;
      phase = 'wait-online'; setStatus('Waiting for opponent…'); render();
    }
  }

  // =========== POWER-UP EFFECTS ===========
  function applyPowerup(type, r, c, owner) {
    const cell = grid[r][c];
    switch (type) {
      case 'surge':
        cell.power = Math.min(cell.power + 3, MAX_POWER);
        flashHex(r, c, 'flash-surge flash-powerup', 600);
        return 'Surge! +3 power';
      case 'shield':
        cell.shielded = true;
        flashHex(r, c, 'flash-shield flash-powerup', 600);
        return 'Shield!';
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
        return `Drain! Stole ${drained}`;
      }
      case 'blaze':
        cell.blazeBuffed = true;
        flashHex(r, c, 'flash-blaze flash-powerup', 600);
        return 'Blaze! 2x';
      case 'freeze': {
        const foes = [PLAYER, PLAYER2, ENEMY].filter(o => o !== owner);
        let froze = 0;
        for (const [nr, nc] of getNeighbors(r, c)) {
          if (foes.includes(grid[nr][nc].owner)) { grid[nr][nc].frozen = true; froze++; flashHex(nr, nc, 'flash-freeze flash-powerup', 500); }
        }
        flashHex(r, c, 'flash-freeze flash-powerup', 600);
        return `Froze ${froze}`;
      }
      case 'spread': {
        const neutralNeigh = getNeighbors(r, c).filter(([nr,nc]) => grid[nr][nc].owner === NEUTRAL);
        if (neutralNeigh.length === 0) return 'Spread! (no neutral)';
        const pickIndex = gameMode === 'online' ? seededRand(neutralNeigh.length) : randInt(neutralNeigh.length);
        const [nr, nc] = neutralNeigh[pickIndex];
        const sPU = grid[nr][nc].powerup;
        grid[nr][nc] = makeCell(owner, Math.max(1, Math.floor(cell.power / 2)));
        grid[nr][nc].powerup = sPU;
        flashHex(nr, nc, 'flash-spread flash-powerup', 600);
        let extra = '';
        if (sPU) extra = ' → ' + applyPowerup(sPU, nr, nc, owner);
        return 'Spread!' + extra;
      }
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

  function growPhase(owner) { growPhaseOwner(owner); }

function beginAITurn() {
    phase = 'ai'; setStatus('Enemy is thinking…'); render();
    const thinkTime = { easy: 300, normal: 450, hard: 600, intense: 750, extreme: 900 };
    const d = currentDiff().id;
    setTimeout(() => {
      growPhase(ENEMY); render();
      setTimeout(aiTakeTurn, thinkTime[d] || 450);
    }, 450);
  }

  function aiGetAllAttacks() {
    const attacks = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].owner !== ENEMY || grid[r][c].frozen) continue;
      for (const [nr, nc] of getAttackTargets(r, c)) {
        const src = grid[r][c];
        let aPow = src.power;
        if (src.blazeBuffed) aPow = Math.min(aPow * 2, 18);
        let dPow = grid[nr][nc].power;
        if (grid[nr][nc].shielded) dPow += 3;
        attacks.push({
          sr: r, sc: c, dr: nr, dc: nc,
          sPow: aPow, dPow,
          canWin: aPow > dPow,
          margin: aPow - dPow,
          dOwner: grid[nr][nc].owner,
          dPU: grid[nr][nc].powerup,
          isBoss: grid[r][c].boss
        });
      }
    }
    return attacks;
  }

  function aiGetAllTransfers() {
    const transfers = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].owner !== ENEMY || grid[r][c].frozen || grid[r][c].power <= 1) continue;
      for (const [nr, nc] of getNeighbors(r, c)) {
        if (grid[nr][nc].owner !== ENEMY) continue;
        const src = grid[r][c], dst = grid[nr][nc];
        const canGive = src.power - 1;
        const canReceive = MAX_POWER - dst.power;
        const actual = Math.min(canGive, canReceive);
        if (actual <= 0) continue;
        const dstAttackTargets = getAttackTargets(nr, nc);
        const wouldEnableAttack = dstAttackTargets.some(([ar, ac]) => {
          let ap = dst.power + actual;
          if (dst.blazeBuffed) ap = Math.min(ap * 2, 18);
          let dp = grid[ar][ac].power;
          if (grid[ar][ac].shielded) dp += 3;
          return ap > dp;
        });
        transfers.push({ sr: r, sc: c, dr: nr, dc: nc, amount: actual, wouldEnableAttack, dstAttacks: dstAttackTargets.length });
      }
    }
    return transfers;
  }

  function aiScoreAttack(a, diff) {
    let score = 0;
    if (!a.canWin) {
      if (a.margin === 0) return -50;
      return -200;
    }
    score = 60 + a.margin * 8;
    if (a.dOwner === PLAYER) score += 40;
    if (a.dPU) {
      score += 30;
      if (a.dPU === 'surge')  score += 25;
      if (a.dPU === 'drain')  score += 20;
      if (a.dPU === 'freeze') score += 35;
      if (a.dPU === 'blaze')  score += 15;
      if (a.dPU === 'spread') score += 10;
    }
    if (a.margin === 1) score -= 20;
    const newPow = Math.min(a.sPow - a.dPow, MAX_POWER);
    const newNeighborAttacks = getNeighbors(a.dr, a.dc).filter(([nr, nc]) =>
      grid[nr][nc].owner === PLAYER && grid[nr][nc].power < newPow
    ).length;
    score += newNeighborAttacks * 15;
    return score;
  }

  function aiTakeTurn() {
    const diff = currentDiff();
    const id = diff.id;

    if (id === 'easy') { aiEasyTurn(); return; }
    if (id === 'normal') { aiNormalTurn(); return; }
    if (id === 'hard') { aiHardTurn(); return; }
    if (id === 'intense') { aiIntenseTurn(); return; }
    if (id === 'extreme') { aiExtremeTurn(); return; }
    aiNormalTurn();
  }

  // EASY: mostly random, often skips, never transfers, sometimes attacks losing hexes
  function aiEasyTurn() {
    const attacks = aiGetAllAttacks();
    if (Math.random() < 0.35 || attacks.length === 0) {
      setStatus('Enemy passed'); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 400); return;
    }
    const shuffled = attacks.sort(() => Math.random() - 0.5);
    const pick = shuffled[0];
    if (!pick.canWin && Math.random() < 0.6) {
      setStatus('Enemy fumbled'); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 400); return;
    }
    flashHex(pick.sr, pick.sc, 'flash-ai-source', 400); SFX.aiMove();
    setTimeout(() => { executeAIAttack(pick); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600); }, 400);
  }

  // NORMAL: picks decent attacks, slight randomness, no transfers
  function aiNormalTurn() {
    const attacks = aiGetAllAttacks();
    const winning = attacks.filter(a => a.canWin);
    if (winning.length === 0) {
      setStatus('Enemy skipped'); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 400); return;
    }
    const scored = winning.map(a => ({ ...a, score: aiScoreAttack(a) + Math.random() * 20 }));
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[0];
    flashHex(pick.sr, pick.sc, 'flash-ai-source', 400); SFX.aiMove();
    setTimeout(() => { executeAIAttack(pick); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600); }, 400);
  }

  // HARD: smarter scoring, occasionally transfers to set up big attacks
  function aiHardTurn() {
    const attacks = aiGetAllAttacks();
    const winning = attacks.filter(a => a.canWin);

    // Sometimes transfer to strengthen a hex that can then attack
    if (Math.random() < 0.25) {
      const transfers = aiGetAllTransfers().filter(t => t.wouldEnableAttack);
      if (transfers.length > 0) {
        transfers.sort((a, b) => b.dstAttacks - a.dstAttacks);
        const t = transfers[0];
        executeAITransfer(t);
        setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600);
        return;
      }
    }

    if (winning.length === 0) {
      setStatus('Enemy skipped'); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 400); return;
    }
    const scored = winning.map(a => ({ ...a, score: aiScoreAttack(a) + Math.random() * 10 }));
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[0];
    flashHex(pick.sr, pick.sc, 'flash-ai-source', 400); SFX.aiMove();
    setTimeout(() => { executeAIAttack(pick); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600); }, 400);
  }

  // INTENSE: transfers strategically, targets power-ups, prefers high-margin attacks
  function aiIntenseTurn() {
    const attacks = aiGetAllAttacks();
    const winning = attacks.filter(a => a.canWin);
    const transfers = aiGetAllTransfers();

    // Prefer transfers that unlock powerful attacks or power-ups
    const goodTransfers = transfers.filter(t => t.wouldEnableAttack || t.dstAttacks >= 2);
    if (goodTransfers.length > 0 && Math.random() < 0.45) {
      goodTransfers.sort((a, b) => b.dstAttacks - a.dstAttacks);
      const t = goodTransfers[0];
      executeAITransfer(t);
      setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600);
      return;
    }

    if (winning.length === 0) {
      // Try any transfer to improve position
      if (transfers.length > 0) {
        transfers.sort((a, b) => b.actual - a.actual);
        executeAITransfer(transfers[0]);
        setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600);
        return;
      }
      setStatus('Enemy repositioned'); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 400); return;
    }

    const scored = winning.map(a => {
      let s = aiScoreAttack(a);
      if (a.dPU === 'freeze' || a.dPU === 'drain') s += 40;
      if (a.margin >= 3) s += 20;
      return { ...a, score: s + Math.random() * 5 };
    });
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[0];
    flashHex(pick.sr, pick.sc, 'flash-ai-source', 400); SFX.aiMove();
    setTimeout(() => { executeAIAttack(pick); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600); }, 400);
  }

  // EXTREME: full minimax-style evaluation, always transfers optimally, plans 2 moves ahead
  function aiExtremeTurn() {
    const attacks = aiGetAllAttacks();
    const winning = attacks.filter(a => a.canWin);
    const transfers = aiGetAllTransfers();

    // Score every transfer by what attacks it would open up
    const scoredTransfers = transfers.map(t => {
      let s = 0;
      const dst = grid[t.dr][t.dc];
      const newPow = Math.min(dst.power + t.actual, MAX_POWER);
      getAttackTargets(t.dr, t.dc).forEach(([nr, nc]) => {
        let ap = newPow;
        if (dst.blazeBuffed) ap = Math.min(ap * 2, 18);
        let dp = grid[nr][nc].power;
        if (grid[nr][nc].shielded) dp += 3;
        if (ap > dp) {
          s += 80 + (ap - dp) * 10;
          if (grid[nr][nc].powerup) s += 50;
          if (grid[nr][nc].owner === PLAYER) s += 30;
        }
      });
      // Penalise weakening the source if it becomes attackable
      const srcPow = grid[t.sr][t.sc].power - t.amount;
      getNeighbors(t.sr, t.sc).forEach(([nr, nc]) => {
        if (grid[nr][nc].owner === PLAYER && grid[nr][nc].power > srcPow) s -= 35;
      });
      return { ...t, score: s };
    });

    const scoredAttacks = winning.map(a => {
      let s = aiScoreAttack(a);
      if (a.dPU) s += 45;
      if (a.margin >= 4) s += 30;
      if (a.margin === 1) s -= 30;
      // Penalise leaving source exposed
      const leftoverPow = 1;
      getNeighbors(a.sr, a.sc).forEach(([nr, nc]) => {
        if (grid[nr][nc].owner === PLAYER && grid[nr][nc].power > leftoverPow) s -= 20;
      });
      return { ...a, score: s };
    });

    const bestTransfer = scoredTransfers.length > 0 ? scoredTransfers.sort((a, b) => b.score - a.score)[0] : null;
    const bestAttack = scoredAttacks.length > 0 ? scoredAttacks.sort((a, b) => b.score - a.score)[0] : null;

    // Pick whichever is higher value
    if (bestTransfer && bestAttack) {
      if (bestTransfer.score > bestAttack.score + 20) {
        executeAITransfer(bestTransfer);
        setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600); return;
      }
    } else if (bestTransfer && !bestAttack) {
      if (bestTransfer.score > 0) {
        executeAITransfer(bestTransfer);
        setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600); return;
      }
    }

    if (bestAttack) {
      flashHex(bestAttack.sr, bestAttack.sc, 'flash-ai-source', 400); SFX.aiMove();
      setTimeout(() => { executeAIAttack(bestAttack); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 600); }, 400);
    } else {
      setStatus('Enemy calculating…'); setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 400);
    }
  }

  function executeAIAttack(a) {
    const src = grid[a.sr][a.sc], dst = grid[a.dr][a.dc];
    let aPow = src.power;
    const wasBlazed = src.blazeBuffed;
    if (wasBlazed) { aPow = Math.min(aPow * 2, 18); src.blazeBuffed = false; }
    let dPow = dst.power;
    const wasShielded = dst.shielded;
    if (wasShielded) dPow += 3;
    const capPU = dst.powerup;
    if (aPow > dPow) {
      dst.owner = ENEMY; dst.power = Math.min(aPow - dPow, MAX_POWER);
      src.power = 1; dst.powerup = null; dst.shielded = false;
      dst.blazeBuffed = false; dst.frozen = false; dst.boss = false;
      flashHex(a.dr, a.dc, 'flash-ai-capture', 500); SFX.attack();
      let msg = `Enemy captured! (${wasBlazed ? aPow + ' 2x' : aPow} vs ${wasShielded ? dPow + ' shield' : dPow})`;
      if (capPU) msg += ' · ' + applyPowerup(capPU, a.dr, a.dc, ENEMY);
      setStatus(msg);
    } else if (aPow === dPow) {
      src.power = Math.max(1, src.power - 1); setStatus('Enemy tied!');
    } else {
      src.power = 1; if (dst.power > 1) dst.power -= 1; setStatus('Enemy failed!');
    }
    render();
  }

function executeAITransfer(t) {
    const src = grid[t.sr][t.sc], dst = grid[t.dr][t.dc];
    const actual = Math.min(src.power - 1, MAX_POWER - dst.power);
    if (actual <= 0) return;
    src.power -= actual; dst.power += actual;
    flashHex(t.sr, t.sc, 'flash-transfer-out', 400);
    flashHex(t.dr, t.dc, 'flash-transfer-in', 400);
    setStatus(`Enemy transferred ${actual} power`);
    render();
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
    setStatus('Your hexes grew +1 · select a hex to attack or transfer');
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
    let hasP = false, hasE = false, pS = 0, eS = 0, hasBoss = false, pH = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const o = grid[r][c].owner;
      if (o === PLAYER) { hasP = true; pS += grid[r][c].power; pH++; }
      if (o === ENEMY)  { hasE = true; eS += grid[r][c].power; if (grid[r][c].boss) hasBoss = true; }
    }

    if (cfg.isBoss && !hasBoss && hasP) {
      awardHexoneX(pH, 0, true);
      setTimeout(() => showEnd('Boss Defeated!', `${cfg.bossName} destroyed on stage ${currentStage}!`, 'win'), 800);
      return true;
    }
    if (!hasE) {
      awardHexoneX(pH, 0, true);
      setTimeout(() => showEnd('Victory!', `Stage ${currentStage} cleared in ${turn} turns!`, 'win'), 800);
      return true;
    }
    if (!hasP) {
      awardHexoneX(pH, 0, false);
      setTimeout(() => showEnd('Defeat', `Stage ${currentStage} — enemy took all your hexes.`, 'lose'), 800);
      return true;
    }
    if (turn >= cfg.maxTurns) {
      const won = pS > eS;
      awardHexoneX(pH, 0, won);
      setTimeout(() => {
        if (won) showEnd('Victory!', `Time's up — you win! ${pS} vs ${eS}`, 'win');
        else if (eS > pS) showEnd('Defeat', `Time's up — enemy wins ${eS} vs ${pS}`, 'lose');
        else showEnd('Draw', `Tied at ${pS}!`, 'draw');
      }, 800);
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

    const p1Name = (gameMode === 'online' && onlineSide === PLAYER2) ? 'Opponent' : 'Player 1';
    const p2Name = (gameMode === 'online' && onlineSide === PLAYER)  ? 'Opponent' : 'Player 2';

    if (p2H === 0) {
      const viewerWon = (gameMode === 'online') ? (onlineSide === PLAYER) : true;
      awardHexoneX(p1H, p2H, viewerWon);
      setTimeout(() => showEnd(`${p1Name} Wins!`, `${p1Name} eliminated ${p2Name}!`, p1Name === 'Opponent' ? 'lose' : 'win'), 800);
      return true;
    }
    if (p1H === 0) {
      const viewerWon = (gameMode === 'online') ? (onlineSide === PLAYER2) : false;
      awardHexoneX(p2H, p1H, viewerWon);
      setTimeout(() => showEnd(`${p2Name} Wins!`, `${p2Name} eliminated ${p1Name}!`, p2Name === 'Opponent' ? 'lose' : 'win'), 800);
      return true;
    }
    if (turn >= cfg.maxTurns) {
      const p1Wins = p1S > p2S;
      const viewerWon = (gameMode === 'online')
        ? (p1Wins ? onlineSide === PLAYER : onlineSide === PLAYER2)
        : p1Wins;
      awardHexoneX(p1Wins ? p1H : p2H, p1Wins ? p2H : p1H, viewerWon);
      setTimeout(() => {
        if (p1S > p2S) showEnd(`${p1Name} Wins!`, `Time's up! ${p1S} vs ${p2S}`, p1Name === 'Opponent' ? 'lose' : 'win');
        else if (p2S > p1S) showEnd(`${p2Name} Wins!`, `Time's up! ${p2S} vs ${p1S}`, p2Name === 'Opponent' ? 'lose' : 'win');
        else showEnd('Draw!', `Tied at ${p1S}!`, 'draw');
      }, 800);
      return true;
    }
    return false;
  }

  function showEnd(title, desc, type) {
    phase = 'gameover';
    resultTitle.textContent = title; resultTitle.className = type;
    resultDesc.textContent = desc;

    if (type === 'win') {
      SFX.victory();
      if (gameMode === 'ai') stageWon();
      btnNext.textContent = gameMode === 'ai'
        ? (currentStage >= TOTAL_STAGES ? 'All Stages!' : 'Next Stage')
        : 'Play Again';
      btnNext.classList.remove('hidden');
    } else if (type === 'draw') {
      SFX.defeat(); btnNext.textContent = 'Play Again'; btnNext.classList.remove('hidden');
    } else {
      SFX.defeat();
      if (gameMode !== 'ai') { btnNext.textContent = 'Play Again'; btnNext.classList.remove('hidden'); }
      else { btnNext.classList.add('hidden'); }
    }

    if (gameMode === 'online') { goOverlay.classList.add('hidden'); showRematch(type === 'win'); return; }
    goOverlay.classList.remove('hidden');
    setStatus(title); render();
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  // =========== SKIP ATTACK ===========
  function skipAttack() {
    if (animating || (phase !== 'select' && phase !== 'target')) return;
    SFX.click(); selectedHex = null; validTargets = []; transferTargets = [];
    if (gameMode === 'online') sendOnline({ type: 'skip' });
    setStatus('Skipped…'); render();
    setTimeout(() => {
      if (gameMode === 'ai') { beginAITurn(); }
      else if (gameMode === 'local') {
        localTurn = localTurn === PLAYER ? PLAYER2 : PLAYER;
        growPhaseOwner(localTurn); turn++; phase = 'select'; render(); showLocalTurnBanner();
      } else if (gameMode === 'online') {
        growPhaseOwner(opponentOwner()); turn++;
        phase = 'wait-online'; setStatus('Waiting for opponent…'); render();
      }
    }, 300);
  }

  function toggleSound() {
    SFX.on = !SFX.on; progress.soundOn = SFX.on; saveProgress();
    const iconEl = document.getElementById('sound-icon');
    if (iconEl) {
      if (SFX.on) {
        iconEl.innerHTML = '<path d="M2 5H5L9 2V12L5 9H2V5Z" fill="#d1d5db"/><path d="M11 4.5C12.2 5.5 12.2 8.5 11 9.5" stroke="#d1d5db" stroke-width="1.2" stroke-linecap="round"/>';
      } else {
        iconEl.innerHTML = '<path d="M2 5H5L9 2V12L5 9H2V5Z" fill="#d1d5db"/><line x1="11" y1="4" x2="14" y2="10" stroke="#f87171" stroke-width="1.2" stroke-linecap="round"/><line x1="14" y1="4" x2="11" y2="10" stroke="#f87171" stroke-width="1.2" stroke-linecap="round"/>';
      }
    }
    if (SFX.on) { BGM.unmute(); SFX.click(); } else { BGM.mute(); }
  }

  // =========== INIT ===========
  function init() {
    svgEl         = document.getElementById('grid');
    statusEl      = document.getElementById('status');
    turnEl        = document.getElementById('turn-num');
    turnMaxEl     = document.getElementById('turn-max');
    stageNumEl    = document.getElementById('stage-num');
    bossBadge     = document.getElementById('boss-badge');
    boardEl       = document.getElementById('board');
    pHexesEl      = document.getElementById('p-hexes');
    pPowerEl      = document.getElementById('p-power');
    eHexesEl      = document.getElementById('e-hexes');
    ePowerEl      = document.getElementById('e-power');
    foeLabel      = document.getElementById('foe-label');
    pLabel        = document.getElementById('p-label');
    playerDot     = document.getElementById('player-dot');
    btnSkip       = document.getElementById('btn-skip');
    btnSound      = document.getElementById('btn-sound');
    enemyDot      = document.getElementById('enemy-dot');

    tutOverlay    = document.getElementById('tut-overlay');
    tutIcon       = document.getElementById('tut-icon');
    tutTitle      = document.getElementById('tut-title');
    tutText       = document.getElementById('tut-text');
    tutDots       = document.getElementById('tut-dots');
    tutNextBtn    = document.getElementById('tut-next');

    bossOverlay   = document.getElementById('boss-overlay');
    bossNameEl    = document.getElementById('boss-name');
    bossSubEl     = document.getElementById('boss-sub');

    stagesOverlay = document.getElementById('stages-overlay');
    stageGridEl   = document.getElementById('stage-grid');

    goOverlay     = document.getElementById('go-overlay');
    resultTitle   = document.getElementById('result-title');
    resultDesc    = document.getElementById('result-desc');
    btnNext       = document.getElementById('btn-next');
    btnRetry      = document.getElementById('btn-retry');

    modeOverlay     = document.getElementById('mode-overlay');
    onlineOverlay   = document.getElementById('online-overlay');
    localTurnBanner = document.getElementById('local-turn-banner');

    loadProgress();
    updateShopButton();
    updateUsernameDisplay();
    updateDiffButton();
    checkRejoinOnLoad();
    startOwnerGiftListener();

    if (!progress.tutDone) showTutorial();
    else startStage(progress.stage);
  }

  document.addEventListener('DOMContentLoaded', init);

  // =========== ADMIN PANEL FUNCTIONS ===========
  function adminMaxMyHexes() {
    const owner = (gameMode === 'online') ? onlineSide : PLAYER;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (grid[r][c].owner === owner) grid[r][c].power = MAX_POWER;
    render(); setStatus('[ADMIN] All your hexes maxed!');
  }

  function adminGiveHexoneX() {
    const amt = parseInt(prompt('How much HexoneX to give yourself?', '1000'), 10);
    if (isNaN(amt) || amt <= 0) return;
    progress.hexoneX += amt;
    saveProgress(); updateShopButton();
    setStatus(`[ADMIN] +${amt} HexoneX given!`);
  }

async function adminGiveOppHexoneX(targetUsername) {
  const amt = parseInt(prompt(`How much HexoneX to give ${targetUsername || 'opponent'}?`, '1000'), 10);
  if (isNaN(amt) || amt <= 0) return;

  // Gift to yourself
  if (!targetUsername) {
    if (gameMode !== 'online' || !roomCode) { setStatus('[ADMIN] Provide a username or be in an online game!'); return; }
    const oppSide = onlineSide === 'player' ? 'player2' : 'player';
    update(ref(database, `rooms/${roomCode}`), {
      [`admin_opp_hexonex_${oppSide}`]: { amount: amt, ts: Date.now() }
    }).catch(console.error);
    setStatus(`[ADMIN] Sent ${amt} HexoneX to opponent`);
    return;
  }

  // Try live room lookup first
  const userInfo = await findUserByUsername(targetUsername);
  if (userInfo && userInfo.roomCode) {
    update(ref(database, `rooms/${userInfo.roomCode}`), {
      [`admin_opp_hexonex_${userInfo.side}`]: { amount: amt, ts: Date.now() }
    }).catch(console.error);
    setStatus(`[ADMIN] Sent ${amt} HexoneX to ${targetUsername} (in room)`);
    return;
  }

  // Fallback: write to a persistent inbox the player reads on next login/game start
  update(ref(database, `user_inbox/${targetUsername}`), {
    hexonex: { amount: amt, ts: Date.now(), from: progress.username || 'admin' }
  }).catch(console.error);
  setStatus(`[ADMIN] ${targetUsername} not in a room — HexoneX queued in their inbox`);
}

  function adminMaxOppHexes() {
    const oppOwner = (gameMode === 'online') ? onlineOpponentSide()
                    : (gameMode === 'local')  ? PLAYER2 : ENEMY;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (grid[r][c].owner === oppOwner) grid[r][c].power = MAX_POWER;
    render(); setStatus('[ADMIN] All opponent hexes maxed!');
  }

  function adminCoverBoard() {
    const owner = (gameMode === 'online') ? onlineSide : PLAYER;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].owner === BLOCKED) continue;
      grid[r][c].owner = owner;
      grid[r][c].power = MAX_POWER;
      grid[r][c].powerup = null;
      grid[r][c].blazeBuffed = false; grid[r][c].shielded = false;
      grid[r][c].frozen = false; grid[r][c].boss = false;
    }
    render(); setStatus('[ADMIN] Board covered!');
  }

  function adminGiveOppOneHex() {
    const oppOwner = (gameMode === 'online') ? onlineOpponentSide()
                    : (gameMode === 'local')  ? PLAYER2 : ENEMY;
    const myOwner  = (gameMode === 'online') ? onlineSide : PLAYER;
    let kept = false;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].owner !== oppOwner) continue;
      if (!kept) { kept = true; grid[r][c].power = 1; }
      else { grid[r][c].owner = myOwner; grid[r][c].power = 1; }
    }
    render(); setStatus('[ADMIN] Opponent reduced to 1 hex!');
  }

  function adminGiveOppWin() {
    const myOwner  = (gameMode === 'online') ? onlineSide : PLAYER;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (grid[r][c].owner === myOwner) { grid[r][c].owner = NEUTRAL; grid[r][c].power = 1; }
    render();
    setTimeout(() => checkGameOver(), 100);
    setStatus('[ADMIN] Giving opponent the win…');
  }

  function adminGiveYouWin() {
    const oppOwner = (gameMode === 'online') ? onlineOpponentSide()
                    : (gameMode === 'local')  ? PLAYER2 : ENEMY;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (grid[r][c].owner === oppOwner) { grid[r][c].owner = NEUTRAL; grid[r][c].power = 1; }
    render();
    setTimeout(() => checkGameOver(), 100);
    setStatus('[ADMIN] Giving you the win…');
  }

  function showAdminPanel() {
    const el = document.getElementById('admin-panel-overlay');
    if (el) el.classList.remove('hidden');
  }

  function closeAdminPanel() {
    const el = document.getElementById('admin-panel-overlay');
    if (el) el.classList.add('hidden');
  }

  // =========== OWNER PANEL FUNCTIONS ===========
  async function ownerSendGift(type, skinId, targetUsername) {
    const skin = SKINS[type] && SKINS[type].find(s => s.id === skinId);
    if (!skin) { setStatus('Unknown skin!'); return; }

    if (targetUsername) {
      const userInfo = await findUserByUsername(targetUsername);
      if (!userInfo || !userInfo.roomCode) {
        setStatus(`[OWNER] ${targetUsername} is not online!`);
        return;
      }
      const theirGiftKey = `owner_gift_${userInfo.side}`;
      await update(ref(database, `rooms/${userInfo.roomCode}/${theirGiftKey}`), {
        type, id: skinId, ts: Date.now(), fromOwner: true
      });
      setStatus(`[OWNER] Gifted ${skin.name} to ${targetUsername}`);
      return;
    }

    if (gameMode !== 'online' || !roomCode) { setStatus('[OWNER] Online only (or provide a username)!'); return; }
    const oppSide = onlineSide === 'player' ? 'player2' : 'player';
    const giftPath = `rooms/${roomCode}/owner_gift_${oppSide}`;
    await update(ref(database, giftPath), { type, id: skinId, ts: Date.now(), fromOwner: true });
    setStatus(`[OWNER] Gifted ${skin.name} to opponent`);
  }

  function ownerGiveOppColor(targetUsername) {
    const choices = SKINS.colors.map(s => `${s.id}${s.ownerOnly ? ' ★' : ''}`).join(', ');
    const id = prompt(`Color ID to gift${targetUsername ? ` to ${targetUsername}` : ' to opponent'}:\n${choices}`, 'aurora');
    if (!id) return;
    ownerSendGift('colors', id.trim().toLowerCase(), targetUsername || null).catch(e => setStatus('[OWNER] Error: ' + e.message));
  }

  function ownerGiveOppDesign(targetUsername) {
    const choices = SKINS.designs.map(s => `${s.id}${s.ownerOnly ? ' ★' : ''}`).join(', ');
    const id = prompt(`Design ID to gift${targetUsername ? ` to ${targetUsername}` : ' to opponent'}:\n${choices}`, 'stars');
    if (!id) return;
    ownerSendGift('designs', id.trim().toLowerCase(), targetUsername || null).catch(e => setStatus('[OWNER] Error: ' + e.message));
  }

  function ownerGiveOppCosmetic(targetUsername) {
    const choices = SKINS.cosmetics.map(s => `${s.id}${s.ownerOnly ? ' ★' : ''}`).join(', ');
    const id = prompt(`Cosmetic ID to gift${targetUsername ? ` to ${targetUsername}` : ' to opponent'}:\n${choices}`, 'aura');
    if (!id) return;
    ownerSendGift('cosmetics', id.trim().toLowerCase(), targetUsername || null).catch(e => setStatus('[OWNER] Error: ' + e.message));
  }

  function showOwnerPanel() {
    const el = document.getElementById('owner-panel-overlay');
    if (el) el.classList.remove('hidden');
  }

  function closeOwnerPanel() {
    const el = document.getElementById('owner-panel-overlay');
    if (el) el.classList.add('hidden');
  }

  // =========== LISTEN FOR OWNER GIFTS (Firebase) ===========
  let _ownerGiftListener = null;
  let _adminOppHexoneXListener = null;
  let _lastOwnerGiftTs = 0;
  let _lastAdminGiftTs = 0;

  function startOwnerGiftListener() {
    if (!roomCode) return;
    const myGiftKey = `owner_gift_${onlineSide}`;
    const myAdminHexKey = `admin_opp_hexonex_${onlineSide}`;

    if (_ownerGiftListener) {
      try { off(ref(database, `rooms/${roomCode}/${myGiftKey}`)); } catch(e) {}
    }
    _lastOwnerGiftTs = 0;
    _ownerGiftListener = onValue(ref(database, `rooms/${roomCode}/${myGiftKey}`), (snap) => {
      const d = snap.val();
      if (!d || !d.ts || d.ts <= _lastOwnerGiftTs) return;
      _lastOwnerGiftTs = d.ts;

      if (d.type === 'colors' || d.type === 'color') {
        const id = d.id;
        if (!progress.ownedSkins.colors.includes(id)) progress.ownedSkins.colors.push(id);
        progress.equippedSkins.color = id;
        if (id === 'rainbow') startRainbowLoop(); else stopRainbowLoop();
      } else if (d.type === 'designs' || d.type === 'design') {
        const id = d.id;
        if (!progress.ownedSkins.designs.includes(id)) progress.ownedSkins.designs.push(id);
        progress.equippedSkins.design = id;
      } else if (d.type === 'cosmetics' || d.type === 'cosmetic') {
        const id = d.id;
        if (!progress.ownedSkins.cosmetics.includes(id)) progress.ownedSkins.cosmetics.push(id);
        progress.equippedSkins.cosmetic = id;
      }
      saveProgress(); render();
      const skinName = SKINS.colors.concat(SKINS.designs, SKINS.cosmetics).find(s => s.id === d.id)?.name || d.id;
      setStatus(`🎁 You were gifted: ${skinName}!`);
    });

    if (_adminOppHexoneXListener) {
      try { off(ref(database, `rooms/${roomCode}/${myAdminHexKey}`)); } catch(e) {}
    }
    _lastAdminGiftTs = 0;
    _adminOppHexoneXListener = onValue(ref(database, `rooms/${roomCode}/${myAdminHexKey}`), (snap) => {
      const d = snap.val();
      if (!d || !d.ts || d.ts <= _lastAdminGiftTs) return;
      _lastAdminGiftTs = d.ts;
      const amt = d.amount || 0;
      if (amt > 0) {
        progress.hexoneX += amt;
        saveProgress(); updateShopButton();
        setStatus(`[ADMIN GIFT] +${amt} HexoneX received!`);
      }
      // Check personal inbox on game start
const inboxRef = ref(database, `user_inbox/${progress.username}/hexonex`);
get(inboxRef).then(snap => {
  const d = snap.val();
  if (!d || !d.amount || !d.ts) return;
  const age = Date.now() - d.ts;
  if (age > 7 * 24 * 60 * 60 * 1000) { set(inboxRef, null); return; } // expire after 7 days
  progress.hexoneX += d.amount;
  saveProgress(); updateShopButton();
  setStatus(`[GIFT] +${d.amount} HexoneX from ${d.from || 'admin'} received!`);
  set(inboxRef, null); // clear after claiming
}).catch(() => {});
    });
  }

  // =========== PUBLIC API ===========
  return {
    skipAttack, restartStage, nextStage, startBoss,
    showStages, closeStages, toggleSound,
    nextTutorial, skipTutorial, replayTutorial,
    showModeSelect, closeModeSelect, selectMode,
    onlineCreate, showJoinRoom, onlineJoin,
    showCreateJoin, cancelOnline, copyRoomCode,
    dismissLocalBanner,
    toggleChat, sendChat, voteRematch,
    showShop, closeShop, buySkin, switchTab,
    updateShopButton,
    showUsernameEdit, saveUsername, closeUsernameEdit,
    findRandomMatch,
    cycleAIDifficulty,
    leaveOnlineGame, rejoinRoom, declineRejoin, closeOppLeft,
    adminMaxMyHexes, adminGiveHexoneX, adminGiveOppHexoneX,
    adminMaxOppHexes, adminCoverBoard, adminGiveOppOneHex,
    adminGiveOppWin, adminGiveYouWin, showAdminPanel, closeAdminPanel,
    ownerGiveOppColor, ownerGiveOppDesign, ownerGiveOppCosmetic,
    showOwnerPanel, closeOwnerPanel
  };
})();

window.HexAsteal = HexAsteal;

// =========== CHEAT CODE DETECTION + PANEL INJECTION ===========
(function() {
  'use strict';

  const ADMIN_CODE = '1100=-0987654321234567890-=';
  const OWNER_CODE = '1010=-0987654321234567890-=';
  let _buf = '';

  window._hexAdminMode = false;
  window._hexOwnerMode = false;

  document.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    _buf = (_buf + e.key).slice(-(Math.max(ADMIN_CODE.length, OWNER_CODE.length)));

    if (_buf.endsWith(ADMIN_CODE) && !window._hexAdminMode) {
      window._hexAdminMode = true;
      injectStyles();
      injectAdminPanel();
      showAdminButton();
      HexAsteal.showShop();
      HexAsteal.closeShop();
      _buf = '';
    }
    if (_buf.endsWith(OWNER_CODE) && !window._hexOwnerMode) {
      window._hexOwnerMode = true;
      injectStyles();
      const adminOwnerSec = document.getElementById('admin-owner-section');
      if (adminOwnerSec) adminOwnerSec.style.display = '';
      else { injectOwnerPanel(); }
      showOwnerButton();
      HexAsteal.showShop();
      HexAsteal.closeShop();
      _buf = '';
    }
  });

  const adminSVG = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <polygon points="6.5,1 8,4.5 12,4.5 9,7 10,11 6.5,9 3,11 4,7 1,4.5 5,4.5" fill="#6366f1" stroke="#a5b4fc" stroke-width="0.6"/>
    <circle cx="6.5" cy="6.5" r="1.5" fill="#fff" opacity="0.9"/>
  </svg>`;

  const ownerSVG = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M1 10 L3 5 L6.5 8 L10 3 L12 10 Z" fill="#f59e0b" stroke="#fbbf24" stroke-width="0.6" stroke-linejoin="round"/>
    <rect x="1" y="10" width="11" height="1.5" rx="0.6" fill="#fbbf24"/>
  </svg>`;

  function injectStyles() {
    if (document.getElementById('admin-owner-styles')) return;
    const s = document.createElement('style');
    s.id = 'admin-owner-styles';
    s.textContent = `
      .admin-btn {
        padding:7px 8px; border:1px solid rgba(99,102,241,0.35);
        border-radius:7px; background:rgba(99,102,241,0.08); color:#c7d2fe;
        font-size:10px; font-weight:700; cursor:pointer; transition:all 0.15s;
        display:flex; align-items:center; gap:5px; letter-spacing:0.2px;
      }
      .admin-btn:hover { background:rgba(99,102,241,0.18); border-color:#6366f1; color:#e0e7ff; }
      .admin-btn:active { transform:scale(0.97); }
      .owner-btn { border-color:rgba(245,158,11,0.35)!important; color:#fde68a!important; background:rgba(245,158,11,0.08)!important; }
      .owner-btn:hover { background:rgba(245,158,11,0.18)!important; border-color:#f59e0b!important; }
      .owner-panel-btn {
        padding:9px 12px; border:1px solid rgba(245,158,11,0.4);
        border-radius:8px; background:rgba(245,158,11,0.08); color:#fde68a;
        font-size:12px; font-weight:700; cursor:pointer; transition:all 0.15s;
        display:flex; align-items:center; gap:7px; width:100%;
      }
      .owner-panel-btn:hover { background:rgba(245,158,11,0.18); border-color:#f59e0b; color:#fff; }
      .owner-panel-btn:active { transform:scale(0.98); }
      .panel-username-input {
        width:100%; padding:7px 10px; border-radius:8px;
        border:1px solid rgba(99,102,241,0.3); background:#08081a;
        color:#e5e7eb; font-size:12px; outline:none; margin-bottom:8px;
        transition:border-color 0.15s; box-sizing:border-box;
      }
      .panel-username-input:focus { border-color:#6366f1; }
      .panel-username-input.owner-input { border-color:rgba(245,158,11,0.3); }
      .panel-username-input.owner-input:focus { border-color:#f59e0b; }
      .panel-user-hint { font-size:10px; color:#4b5563; margin:-4px 0 8px; }
    `;
    document.head.appendChild(s);
  }

  function showAdminButton() {
    if (document.getElementById('btn-admin')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-admin';
    btn.title = 'Admin Panel';
    btn.onclick = () => HexAsteal.showAdminPanel();
    btn.style.cssText = 'border-color:rgba(99,102,241,0.5)!important;color:#a5b4fc!important;';
    btn.innerHTML = `${adminSVG} Admin`;
    document.getElementById('buttons').appendChild(btn);
  }

  function showOwnerButton() {
    if (document.getElementById('btn-owner')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-owner';
    btn.title = 'Owner Panel';
    btn.onclick = () => {
      if (window._hexAdminMode) HexAsteal.showAdminPanel();
      else HexAsteal.showOwnerPanel();
    };
    btn.style.cssText = 'border-color:rgba(245,158,11,0.5)!important;color:#fbbf24!important;';
    btn.innerHTML = `${ownerSVG} Owner`;
    document.getElementById('buttons').appendChild(btn);
  }

  function injectAdminPanel() {
    if (document.getElementById('admin-panel-overlay')) return;

    const el = document.createElement('div');
    el.id = 'admin-panel-overlay';
    el.className = 'overlay-screen hidden';
    el.innerHTML = `
      <div class="overlay-card" style="max-width:420px;padding:22px 20px;background:#0a081c;border-color:rgba(99,102,241,0.3);max-height:90vh;overflow-y:auto;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <polygon points="10,1 12.2,7 19,7 13.5,10.8 15.5,17 10,13.5 4.5,17 6.5,10.8 1,7 7.8,7" fill="#6366f1" stroke="#a5b4fc" stroke-width="0.7"/>
            <circle cx="10" cy="10" r="2" fill="#fff" opacity="0.9"/>
          </svg>
          <h2 style="font-size:17px;font-weight:900;color:#a5b4fc;margin:0;letter-spacing:1px;">ADMIN PANEL</h2>
          <span style="margin-left:auto;font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(99,102,241,0.2);border:1px solid #6366f1;color:#818cf8;font-weight:800;letter-spacing:1px;">RESTRICTED</span>
        </div>
        <p style="font-size:10px;color:#4b5563;margin-bottom:14px;">Hex grid actions use your current game session.</p>

        <p style="font-size:10px;color:#6366f1;font-weight:800;letter-spacing:1px;margin-bottom:8px;">GAME ACTIONS</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:14px;">
          <button class="admin-btn" onclick="HexAsteal.adminMaxMyHexes()">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="1" width="9" height="9" rx="1.5" stroke="#4ade80" stroke-width="1.1"/><line x1="5.5" y1="3" x2="5.5" y2="8" stroke="#4ade80" stroke-width="1.1"/><line x1="3" y1="5.5" x2="8" y2="5.5" stroke="#4ade80" stroke-width="1.1"/></svg>
            Max My Hexes
          </button>
          <button class="admin-btn" onclick="HexAsteal.adminMaxOppHexes()">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="1" width="9" height="9" rx="1.5" stroke="#f87171" stroke-width="1.1"/><path d="M3.5 5.5L5 7L7.5 4" stroke="#f87171" stroke-width="1.1" stroke-linecap="round"/></svg>
            Max Opp Hexes
          </button>
          <button class="admin-btn" onclick="HexAsteal.adminCoverBoard()">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="5.5" r="4.5" stroke="#22d3ee" stroke-width="1.1"/><circle cx="5.5" cy="5.5" r="2" fill="#22d3ee" opacity="0.5"/></svg>
            Cover Board
          </button>
          <button class="admin-btn" onclick="HexAsteal.adminGiveOppOneHex()">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><polygon points="5.5,1 9.5,3 9.5,8 5.5,10 1.5,8 1.5,3" stroke="#f97316" stroke-width="1" fill="none"/><text x="5.5" y="7.8" text-anchor="middle" font-size="5" fill="#f97316" font-weight="900">1</text></svg>
            Opp = 1 Hex
          </button>
          <button class="admin-btn" onclick="HexAsteal.adminGiveOppWin()">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.5 5.5L4.5 7.5L8.5 3.5" stroke="#f87171" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Give Opp Win
          </button>
          <button class="admin-btn" onclick="HexAsteal.adminGiveYouWin()">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.5 5.5L4.5 7.5L8.5 3.5" stroke="#4ade80" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Give You Win
          </button>
        </div>

        <p style="font-size:10px;color:#6366f1;font-weight:800;letter-spacing:1px;margin-bottom:8px;">HEXONEX GIFTING</p>
        <button class="admin-btn" onclick="HexAsteal.adminGiveHexoneX()" style="width:100%;margin-bottom:10px;justify-content:center;">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1L6.7 4.2H10L7.5 6L8.5 9L5.5 7.5L2.5 9L3.5 6L1 4.2H4.3Z" fill="#fbbf24"/></svg>
          Give Myself HexoneX
        </button>
        <input id="admin-target-username" class="panel-username-input" placeholder="Username to gift HexoneX (blank = opponent)…" autocomplete="off"/>
        <p class="panel-user-hint">Leave blank to gift current in-game opponent. Type a username to gift any online player.</p>
        <button class="admin-btn" onclick="HexAsteal.adminGiveOppHexoneX(document.getElementById('admin-target-username').value.trim()||null)" style="width:100%;justify-content:center;margin-bottom:6px;">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1L6.7 4.2H10L7.5 6L8.5 9L5.5 7.5L2.5 9L3.5 6L1 4.2H4.3Z" fill="#f87171"/></svg>
          Gift HexoneX to User
        </button>

        <div id="admin-owner-section" style="display:none;border-top:1px solid rgba(99,102,241,0.2);padding-top:12px;margin-top:10px;">
          <p style="font-size:10px;color:#f59e0b;font-weight:800;letter-spacing:1px;margin-bottom:8px;">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:middle"><path d="M1 8L2.5 4L5 6L7.5 2.5L9 8Z" fill="#f59e0b"/></svg>
            OWNER TOOLS
          </p>
          <input id="admin-owner-username" class="panel-username-input owner-input" placeholder="Username to gift skin (blank = opponent)…" autocomplete="off"/>
          <p class="panel-user-hint">Owner-exclusive skins marked ★ are available.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
            <button class="admin-btn owner-btn" onclick="HexAsteal.ownerGiveOppColor(document.getElementById('admin-owner-username').value.trim()||null)">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="#f59e0b" stroke-width="1"/><circle cx="5" cy="5" r="1.8" fill="#f59e0b" opacity="0.6"/></svg>
              Gift Color
            </button>
            <button class="admin-btn owner-btn" onclick="HexAsteal.ownerGiveOppDesign(document.getElementById('admin-owner-username').value.trim()||null)">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polygon points="5,1 9,3 9,7 5,9 1,7 1,3" stroke="#f59e0b" stroke-width="1" fill="none"/></svg>
              Gift Design
            </button>
            <button class="admin-btn owner-btn" onclick="HexAsteal.ownerGiveOppCosmetic(document.getElementById('admin-owner-username').value.trim()||null)">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1L6.2 3.8H9.5L7 5.6L8 8.5L5 6.9L2 8.5L3 5.6L0.5 3.8H3.8Z" fill="#f59e0b" opacity="0.8"/></svg>
              Gift Cosmetic
            </button>
          </div>
        </div>

        <button class="btn-ghost" onclick="HexAsteal.closeAdminPanel()" style="margin-top:14px;width:100%">Close</button>
      </div>`;

    document.body.appendChild(el);

    if (window._hexOwnerMode) {
      const sec = el.querySelector('#admin-owner-section');
      if (sec) sec.style.display = '';
    }
  }

  function injectOwnerPanel() {
    if (document.getElementById('owner-panel-overlay')) return;

    const el = document.createElement('div');
    el.id = 'owner-panel-overlay';
    el.className = 'overlay-screen hidden';
    el.innerHTML = `
      <div class="overlay-card" style="max-width:340px;padding:22px 20px;background:#0e0c0a;border-color:rgba(245,158,11,0.3);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M1 16 L4 7 L10 12 L16 4 L19 16 Z" fill="#f59e0b" stroke="#fbbf24" stroke-width="0.7" stroke-linejoin="round"/>
            <rect x="1" y="16" width="18" height="2" rx="0.8" fill="#fbbf24"/>
          </svg>
          <h2 style="font-size:17px;font-weight:900;color:#fde68a;margin:0;letter-spacing:1px;">OWNER PANEL</h2>
        </div>

        <p style="font-size:11px;color:#78350f;margin-bottom:12px;">Gift skins to any online player, or leave blank to gift your current opponent.</p>

        <input id="owner-target-username" class="panel-username-input owner-input" placeholder="Username (blank = current opponent)…" autocomplete="off"/>
        <p class="panel-user-hint" style="margin-bottom:12px;">Owner-exclusive items are marked ★ in prompts.</p>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
          <button class="owner-panel-btn" onclick="HexAsteal.ownerGiveOppColor(document.getElementById('owner-target-username').value.trim()||null)">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="#f59e0b" stroke-width="1.2"/><circle cx="6.5" cy="6.5" r="2.5" fill="#f59e0b" opacity="0.5"/></svg>
            Give Color
          </button>
          <button class="owner-panel-btn" onclick="HexAsteal.ownerGiveOppDesign(document.getElementById('owner-target-username').value.trim()||null)">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><polygon points="6.5,1 11,3.5 11,9.5 6.5,12 2,9.5 2,3.5" stroke="#f59e0b" stroke-width="1.1" fill="none"/></svg>
            Give Design
          </button>
          <button class="owner-panel-btn" onclick="HexAsteal.ownerGiveOppCosmetic(document.getElementById('owner-target-username').value.trim()||null)">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1L8.2 5H12.5L9.2 7.5L10.5 12L6.5 9.5L2.5 12L3.8 7.5L0.5 5H4.8Z" fill="#f59e0b" opacity="0.8"/></svg>
            Give Cosmetic
          </button>
        </div>

        <button class="btn-ghost" onclick="HexAsteal.closeOwnerPanel()" style="margin-top:4px;width:100%">Close</button>
      </div>`;

    document.body.appendChild(el);
  }

})();
