/* LATHE.ETCH — splash: a laser etches a loss surface (adapted from ARES.ETCH).
 *
 * Full-screen timeline (seconds from load; all in T below):
 *   0.15–0.95  "WELCOME TO / LATHE" types out in a 5x7 pixel font (CRT phosphor)
 *   1.35–1.75  text flickers out
 *   1.80       a bright laser dot appears at the centre
 *   1.95–2.55  the cube (cage) unfolds around it
 *   2.50–2.90  the dot splits into four beams that fly to the four top corners
 *   2.90–3.75  rows: each emitter traces its quadrant row by row, burning the anchors and row lines
 *   3.75–4.35  columns: each emitter traces the column lines
 *   4.35–5.00  fill: quads are filled by loss value, low to high (viridis)
 *   5.00       the screen flies to its slot at the top left of the header (1.3 s); emitters retract
 * Each beam ends exactly on the point being etched at that instant (the tip moves along the grid lines).
 * Docked, it orbits slowly and a laser scan line sweeps the finished surface every 5 s (CRT).
 * Click or any key during the splash skips to the dock. Click the docked screen to re-etch it.
 * A URL with a #section skips the full-screen part; prefers-reduced-motion shows a still, docked surface.
 */
(function () {
  "use strict";
  const slot = document.getElementById("etch-slot");
  if (!slot) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const deepLink = !!location.hash && location.hash.length > 1;

  const T = { type0: 0.15, type1: 0.95, fadeA: 1.35, fadeB: 1.75, dot: 1.8, cubeA: 1.95, cubeB: 2.55,
              splitA: 2.5, splitB: 2.9, rowsB: 3.75, colsB: 4.35, fillB: 5.0, retB: 5.5, dock: 5.0, dockDur: 1.3 };

  // ------------------------------------------------------------------ DOM
  const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const veil = mk("div", "etch-veil");
  const crt = mk("div", "etch-crt");
  const cv = mk("canvas");
  const hud = mk("div", "etch-hud");
  const hudPhase = mk("span", "ph");
  hud.innerHTML = "<b>LATHE.ETCH</b> // loss surface<br>";
  hud.appendChild(hudPhase);
  const skip = mk("div", "etch-skip");
  skip.textContent = "click or press any key to skip";
  crt.append(cv, mk("div", "etch-lines"), mk("div", "etch-glass"), hud, skip);
  crt.setAttribute("role", "img");
  crt.setAttribute("aria-label", "Animated wireframe of a loss surface being laser-etched");
  crt.title = "LATHE.ETCH: a loss surface, re-scanned every 5 s · click to re-etch";
  document.body.append(veil, crt);
  const ctx = cv.getContext("2d");

  // ------------------------------------------------------------------ palette (site colours)
  const P = { laser: "#ff8a2a", laserHot: "#ffe2c0", cage: "#1f9fb8", node: "#ffb070", mesh: "#22e3ff",
              bed: "#04121a", rim: "#0c3340", cyan: "#22e3ff", orange: "#ff8a2a", spark: ["#ff8a2a", "#ffd070", "#22e3ff", "#ffffff"] };

  // ------------------------------------------------------------------ 5x7 pixel font (only the glyphs we need)
  const GLYPH = {
    W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  };
  const LINES = [{ s: "WELCOME TO", k: 1, col: () => P.cyan }, { s: "LATHE", k: 2, col: (i) => (i < 3 ? P.cyan : P.orange) }];
  const NCHAR = LINES[0].s.length + LINES[1].s.length;

  // ------------------------------------------------------------------ geometry: a loss landscape
  const CUBE = 150, EXT = 122, HS = 120, N = 17, MID = (N - 1) / 2;
  // two basins (a deep one and a shallow one), a ridge between them, a bowl, and a little ripple
  function loss(u, v) {
    return 0.95
      - 0.85 * Math.exp(-((u - 0.32) ** 2 + (v - 0.12) ** 2) / 0.10)
      - 0.55 * Math.exp(-((u + 0.46) ** 2 + (v + 0.38) ** 2) / 0.07)
      + 0.22 * (u * u + v * v)
      + 0.035 * Math.sin(9 * u) * Math.cos(8 * v);
  }
  const grid = [], pts = [];
  let lmin = Infinity, lmax = -Infinity;
  for (let r = 0; r < N; r++) {
    grid[r] = [];
    for (let c = 0; c < N; c++) {
      const u = (c / (N - 1)) * 2 - 1, v = (r / (N - 1)) * 2 - 1, L = loss(u, v);
      lmin = Math.min(lmin, L); lmax = Math.max(lmax, L);
      const p = { id: r * N + c, x: u * EXT, z: v * EXT, L, dep: false };
      grid[r][c] = p; pts.push(p);
    }
  }
  for (const p of pts) { p.t = (p.L - lmin) / (lmax - lmin); p.y = (0.55 - p.t) * HS; }
  const corners = [];
  for (let i = 0; i < 8; i++) corners.push({ x: (i & 1 ? 1 : -1) * CUBE, y: (i & 2 ? 1 : -1) * CUBE, z: (i & 4 ? 1 : -1) * CUBE });
  const CAGE = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
  const ORIGIN = { x: 0, y: 0, z: 0 };

  // four emitters, one per quadrant; each gets a row snake, a column snake and its quads (low loss first)
  const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
  const emitters = [];
  for (let k = 0; k < 4; k++) {
    const rr = k & 1 ? range(MID, N - 1) : range(0, MID);
    const cc = k & 2 ? range(MID, N - 1) : range(0, MID);
    const rows = [], cols = [], quads = [];
    rr.forEach((r, i) => (i % 2 ? cc.slice().reverse() : cc).forEach((c) => rows.push(grid[r][c])));
    cc.forEach((c, j) => (j % 2 ? rr.slice().reverse() : rr).forEach((r) => cols.push(grid[r][c])));
    for (const r of rr.slice(0, -1)) for (const c of cc.slice(0, -1)) {
      const a = grid[r][c], b = grid[r][c + 1], q = grid[r + 1][c + 1], d = grid[r + 1][c];
      quads.push({ a, b, c: q, d, t: (a.t + b.t + q.t + d.t) / 4, cx: (a.x + q.x) / 2, cy: (a.y + b.y + q.y + d.y) / 4, cz: (a.z + q.z) / 2 });
    }
    quads.sort((q1, q2) => q1.t - q2.t);
    emitters.push({ corner: { x: (k & 2 ? 1 : -1) * CUBE, y: -CUBE, z: (k & 1 ? 1 : -1) * CUBE }, rows, cols, quads,
                    rS: { done: 0, dep: 0, part: null }, cS: { done: 0, dep: 0, part: null }, nQ: 0, pos: { ...ORIGIN }, tip: null, glow: 0 });
  }

  // ------------------------------------------------------------------ state
  const S = { el: 0, yaw: 0.3, pitch: -0.42, particles: [], flashes: [], smoke: [], edges: [], edgeSet: new Set(), filled: [],
              zoom: 1, zoomT: 1, cage: 1, docked: false, docking: false, scanT: -1, nextScan: 0 };
  function resetSim(el0) {
    S.el = el0 || 0; S.particles.length = 0; S.flashes.length = 0; S.smoke.length = 0; S.edges.length = 0; S.edgeSet.clear(); S.filled.length = 0;
    for (const p of pts) { p.dep = false; p.depT = -9; }
    for (const e of emitters) { e.rS = { done: 0, dep: 0, part: null }; e.cS = { done: 0, dep: 0, part: null }; e.nQ = 0; e.pos = { ...ORIGIN }; e.tip = null; e.glow = 0; }
  }
  resetSim(0);

  // ------------------------------------------------------------------ canvas
  let W = 0, H = 0;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  function fit() {
    const r = crt.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S.zoomT = S.docked ? Math.min(W / 350, H / 228) : Math.min(W / 420, H / 430);
  }
  function project(p) {
    const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    const x1 = p.x * cy - p.z * sy, z1 = p.x * sy + p.z * cy;
    const y1 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
    const f = (700 / (700 + z2 + 300)) * S.zoom;
    return { x: W / 2 + x1 * f, y: H * (S.docked ? 0.57 : 0.5) + y1 * f, s: f, z: z2 };
  }
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerp3 = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const easeBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  function viridis(t) {
    const st = [[0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 144, 141]], [0.75, [93, 201, 99]], [1, [253, 231, 37]]];
    t = clamp(t);
    for (let i = 1; i < st.length; i++) if (t <= st[i][0]) {
      const f = (t - st[i - 1][0]) / (st[i][0] - st[i - 1][0]), a = st[i - 1][1], b = st[i][1];
      return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * f) + "," + Math.round(a[1] + (b[1] - a[1]) * f) + "," + Math.round(a[2] + (b[2] - a[2]) * f) + ")";
    }
    return "rgb(253,231,37)";
  }

  // ------------------------------------------------------------------ sprites: smoke puff + warm underglow
  function sprite(stops) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }
  const SMOKE = sprite([[0, "rgba(170,180,188,.55)"], [0.45, "rgba(120,132,140,.28)"], [1, "rgba(90,100,110,0)"]]);
  const EMBER = sprite([[0, "rgba(255,150,60,.7)"], [0.5, "rgba(255,90,20,.25)"], [1, "rgba(255,60,0,0)"]]);

  // ------------------------------------------------------------------ sparks
  function sparks(p, n, I, flash) {
    if (S.particles.length > 2600 || reduce) return;
    if (flash && S.flashes.length < 16) S.flashes.push({ x: p.x, y: p.y, z: p.z, life: 1, decay: 0.1, size: 2.2 + 1.6 * I });
    for (let i = 0; i < n * 4; i++) {            // white-hot streaks
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, sp = 1.5 + Math.random() * 4.5 * I;
      S.particles.push({ k: "s", x: p.x, y: p.y, z: p.z, px: p.x, py: p.y, pz: p.z,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp - 0.6, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 1, decay: 0.04 + Math.random() * 0.06, col: Math.random() < 0.55 ? "#ffffff" : P.laserHot, size: 0.4 + Math.random() * 0.8 });
    }
    for (let i = 0; i < n * 2; i++) {            // molten ejecta: arc up, fall, cool white -> yellow -> orange -> red
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.8 + 0.3, sp = 1 + Math.random() * 2.6 * I;
      S.particles.push({ k: "e", x: p.x, y: p.y, z: p.z, px: p.x, py: p.y, pz: p.z,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: -Math.sin(e) * sp * 1.4, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 1, decay: 0.012 + Math.random() * 0.02, col: P.spark[(Math.random() * P.spark.length) | 0], size: 0.9 + Math.random() * 1.6, heat: 1, bounced: 0 });
    }
    if (Math.random() < 0.35 * n) smokePuff(p, I);
  }
  function smokePuff(p, I) {
    if (S.smoke.length > 320 || reduce) return;
    S.smoke.push({ x: p.x + (Math.random() - 0.5) * 4, y: p.y - 2, z: p.z + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.35, vy: -0.35 - Math.random() * 0.5 * (0.6 + I), vz: (Math.random() - 0.5) * 0.35,
      r: 3 + Math.random() * 4, grow: 0.25 + Math.random() * 0.3, life: 1, decay: 0.008 + Math.random() * 0.01,
      warm: 1, spin: Math.random() * 6 });
  }
  function stepParticles() {
    for (let i = S.flashes.length - 1; i >= 0; i--) if ((S.flashes[i].life -= S.flashes[i].decay) <= 0) S.flashes.splice(i, 1);
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      if (p.k === "s") { p.vy += 0.03; p.vx *= 0.88; p.vy *= 0.92; p.vz *= 0.88; }
      else {
        p.vy += 0.11; p.vx *= 0.985; p.vz *= 0.985; p.heat = Math.max(0, p.heat - p.decay * 1.1);
        if (p.y > CUBE && p.vy > 0 && p.bounced < 2) { p.y = CUBE; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; p.bounced++; }   // skitter on the bed
      }
      if ((p.life -= p.decay) <= 0) S.particles.splice(i, 1);
    }
    for (let i = S.smoke.length - 1; i >= 0; i--) {
      const m = S.smoke[i];
      m.x += m.vx; m.y += m.vy; m.z += m.vz; m.vy *= 0.995; m.vx += (Math.random() - 0.5) * 0.04; m.vz += (Math.random() - 0.5) * 0.04;
      m.r += m.grow; m.warm = Math.max(0, m.warm - 0.05);
      if ((m.life -= m.decay) <= 0) S.smoke.splice(i, 1);
    }
  }
  const heat = (t) => (t > 0.85 ? "#ffffff" : t > 0.65 ? "#fff5d0" : t > 0.45 ? "#ffd870" : t > 0.25 ? "#ff8a2a" : t > 0.1 ? "#e8230a" : "#6a1408");

  // ------------------------------------------------------------------ path tracing (the precise part)
  function addEdge(a, b) {
    const key = a.id < b.id ? a.id * 4096 + b.id : b.id * 4096 + a.id;
    if (!S.edgeSet.has(key)) { S.edgeSet.add(key); S.edges.push([a, b, S.el]); }
  }
  // advance a tip along `path` to fraction f; completed segments become edges, visited vertices become anchors
  function trace(st, path, f, deposit) {
    const L = path.length - 1, p = f * L, i = Math.min(L, Math.floor(p));
    const jump = i - st.done > 6;                       // skip/resize jumps: no spark storm
    while (st.done < i) { addEdge(path[st.done], path[st.done + 1]); st.done++; }
    if (f > 0) while (st.dep <= i) {
      const v = path[st.dep];
      if (deposit && !v.dep) { v.dep = true; v.depT = jump ? -9 : S.el; if (!jump) sparks(v, 3, 1.15, true); }
      st.dep++;
    }
    if (f <= 0) { st.part = null; return path[0]; }
    if (i >= L) { st.part = null; return path[L]; }
    const tip = lerp3(path[i], path[i + 1], p - i);
    st.part = [path[i], tip];
    return tip;
  }

  // ------------------------------------------------------------------ timeline
  function update(dt) {
    S.yaw += dt * (S.docked ? 0.12 : 0.2);
    S.zoom = lerp(S.zoom, S.zoomT, 1 - Math.exp(-dt * (S.docked ? 2.5 : 8)));
    S.cage = lerp(S.cage, S.docked ? 0.22 : 1, 1 - Math.exp(-dt * 2));
    S.el = Math.min(T.retB + 1, S.el + dt);
    const el = S.el;
    const fR = clamp((el - T.splitB) / (T.rowsB - T.splitB));
    const fC = clamp((el - T.rowsB) / (T.colsB - T.rowsB));
    const fF = clamp((el - T.colsB) / (T.fillB - T.colsB));
    for (const e of emitters) {
      const tR = trace(e.rS, e.rows, fR, true);
      const tC = trace(e.cS, e.cols, fC, false);
      const nQ = Math.floor(fF * e.quads.length);
      const jump = nQ - e.nQ > 6;
      while (e.nQ < nQ) { const q = e.quads[e.nQ++]; q.fT = jump ? -9 : S.el; S.filled.push(q); if (!jump) sparks({ x: q.cx, y: q.cy, z: q.cz }, 1, 0.7, e.nQ % 2 === 1); }
      // emitter position
      if (el < T.splitA) e.pos = { ...ORIGIN };
      else if (el < T.splitB) e.pos = lerp3(ORIGIN, e.corner, ease((el - T.splitA) / (T.splitB - T.splitA)));
      else if (el < T.fillB) e.pos = { ...e.corner };
      else e.pos = lerp3(e.corner, { x: e.corner.x * 1.5, y: -CUBE * 1.9, z: e.corner.z * 1.5 }, ease(clamp((el - T.fillB) / (T.retB - T.fillB))));
      e.glow = el < T.splitA ? 0 : el < T.fillB ? 0.75 + 0.25 * Math.sin(el * 14 + e.corner.x) : e.glow * 0.93;
      // beam tip: exactly the point being etched
      if (el >= T.splitB && el < T.rowsB) e.tip = tR;
      else if (el >= T.rowsB && el < T.colsB) e.tip = tC;
      else if (el >= T.colsB && el < T.fillB) { const q = e.quads[Math.min(e.quads.length - 1, e.nQ)]; e.tip = { x: q.cx, y: q.cy, z: q.cz }; }
      else e.tip = null;
      if (e.tip && dt > 0) { sparks(e.tip, S.docked ? 1 : 2, 0.75, false); if (Math.random() < 0.5) smokePuff(e.tip, 0.6); }
    }
    hud.style.opacity = el >= T.dot && !S.docking && !S.docked ? 1 : 0;
    hudPhase.textContent = el < T.cubeA ? "phase: laser on" : el < T.splitA ? "phase: cage" : el < T.splitB ? "phase: split ×4"
      : el < T.rowsB ? "phase: anchors + rows " + Math.round(100 * fR) + "%" : el < T.colsB ? "phase: columns " + Math.round(100 * fC) + "%"
      : el < T.fillB ? "phase: fill (low → high loss) " + Math.round(100 * fF) + "%" : el < T.retB ? "phase: retract" : "phase: done";
    // CRT scan every 5 s once docked and finished
    if (S.docked && el >= T.retB && !reduce) {
      const now = performance.now() / 1000;
      if (S.scanT < 0 && now >= S.nextScan) { S.scanT = 0; S.nextScan = now + 5; }
      if (S.scanT >= 0) { S.scanT += dt / 1.3; if (S.scanT > 1.25) S.scanT = -1; }
    }
    stepParticles();
  }

  // ------------------------------------------------------------------ render pieces
  function drawWelcome(el) {
    if (el < T.type0 || el > T.fadeB) return;
    const typed = Math.floor(clamp((el - T.type0) / (T.type1 - T.type0)) * NCHAR + 1e-6);
    let a = 1;
    if (el > T.fadeA) { a = 1 - (el - T.fadeA) / (T.fadeB - T.fadeA); if (Math.random() < 0.25) a *= 0.35; }
    const p = Math.max(2, Math.min(9, (W * 0.56) / 60));     // pixel pitch: both lines are ~59 columns of p
    const h1 = 7 * p, h2 = 14 * p, gap = 5 * p, top = H / 2 - (h1 + gap + h2) / 2;
    const jx = el > T.fadeA ? (Math.random() - 0.5) * p : 0;
    let n = 0, cur = null;
    ctx.save();
    ctx.globalAlpha = a;
    LINES.forEach((ln, li) => {
      const px = p * ln.k, w = (ln.s.length * 6 - 1) * px, x0 = W / 2 - w / 2 + jx, y0 = li ? top + h1 + gap : top;
      for (let ci = 0; ci < ln.s.length; ci++) {
        const g = GLYPH[ln.s[ci]], cx = x0 + ci * 6 * px;
        if (n >= typed) { if (!cur) cur = { x: cx, y: y0, px }; n++; continue; }
        n++;
        const col = ln.col(ci);
        for (const pass of [0, 1]) {               // pass 0: glow (shadow); pass 1: crisp pixels + red fringe
          ctx.shadowBlur = pass ? 0 : 14 * (px / 6); ctx.shadowColor = col;
          for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === "1") {
            const X = cx + c * px, Y = y0 + r * px, s = px * 0.84;
            if (pass) { ctx.fillStyle = "rgba(255,60,60,.28)"; ctx.fillRect(X + px * 0.18, Y, s, s); }
            ctx.fillStyle = col; ctx.fillRect(X, Y, s, s);
          }
        }
      }
    });
    if (!cur && typed >= NCHAR) { const ln = LINES[1], px = p * 2, w = (ln.s.length * 6 - 1) * px; cur = { x: W / 2 + w / 2 + px * 1.2 + jx, y: top + h1 + gap, px }; }
    if (cur && Math.floor(el * 3.2) % 2 === 0) {
      ctx.shadowBlur = 10; ctx.shadowColor = P.cyan; ctx.fillStyle = P.cyan;
      ctx.fillRect(cur.x, cur.y, cur.px * 4.2, cur.px * 7);
    }
    ctx.restore();
  }
  function glowDot(p, r, a) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
    g.addColorStop(0, "rgba(255,255,255," + a + ")"); g.addColorStop(0.18, "rgba(255,226,192," + a * 0.8 + ")");
    g.addColorStop(0.45, "rgba(255,138,42," + a * 0.3 + ")"); g.addColorStop(1, "rgba(255,138,42,0)");
    ctx.fillStyle = g; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2); ctx.fill();
  }
  function beam(a, b, lw) {
    ctx.lineCap = "round";
    ctx.strokeStyle = P.laser; ctx.globalAlpha = 0.22; ctx.lineWidth = 4.5 * lw;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = P.laserHot; ctx.globalAlpha = 0.95; ctx.lineWidth = 1.1 * lw;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  function render() {
    const el = S.el;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = S.docked ? "#020a0c" : "#03080a";
    ctx.fillRect(0, 0, W, H);
    const lw = S.docked ? 0.6 : 1;
    drawWelcome(el);
    // cage: unfolds from the centre
    const kC = el < T.cubeA ? 0 : el < T.cubeB ? easeBack((el - T.cubeA) / (T.cubeB - T.cubeA)) : 1;
    const aC = clamp((el - T.cubeA) / (T.cubeB - T.cubeA)) * S.cage;
    if (aC > 0.02) {
      const sc = (p) => ({ x: p.x * kC, y: p.y * kC, z: p.z * kC });
      const bed = [{ x: -CUBE, y: CUBE, z: -CUBE }, { x: CUBE, y: CUBE, z: -CUBE }, { x: CUBE, y: CUBE, z: CUBE }, { x: -CUBE, y: CUBE, z: CUBE }].map((p) => project(sc(p)));
      ctx.globalAlpha = 0.7 * aC; ctx.fillStyle = P.bed;
      ctx.beginPath(); ctx.moveTo(bed[0].x, bed[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(bed[i].x, bed[i].y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = P.rim; ctx.lineWidth = 0.5; ctx.globalAlpha = 0.45 * aC;
      for (let i = 0; i <= 8; i++) {
        const t = -CUBE + (i / 8) * 2 * CUBE;
        let a = project(sc({ x: t, y: CUBE, z: -CUBE })), b = project(sc({ x: t, y: CUBE, z: CUBE }));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        a = project(sc({ x: -CUBE, y: CUBE, z: t })); b = project(sc({ x: CUBE, y: CUBE, z: t }));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.strokeStyle = P.cage;
      for (const [i, j] of CAGE) {
        const a = project(sc(corners[i])), b = project(sc(corners[j]));
        ctx.globalAlpha = 0.3 * aC; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 0.85 * aC; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    // filled quads, back to front
    const totalQ = emitters.reduce((s, e) => s + e.quads.length, 0), fillFrac = S.filled.length / totalQ;
    if (S.filled.length) {
      const items = [], nF = S.filled.length;
      for (let i = 0; i < nF; i++) {
        const q = S.filled[i], pa = project(q.a), pb = project(q.b), pc = project(q.c), pd = project(q.d);
        items.push({ q, pa, pb, pc, pd, z: (pa.z + pb.z + pc.z + pd.z) / 4, fresh: nF - i });
      }
      items.sort((a, b) => b.z - a.z);
      for (const it of items) {
        ctx.globalAlpha = 0.9; ctx.fillStyle = viridis(it.q.t);
        ctx.beginPath(); ctx.moveTo(it.pa.x, it.pa.y); ctx.lineTo(it.pb.x, it.pb.y); ctx.lineTo(it.pc.x, it.pc.y); ctx.lineTo(it.pd.x, it.pd.y); ctx.closePath(); ctx.fill();
        const age = el - it.q.fT;
        if (age >= 0 && age < 0.5) {             // freshly fused: white-hot, cooling to the viridis colour
          const k = 1 - age / 0.5;
          ctx.fillStyle = heat(k); ctx.globalAlpha = 0.75 * k; ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = k; ctx.lineWidth = 1.2 * lw; ctx.stroke();
        }
      }
    }
    // engraved lines (complete edges + the segment each tip is cutting right now)
    const dim = 1 - 0.55 * fillFrac;
    if (S.edges.length) {
      ctx.strokeStyle = P.mesh; ctx.lineCap = "round";
      ctx.beginPath();
      for (const [a0, b0] of S.edges) { const a = project(a0), b = project(b0); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.globalAlpha = 0.22 * dim; ctx.lineWidth = 2.4 * lw; ctx.stroke();
      ctx.globalAlpha = 0.9 * dim; ctx.lineWidth = 0.8 * lw; ctx.stroke();
    }
    for (let i = S.edges.length - 1; i >= 0; i--) {      // freshly cut lines glow and cool (white -> orange -> cyan)
      const [a0, b0, t0] = S.edges[i], age = el - t0;
      if (age > 0.7) break;
      if (age < 0) continue;
      const k = 1 - age / 0.7, a = project(a0), b = project(b0);
      ctx.strokeStyle = heat(k); ctx.globalAlpha = 0.95 * k; ctx.lineWidth = (1 + 2.2 * k) * lw;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const e of emitters) for (const st of [e.rS, e.cS]) if (st.part) {
      const a = project(st.part[0]), b = project(st.part[1]);
      ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = 0.95; ctx.lineWidth = 1.3 * lw;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // anchors
    const dimA = 1 - 0.75 * fillFrac;
    for (const v of pts) if (v.dep) {
      const p = project(v), age = el - v.depT;
      if (age >= 0 && age < 0.6) {
        const k = 1 - age / 0.6;
        ctx.globalAlpha = 0.5 * k; ctx.fillStyle = heat(k);
        ctx.beginPath(); ctx.arc(p.x, p.y, (2.2 + 3.2 * k) * p.s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 0.45 * dimA; ctx.fillStyle = P.laserHot;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * p.s, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9 * dimA; ctx.fillStyle = P.laser;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 * p.s, 0, Math.PI * 2); ctx.fill();
    }
    // the laser: one dot, then four emitters with beams pinned to their tips
    const o = project(ORIGIN);
    if (el >= T.dot && el < T.splitA) {
      const k = clamp((el - T.dot) / 0.15), pulse = 1 + 0.18 * Math.sin(el * 30);
      glowDot(o, 3.4 * k * pulse * Math.max(1, S.zoom), 1);
    }
    if (el >= T.splitA && el < T.retB + 0.6) {
      const fs = clamp((el - T.splitA) / (T.splitB - T.splitA));
      for (const e of emitters) {
        const p = project(e.pos);
        if (fs < 1) { ctx.strokeStyle = P.laserHot; ctx.globalAlpha = 0.8 * (1 - fs); ctx.lineWidth = 1.4 * lw;
          ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
        if (e.tip) {
          const t = project(e.tip);
          beam(p, t, lw);
          glowDot(t, (2.2 + 0.6 * Math.random()) * Math.max(0.6, t.s), 1);   // flickering melt pool
        }
        const r = 3.6 * p.s;
        ctx.fillStyle = P.laserHot; ctx.globalAlpha = 0.18 + e.glow * 0.45;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = P.node; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      }
      if (fs < 1) glowDot(o, 3 * (1 - fs) * Math.max(1, S.zoom), 1 - fs);
    }
    // smoke (drawn normally, so it dims what is behind it a little)
    if (S.smoke.length) {
      for (const m of S.smoke) {
        const pr = project(m), r = m.r * pr.s, a = Math.min(1, m.life * 1.4);
        ctx.globalAlpha = 0.5 * a; ctx.drawImage(SMOKE, pr.x - r, pr.y - r, 2 * r, 2 * r);
        if (m.warm > 0) { ctx.globalAlpha = 0.25 * m.warm; ctx.drawImage(EMBER, pr.x - r * 0.7, pr.y - r * 0.7, 1.4 * r, 1.4 * r); }
      }
    }
    // particles (additive)
    ctx.globalCompositeOperation = "lighter";
    for (const f of S.flashes) {
      const pr = project(f), life = Math.max(0, f.life), r = f.size * (1 + (1 - life) * 1.5) * pr.s;
      const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, r * 4);
      g.addColorStop(0, "rgba(255,255,255," + life * 0.8 + ")"); g.addColorStop(0.2, "rgba(255,226,192," + life * 0.35 + ")");
      g.addColorStop(0.5, "rgba(255,138,42," + life * 0.12 + ")"); g.addColorStop(1, "rgba(255,138,42,0)");
      ctx.fillStyle = g; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, r * 4, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of S.particles) {
      const pr = project(p), pv = project({ x: p.px, y: p.py, z: p.pz }), life = Math.max(0, p.life);
      ctx.strokeStyle = p.k === "e" ? heat(p.heat) : p.col; ctx.globalAlpha = life * (p.k === "e" ? 0.5 : 0.85);
      ctx.lineWidth = p.size * 1.4 * pr.s; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(pv.x, pv.y); ctx.lineTo(pr.x, pr.y); ctx.stroke();
    }
    // CRT laser scan
    if (S.scanT >= 0) {
      const y = -0.08 * H + S.scanT * 1.16 * H;
      const trail = ctx.createLinearGradient(0, y - H * 0.32, 0, y);
      trail.addColorStop(0, "rgba(34,227,255,0)"); trail.addColorStop(1, "rgba(34,227,255,0.16)");
      ctx.globalAlpha = 1; ctx.fillStyle = trail; ctx.fillRect(0, y - H * 0.32, W, H * 0.32);
      for (const v of pts) {
        const p = project(v), d = Math.abs(p.y - y);
        if (d < H * 0.06) {
          ctx.globalAlpha = 1 - d / (H * 0.06); ctx.fillStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 * p.s + 0.6, 0, Math.PI * 2); ctx.fill();
        }
      }
      const g = ctx.createLinearGradient(0, y - 4, 0, y + 4);
      g.addColorStop(0, "rgba(255,138,42,0)"); g.addColorStop(0.5, "rgba(255,226,192,0.95)"); g.addColorStop(1, "rgba(255,138,42,0)");
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, y - 4, W, 8);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, y - 0.5, W, 1);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ dock
  function placeDocked() {               // the screen lives inside the (sticky) header slot from now on
    if (crt.parentNode !== slot) slot.appendChild(crt);
    Object.assign(crt.style, { left: "", top: "", width: "", height: "", transform: "", clipPath: "", transition: "" });
  }
  let dockScale = 1;
  function finishDock() {
    crt.classList.remove("docking");
    crt.classList.add("docked");
    S.docked = true; S.docking = false;
    const z = S.zoom;
    placeDocked(); fit();
    S.zoom = z * dockScale;              // continue from what was on screen, then ease to the docked framing
    S.nextScan = performance.now() / 1000 + Math.max(0, T.retB - S.el) + 0.8;
    veil.remove();
  }
  function startDock(dur) {
    if (S.docked || S.docking) return;
    S.docking = true;
    document.documentElement.classList.remove("etch-lock");
    crt.classList.add("docking");
    const r = slot.getBoundingClientRect(), vw = W, vh = H;
    const s = Math.max(r.width / vw, r.height / vh);
    dockScale = s;
    const ix = (vw - r.width / s) / 2, iy = (vh - r.height / s) / 2;
    const tx = r.left - ix * s, ty = r.top - iy * s;
    crt.style.transition = "none";
    crt.style.clipPath = "inset(0px 0px 0px 0px round 0px)";
    void crt.offsetWidth;
    const curve = "cubic-bezier(.75,0,.2,1)";
    crt.style.transition = "transform " + dur + "s " + curve + ", clip-path " + dur + "s " + curve;
    crt.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
    crt.style.clipPath = "inset(" + iy + "px " + ix + "px " + iy + "px " + ix + "px round " + 8 / s + "px)";
    veil.classList.add("out");
    setTimeout(finishDock, dur * 1000 + 40);
  }
  function dockNow() {                   // no splash: start inside the slot
    crt.classList.add("docked");
    S.docked = true;
    veil.remove();
    placeDocked(); fit(); S.zoom = S.zoomT;
    S.nextScan = performance.now() / 1000 + (T.retB - T.dot) + 0.8;
  }

  // ------------------------------------------------------------------ loop
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      if (!S.docked && !S.docking && S.el >= T.dock) startDock(T.dockDur);
      acc += dt;
      const idle = S.docked && S.el >= T.retB + 0.6 && S.scanT < 0 && !S.particles.length && !S.smoke.length;
      if (!idle || acc >= 1 / 30) { update(idle ? acc : dt); render(); acc = 0; }   // ~30 fps when idle
    }
    requestAnimationFrame(frame);
  }
  function skipAhead() {
    if (S.docked || S.docking) return;
    S.el = Math.max(S.el, T.retB);
    startDock(0.7);
  }
  crt.addEventListener("click", () => {
    if (!S.docked) return skipAhead();
    if (S.el >= T.retB) { resetSim(T.dot); S.nextScan = performance.now() / 1000 + (T.retB - T.dot) + 0.8; }  // re-etch in place
  });
  window.addEventListener("keydown", () => skipAhead(), { once: true });
  window.addEventListener("resize", () => { fit(); if (reduce) render(); });

  if (reduce) {
    dockNow(); S.cage = 0.22; S.el = T.retB + 1;
    update(0); S.particles.length = 0; S.flashes.length = 0; S.smoke.length = 0; render();
    return;
  }
  if (deepLink) { dockNow(); resetSim(T.dot); }
  else { document.documentElement.classList.add("etch-lock"); fit(); S.zoom = S.zoomT; }
  requestAnimationFrame(frame);
})();
