/* ===========================================
   HEXASTEAL — Territory Conquest with Power-Ups
   =========================================== */

const HexAsteal = (function () {
  'use strict';

  // =========== CONSTANTS ===========
  const COLS      = 9;
  const ROWS      = 7;
  const HEX_R     = 30;
  const MAX_POWER = 9;
  const MAX_TURNS = 40;

  const HEX_W   = Math.sqrt(3) * HEX_R;
  const ROW_H   = HEX_R * 1.5;
  const PAD_X   = HEX_W / 2 + 14;
  const PAD_Y   = HEX_R + 14;

  const PLAYER  = 'player';
  const ENEMY   = 'enemy';
  const NEUTRAL = 'neutral';
  const BLOCKED = 'blocked';

  // Neighbor offsets for pointy-top, odd-row-right offset
  const DIRS_EVEN = [[-1, -1], [-1, 0], [0, 1], [1, 0], [1, -1], [0, -1]];
  const DIRS_ODD  = [[-1,  0], [-1, 1], [0, 1], [1, 1], [1,  0], [0, -1]];

  // =========== POWER-UP TYPES ===========
  const POWERUPS = {
    surge:  { icon: '⚡', label: 'Surge',  desc: '+3 power' },
    shield: { icon: '🛡',  label: 'Shield', desc: 'needs +3 extra to capture' },
    drain:  { icon: '💀', label: 'Drain',  desc: 'steals 2 from adjacent foes' },
    blaze:  { icon: '🔥', label: 'Blaze',  desc: 'next attack deals 2× damage' },
    freeze: { icon: '❄',  label: 'Freeze', desc: 'adjacent foes skip growth' },
    spread: { icon: '🌀', label: 'Spread', desc: 'also captures an adjacent neutral' }
  };
  const POWERUP_KEYS = Object.keys(POWERUPS);

  // =========== STATE ===========
  let grid         = [];
  let turn         = 1;
  let phase        = 'select';   // select | target | ai | gameover
  let selectedHex  = null;
  let validTargets = [];
  let hexEls       = {};
  let animating    = false;

  // =========== DOM REFS ===========
  let svgEl, statusEl, turnEl;
  let pHexesEl, pPowerEl, eHexesEl, ePowerEl;
  let btnSkip, overlay, resultTitle, resultDesc;

  // =========== HEX GEOMETRY ===========

  function hexCenter(r, c) {
    return [
      PAD_X + c * HEX_W + (r % 2 === 1 ? HEX_W / 2 : 0),
      PAD_Y + r * ROW_H
    ];
  }

  function hexPoints(cx, cy) {
    let pts = '';
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      pts += `${(cx + HEX_R * Math.cos(a)).toFixed(1)},${(cy + HEX_R * Math.sin(a)).toFixed(1)} `;
    }
    return pts.trim();
  }

  function getNeighbors(r, c) {
    const dirs = r % 2 === 0 ? DIRS_EVEN : DIRS_ODD;
    const out = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc].owner !== BLOCKED) {
        out.push([nr, nc]);
      }
    }
    return out;
  }

  function getAttackTargets(r, c) {
    return getNeighbors(r, c).filter(
      ([nr, nc]) => grid[nr][nc].owner !== grid[r][c].owner && grid[nr][nc].owner !== BLOCKED
    );
  }

  // =========== MAP GENERATION ===========

  function randInt(max) { return Math.floor(Math.random() * max); }

  function generateMap() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (let c = 0; c < COLS; c++) {
        grid[r][c] = { owner: NEUTRAL, power: 1 + randInt(4), powerup: null,
                       blazeBuffed: false, shielded: false, frozen: false };
      }
    }

    // Player — bottom-left cluster
    const pStarts = [[5, 0], [5, 1], [6, 0], [6, 1]];
    pStarts.forEach(([r, c]) => {
      grid[r][c] = { owner: PLAYER, power: 3 + randInt(2), powerup: null,
                     blazeBuffed: false, shielded: false, frozen: false };
    });

    // Enemy — top-right cluster
    const eStarts = [[0, 7], [0, 8], [1, 7], [1, 8]];
    eStarts.forEach(([r, c]) => {
      grid[r][c] = { owner: ENEMY, power: 3 + randInt(2), powerup: null,
                     blazeBuffed: false, shielded: false, frozen: false };
    });

    // Blocked hexes (mountains) — 4-6, away from starts
    const numBlocked = 4 + randInt(3);
    let placed = 0, attempts = 0;
    while (placed < numBlocked && attempts < 200) {
      attempts++;
      const r = randInt(ROWS), c = randInt(COLS);
      if (grid[r][c].owner !== NEUTRAL) continue;
      const tooClose = [...pStarts, ...eStarts].some(
        ([sr, sc]) => Math.abs(r - sr) + Math.abs(c - sc) <= 2
      );
      if (tooClose) continue;
      grid[r][c] = { owner: BLOCKED, power: 0, powerup: null,
                     blazeBuffed: false, shielded: false, frozen: false };
      placed++;
    }

    // Place power-ups on neutral hexes — 6-9 total, evenly spread
    const neutralCells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c].owner === NEUTRAL) neutralCells.push([r, c]);
      }
    }
    // Shuffle
    for (let i = neutralCells.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [neutralCells[i], neutralCells[j]] = [neutralCells[j], neutralCells[i]];
    }

    const numPowerups = Math.min(6 + randInt(4), neutralCells.length);
    for (let i = 0; i < numPowerups; i++) {
      const [r, c] = neutralCells[i];
      grid[r][c].powerup = POWERUP_KEYS[i % POWERUP_KEYS.length];
    }
  }

  // =========== SVG BOARD ===========

  function createBoard() {
    const NS = 'http://www.w3.org/2000/svg';
    svgEl.innerHTML = '';
    hexEls = {};

    // Defs — glow filters
    const defs = document.createElementNS(NS, 'defs');
    defs.appendChild(makeGlow(NS, 'glow-player', '#22c55e', 3));
    defs.appendChild(makeGlow(NS, 'glow-enemy',  '#ef4444', 3));
    defs.appendChild(makeGlow(NS, 'glow-select', '#fbbf24', 5));
    defs.appendChild(makeGlow(NS, 'glow-surge',  '#22d3ee', 4));
    defs.appendChild(makeGlow(NS, 'glow-shield', '#a8a29e', 4));
    defs.appendChild(makeGlow(NS, 'glow-drain',  '#a855f7', 4));
    defs.appendChild(makeGlow(NS, 'glow-blaze',  '#f97316', 4));
    defs.appendChild(makeGlow(NS, 'glow-freeze', '#7dd3fc', 4));
    defs.appendChild(makeGlow(NS, 'glow-spread', '#f472b6', 4));
    svgEl.appendChild(defs);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const [cx, cy] = hexCenter(r, c);
        const g    = document.createElementNS(NS, 'g');
        const poly = document.createElementNS(NS, 'polygon');
        poly.setAttribute('points', hexPoints(cx, cy));

        if (grid[r][c].owner === BLOCKED) {
          poly.setAttribute('class', 'hex hex-blocked');
          g.appendChild(poly);
          const ico = document.createElementNS(NS, 'text');
          ico.setAttribute('x', cx);
          ico.setAttribute('y', cy);
          ico.setAttribute('dy', '0.38em');
          ico.setAttribute('class', 'hex-icon');
          ico.textContent = '▲';
          g.appendChild(ico);
          svgEl.appendChild(g);
          continue;
        }

        poly.setAttribute('class', 'hex');
        g.setAttribute('data-r', r);
        g.setAttribute('data-c', c);
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => handleClick(r, c));

        // Power number text
        const txt = document.createElementNS(NS, 'text');
        txt.setAttribute('x', cx);
        txt.setAttribute('y', cy);
        txt.setAttribute('dy', '0.05em');
        txt.setAttribute('class', 'hex-text');

        // Power-up icon (rendered below power number)
        const puIcon = document.createElementNS(NS, 'text');
        puIcon.setAttribute('x', cx);
        puIcon.setAttribute('y', cy);
        puIcon.setAttribute('dy', '1.6em');
        puIcon.setAttribute('class', 'hex-powerup-icon');

        // Status icon (shield/blaze/freeze indicator above power)
        const statusIcon = document.createElementNS(NS, 'text');
        statusIcon.setAttribute('x', cx);
        statusIcon.setAttribute('y', cy);
        statusIcon.setAttribute('dy', '-0.9em');
        statusIcon.setAttribute('class', 'hex-powerup-icon');

        g.appendChild(poly);
        g.appendChild(txt);
        g.appendChild(puIcon);
        g.appendChild(statusIcon);
        svgEl.appendChild(g);
        hexEls[`${r},${c}`] = { group: g, polygon: poly, text: txt, puIcon, statusIcon };
      }
    }

    // Compute viewBox
    let maxX = 0, maxY = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const [cx, cy] = hexCenter(r, c);
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;
      }
    }
    svgEl.setAttribute('viewBox', `0 0 ${Math.ceil(maxX + PAD_X)} ${Math.ceil(maxY + PAD_Y)}`);
  }

  function makeGlow(ns, id, color, radius) {
    const f = document.createElementNS(ns, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('x', '-50%'); f.setAttribute('y', '-50%');
    f.setAttribute('width', '200%'); f.setAttribute('height', '200%');

    const flood = document.createElementNS(ns, 'feFlood');
    flood.setAttribute('flood-color', color);
    flood.setAttribute('flood-opacity', '0.6');
    flood.setAttribute('result', 'flood');

    const comp = document.createElementNS(ns, 'feComposite');
    comp.setAttribute('in', 'flood'); comp.setAttribute('in2', 'SourceGraphic');
    comp.setAttribute('operator', 'in'); comp.setAttribute('result', 'mask');

    const blur = document.createElementNS(ns, 'feGaussianBlur');
    blur.setAttribute('in', 'mask');
    blur.setAttribute('stdDeviation', radius);
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
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const key = `${r},${c}`;
        if (!hexEls[key]) continue;

        const cell = grid[r][c];
        const el   = hexEls[key];

        // Build CSS class
        let cls = 'hex';

        // Base owner class
        if (cell.powerup && cell.owner === NEUTRAL) {
          cls += ` hex-powerup-${cell.powerup}`;
        } else {
          cls += ` hex-${cell.owner}`;
        }

        // Buff indicators
        if (cell.blazeBuffed) cls += ' hex-blaze-buffed';
        if (cell.shielded)    cls += ' hex-shielded';
        if (cell.frozen)      cls += ' hex-frozen';

        // Interactive states
        if (selectedHex && selectedHex[0] === r && selectedHex[1] === c) {
          cls += ' hex-selected';
        } else if (isValidTarget(r, c)) {
          cls += ' hex-valid-target';
        } else if (phase === 'select' && cell.owner === PLAYER &&
                   !cell.frozen && getAttackTargets(r, c).length > 0) {
          cls += ' hex-selectable';
        }

        el.polygon.setAttribute('class', cls);
        el.text.textContent = cell.power;

        // Power-up icon below number (only on uncaptured power-up hexes)
        if (cell.powerup && cell.owner === NEUTRAL) {
          el.puIcon.textContent = POWERUPS[cell.powerup].icon;
          // Apply glow to power-up hexes
          if (!cls.includes('hex-valid-target') && !cls.includes('hex-selected')) {
            el.polygon.style.filter = `url(#glow-${cell.powerup})`;
          } else {
            el.polygon.style.filter = '';
          }
        } else {
          el.puIcon.textContent = '';
          if (!cls.includes('hex-selected') && !cls.includes('hex-selectable')) {
            el.polygon.style.filter = '';
          }
        }

        // Status icons above number (buffs on owned hexes)
        let statusStr = '';
        if (cell.blazeBuffed) statusStr += '🔥';
        if (cell.shielded)    statusStr += '🛡';
        if (cell.frozen)      statusStr += '❄';
        el.statusIcon.textContent = statusStr;
      }
    }
    updateStats();
    btnSkip.disabled = (phase !== 'select' && phase !== 'target');
  }

  function isValidTarget(r, c) {
    return validTargets.some(([vr, vc]) => vr === r && vc === c);
  }

  function updateStats() {
    let pH = 0, pP = 0, eH = 0, eP = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const o = grid[r][c].owner;
        if (o === PLAYER) { pH++; pP += grid[r][c].power; }
        if (o === ENEMY)  { eH++; eP += grid[r][c].power; }
      }
    }
    turnEl.textContent   = turn;
    pHexesEl.textContent = pH;
    pPowerEl.textContent = pP;
    eHexesEl.textContent = eH;
    ePowerEl.textContent = eP;
  }

  // =========== CLICK HANDLING ===========

  function handleClick(r, c) {
    if (animating || phase === 'ai' || phase === 'gameover') return;

    const cell = grid[r][c];

    if (phase === 'select') {
      if (cell.owner !== PLAYER) return;
      if (cell.frozen) {
        setStatus('❄ That hex is frozen — it can\'t attack this turn.');
        return;
      }
      const targets = getAttackTargets(r, c);
      if (targets.length === 0) {
        setStatus('No valid targets from that hex — pick another.');
        return;
      }
      selectedHex  = [r, c];
      validTargets = targets;
      phase = 'target';
      const blazeNote = cell.blazeBuffed ? ' 🔥 Blaze active — 2× damage!' : '';
      setStatus(`Power ${cell.power} selected · choose an adjacent hex to attack${blazeNote}`);
      render();
      return;
    }

    if (phase === 'target') {
      if (cell.owner === PLAYER) {
        if (r === selectedHex[0] && c === selectedHex[1]) { deselect(); return; }
        if (cell.frozen) {
          setStatus('❄ That hex is frozen — pick another.');
          return;
        }
        const targets = getAttackTargets(r, c);
        if (targets.length === 0) { setStatus('No valid targets from that hex.'); return; }
        selectedHex  = [r, c];
        validTargets = targets;
        const blazeNote = cell.blazeBuffed ? ' 🔥 2×!' : '';
        setStatus(`Power ${cell.power} selected · choose target${blazeNote}`);
        render();
        return;
      }
      if (!isValidTarget(r, c)) return;
      executeAttack(selectedHex[0], selectedHex[1], r, c);
    }
  }

  function deselect() {
    selectedHex  = null;
    validTargets = [];
    phase = 'select';
    setStatus('Select one of your hexes to attack from');
    render();
  }

  // =========== COMBAT ===========

  function executeAttack(sr, sc, dr, dc) {
    animating = true;
    const src = grid[sr][sc];
    const dst = grid[dr][dc];

    // Apply blaze buff — double attack power
    let attackPower = src.power;
    const wasBlazed = src.blazeBuffed;
    if (wasBlazed) {
      attackPower = Math.min(attackPower * 2, 18); // cap at 18 for display
      src.blazeBuffed = false;
    }

    // Apply shield defense — need extra power to break through
    let defensePower = dst.power;
    const wasShielded = dst.shielded;
    if (wasShielded) {
      defensePower += 3;
    }

    const capturedPowerup = dst.powerup;

    if (attackPower > defensePower) {
      dst.owner = PLAYER;
      dst.power = Math.min(attackPower - defensePower, MAX_POWER);
      src.power = 1;
      dst.powerup = null;
      dst.shielded = false;
      dst.blazeBuffed = false;
      dst.frozen = false;

      flashHex(dr, dc, 'flash-capture', 550);

      let msg = `✅ Captured! ${wasBlazed ? attackPower + ' (🔥2×)' : attackPower} vs ${wasShielded ? defensePower + ' (🛡+3)' : defensePower}`;

      // Trigger power-up effect
      if (capturedPowerup) {
        msg += ' · ' + applyPowerup(capturedPowerup, dr, dc, PLAYER);
      }

      setStatus(msg);
    } else {
      src.power = 1;
      if (dst.power > 1) dst.power -= 1;
      // Shield survives failed attacks
      flashHex(sr, sc, 'flash-fail', 550);
      if (attackPower === defensePower) {
        setStatus(`⚔️ Tied ${attackPower} vs ${defensePower} — attack deflected`);
      } else {
        setStatus(`❌ Failed ${wasBlazed ? attackPower + ' (🔥2×)' : attackPower} vs ${wasShielded ? defensePower + ' (🛡+3)' : defensePower} — not enough power`);
      }
    }

    selectedHex  = null;
    validTargets = [];
    render();

    setTimeout(() => {
      animating = false;
      if (checkGameOver()) return;
      beginAITurn();
    }, 700);
  }

  // =========== POWER-UP EFFECTS ===========

  function applyPowerup(type, r, c, owner) {
    const cell = grid[r][c];

    switch (type) {
      case 'surge': {
        cell.power = Math.min(cell.power + 3, MAX_POWER);
        flashHex(r, c, 'flash-surge flash-powerup', 600);
        return '⚡ Surge! +3 power';
      }

      case 'shield': {
        cell.shielded = true;
        flashHex(r, c, 'flash-shield flash-powerup', 600);
        return '🛡 Shield active! Needs +3 extra to capture';
      }

      case 'drain': {
        const neighbors = getNeighbors(r, c);
        let drained = 0;
        const enemyOwner = owner === PLAYER ? ENEMY : PLAYER;
        for (const [nr, nc] of neighbors) {
          if (grid[nr][nc].owner === enemyOwner) {
            const steal = Math.min(2, grid[nr][nc].power - 1);
            if (steal > 0) {
              grid[nr][nc].power -= steal;
              drained += steal;
              flashHex(nr, nc, 'flash-drain flash-powerup', 500);
            }
          }
        }
        cell.power = Math.min(cell.power + drained, MAX_POWER);
        flashHex(r, c, 'flash-drain flash-powerup', 600);
        return `💀 Drain! Stole ${drained} power from foes`;
      }

      case 'blaze': {
        cell.blazeBuffed = true;
        flashHex(r, c, 'flash-blaze flash-powerup', 600);
        return '🔥 Blaze! Next attack deals 2× damage';
      }

      case 'freeze': {
        const neighbors = getNeighbors(r, c);
        let frozen = 0;
        const enemyOwner = owner === PLAYER ? ENEMY : PLAYER;
        for (const [nr, nc] of neighbors) {
          if (grid[nr][nc].owner === enemyOwner) {
            grid[nr][nc].frozen = true;
            frozen++;
            flashHex(nr, nc, 'flash-freeze flash-powerup', 500);
          }
        }
        flashHex(r, c, 'flash-freeze flash-powerup', 600);
        return `❄ Freeze! ${frozen} enemy hex${frozen !== 1 ? 'es' : ''} frozen`;
      }

      case 'spread': {
        const neighbors = getNeighbors(r, c);
        const neutralNeighbors = neighbors.filter(
          ([nr, nc]) => grid[nr][nc].owner === NEUTRAL
        );
        if (neutralNeighbors.length > 0) {
          const [nr, nc] = neutralNeighbors[randInt(neutralNeighbors.length)];
          const spreadPowerup = grid[nr][nc].powerup;
          grid[nr][nc].owner = owner;
          grid[nr][nc].power = Math.max(1, Math.floor(cell.power / 2));
          grid[nr][nc].powerup = null;
          grid[nr][nc].blazeBuffed = false;
          grid[nr][nc].shielded = false;
          grid[nr][nc].frozen = false;
          flashHex(nr, nc, 'flash-spread flash-powerup', 600);
          // If the spread hex had a power-up, trigger it too (chain!)
          let extra = '';
          if (spreadPowerup) {
            extra = ' → ' + applyPowerup(spreadPowerup, nr, nc, owner);
          }
          return '🌀 Spread! Captured an adjacent neutral hex' + extra;
        }
        return '🌀 Spread! (no neutral neighbor)';
      }

      default:
        return '';
    }
  }

  function flashHex(r, c, cls, dur) {
    const key = `${r},${c}`;
    if (!hexEls[key]) return;
    const classes = cls.split(' ');
    classes.forEach(cl => hexEls[key].polygon.classList.add(cl));
    setTimeout(() => {
      classes.forEach(cl => hexEls[key].polygon.classList.remove(cl));
    }, dur || 500);
  }

  // =========== GROWTH ===========

  function growPhase(owner) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        if (cell.owner === owner) {
          // Frozen hexes don't grow — then unfreeze
          if (cell.frozen) {
            cell.frozen = false;
            flashHex(r, c, 'flash-freeze', 300);
            continue;
          }
          if (cell.power < MAX_POWER) {
            cell.power++;
            flashHex(r, c, 'flash-grow', 350);
          }
        }
      }
    }
  }

  // =========== AI ===========

  function beginAITurn() {
    phase = 'ai';
    setStatus('Enemy is thinking…');
    render();

    setTimeout(() => {
      growPhase(ENEMY);
      render();
      setTimeout(aiAttack, 450);
    }, 500);
  }

  function aiAttack() {
    // Gather all possible attacks
    const attacks = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c].owner !== ENEMY) continue;
        if (grid[r][c].frozen) continue; // frozen hexes can't attack
        for (const [nr, nc] of getAttackTargets(r, c)) {
          const src = grid[r][c];
          let attackPow = src.power;
          if (src.blazeBuffed) attackPow = Math.min(attackPow * 2, 18);

          let defensePow = grid[nr][nc].power;
          if (grid[nr][nc].shielded) defensePow += 3;

          attacks.push({
            sr: r, sc: c, dr: nr, dc: nc,
            sPow: attackPow,
            rawPow: src.power,
            dPow: defensePow,
            rawDPow: grid[nr][nc].power,
            dOwner: grid[nr][nc].owner,
            dPowerup: grid[nr][nc].powerup,
            isBlazed: src.blazeBuffed
          });
        }
      }
    }

    // Score each attack
    let best = null, bestScore = -Infinity;
    for (const a of attacks) {
      let score = 0;
      const diff = a.sPow - a.dPow;
      if (diff > 0) {
        score = 100 + diff * 10;
        if (a.dOwner === PLAYER) score += 50;
        score += a.rawDPow * 3;
        // Bonus for capturing power-ups
        if (a.dPowerup) {
          score += 40;
          if (a.dPowerup === 'surge')  score += 15;
          if (a.dPowerup === 'drain')  score += 20;
          if (a.dPowerup === 'blaze')  score += 15;
          if (a.dPowerup === 'freeze') score += 25;
          if (a.dPowerup === 'spread') score += 20;
          if (a.dPowerup === 'shield') score += 10;
        }
      } else if (diff === 0) {
        score = -30;
      } else {
        score = -100;
      }
      score += Math.random() * 8;
      if (score > bestScore) { bestScore = score; best = a; }
    }

    if (best && bestScore > 50) {
      flashHex(best.sr, best.sc, 'flash-ai-source', 400);

      setTimeout(() => {
        const src = grid[best.sr][best.sc];
        const dst = grid[best.dr][best.dc];

        let attackPower = src.power;
        const wasBlazed = src.blazeBuffed;
        if (wasBlazed) {
          attackPower = Math.min(attackPower * 2, 18);
          src.blazeBuffed = false;
        }

        let defensePower = dst.power;
        const wasShielded = dst.shielded;
        if (wasShielded) {
          defensePower += 3;
        }

        const capturedPowerup = dst.powerup;

        if (attackPower > defensePower) {
          dst.owner = ENEMY;
          dst.power = Math.min(attackPower - defensePower, MAX_POWER);
          src.power = 1;
          dst.powerup = null;
          dst.shielded = false;
          dst.blazeBuffed = false;
          dst.frozen = false;

          flashHex(best.dr, best.dc, 'flash-ai-capture', 500);

          let msg = `⚔️ Enemy captured a hex! (${wasBlazed ? attackPower + ' 🔥' : attackPower} vs ${wasShielded ? defensePower + ' 🛡' : defensePower})`;
          if (capturedPowerup) {
            msg += ' · ' + applyPowerup(capturedPowerup, best.dr, best.dc, ENEMY);
          }
          setStatus(msg);
        } else {
          src.power = 1;
          if (dst.power > 1) dst.power -= 1;
          setStatus('⚔️ Enemy attack failed!');
        }
        render();

        setTimeout(() => {
          if (checkGameOver()) return;
          startNewTurn();
        }, 600);
      }, 450);
    } else {
      setStatus('⚔️ Enemy skipped their attack');
      setTimeout(() => {
        if (checkGameOver()) return;
        startNewTurn();
      }, 400);
    }
  }

  // =========== TURN MANAGEMENT ===========

  function startNewTurn() {
    turn++;
    growPhase(PLAYER);
    phase = 'select';

    if (!playerHasAttacks()) {
      setStatus('No attacks available — skipping your turn…');
      render();
      setTimeout(() => {
        if (checkGameOver()) return;
        beginAITurn();
      }, 600);
      return;
    }

    setStatus('Your hexes grew +1 · select a hex to attack from');
    render();
  }

  function playerHasAttacks() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c].owner === PLAYER && !grid[r][c].frozen &&
            getAttackTargets(r, c).length > 0) return true;
      }
    }
    return false;
  }

  // =========== WIN / LOSE ===========

  function checkGameOver() {
    let hasP = false, hasE = false;
    let pScore = 0, eScore = 0, pH = 0, eH = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const o = grid[r][c].owner;
        if (o === PLAYER) { hasP = true; pH++; pScore += grid[r][c].power; }
        if (o === ENEMY)  { hasE = true; eH++; eScore += grid[r][c].power; }
      }
    }

    if (!hasE) {
      showEnd('Victory!', `You conquered all enemy hexes in ${turn} turns!`, 'win');
      return true;
    }
    if (!hasP) {
      showEnd('Defeat', 'The enemy captured all your territory.', 'lose');
      return true;
    }
    if (turn >= MAX_TURNS) {
      if (pScore > eScore)      showEnd('Victory!',  `Time's up — you win ${pH} hexes (⚡${pScore}) vs ${eH} (⚡${eScore})!`, 'win');
      else if (eScore > pScore) showEnd('Defeat',    `Time's up — enemy wins ${eH} hexes (⚡${eScore}) vs ${pH} (⚡${pScore}).`, 'lose');
      else                      showEnd('Draw',      `Time's up — tied at ⚡${pScore} each!`, 'draw');
      return true;
    }
    return false;
  }

  function showEnd(title, desc, type) {
    phase = 'gameover';
    resultTitle.textContent = title;
    resultTitle.className = type;
    resultDesc.textContent = desc;
    overlay.classList.remove('hidden');
    setStatus(title);
    render();
  }

  // =========== HELPERS ===========

  function setStatus(msg) { statusEl.textContent = msg; }

  // =========== PUBLIC API ===========

  function skipAttack() {
    if (phase !== 'select' && phase !== 'target') return;
    selectedHex  = null;
    validTargets = [];
    setStatus('Skipped attack · enemy turn…');
    render();
    setTimeout(beginAITurn, 350);
  }

  function newGame() {
    overlay.classList.add('hidden');
    turn       = 1;
    phase      = 'select';
    selectedHex  = null;
    validTargets = [];
    animating  = false;

    generateMap();
    createBoard();
    growPhase(PLAYER);
    render();
    setStatus('Your hexes grew +1 · select a hex to attack from');
  }

  // =========== INIT ===========

  function init() {
    svgEl       = document.getElementById('grid');
    statusEl    = document.getElementById('status');
    turnEl      = document.getElementById('turn-num');
    pHexesEl    = document.getElementById('p-hexes');
    pPowerEl    = document.getElementById('p-power');
    eHexesEl    = document.getElementById('e-hexes');
    ePowerEl    = document.getElementById('e-power');
    btnSkip     = document.getElementById('btn-skip');
    overlay     = document.getElementById('overlay');
    resultTitle = document.getElementById('result-title');
    resultDesc  = document.getElementById('result-desc');

    newGame();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { skipAttack, newGame };
})();
