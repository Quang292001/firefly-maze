/* Firefly Maze — graphic & UI: Huỳnh Nhật Quang. Gameplay based on a Pac-Man tutorial, rewritten. */
(() => {
  "use strict";

  // ---------- Palette (style guide C · Lam đêm) ----------
  const C = {
    bg: "#06141B", wall: "#11425A", wallHi: "#2A7FA8", player: "#E8FF59",
    accent: "#59C3FF", text: "#E6F1F5", body: "#2A7FA8", wing: "#BFE6FF",
    core: "#0E2230", frightened: "#E6F1F5",
    ghosts: ["#FF7A45", "#FF5C8A", "#B98CFF", "#59C3FF"],
  };

  // # wall · . orb · o star · - ghost door · G ghost home · P player · space empty
  const MAP = [
    "###################",
    "#........#........#",
    "#o##.###.#.###.##o#",
    "#.................#",
    "#.##.#.#####.#.##.#",
    "#....#...#...#....#",
    "####.###.#.###.####",
    "   #.#.......#.#   ",
    "####.#.##-##.#.####",
    "    ...#GGG#...    ",
    "####.#.#####.#.####",
    "   #.#.......#.#   ",
    "####.#.#####.#.####",
    "#........#........#",
    "#.##.###.#.###.##.#",
    "#o.#.....P.....#.o#",
    "##.#.#.#####.#.#.##",
    "#....#...#...#....#",
    "#.######.#.######.#",
    "#.................#",
    "###################",
  ];
  const ROWS = MAP.length, COLS = MAP[0].length;
  const DIRS = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };
  const NONE = { dx: 0, dy: 0 };
  const DOOR = { x: 9, y: 7 };       // tile just above the ghost door
  const HOME = { x: 9, y: 9 };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("game"), ctx = canvas.getContext("2d");
  const screens = { start: $("screen-start"), help: $("screen-help"), howto: $("screen-howto"), pause: $("screen-pause"), over: $("screen-over"), win: $("screen-win") };
  const hud = $("hud"), readyEl = $("ready");
  const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  document.body.classList.toggle("touch", isTouch);

  // ---------- Storage (guarded) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // ---------- Sound (tiny WebAudio synth) ----------
  let soundOn = store.get("ff-sound", true);
  let actx = null;
  function beep(freq, dur = 0.06, type = "sine", vol = 0.06, slide = 0) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
    } catch { /* audio unavailable */ }
  }
  const sfx = {
    orb: (() => { let hi = false; return () => { hi = !hi; beep(hi ? 880 : 740, 0.05, "triangle", 0.035); }; })(),
    star: () => { beep(520, 0.25, "sine", 0.07, 600); },
    ghost: () => { beep(300, 0.18, "square", 0.04, 900); },
    die: () => { beep(600, 0.7, "sawtooth", 0.05, -540); },
    win: () => { [660, 880, 1100].forEach((f, i) => setTimeout(() => beep(f, 0.15, "triangle", 0.06), i * 120)); },
  };

  // ---------- State ----------
  let tile = 32, dpr = 1, wallLayer = null;
  let grid, orbsLeft, player, ghosts, particles;
  let score = 0, best = store.get("ff-best", 0), lives = 3, level = 1;
  let state = "menu";               // menu | ready | play | paused | dying | over | win
  let readyTimer = 0, dyingTimer = 0, frightTimer = 0, ghostCombo = 0, modeTimer = 0, scatter = true, time = 0;

  const isWall = (c, r) => { if (r < 0 || r >= ROWS) return true; if (c < 0 || c >= COLS) return MAP[r][0] !== " " && MAP[r][COLS - 1] !== " " ? true : false; return grid[r][c] === "#"; };
  const walkable = (c, r, forGhost) => { if (isWall(c, r)) return false; if (c < 0 || c >= COLS) return true; const t = grid[r][c]; return forGhost ? true : t !== "-" && t !== "G"; };

  function resetLevel() {
    grid = MAP.map((row) => row.split(""));
    orbsLeft = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] === "." || grid[r][c] === "o") orbsLeft++;
    resetActors();
  }

  function resetActors() {
    const speedUp = 1 + (level - 1) * 0.08;
    player = { x: 9, y: 15, dir: NONE, next: NONE, speed: 6.2 * speedUp, face: 1, angle: 0, trail: [] };
    ghosts = C.ghosts.map((color, i) => ({
      i, color, x: i === 0 ? DOOR.x : 8 + (i - 1), y: i === 0 ? DOOR.y : HOME.y, dir: i === 0 ? DIRS.left : NONE,
      speed: 5.2 * speedUp, mode: i === 0 ? "out" : "home", release: [0, 2, 5, 8][i] / speedUp, bob: Math.random() * 6,
    }));
    particles = [];
    frightTimer = 0; ghostCombo = 0; modeTimer = 0; scatter = true;
  }

  // ---------- Layout ----------
  function layout() {
    const stage = $("stage").getBoundingClientRect();
    const pad = 12;
    tile = Math.max(12, Math.floor(Math.min((stage.width - pad * 2) / COLS, (stage.height - pad * 2) / ROWS)));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = COLS * tile * dpr; canvas.height = ROWS * tile * dpr;
    canvas.style.width = COLS * tile + "px"; canvas.style.height = ROWS * tile + "px";
    buildWalls();
  }

  function buildWalls() {
    wallLayer = document.createElement("canvas");
    wallLayer.width = canvas.width; wallLayer.height = canvas.height;
    const w = wallLayer.getContext("2d");
    w.scale(dpr, dpr);
    const segs = [];
    const isW = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && MAP[r][c] === "#";
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!isW(c, r)) continue;
      const cx = (c + 0.5) * tile, cy = (r + 0.5) * tile;
      let n = 0;
      if (isW(c + 1, r)) { segs.push([cx, cy, cx + tile, cy]); n++; }
      if (isW(c, r + 1)) { segs.push([cx, cy, cx, cy + tile]); n++; }
      if (!n && !isW(c - 1, r) && !isW(c, r - 1)) segs.push([cx, cy, cx + 0.01, cy]);
    }
    const stroke = (width, color, blur, blurColor) => {
      w.lineCap = "round"; w.lineJoin = "round"; w.lineWidth = width; w.strokeStyle = color;
      w.shadowBlur = blur; w.shadowColor = blurColor || "transparent";
      w.beginPath(); for (const [a, b, c2, d] of segs) { w.moveTo(a, b); w.lineTo(c2, d); } w.stroke();
    };
    stroke(tile * 0.55, "#14506D", tile * 0.7, "rgba(89,195,255,0.45)");
    stroke(tile * 0.55, "#14506D", 0);
    stroke(tile * 0.32, "#0D3449", 0);
    stroke(Math.max(1.5, tile * 0.07), "#3FA3D1", tile * 0.3, "rgba(89,195,255,0.6)");
    // ghost door
    w.shadowBlur = 0; w.fillStyle = "rgba(255,92,138,0.8)";
    w.fillRect(9 * tile + tile * 0.1, 8 * tile + tile * 0.42, tile * 0.8, tile * 0.16);
  }

  // ---------- Movement ----------
  const atCenter = (e) => Math.abs(e.x - Math.round(e.x)) < 1e-4 && Math.abs(e.y - Math.round(e.y)) < 1e-4;
  const same = (a, b) => a.dx === b.dx && a.dy === b.dy;

  function moveEntity(e, dt, choose, forGhost) {
    let remaining = e.speed * dt, guard = 0;
    while (remaining > 1e-6 && guard++ < 8) {
      if (atCenter(e)) {
        e.x = Math.round(e.x); e.y = Math.round(e.y);
        if (e.x < 0) e.x = COLS - 1; else if (e.x > COLS - 1) e.x = 0;
        const d = choose(e);
        if (!d || (d.dx === 0 && d.dy === 0) || !walkable(e.x + d.dx, e.y + d.dy, forGhost)) { e.dir = NONE; return; }
        e.dir = d;
        const step = Math.min(1, remaining);
        e.x += d.dx * step; e.y += d.dy * step; remaining -= step;
      } else {
        const tx = e.dir.dx > 0 ? Math.ceil(e.x) : e.dir.dx < 0 ? Math.floor(e.x) : e.x;
        const ty = e.dir.dy > 0 ? Math.ceil(e.y) : e.dir.dy < 0 ? Math.floor(e.y) : e.y;
        const dist = Math.abs(tx - e.x) + Math.abs(ty - e.y);
        if (dist === 0) { e.x = Math.round(e.x); e.y = Math.round(e.y); continue; }
        if (remaining >= dist) { e.x = tx; e.y = ty; remaining -= dist; }
        else { e.x += e.dir.dx * remaining; e.y += e.dir.dy * remaining; remaining = 0; }
      }
    }
    if (e.x < -0.5) e.x += COLS; else if (e.x > COLS - 0.5) e.x -= COLS;
  }

  // Turn assist: if the player asks to turn slightly before or just after an opening,
  // snap onto that tile's center and take the turn (feels like classic maze games).
  const TURN_WINDOW = 0.45;
  function tryCornerTurn(e) {
    const n = e.next;
    if (same(n, NONE) || same(n, e.dir) || same(e.dir, NONE)) return;
    if (n.dx === -e.dir.dx && n.dy === -e.dir.dy) return;
    const cx = Math.round(e.x), cy = Math.round(e.y);
    const off = Math.abs(e.x - cx) + Math.abs(e.y - cy);
    if (off > TURN_WINDOW || off < 1e-4) return;
    if (cx < 0 || cx >= COLS) return;
    if (!walkable(cx + n.dx, cy + n.dy)) return;
    e.x = cx; e.y = cy; e.dir = n;
  }
  function choosePlayer(e) {
    if (!same(e.next, NONE) && walkable(e.x + e.next.dx, e.y + e.next.dy)) return e.next;
    if (!same(e.dir, NONE) && walkable(e.x + e.dir.dx, e.y + e.dir.dy)) return e.dir;
    return NONE;
  }

  function ghostTarget(g) {
    if (g.mode === "eaten") return HOME;
    if (g.mode === "out") return DOOR;
    const px = Math.round(player.x), py = Math.round(player.y);
    if (scatter) return [{ x: COLS - 2, y: -2 }, { x: 1, y: -2 }, { x: COLS - 1, y: ROWS + 1 }, { x: 0, y: ROWS + 1 }][g.i];
    switch (g.i) {
      case 0: return { x: px, y: py };
      case 1: return { x: px + player.dir.dx * 4, y: py + player.dir.dy * 4 };
      case 2: { const b = ghosts[0]; return { x: px + (px - Math.round(b.x)), y: py + (py - Math.round(b.y)) }; }
      default: return Math.hypot(px - g.x, py - g.y) > 7 ? { x: px, y: py } : { x: 0, y: ROWS + 1 };
    }
  }

  function chooseGhost(g) {
    if (g.mode === "out" && g.x === DOOR.x && g.y === DOOR.y) g.mode = "chase";
    if (g.mode === "eaten" && g.x === HOME.x && g.y === HOME.y) g.mode = "out";
    const opts = Object.values(DIRS).filter((d) => walkable(g.x + d.dx, g.y + d.dy, true) && !(d.dx === -g.dir.dx && d.dy === -g.dir.dy && !same(g.dir, NONE)));
    // ghosts outside home never re-enter through the door unless eaten
    const filtered = opts.filter((d) => {
      const t = grid[g.y + d.dy] && grid[g.y + d.dy][g.x + d.dx];
      return g.mode === "eaten" || g.mode === "out" || (t !== "-" && t !== "G");
    });
    const list = filtered.length ? filtered : opts.length ? opts : Object.values(DIRS).filter((d) => walkable(g.x + d.dx, g.y + d.dy, true));
    if (!list.length) return NONE;
    if (frightTimer > 0 && g.mode === "chase") return list[Math.floor(Math.random() * list.length)];
    const t = ghostTarget(g);
    let bestD = null, bestDist = Infinity;
    for (const d of list) { const dist = Math.hypot(g.x + d.dx - t.x, g.y + d.dy - t.y); if (dist < bestDist) { bestDist = dist; bestD = d; } }
    return bestD;
  }

  // ---------- Update ----------
  function update(dt) {
    time += dt;
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);

    if (state === "ready") { readyTimer -= dt; if (readyTimer <= 0) { state = "play"; readyEl.classList.add("hidden"); } return; }
    if (state === "dying") { dyingTimer -= dt; if (dyingTimer <= 0) afterDeath(); return; }
    if (state !== "play") return;

    // scatter / chase rhythm
    modeTimer += dt;
    const phase = scatter ? 6 : 18;
    if (modeTimer > phase) { modeTimer = 0; scatter = !scatter; ghosts.forEach((g) => { if (g.mode === "chase") g.dir = { dx: -g.dir.dx, dy: -g.dir.dy }; }); }
    if (frightTimer > 0) { frightTimer -= dt; if (frightTimer <= 0) ghostCombo = 0; }

    // player
    const prevDir = player.dir;
    if (!same(player.next, NONE) && same(player.next, { dx: -player.dir.dx, dy: -player.dir.dy })) player.dir = player.next;
    tryCornerTurn(player);
    moveEntity(player, dt, choosePlayer, false);
    if (!same(player.dir, NONE)) {
      player.angle = Math.atan2(player.dir.dy, player.dir.dx);
      if (player.dir.dx) player.face = player.dir.dx;
    } else if (!same(prevDir, NONE)) { /* stopped */ }
    player.trail.push({ x: player.x, y: player.y, life: 0.5 });
    player.trail.forEach((t) => (t.life -= dt));
    player.trail = player.trail.filter((t) => t.life > 0).slice(-14);

    // eat
    const pc = Math.round(player.x), pr = Math.round(player.y);
    if (pc >= 0 && pc < COLS && Math.abs(player.x - pc) < 0.35 && Math.abs(player.y - pr) < 0.35) {
      const t = grid[pr][pc];
      if (t === "." || t === "o") {
        grid[pr][pc] = " "; orbsLeft--;
        if (t === ".") { score += 10; sfx.orb(); burst(pc, pr, C.player, 4, 1.2); }
        else {
          score += 50; sfx.star(); burst(pc, pr, C.accent, 14, 3);
          frightTimer = Math.max(3, 7 - (level - 1) * 0.7); ghostCombo = 0;
          ghosts.forEach((g) => { if (g.mode === "chase") g.dir = { dx: -g.dir.dx, dy: -g.dir.dy }; });
        }
        if (orbsLeft <= 0) return levelComplete();
      }
    }

    // ghosts
    for (const g of ghosts) {
      g.bob += dt * 6;
      if (g.mode === "home") {
        g.release -= dt;
        g.y = HOME.y + Math.sin(g.bob) * 0.15;
        if (g.release <= 0) { g.y = HOME.y; g.x = Math.round(g.x); g.mode = "out"; g.dir = NONE; }
        continue;
      }
      const base = g.speed;
      const scared = frightTimer > 0 && g.mode === "chase";
      const inTunnel = Math.round(g.y) === 9 && (g.x < 4 || g.x > COLS - 5);
      g.speed = g.mode === "eaten" ? base * 2.2 : scared ? base * 0.55 : inTunnel ? base * 0.5 : base;
      moveEntity(g, dt, chooseGhost, true);
      g.speed = base;

      if (Math.hypot(g.x - player.x, g.y - player.y) < 0.65) {
        if (scared) {
          g.mode = "eaten"; ghostCombo++;
          const pts = 200 * Math.pow(2, ghostCombo - 1); score += pts;
          sfx.ghost(); burst(g.x, g.y, g.color, 18, 3.5); floatText(g.x, g.y, "+" + pts);
        } else if (g.mode === "chase") { return die(); }
      }
    }
    syncHud();
  }

  function burst(x, y, color, n, spd) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * spd;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.4, max: 0.8, color });
    }
  }
  function floatText(x, y, text) { particles.push({ x, y, vx: 0, vy: -1.2, life: 0.9, max: 0.9, color: C.text, text }); }

  function die() {
    state = "dying"; dyingTimer = 1.4; sfx.die();
    burst(player.x, player.y, C.player, 30, 4);
  }
  function afterDeath() {
    lives--; syncHud();
    if (lives <= 0) return gameOver();
    resetActors(); startReady(1.4);
  }
  function levelComplete() {
    state = "win"; sfx.win(); saveBest(); syncHud();
    $("win-score").textContent = score; $("win-lives").textContent = lives; $("win-next").textContent = level + 1;
    show("win");
  }
  function gameOver() {
    state = "over";
    const isNew = saveBest();
    $("over-score").textContent = score; $("over-best").textContent = best; $("over-level").textContent = level;
    $("over-newbest").classList.toggle("hidden", !isNew);
    show("over");
  }
  function saveBest() { if (score > best) { best = score; store.set("ff-best", best); return true; } return false; }

  // ---------- Draw ----------
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, COLS * tile, ROWS * tile);
    // floor
    const g = ctx.createRadialGradient(COLS * tile / 2, ROWS * tile / 2, tile, COLS * tile / 2, ROWS * tile / 2, ROWS * tile * 0.7);
    g.addColorStop(0, "#0B2230"); g.addColorStop(1, C.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, COLS * tile, ROWS * tile);
    if (wallLayer) ctx.drawImage(wallLayer, 0, 0, COLS * tile, ROWS * tile);
    drawOrbs();
    for (const t of player.trail) drawGlow(t.x, t.y, tile * 0.25 * (t.life / 0.5), `rgba(232,255,89,${0.25 * t.life})`);
    ghosts.forEach(drawGhost);
    if (state !== "dying") drawFirefly(player.x, player.y, player.angle, player.face, 1);
    else drawFirefly(player.x, player.y, player.angle, player.face, Math.max(0, dyingTimer / 1.4));
    drawParticles();
  }

  const px = (v) => (v + 0.5) * tile;

  function drawGlow(x, y, r, color) {
    if (r <= 0) return;
    const gr = ctx.createRadialGradient(px(x), px(y), 0, px(x), px(y), r);
    gr.addColorStop(0, color); gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px(x), px(y), r, 0, Math.PI * 2); ctx.fill();
  }

  function drawOrbs() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (t === ".") {
        const pulse = 0.85 + Math.sin(time * 3 + (r * 7 + c * 3)) * 0.15;
        drawGlow(c, r, tile * 0.32 * pulse, "rgba(232,255,89,0.35)");
        ctx.fillStyle = C.player; ctx.beginPath(); ctx.arc(px(c), px(r), tile * 0.09, 0, Math.PI * 2); ctx.fill();
      } else if (t === "o") {
        const s = 1 + Math.sin(time * 5) * 0.12;
        drawGlow(c, r, tile * 0.7 * s, "rgba(89,195,255,0.45)");
        star(px(c), px(r), tile * 0.36 * s, tile * 0.12 * s, C.accent, time);
        ctx.fillStyle = C.text; ctx.beginPath(); ctx.arc(px(c), px(r), tile * 0.08, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function star(x, y, R, r, color, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot * 0.6); ctx.fillStyle = color; ctx.beginPath();
    for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, rad = k % 2 ? r : R; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawFirefly(x, y, angle, face, alpha) {
    if (alpha <= 0) return;
    const s = tile / 26, flap = Math.sin(time * 28);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawGlow(x, y, tile * (0.95 + Math.sin(time * 6) * 0.08), "rgba(232,255,89,0.42)");
    ctx.translate(px(x), px(y));
    // keep it upright when flying left
    if (face < 0 && Math.abs(angle) > Math.PI / 2) { ctx.scale(-1, 1); ctx.rotate(Math.PI - angle); } else ctx.rotate(angle);
    ctx.scale(s, s);
    // wings
    ctx.fillStyle = "rgba(191,230,255,0.7)";
    ctx.save(); ctx.translate(2, -6); ctx.scale(1, 0.55 + flap * 0.45);
    ctx.beginPath(); ctx.ellipse(-1, -7, 6, 10, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, -6, 5, 8, 0.3, 0, Math.PI * 2); ctx.globalAlpha = alpha * 0.6; ctx.fill();
    ctx.restore(); ctx.globalAlpha = alpha;
    // abdomen (glowing tail at the back)
    const ab = ctx.createRadialGradient(-7, 1, 1, -7, 1, 10);
    ab.addColorStop(0, "#FFFFFF"); ab.addColorStop(0.35, C.player); ab.addColorStop(1, "#B8D12E");
    ctx.fillStyle = ab; ctx.beginPath(); ctx.ellipse(-7, 1, 9, 7.5, 0, 0, Math.PI * 2); ctx.fill();
    // thorax + head
    ctx.fillStyle = C.body;
    ctx.beginPath(); ctx.ellipse(3, 0, 6, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(10, -1, 5, 0, Math.PI * 2); ctx.fill();
    // eye
    ctx.fillStyle = C.text; ctx.beginPath(); ctx.arc(12, -2.5, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(12.8, -2.5, 1.1, 0, Math.PI * 2); ctx.fill();
    // antennae
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(11, -5); ctx.quadraticCurveTo(13, -11, 17, -12); ctx.stroke();
    ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(17, -12, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawGhost(g) {
    const scared = frightTimer > 0 && g.mode === "chase";
    const blink = scared && frightTimer < 2 && Math.floor(time * 8) % 2 === 0;
    const eaten = g.mode === "eaten";
    const color = scared ? (blink ? C.ghosts[0] : C.frightened) : g.color;
    const s = tile / 29, cx = px(g.x), cy = px(g.y) + Math.sin(g.bob) * 1.2 * s;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    if (!eaten) {
      // glow
      ctx.shadowColor = color; ctx.shadowBlur = 14 * s * 2;
      ctx.beginPath();
      ctx.moveTo(-13, 12);
      ctx.lineTo(-13, -2); ctx.arc(0, -2, 13, Math.PI, 0); ctx.lineTo(13, 12);
      const waves = 4, w = 26 / waves, ph = time * 10;
      for (let k = 0; k < waves; k++) {
        const x1 = 13 - k * w;
        ctx.quadraticCurveTo(x1 - w / 2, 12 + (k % 2 ? 4 : 6) + Math.sin(ph + k) * 2, x1 - w, 12);
      }
      ctx.closePath();
      ctx.fillStyle = scared ? "#1B3A4A" : C.core; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke();
    }
    // eyes look toward movement
    const lx = g.dir.dx * 2, ly = g.dir.dy * 2;
    if (scared) {
      ctx.fillStyle = color;
      ctx.fillRect(-7, -5, 4, 4); ctx.fillRect(3, -5, 4, 4);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(-8, 5); for (let k = 0; k < 5; k++) ctx.lineTo(-8 + (k + 1) * 4, k % 2 ? 5 : 3); ctx.stroke();
    } else {
      for (const ex of [-5, 5]) {
        ctx.fillStyle = eaten ? C.text : color;
        ctx.beginPath(); ctx.ellipse(ex, -3, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = eaten ? C.accent : "#FFFFFF";
        ctx.beginPath(); ctx.arc(ex + lx, -3 + ly, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.text) {
        ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.font = `${Math.round(tile * 0.55)}px "Lilita One", sans-serif`;
        ctx.textAlign = "center"; ctx.fillText(p.text, px(p.x), px(p.y)); ctx.globalAlpha = 1; continue;
      }
      ctx.fillStyle = p.color; ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(px(p.x), px(p.y), tile * 0.07 * (0.5 + a), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD ----------
  const lifeIcon = `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="9" fill="#E8FF59" fill-opacity=".18"/><ellipse cx="9" cy="13" rx="5.5" ry="4.5" fill="#E8FF59"/><circle cx="16" cy="12" r="4" fill="#2A7FA8"/><ellipse cx="12" cy="7" rx="3" ry="4" fill="#BFE6FF" fill-opacity=".7"/></svg>`;
  let lastHud = "";
  function syncHud() {
    const key = `${score}|${best}|${level}|${lives}`;
    if (key === lastHud) return; lastHud = key;
    $("hud-score").textContent = score;
    $("hud-best").textContent = Math.max(best, score);
    $("hud-level").textContent = level;
    $("hud-lives").innerHTML = lifeIcon.repeat(Math.max(0, lives));
  }

  // ---------- Screens ----------
  function show(name) { Object.entries(screens).forEach(([k, el]) => el.classList.toggle("hidden", k !== name)); }
  function hideScreens() { Object.values(screens).forEach((el) => el.classList.add("hidden")); }
  function startReady(sec = 1.8) { state = "ready"; readyTimer = sec; readyEl.classList.remove("hidden"); }

  function newGame() {
    score = 0; lives = 3; level = 1; lastHud = "";
    resetLevel(); enterGame(true);
  }
  function nextLevel() { level++; resetLevel(); enterGame(); }
  function enterGame(withHowto) {
    hideScreens(); hud.classList.remove("hidden");
    layout(); syncHud();
    if (withHowto) { state = "howto"; show("howto"); } else startReady();
  }
  function beginFromHowto() { if (state !== "howto") return; hideScreens(); startReady(); }
  function toMenu() {
    state = "menu"; hud.classList.add("hidden"); readyEl.classList.add("hidden");
    show("start");
  }
  function pause() { if (state === "play" || state === "ready") { state = "paused"; show("pause"); } }
  function resume() { if (state === "paused") { hideScreens(); startReady(0.8); } }
  function setSound(on) {
    soundOn = on; store.set("ff-sound", on);
    ["btn-sound", "btn-sound-2"].forEach((id) => ($(id).textContent = `Âm thanh: ${on ? "Bật" : "Tắt"}`));
  }

  $("btn-play").onclick = newGame;
  $("btn-help").onclick = () => show("help");
  $("btn-help-back").onclick = () => show("start");
  $("btn-sound").onclick = $("btn-sound-2").onclick = () => setSound(!soundOn);
  $("btn-pause").onclick = pause;
  $("btn-resume").onclick = resume;
  $("btn-restart").onclick = newGame;
  $("btn-again").onclick = newGame;
  $("btn-next").onclick = nextLevel;
  ["btn-menu", "btn-menu-2", "btn-menu-3"].forEach((id) => ($(id).onclick = toMenu));
  setSound(soundOn);

  // ---------- Input ----------
  const KEYS = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
  window.addEventListener("keydown", (e) => {
    if (state === "howto") { e.preventDefault(); beginFromHowto(); if (KEYS[e.code]) player.next = DIRS[KEYS[e.code]]; return; }
    if (KEYS[e.code]) { e.preventDefault(); player && (player.next = DIRS[KEYS[e.code]]); }
    else if (e.code === "KeyP" || e.code === "Escape") { state === "paused" ? resume() : pause(); }
    else if ((e.code === "Enter" || e.code === "Space") && state === "menu" && !screens.start.classList.contains("hidden")) newGame();
  });
  screens.howto.addEventListener("pointerdown", (e) => { e.preventDefault(); beginFromHowto(); });
  let touchStart = null;
  $("stage").addEventListener("pointerdown", (e) => { touchStart = { x: e.clientX, y: e.clientY }; });
  $("stage").addEventListener("pointermove", (e) => {
    if (!touchStart || !player) return;
    const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
    if (Math.hypot(dx, dy) < 24) return;
    player.next = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS.right : DIRS.left) : (dy > 0 ? DIRS.down : DIRS.up);
    touchStart = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointerup", () => (touchStart = null));
  window.addEventListener("resize", () => layout());
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state !== "paused") update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  resetLevel(); layout(); syncHud();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout());
  requestAnimationFrame(frame);

})();
