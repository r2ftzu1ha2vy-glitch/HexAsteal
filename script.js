// =========== FIREBASE (loaded as module) ===========
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, off } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

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

// =========== REFRESH DETECTION ===========
let refreshDetected = false;
let refreshOverlay = null;
let roomCleanupTimeout = null;
let isLeavingRoom = false;

// Add this function to create refresh overlay
function createRefreshOverlay() {
  if (refreshOverlay) return;
  
  refreshOverlay = document.createElement('div');
  refreshOverlay.id = 'refresh-overlay';
  refreshOverlay.className = 'overlay-screen';
  refreshOverlay.innerHTML = `
    <div class="overlay-card refresh-card">
      <h2>⟳ Refresh Detected</h2>
      <p>You left the game. Would you like to rejoin your online match?</p>
      <div class="refresh-btns" style="display: flex; gap: 10px; justify-content: center; margin-top: 20px;">
        <button class="btn-primary" id="refresh-yes">Yes, Rejoin</button>
        <button class="btn-ghost" id="refresh-no">No, Stay</button>
      </div>
    </div>
  `;
  document.body.appendChild(refreshOverlay);
  
  document.getElementById('refresh-yes').onclick = () => {
    refreshOverlay.classList.add('hidden');
    rejoinRoom();
  };
  
document.getElementById('refresh-no').onclick = () => {
  refreshOverlay.classList.add('hidden');
  // Clean up room data
  if (roomCode && onlineSide === PLAYER) {
    set(ref(database, `rooms/${roomCode}`), null).catch(() => {});
  }
  cleanupAllOnline();
  gameMode = 'ai';
  startStage(progress.stage);
  // UPDATE: Call updateOnlineUI to hide leave button
  updateOnlineUI();
  
  // Clear session storage
  sessionStorage.removeItem('lastRoomCode');
  sessionStorage.removeItem('lastOnlineSide');
};;
};

function rejoinRoom() {
  if (!roomCode) return;
  
  const roomRef = ref(database, `rooms/${roomCode}`);
  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      setStatus('Room no longer exists.');
      gameMode = 'ai';
      startStage(progress.stage);
      // UPDATE: Hide leave button if room doesn't exist
      updateOnlineUI();
      // Clear session storage
      sessionStorage.removeItem('lastRoomCode');
      sessionStorage.removeItem('lastOnlineSide');
      return;
    }
    
    // Rejoin as the same side
    onlineRoomSettings = sanitizeRoomSettings(data.settings || {});
    hideAllOverlays();
    startOnlineGame(onlineSide === PLAYER, data.seed || (Date.now() & 0xffff), onlineRoomSettings);
    startOnlineMoveListener();
    initChat();
    // updateOnlineUI will be called inside startOnlineGame
  }, { onlyOnce: true });
}
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

  const POWERUPS = {
    surge:  { icon: '⚡︎' },
    shield: { icon: '🛡' },
    drain:  { icon: '☠︎︎' },
    blaze:  { icon: 'ঌ' },
    freeze: { icon: '❄' },
    spread: { icon: '𖦹' }
  };
  const PU_KEYS = Object.keys(POWERUPS);

  // =========== GAME MODE ===========
  let gameMode = 'ai';
  let localTurn = PLAYER;

  // =========== ONLINE ROOM SETTINGS ===========
  // FIX: declared at module scope so all functions can access it
  let onlineRoomSettings = { pups: 8, startHexes: 4, background: 'original' };

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
      maxTurns: [35, 30, 28][tier],
      eHexes: [5, 7, 9][tier],
      ePow: [4, 5, 6][tier],
      pPow: 4,
      blocked: [3, 4, 4][tier],
      pups: 6,
      isBoss: true,
      bossPow: [7, 8, 9][tier],
      bossRegen: 2,
      bossName: ['HEXAFORCE', 'HEXAFORCE II', 'HEXAFORCE SUPREME'][tier],
      background: 'original'
    };
    return {
      maxTurns: Math.round(40 - tier * 4 - p * 3),
      eHexes: Math.min(Math.round(4 + tier * 1.5 + p * 1.5), 8),
      ePow: Math.min(Math.round(3 + tier * 0.7 + p * 0.8), 7),
      pPow: Math.min(3 + Math.floor(tier * 0.5), 5),
      blocked: Math.min(Math.round(4 + tier + p * 1.5), 8),
      pups: Math.max(Math.round(8 - tier - p * 1.5), 4),
      isBoss: false, bossPow: 0, bossRegen: 1, bossName: null,
      background: 'original'
    };
  }

  // FIX: mpConfig now accepts roomSettings parameter and applies them
  function mpConfig(roomSettings) {
    const s = sanitizeRoomSettings(roomSettings || {});
    return {
      maxTurns: 50,
      eHexes: s.startHexes || 4,
      ePow: 4,
      pPow: 4,
      blocked: 5,
      pups: s.pups !== undefined ? s.pups : 8,
      isBoss: false, bossPow: 0, bossRegen: 1, bossName: null,
      background: s.background || 'original'
    };
  }

  // FIX: sanitizeRoomSettings defined at module scope
  function sanitizeRoomSettings(raw) {
    const pups = parseInt(raw && raw.pups, 10);
    const startHexes = parseInt(raw && raw.startHexes, 10);
    return {
      pups: isNaN(pups) ? 8 : Math.max(0, Math.min(12, pups)),
      startHexes: isNaN(startHexes) ? 4 : Math.max(2, Math.min(8, startHexes)),
      background: (raw && raw.background) || 'original'
    };
  }

  // FIX: roomSettingsSummary defined at module scope
  function roomSettingsSummary(s) {
    return `Power-ups: ${s.pups} · Start hexes: ${s.startHexes} · Board: ${s.background}`;
  }

  // FIX: applyBoardTheme defined at module scope
  function applyBoardTheme(theme) {
    if (!boardEl) return;
    boardEl.setAttribute('data-theme', theme || 'original');
  }

  // FIX: visualOwner defined — returns the logical owner string used for CSS classes
  function visualOwner(owner) {
    if (owner === PLAYER2) return 'player2';
    return owner; // 'player', 'enemy', 'neutral', 'blocked'
  }

  // FIX: onlineOpponentSide defined — returns the opponent's side string
  function onlineOpponentSide() {
    return onlineSide === PLAYER ? PLAYER2 : PLAYER;
  }

  // =========== SKIN HELPERS ===========
  // FIX: getEquippedColorSkin, getDesignPatternId, getCosmeticMeta all defined

  function getEquippedColorSkin() {
    const id = progress.equippedSkins.color || 'green';
    return SKINS.colors.find(s => s.id === id) || SKINS.colors[0];
  }

  // Returns the SVG pattern ID for the current design skin, or null for 'none'
  function getDesignPatternId() {
    const id = progress.equippedSkins.design || 'none';
    if (id === 'none') return null;
    return `design-${id}`;
  }

  // Returns cosmetic display info or null
  function getCosmeticMeta() {
    const id = progress.equippedSkins.cosmetic || 'none';
    if (id === 'none') return null;
    const map = {
      horns: { text: '𓄋', cls: 'hex-cosmetic' },
      halo:  { text: '⬭', cls: 'hex-cosmetic' },
      crown: { text: '🜲', cls: 'hex-cosmetic' }
    };
    return map[id] || null;
  }

  // Returns true if the cell owner is the local viewer's side
  function isViewerOwned(owner) {
    if (gameMode === 'online') return owner === onlineSide;
    return owner === PLAYER;
  }

  // =========== PROGRESS ===========
  const SAVE_KEY = 'hexastealv1';

  let progress = {
    stage: 1, completed: [], tutDone: false, soundOn: true,
    hexoneX: 0,
    ownedSkins: {
      colors: ['green'],
      designs: ['none'],
      cosmetics: ['none']
    },
    equippedSkins: {
      color: 'green',
      design: 'none',
      cosmetic: 'none'
    }
  };

  const SKINS = {
    colors: [
      {id: 'green',   name: 'Classic Green', price: 0,   stroke: '#22c55e', fill: '#14532d'},
      {id: 'blue',    name: 'Cyber Blue',    price: 50,  stroke: '#3b82f6', fill: '#172554'},
      {id: 'purple',  name: 'Void Purple',   price: 75,  stroke: '#a855f7', fill: '#2e1065'},
      {id: 'gold',    name: 'Golden Glory',  price: 150, stroke: '#fbbf24', fill: '#92400e'},
      {id: 'rainbow', name: 'Rainbow',       price: 300, stroke: '#ef4444', fill: '#991b1b'}
    ],
    designs: [
      {id: 'none',    name: 'Plain',   price: 0},
      {id: 'stripes', name: 'Stripes', price: 100},
      {id: 'swirl',   name: 'Swirl',   price: 125},
      {id: 'dots',    name: 'Dots',    price: 175}
    ],
    cosmetics: [
      {id: 'none',  name: 'None',          price: 0},
      {id: 'horns', name: 'Devil Horns',   price: 200},
      {id: 'halo',  name: 'Angel Halo',    price: 200},
      {id: 'crown', name: 'Victory Crown', price: 350}
    ]
  };

  function awardHexoneX(pHexes, _eHexes, won) {
    let earnings;
    if (won) {
      earnings = pHexes * 5;
      progress.hexoneX += earnings;
      setStatus(`+${earnings} HexoneX! ⌬ (Win Bonus)`);
    } else {
      earnings = -(Math.floor(pHexes / 2) * 2);
      progress.hexoneX = Math.max(0, progress.hexoneX + earnings);
      setStatus(`${earnings} HexoneX ⌬ (Loss Penalty)`);
    }
    saveProgress();
    updateShopButton();
  }

  function buySkin(type, id, price) {
    const skin = SKINS[type] && SKINS[type].find(s => s.id === id);
    if (!skin) return;
    if (!progress.ownedSkins[type]) progress.ownedSkins[type] = [];
    if (!progress.ownedSkins[type].includes(id)) {
      if (progress.hexoneX < price) { setStatus('❌ Not enough HexoneX!'); return; }
      progress.ownedSkins[type].push(id);
      progress.hexoneX -= price;
      saveProgress();
      setStatus(`☑ Bought ${skin.name}!`);
    } else {
      const key = type === 'colors' ? 'color' : type === 'designs' ? 'design' : 'cosmetic';
      progress.equippedSkins[key] = id;
      saveProgress();
      setStatus(`🖍 Equipped ${skin.name}!`);
    }
    showShop();
    updateShopButton();
    render();
  }

  function updateShopButton() {
    const btn = document.getElementById('btn-shop');
    if (btn) btn.textContent = `𖠩 ${progress.hexoneX}`;
  }

  function showShop() {
    const overlay = document.getElementById('shop-overlay');
    if (!overlay) return;
    const balEl = document.getElementById('hexoneX-balance');
    if (balEl) balEl.textContent = progress.hexoneX;

    const colorsEl = document.getElementById('shop-colors');
    if (colorsEl) colorsEl.innerHTML = SKINS.colors.map(skin => `
      <div class="skin-item ${(progress.ownedSkins.colors || []).includes(skin.id) ? 'owned' : ''} ${progress.equippedSkins.color === skin.id ? 'equipped' : ''}">
        <div class="skin-preview" style="background:${skin.fill};border:2px solid ${skin.stroke};border-radius:8px;width:50px;height:50px;"></div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:#f3f4f6">${skin.name}</div>
          <small style="color:#fbbf24">${skin.price} HexoneX</small>
        </div>
        <button class="shop-action-btn" onclick="HexAsteal.buySkin('colors', '${skin.id}', ${skin.price})">
          ${(progress.ownedSkins.colors || []).includes(skin.id) ? 'Equip' : 'Buy'}
        </button>
      </div>
    `).join('');

    const designsEl = document.getElementById('shop-designs');
    if (designsEl) designsEl.innerHTML = SKINS.designs.map(skin => `
      <div class="skin-item ${(progress.ownedSkins.designs || []).includes(skin.id) ? 'owned' : ''} ${progress.equippedSkins.design === skin.id ? 'equipped' : ''}">
        <div class="skin-preview" style="background:#1a1a2e;border:2px solid #374151;border-radius:8px;width:50px;height:50px;display:flex;align-items:center;justify-content:center;font-size:18px;">${skin.id !== 'none' ? skin.id[0].toUpperCase() : '—'}</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:#f3f4f6">${skin.name}</div>
          <small style="color:#fbbf24">${skin.price} HexoneX</small>
        </div>
        <button class="shop-action-btn" onclick="HexAsteal.buySkin('designs', '${skin.id}', ${skin.price})">
          ${(progress.ownedSkins.designs || []).includes(skin.id) ? 'Equip' : 'Buy'}
        </button>
      </div>
    `).join('');

    const cosmeticsEl = document.getElementById('shop-cosmetics');
    if (cosmeticsEl) cosmeticsEl.innerHTML = SKINS.cosmetics.map(skin => `
      <div class="skin-item ${(progress.ownedSkins.cosmetics || []).includes(skin.id) ? 'owned' : ''} ${progress.equippedSkins.cosmetic === skin.id ? 'equipped' : ''}">
        <div class="skin-preview" style="background:#1a1a2e;border:2px solid #374151;border-radius:8px;width:50px;height:50px;display:flex;align-items:center;justify-content:center;font-size:22px;">${skin.id === 'horns' ? '𓄋' : skin.id === 'halo' ? '⬭' : skin.id === 'crown' ? '🜲' : '—'}</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:#f3f4f6">${skin.name}</div>
          <small style="color:#fbbf24">${skin.price} HexoneX</small>
        </div>
        <button class="shop-action-btn" onclick="HexAsteal.buySkin('cosmetics', '${skin.id}', ${skin.price})">
          ${(progress.ownedSkins.cosmetics || []).includes(skin.id) ? 'Equip' : 'Buy'}
        </button>
      </div>
    `).join('');

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
    pStarts.forEach(([r,c]) => { grid[r][c] = makeCell(PLAYER, cfg.pPow + randInt(2)); });

    if (isMP) {
      const p2Starts = [[0,7],[0,8],[1,7],[1,8]];
      p2Starts.forEach(([r,c]) => { grid[r][c] = makeCell(PLAYER2, cfg.pPow + randInt(2)); });
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
      if (need > 0) {
        for (const [r, c] of bNeigh) {
          if (need <= 0) break;
          for (const [nr, nc] of shuffle(getNeighbors(r, c))) {
            if (need <= 0) break;
            if (grid[nr][nc].owner === NEUTRAL) { grid[nr][nc] = makeCell(ENEMY, cfg.ePow + randInt(2)); need--; }
          }
        }
      }
    } else {
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

    let placed = 0, att = 0;
    const p2Starts = [[0,7],[0,8],[1,7],[1,8]];
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

    // Glow filters
    ['glow-player:#22c55e:3','glow-player2:#3b82f6:3','glow-enemy:#ef4444:3',
     'glow-select:#fbbf24:5','glow-boss:#ff0000:6','glow-surge:#22d3ee:4',
     'glow-shield:#a8a29e:4','glow-drain:#a855f7:4','glow-blaze:#f97316:4',
     'glow-freeze:#7dd3fc:4','glow-spread:#f472b6:4'].forEach(s => {
      const [id, color, rad] = s.split(':');
      defs.appendChild(makeGlow(NS, id, color, +rad));
    });

    // FIX: Design pattern definitions for skin overlays
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

        // FIX: designOverlay — a second polygon over the base for pattern fills
        const designOverlay = document.createElementNS(NS, 'polygon');
        designOverlay.setAttribute('points', hexPoints(cx, cy));
        designOverlay.style.fill = 'none';
        designOverlay.style.pointerEvents = 'none';

        // FIX: cosmeticIcon — text element for cosmetic overlays (crown, halo, horns)
        const cosmeticIcon = document.createElementNS(NS, 'text');
        cosmeticIcon.setAttribute('x', cx); cosmeticIcon.setAttribute('y', cy);
        cosmeticIcon.setAttribute('dy', '-1.6em'); cosmeticIcon.setAttribute('class', 'hex-cosmetic');
        cosmeticIcon.style.pointerEvents = 'none';

        g.appendChild(poly);
        g.appendChild(designOverlay);
        g.appendChild(txt);
        g.appendChild(puIcon);
        g.appendChild(statusIcon);
        g.appendChild(bossIcon);
        g.appendChild(cosmeticIcon);
        svgEl.appendChild(g);

        // FIX: hexEls now includes designOverlay and cosmeticIcon
        hexEls[`${r},${c}`] = { group: g, polygon: poly, text: txt, puIcon, statusIcon, bossIcon, designOverlay, cosmeticIcon };
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

        // FIX: visualOwner is now defined above
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

  if (gameMode === 'online') {
    updateOnlineUI();
  }
        
        el.polygon.setAttribute('class', cls);

        // FIX: isViewerOwned, getEquippedColorSkin, getDesignPatternId, getCosmeticMeta all defined
        if (isViewerOwned(cell.owner)) {
          const colorSkin = getEquippedColorSkin();
          el.polygon.style.fill = colorSkin.fill;
          el.polygon.style.stroke = colorSkin.stroke;

          const patternId = getDesignPatternId();
          el.designOverlay.style.fill = patternId ? `url(#${patternId})` : 'none';

          const cosmetic = getCosmeticMeta();
          if (cosmetic) {
            el.cosmeticIcon.textContent = cosmetic.text;
            el.cosmeticIcon.setAttribute('class', cosmetic.cls);
          } else {
            el.cosmeticIcon.textContent = '';
            el.cosmeticIcon.setAttribute('class', 'hex-cosmetic');
          }
        } else {
          el.polygon.style.fill = '';
          el.polygon.style.stroke = '';
          el.designOverlay.style.fill = 'none';
          el.cosmeticIcon.textContent = '';
          el.cosmeticIcon.setAttribute('class', 'hex-cosmetic');
        }

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
    // FIX: onlineOpponentSide is now defined above
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

    // FIX: playerDot declared in module-level let block
    const colorSkin = getEquippedColorSkin();
    playerDot.className = 'color-dot';
    playerDot.style.background = colorSkin.stroke;
    playerDot.style.boxShadow = `0 0 6px ${colorSkin.stroke}88`;

    if (gameMode === 'local') {
      pLabel.textContent = 'P1';
      foeLabel.textContent = 'P2';
      enemyDot.className = 'color-dot player2-dot';
      enemyDot.style.background = '';
      enemyDot.style.boxShadow = '';
      applyBoardTheme(cfg.background || 'original');
    } else if (gameMode === 'online') {
      pLabel.textContent = 'YOU';
      foeLabel.textContent = 'OPP';
      enemyDot.className = 'color-dot enemy-dot';
      enemyDot.style.background = '';
      enemyDot.style.boxShadow = '';
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
  function showTutorial() {
    tutStep = 0; renderTutStep();
    tutOverlay.classList.remove('hidden');
  }
  function renderTutStep() {
    const s = TUT[tutStep];
    tutIcon.textContent = s.icon; tutTitle.textContent = s.title; tutText.textContent = s.text;
    tutNextBtn.textContent = tutStep === TUT.length - 1 ? '🖳 Play!' : 'Next →';
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
    SFX.click();
    modeOverlay.classList.add('hidden');
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

  // =========== LOCAL 2P ===========
  function startLocalGame() {
    gameMode = 'local';
    cfg = mpConfig();
    localTurn = PLAYER;
    hideAllOverlays();
    generateAndPlay();
  }

  function showLocalTurnBanner() {
    const icon  = document.getElementById('local-banner-icon');
    const title = document.getElementById('local-banner-title');
    const sub   = document.getElementById('local-banner-sub');
    if (localTurn === PLAYER) {
      icon.textContent = '🟢';
      title.textContent = "Player 1's Turn";
      sub.textContent = 'Pass the device to Player 1';
    } else {
      icon.textContent = '🔵';
      title.textContent = "Player 2's Turn";
      sub.textContent = 'Pass the device to Player 2';
    }
    localTurnBanner.classList.remove('hidden');
  }
  function dismissLocalBanner() {
    SFX.click();
    localTurnBanner.classList.add('hidden');
    phase = 'select';
    const who = localTurn === PLAYER ? 'Player 1 (green)' : 'Player 2 (blue)';
    setStatus(`${who} — select a hex to attack or ⇄ transfer`);
    render();
  }

  // =========== ONLINE MULTIPLAYER (Firebase) ===========
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
    setupCodeInputs();
    setTimeout(() => document.getElementById('cd0').focus(), 50);
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
        if (e.key === 'Backspace' && !el.value && i > 0) {
          document.getElementById(`cd${i-1}`).focus();
        }
      };
    }
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

  const code = String(Math.floor(1000 + Math.random() * 9000));
  roomCode = code;
  onlineSide = PLAYER;
  onlineRoomSettings = getOnlineRoomSettings();

  const settingsSummaryDiv = document.createElement('div');
  settingsSummaryDiv.className = 'room-settings-summary';
  settingsSummaryDiv.innerHTML = roomSettingsSummary(onlineRoomSettings);
  
  const waitingText = document.getElementById('waiting-text');
  waitingText.innerHTML = 'Waiting for opponent to join…';
  waitingText.appendChild(settingsSummaryDiv);

  document.getElementById('room-code-big').textContent = code;

  const seed = (Date.now() & 0xffff) + Math.floor(Math.random() * 1000);

  dbRef = ref(database, `rooms/${code}`);
  set(dbRef, {
    status: 'waiting',
    seed,
    settings: onlineRoomSettings,
    createdAt: Date.now(),
    host: 'player1'
  }).catch(err => {
    console.error('Create room error:', err);
    setOnlineStatus('Failed to create room. Check connection.', 'error');
  });

  const statusRef = ref(database, `rooms/${code}/status`);
  statusListener = onValue(statusRef, (snapshot) => {
    if (snapshot.val() === 'joined' && onlineSide === PLAYER) {
      update(dbRef, { status: 'started' }).catch(console.error);
      document.getElementById('waiting-text').innerHTML = 'Opponent joined! Starting…';
      
      // Show settings one more time before starting
      const finalSettings = document.createElement('div');
      finalSettings.className = 'room-settings-summary';
      finalSettings.innerHTML = roomSettingsSummary(onlineRoomSettings);
      document.getElementById('waiting-text').appendChild(finalSettings);

      setTimeout(() => {
        cleanupListeners();
        onlineOverlay.classList.add('hidden');
        startOnlineGame(true, seed, onlineRoomSettings);
        startOnlineMoveListener();
      }, 700);
    }
  });
  
  // Add room cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (roomCode && onlineSide === PLAYER && !isLeavingRoom) {
      set(ref(database, `rooms/${roomCode}`), null).catch(() => {});
    }
  });
}

function onlineJoin() {
  SFX.click();
  const code = [0,1,2,3].map(i => document.getElementById(`cd${i}`).value).join('');

  if (code.length !== 4 || !/^\d{4}$/.test(code)) {
    setOnlineStatus('Enter a valid 4-digit code.', 'error');
    return;
  }

  document.getElementById('online-join-form').classList.add('hidden');
  const connectingEl = document.getElementById('online-connecting');
  connectingEl.classList.remove('hidden');
  connectingEl.innerHTML = `<p class="mode-sub">Connecting to room ${code}…</p><div class="waiting-dots"><span></span><span></span><span></span></div>`;
  document.getElementById('online-back-btn').style.display = 'none';

  roomCode = code;
  onlineSide = PLAYER2;
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
      
      // Show settings to joining player
      connectingEl.innerHTML = `
        <p class="mode-sub">Joined! Waiting for host to start…</p>
        <div class="room-settings-summary">${roomSettingsSummary(onlineRoomSettings)}</div>
        <div class="waiting-dots"><span></span><span></span><span></span></div>
      `;
      
      update(dbRef, { status: 'joined' }).catch(console.error);
    }

    if (data.status === 'started') {
      onlineRoomSettings = sanitizeRoomSettings(data.settings || {});
      cleanupListeners();
      onlineOverlay.classList.add('hidden');
      startOnlineGame(false, data.seed, onlineRoomSettings);
      startOnlineMoveListener();
      initChat();
    }
  });
  
  // Add room cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (roomCode && !isLeavingRoom) {
      // Don't delete room if player is just refreshing
      // The room will be cleaned up by timeout or host
    }
  });
}

// =========== UTILITY FUNCTIONS (move outside IIFE) ===========
function sanitizeRoomSettings(raw) {
  const pups = parseInt(raw && raw.pups, 10);
  const startHexes = parseInt(raw && raw.startHexes, 10);
  return {
    pups: isNaN(pups) ? 8 : Math.max(0, Math.min(12, pups)),
    startHexes: isNaN(startHexes) ? 4 : Math.max(2, Math.min(8, startHexes)),
    background: (raw && raw.background) || 'original'
  };
}

function roomSettingsSummary(s) {
  return `Power-ups: ${s.pups} · Start hexes: ${s.startHexes} · Board: ${s.background}`;
}

function applyBoardTheme(theme) {
  if (!boardEl) return;
  boardEl.setAttribute('data-theme', theme || 'original');
}

function visualOwner(owner) {
  if (owner === PLAYER2) return 'player2';
  return owner;
}

function onlineOpponentSide() {
  return onlineSide === PLAYER ? PLAYER2 : PLAYER;
}
  
  // FIX: startOnlineMoveListener hoisted to module scope (was accidentally nested inside onlineJoin's onValue callback)
  function startOnlineMoveListener() {
    if (!roomCode) return;
    const opponentMoveKey = onlineSide === PLAYER ? 'p2_move' : 'p1_move';
    const moveRef = ref(database, `rooms/${roomCode}/${opponentMoveKey}`);

    moveListener = onValue(moveRef, (snapshot) => {
      const data = snapshot.val();
      if (!data || !data.msgId || data.msgId === lastSeenMsgId) return;
      if (data.sender === onlineSide) return;
      lastSeenMsgId = data.msgId;
      if (data.turn !== turn) {
        console.warn('Turn mismatch:', data.turn, 'vs local', turn);
        return;
      }
      handleOnlineMessage(data);
    });
  }

  // FIX: cancelOnline hoisted to module scope
function cancelOnline() {
  cleanupListeners();
  cleanupRematch();
  teardownChat();

  if (dbRef && roomCode && onlineSide === PLAYER) {
    set(ref(database, `rooms/${roomCode}`), null).catch(() => {});
  }

  dbRef = null;
  roomCode = null;
  lastSeenMsgId = null;
  onlineOverlay.classList.add('hidden');
  
  // Clear session storage
  sessionStorage.removeItem('lastRoomCode');
  sessionStorage.removeItem('lastOnlineSide');
  
  // UPDATE: Call updateOnlineUI when canceling online mode
  updateOnlineUI();
  
  if (gameMode === 'online') {
    gameMode = 'ai';
    startStage(progress.stage);
  }
  // FIX: cleanupListeners hoisted to module scope
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

  // FIX: sendOnline hoisted to module scope
  function sendOnline(msg) {
    if (!roomCode) return;
    const myMoveKey = onlineSide === PLAYER ? 'p1_move' : 'p2_move';
    const msgId = Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const payload = {
      msgId,
      sender: onlineSide,
      type: msg.type,
      move: msg.move || null,
      turn,
      ts: Date.now()
    };
    update(ref(database, `rooms/${roomCode}/${myMoveKey}`), payload)
      .catch(err => console.error('Send move failed:', err));
  }

  // FIX: handleOnlineMessage hoisted to module scope
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

function updateOnlineUI() {
  const leaveBtn = document.getElementById('btn-leave-online');
  if (leaveBtn) {
    if (gameMode === 'online') {
      leaveBtn.classList.remove('hidden');
    } else {
      leaveBtn.classList.add('hidden');
    }
  }
}

  let _rngSeed = 0;
  function seededRand(n) {
    _rngSeed = (_rngSeed * 1664525 + 1013904223) & 0xffffffff;
    return Math.abs(_rngSeed) % n;
  }

function startOnlineGame(isHost, seed, roomSettings) {
  gameMode = 'online';
  onlineRoomSettings = sanitizeRoomSettings(roomSettings || {});
  cfg = mpConfig(onlineRoomSettings);
  hideAllOverlays();
  turn = 1;
  phase = 'select';
  selectedHex = null;
  validTargets = [];
  transferTargets = [];
  animating = false;

  generateMapSeeded(seed || (Date.now() & 0xffff));
  createBoard();
  SFX.stageStart();
  render();
  initChat();
  
  // UPDATE: Show leave button when online game starts
  updateOnlineUI();
  
  // Store room info for refresh detection
  sessionStorage.setItem('lastRoomCode', roomCode);
  sessionStorage.setItem('lastOnlineSide', onlineSide);

  // Monitor room for opponent leaving
  const roomMonitorRef = ref(database, `rooms/${roomCode}`);
  const monitorListener = onValue(roomMonitorRef, (snapshot) => {
    const data = snapshot.val();
    if (!data && !isLeavingRoom) {
      if (phase !== 'gameover') {
        setStatus('⚠️ Opponent has left. Returning to menu...');
        setTimeout(() => {
          appendSystemMsg('Opponent disconnected. Room closed.');
          cleanupAllOnline();
          gameMode = 'ai';
          startStage(progress.stage);
          // UPDATE: Hide leave button when returning to AI mode
          updateOnlineUI();
          // Clear session storage
          sessionStorage.removeItem('lastRoomCode');
          sessionStorage.removeItem('lastOnlineSide');
        }, 2000);
      }
    }
  });

  if (onlineSide === PLAYER) {
    setStatus('𖡎 Your turn (🟢 P1) — select a hex to attack or ⇄ transfer');
  } else {
    phase = 'wait-online';
    setStatus('⏱ Waiting for P1 to move…');
  }
  render();
}

function leaveOnlineGame() {
  if (!roomCode) return;
  
  isLeavingRoom = true;
  
  // Notify opponent if room still exists
  if (dbRef) {
    update(ref(database, `rooms/${roomCode}`), { 
      status: 'closed',
      leaver: onlineSide,
      closedAt: Date.now()
    }).then(() => {
      set(ref(database, `rooms/${roomCode}`), null).catch(() => {});
    }).catch(() => {});
  }
  
  cleanupAllOnline();
  gameMode = 'ai';
  startStage(progress.stage);
  setStatus('Left online match.');
  
  // Clear session storage
  sessionStorage.removeItem('lastRoomCode');
  sessionStorage.removeItem('lastOnlineSide');
  
  // UPDATE: Call updateOnlineUI after leaving
  updateOnlineUI();
}

function cleanupAllOnline() {
  cleanupListeners();
  cleanupRematch();
  teardownChat();
  
  if (roomCleanupTimeout) {
    clearTimeout(roomCleanupTimeout);
    roomCleanupTimeout = null;
  }
  
  dbRef = null;
  roomCode = null;
  lastSeenMsgId = null;
  isLeavingRoom = false;
  onlineOverlay.classList.add('hidden');
  
  // Clear session storage
  sessionStorage.removeItem('lastRoomCode');
  sessionStorage.removeItem('lastOnlineSide');
  
  // UPDATE: Call updateOnlineUI when cleaning up online session
  updateOnlineUI();
}
function updateOnlineUI() {
  const leaveBtn = document.getElementById('btn-leave-online');
  if (leaveBtn) {
    if (gameMode === 'online') {
      leaveBtn.classList.remove('hidden');
    } else {
      leaveBtn.classList.add('hidden');
    }
  }  
  const onlineStatus = document.getElementById('online-status');
  if (onlineStatus) {
    if (gameMode === 'online' && roomCode) {
      onlineStatus.textContent = `Room: ${roomCode}`;
      onlineStatus.classList.remove('hidden');
    } else {
      onlineStatus.classList.add('hidden');
    }
  }
}

  // =========== CHAT ===========
  function initChat() {
    const panel = document.getElementById('chat-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.classList.add('collapsed');
    chatOpen = false;
    unreadCount = 0;
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
          badge.textContent = unreadCount;
          badge.classList.remove('hidden');
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
      badge.classList.add('hidden');
      badge.textContent = '0';
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
    input.value = '';
    SFX.click();
    const key = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    set(ref(database, `rooms/${roomCode}/chat/${key}`), {
      sender: onlineSide,
      text: text.slice(0, 80),
      ts: Date.now()
    }).catch(console.error);
  }

  function teardownChat() {
    const panel = document.getElementById('chat-panel');
    if (panel) panel.classList.add('hidden');
    if (chatListener && roomCode) {
      try { off(ref(database, `rooms/${roomCode}/chat`)); } catch (e) {}
      chatListener = null;
    }
    chatOpen = false;
    unreadCount = 0;
  }

  // =========== REMATCH ===========
  function showRematch(iWon) {
    rematchVoted = false;
    const overlay = document.getElementById('rematch-overlay');
    const icon    = document.getElementById('rematch-icon');
    const title   = document.getElementById('rematch-title');
    const sub     = document.getElementById('rematch-sub');
    const yesBtn  = document.getElementById('btn-rematch-yes');
    const noBtn   = document.getElementById('btn-rematch-no');
    const dots    = document.getElementById('rematch-dots');

    icon.textContent  = iWon ? '𐃯' : '☠︎︎';
    title.textContent = iWon ? 'You Won!' : 'You Lost!';
    sub.textContent   = 'Waiting for opponent…';
    yesBtn.disabled   = false;
    noBtn.disabled    = false;
    dots.classList.add('hidden');

    overlay.classList.remove('hidden');

    update(ref(database, `rooms/${roomCode}`), {
      [`rematch_${onlineSide}`]: null
    }).catch(console.error);

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
          update(ref(database, `rooms/${roomCode}`), { rematchSeed: newSeed, rematchSeedSet: true })
            .catch(console.error);
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
        cleanupRematch();
        overlay.classList.add('hidden');
        cancelOnline();
      }
    });

    rematchTimeout = setTimeout(() => {
      cleanupRematch();
      overlay.classList.add('hidden');
      appendSystemMsg('Rematch timed out.');
      cancelOnline();
    }, 30000);
  }

  function voteRematch(yes) {
    if (rematchVoted) return;
    rematchVoted = true;
    SFX.click();

    const yesBtn = document.getElementById('btn-rematch-yes');
    const noBtn  = document.getElementById('btn-rematch-no');
    const sub    = document.getElementById('rematch-sub');
    const dots   = document.getElementById('rematch-dots');

    yesBtn.disabled = true;
    noBtn.disabled  = true;

    update(ref(database, `rooms/${roomCode}`), {
      [`rematch_${onlineSide}`]: yes
    }).catch(console.error);

    if (yes) {
      sub.textContent = 'Waiting for opponent…';
      dots.classList.remove('hidden');
    } else {
      sub.textContent = 'Leaving…';
    }
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
      p1_move: null, p2_move: null,
      chat: null
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

    let placed = 0, att = 0;
    while (placed < cfg.blocked && att < 300) {
      att++;
      const r = seededRand(ROWS), c = seededRand(COLS);
      if (grid[r][c].owner !== NEUTRAL) continue;
      const nearP  = pStarts.some(([sr,sc])  => Math.abs(r-sr)+Math.abs(c-sc) <= 2);
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
      if (src.blazeBuffed) { aPow = Math.min(aPow*2, 18); src.blazeBuffed = false; }
      let dPow = dst.power;
      if (dst.shielded) dPow += 3;
      const capPU = dst.powerup;
      if (aPow > dPow) {
        dst.owner = src.owner; dst.power = Math.min(aPow - dPow, MAX_POWER);
        src.power = 1; dst.powerup = null; dst.shielded = false;
        dst.blazeBuffed = false; dst.frozen = false; dst.boss = false;
        flashHex(move.dr, move.dc, 'flash-ai-capture', 550);
        SFX.attack();
        if (capPU) applyPowerup(capPU, move.dr, move.dc, src.owner);
        setStatus(`⚔️ Opponent captured! (${aPow} vs ${dPow})`);
      } else if (aPow === dPow) {
        src.power = Math.max(1, src.power - 1);
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
    setStatus(`𖡎 Your turn (${label}) — select a hex`);
    render();
  }

  function setOnlineStatus(msg, type) {
    const waiting = document.getElementById('waiting-text');
    if (waiting) {
      waiting.textContent = msg;
      waiting.style.color = type === 'error' ? '#f87171' : '';
    }
  }

  function copyRoomCode() {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode).catch(() => {});
      SFX.click();
    }
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
        ? `⚔︎ Boss battle! Defeat ${cfg.bossName}!`
        : 'Your hexes grew +1 · select a hex to attack or ⇄ transfer');
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
    if (gameMode === 'online') return;
    startStage(currentStage);
  }

  function hideAllOverlays() {
    [tutOverlay, bossOverlay, stagesOverlay, goOverlay, modeOverlay, onlineOverlay, localTurnBanner]
      .forEach(el => { if (el) el.classList.add('hidden'); });
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
      if (cell.frozen) { setStatus('❄ That hex is frozen.'); SFX.fail(); return; }
      const targets = getAttackTargets(r, c);
      const transfers = getTransferTargets(r, c);
      if (targets.length === 0 && transfers.length === 0) { setStatus('No valid targets from that hex.'); return; }
      selectedHex = [r, c]; validTargets = targets; transferTargets = transfers; phase = 'target';
      SFX.select();
      const bNote = cell.blazeBuffed ? ' ঌ Blaze active — 2× damage!' : '';
      const tNote = transfers.length > 0 ? ' · ⇄ friendly = transfer' : '';
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
        const bNote = cell.blazeBuffed ? ' ঌ 2×!' : '';
        const tNote = transfers.length > 0 ? ' · ⇄' : '';
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
    setStatus('Select a hex to attack or ⇄ transfer power');
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
    setStatus(`⇄ Transferred ${actual} power`);
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

      let msg = `☑ Captured! ${wasBlazed ? aPow+' (ঌ2×)' : aPow} vs ${wasShielded ? defPow+' (🛡+3)' : defPow}`;
      if (wasBoss) msg = `☠︎ ${cfg.bossName} DESTROYED! ${msg}`;
      if (capturedPU) { SFX.powerup(); msg += ' · ' + applyPowerup(capturedPU, dr, dc, src.owner); }
      setStatus(msg);
    } else if (aPow === defPow) {
      src.power = Math.max(1, src.power - 1);
      flashHex(sr, sc, 'flash-fail', 550); SFX.fail();
      setStatus(`⚔︎ Tied ${aPow} vs ${defPow} — deflected!`);
    } else {
      src.power = 1;
      if (dst.power > 1) dst.power -= 1;
      flashHex(sr, sc, 'flash-fail', 550); SFX.fail();
      setStatus(`✖ Failed ${wasBlazed ? aPow+' (ঌ2×)' : aPow} vs ${wasShielded ? defPow+' (🛡+3)' : defPow}`);
    }

    selectedHex = null; validTargets = []; transferTargets = [];
    render();

    if (gameMode === 'online') sendOnline({ type: 'move', move: { type:'attack', sr, sc, dr, dc } });

    // FIX: Boss win path calls showEnd once via checkGameOver(); removed duplicate early-exit
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
      growPhaseOwner(localTurn);
      turn++;
      phase = 'select';
      render();
      showLocalTurnBanner();
    } else if (gameMode === 'online') {
      growPhaseOwner(opponentOwner());
      turn++;
      phase = 'wait-online';
      setStatus('⏱ Waiting for opponent…');
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
        return '⚡︎ Surge! +3 power';
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
        return `☠︎︎ Drain! Stole ${drained}`;
      }
      case 'blaze':
        cell.blazeBuffed = true;
        flashHex(r, c, 'flash-blaze flash-powerup', 600);
        return 'ঌ Blaze! 2×';
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
        if (neutralNeigh.length === 0) return '𖦹 Spread! (no neutral)';
        const pickIndex = gameMode === 'online' ? seededRand(neutralNeigh.length) : randInt(neutralNeigh.length);
        const [nr, nc] = neutralNeigh[pickIndex];
        const sPU = grid[nr][nc].powerup;
        grid[nr][nc] = makeCell(owner, Math.max(1, Math.floor(cell.power / 2)));
        grid[nr][nc].powerup = sPU;
        flashHex(nr, nc, 'flash-spread flash-powerup', 600);
        let extra = '';
        if (sPU) extra = ' → ' + applyPowerup(sPU, nr, nc, owner);
        return '𖦹 Spread!' + extra;
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
          let msg = `⚔︎ Enemy captured! (${wasBlazed ? aPow+' 🔥' : aPow} vs ${wasShielded ? dPow+' 🛡' : dPow})`;
          if (capPU) msg += ' · ' + applyPowerup(capPU, best.dr, best.dc, ENEMY);
          setStatus(msg);
        } else if (aPow === dPow) {
          src.power = Math.max(1, src.power-1);
          setStatus('⚔︎ Enemy tied!');
        } else {
          src.power = 1; if (dst.power>1) dst.power-=1;
          setStatus('⚔︎ Enemy failed!');
        }
        render();
        setTimeout(() => { if (!checkGameOver()) startNewTurn(); }, 550);
      }, 400);
    } else {
      setStatus('⚔︎ Enemy skipped');
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
    setStatus('Your hexes grew +1 · select a hex to attack or ⇄ transfer');
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

    // FIX: boss win only fires through checkGameOver, not also from executeAttack's early-exit
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
        if (won) showEnd('Victory!', `Time's up — you win! ⚡︎${pS} vs ⚡︎${eS}`, 'win');
        else if (eS > pS) showEnd('Defeat', `Time's up — enemy wins ⚡︎${eS} vs ⚡︎${pS}`, 'lose');
        else showEnd('Draw', `Tied at ⚡︎${pS}!`, 'draw');
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

    // FIX: awardHexoneX perspective — win is determined from the local viewer's side
    // Local viewer is always PLAYER (P1 in local, onlineSide in online)
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
        if (p1S > p2S) {
          showEnd(`${p1Name} Wins!`, `Time's up! ⚡︎${p1S} vs ⚡︎${p2S}`, p1Name === 'Opponent' ? 'lose' : 'win');
        } else if (p2S > p1S) {
          showEnd(`${p2Name} Wins!`, `Time's up! ⚡︎${p2S} vs ⚡︎${p1S}`, p2Name === 'Opponent' ? 'lose' : 'win');
        } else {
          showEnd('Draw!', `Tied at ⚡︎${p1S}!`, 'draw');
        }
      }, 800);
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
        ? (currentStage >= TOTAL_STAGES ? '𐃯 All Stages!' : 'Next Stage →')
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

    if (gameMode === 'online') {
      goOverlay.classList.add('hidden');
      showRematch(type === 'win');
      return;
    }

    goOverlay.classList.remove('hidden');
    setStatus(title); render();
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  // =========== SKIP ATTACK ===========
  function skipAttack() {
    // FIX: also guard against animating
    if (animating || (phase !== 'select' && phase !== 'target')) return;
    SFX.click();
    selectedHex = null; validTargets = []; transferTargets = [];

    if (gameMode === 'online') sendOnline({ type: 'skip' });

    setStatus('Skipped…');
    render();
    setTimeout(() => {
      if (gameMode === 'ai') {
        beginAITurn();
      } else if (gameMode === 'local') {
        localTurn = localTurn === PLAYER ? PLAYER2 : PLAYER;
        growPhaseOwner(localTurn); turn++;
        phase = 'select'; render();
        showLocalTurnBanner();
      } else if (gameMode === 'online') {
        growPhaseOwner(opponentOwner());
        turn++;
        phase = 'wait-online';
        setStatus('⏱ Waiting for opponent…'); render();
      }
    }, 300);
  }

  function toggleSound() {
    SFX.on = !SFX.on; progress.soundOn = SFX.on; saveProgress();
    btnSound.textContent = SFX.on ? '🕪' : '🕪×';
    if (SFX.on) SFX.click();
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
    // FIX: playerDot declared here alongside the other DOM refs
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

      const lastRoomCode = sessionStorage.getItem('lastRoomCode');
  const lastSide = sessionStorage.getItem('lastOnlineSide');
  
  if (lastRoomCode && lastSide) {
    roomCode = lastRoomCode;
    onlineSide = lastSide;
    createRefreshOverlay();
    refreshOverlay.classList.remove('hidden');
  }
  
  // Store current room info before page unload
  window.addEventListener('beforeunload', () => {
    if (roomCode && gameMode === 'online' && !isLeavingRoom) {
      sessionStorage.setItem('lastRoomCode', roomCode);
      sessionStorage.setItem('lastOnlineSide', onlineSide);
    } else {
      sessionStorage.removeItem('lastRoomCode');
      sessionStorage.removeItem('lastOnlineSide');
    }
  });

    loadProgress();
    updateShopButton();
    btnSound.textContent = SFX.on ? '🕪' : '🕪×';

    if (!progress.tutDone) showTutorial();
    else startStage(progress.stage);
  }

  document.addEventListener('DOMContentLoaded', init);

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
    updateShopButton, leaveOnlineGame,
  };
})();

window.HexAsteal = HexAsteal;
