/* LATHE.ETCH — splash: eight laser nodes etch a loss surface (adapted from ARES.ETCH).
 *
 * Timeline (seconds from load):
 *   0.0–0.7   nodes dock on the cage
 *   0.7–2.0   anchors: the surface grid is burned in, row by row (snake)
 *   2.0–3.2   mesh: anchors are joined into the wireframe
 *   3.2–4.5   fill: quads are filled by loss value, from the minimum up (viridis)
 *   4.5–5.0   nodes retract
 *   2.6–3.9   meanwhile the screen flies to its slot at the top left of the header
 * Docked, it keeps orbiting slowly and a laser scan line sweeps the finished surface every 5 s (CRT).
 * Click or any key during the splash skips to the dock. Click the docked screen to re-etch it.
 * A URL with a #section skips the full-screen part; prefers-reduced-motion shows a still, docked surface.
 */
(function () {
  "use strict";
  const slot = document.getElementById("etch-slot");
  if (!slot) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const deepLink = !!location.hash && location.hash.length > 1;

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
              bed: "#04121a", rim: "#0c3340", spark: ["#ff8a2a", "#ffd070", "#22e3ff", "#ffffff"] };

  // ------------------------------------------------------------------ geometry: a loss landscape
  const CUBE = 150, EXT = 122, HS = 120, N = 17;
  // two basins (a deep one and a shallow one), a ridge between them, a bowl, and a little ripple
  function loss(u, v) {
    return 0.95
      - 0.85 * Math.exp(-((u - 0.32) ** 2 + (v - 0.12) ** 2) / 0.10)
      - 0.55 * Math.exp(-((u + 0.46) ** 2 + (v + 0.38) ** 2) / 0.07)
      + 0.22 * (u * u + v * v)
      + 0.035 * Math.sin(9 * u) * Math.cos(8 * v);
  }
  const grid = [];
  let lmin = Infinity, lmax = -Infinity;
  for (let r = 0; r < N; r++) {
    grid[r] = [];
    for (let c = 0; c < N; c++) {
      const u = (c / (N - 1)) * 2 - 1, v = (r / (N - 1)) * 2 - 1, L = loss(u, v);
      lmin = Math.min(lmin, L); lmax = Math.max(lmax, L);
      grid[r][c] = { x: u * EXT, z: v * EXT, L };
    }
  }
  for (const row of grid) for (const p of row) { p.t = (p.L - lmin) / (lmax - lmin); p.y = (0.55 - p.t) * HS; }
  const anchors = [];                      // snake order
  for (let r = 0; r < N; r++) for (let k = 0; k < N; k++) anchors.push(grid[r][r % 2 ? N - 1 - k : k]);
  const edges = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (c + 1 < N) edges.push({ a: grid[r][c], b: grid[r][c + 1] });
    if (r + 1 < N) edges.push({ a: grid[r][c], b: grid[r + 1][c] });
  }
  edges.sort((e1, e2) => (e1.a.z + e1.b.z) - (e2.a.z + e2.b.z));
  const quads = [];
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
    const a = grid[r][c], b = grid[r][c + 1], cc = grid[r + 1][c + 1], d = grid[r + 1][c];
    quads.push({ a, b, c: cc, d, t: (a.t + b.t + cc.t + d.t) / 4 });
  }
  quads.sort((q1, q2) => q1.t - q2.t);     // fill from the minimum up
  const corners = [];
  for (let i = 0; i < 8; i++) corners.push({ x: (i & 1 ? 1 : -1) * CUBE, y: (i & 2 ? 1 : -1) * CUBE, z: (i & 4 ? 1 : -1) * CUBE });

  // ------------------------------------------------------------------ state
  const T = { app: 0.7, anc: 2.0, mesh: 3.2, fill: 4.5, end: 5.0 };
  const S = { el: 0, yaw: 0.7, pitch: -0.42, nA: 0, nE: 0, nQ: 0, particles: [], flashes: [], nodes: [],
              zoom: 1, zoomT: 1, cage: 1, docked: false, docking: false, scanT: -1, nextScan: 0, glint: [] };
  function resetSim() {
    S.el = 0; S.nA = S.nE = S.nQ = 0; S.particles.length = 0; S.flashes.length = 0;
    S.nodes = corners.map(() => { const p = { x: (Math.random() - 0.5) * 260, y: -CUBE * 1.7, z: (Math.random() - 0.5) * 260 }; return { home: p, pos: { ...p }, glow: 0 }; });
  }
  resetSim();

  // ------------------------------------------------------------------ canvas
  let W = 0, H = 0;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  function fit() {
    const r = crt.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S.zoomT = S.docked ? Math.min(W / 330, H / 205) : Math.min(W / 420, H / 430);
  }
  function project(p) {
    const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    const x1 = p.x * cy - p.z * sy, z1 = p.x * sy + p.z * cy;
    const y1 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
    const f = (700 / (700 + z2 + 300)) * S.zoom;
    return { x: W / 2 + x1 * f, y: H / 2 + y1 * f, s: f, z: z2 };
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  function viridis(t) {
    const st = [[0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 144, 141]], [0.75, [93, 201, 99]], [1, [253, 231, 37]]];
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < st.length; i++) if (t <= st[i][0]) {
      const f = (t - st[i - 1][0]) / (st[i][0] - st[i - 1][0]), a = st[i - 1][1], b = st[i][1];
      return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * f) + "," + Math.round(a[1] + (b[1] - a[1]) * f) + "," + Math.round(a[2] + (b[2] - a[2]) * f) + ")";
    }
    return "rgb(253,231,37)";
  }

  // ------------------------------------------------------------------ sparks
  function sparks(p, n, I) {
    if (S.particles.length > 1400) return;
    if (S.flashes.length < 10) S.flashes.push({ x: p.x, y: p.y, z: p.z, life: 1, decay: 0.12, size: 2 + 1.5 * I });
    for (let i = 0; i < n * 3; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, sp = 2 + Math.random() * 4 * I;
      S.particles.push({ k: "s", x: p.x, y: p.y, z: p.z, px: p.x, py: p.y, pz: p.z,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp - 0.3, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 1, decay: 0.04 + Math.random() * 0.06, col: Math.random() < 0.6 ? "#ffffff" : P.laserHot, size: 0.4 + Math.random() * 0.8 });
    }
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.6 + 0.2, sp = 0.8 + Math.random() * 2 * I;
      S.particles.push({ k: "e", x: p.x, y: p.y, z: p.z, px: p.x, py: p.y, pz: p.z,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: -Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 1, decay: 0.014 + Math.random() * 0.025, col: P.spark[(Math.random() * P.spark.length) | 0], size: 1 + Math.random() * 1.6, heat: 1 });
    }
  }
  function stepParticles() {
    for (let i = S.flashes.length - 1; i >= 0; i--) if ((S.flashes[i].life -= S.flashes[i].decay) <= 0) S.flashes.splice(i, 1);
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      if (p.k === "s") { p.vy += 0.02; p.vx *= 0.88; p.vy *= 0.92; p.vz *= 0.88; }
      else { p.vy += 0.09; p.vx *= 0.985; p.vz *= 0.985; p.heat = Math.max(0, p.heat - p.decay * 1.3); }
      if ((p.life -= p.decay) <= 0) S.particles.splice(i, 1);
    }
  }
  const heat = (t) => (t > 0.85 ? "#ffffff" : t > 0.65 ? "#fff5d0" : t > 0.45 ? "#ffd870" : t > 0.25 ? "#ff8a2a" : t > 0.1 ? "#e8230a" : "#6a1408");

  // ------------------------------------------------------------------ timeline
  function update(dt) {
    S.yaw += dt * (S.docked ? 0.12 : 0.2);
    S.zoom = lerp(S.zoom, S.zoomT, 1 - Math.exp(-dt * (S.docked ? 2.5 : 8)));
    S.cage = lerp(S.cage, S.docked ? 0.22 : 1, 1 - Math.exp(-dt * 2));
    const prev = S.el;
    S.el = Math.min(T.end + 1, S.el + dt);
    const el = S.el;
    if (el < T.app) {
      const e = ease(el / T.app);
      S.nodes.forEach((n, i) => { n.pos = { x: lerp(n.home.x, corners[i].x, e), y: lerp(n.home.y, corners[i].y, e), z: lerp(n.home.z, corners[i].z, e) }; n.glow = e * 0.85; });
    } else if (el < T.end) {
      if (prev < T.app) S.nodes.forEach((n, i) => { n.pos = { ...corners[i] }; });
      const nA = Math.min(anchors.length, Math.floor(anchors.length * Math.min(1, (el - T.app) / (T.anc - T.app))));
      for (let i = S.nA; i < nA; i++) if (i % 2 === 0 || nA - S.nA < 6) sparks(anchors[i], 2, 1.1);
      S.nA = nA;
      if (el >= T.anc) {
        const nE = Math.min(edges.length, Math.floor(edges.length * Math.min(1, (el - T.anc) / (T.mesh - T.anc))));
        for (let i = S.nE; i < nE; i += 6) { const e = edges[i]; sparks({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, z: (e.a.z + e.b.z) / 2 }, 1, 0.6); }
        S.nE = nE;
      }
      if (el >= T.mesh) {
        const nQ = Math.min(quads.length, Math.floor(quads.length * Math.min(1, (el - T.mesh) / (T.fill - T.mesh))));
        for (let i = S.nQ; i < nQ; i += 4) { const q = quads[i]; sparks({ x: (q.a.x + q.c.x) / 2, y: (q.a.y + q.c.y) / 2, z: (q.a.z + q.c.z) / 2 }, 1, 0.5); }
        S.nQ = nQ;
      }
      if (el >= T.fill) {
        const e = ease(Math.min(1, (el - T.fill) / (T.end - T.fill)));
        S.nodes.forEach((n, i) => { const up = { x: corners[i].x * 1.5, y: -CUBE * 1.8, z: corners[i].z * 1.5 }; n.pos = { x: lerp(corners[i].x, up.x, e), y: lerp(corners[i].y, up.y, e), z: lerp(corners[i].z, up.z, e) }; n.glow *= 0.93; });
      } else S.nodes.forEach((n, i) => { n.glow = 0.7 + 0.3 * Math.sin(el * 10 + i * 0.7); });
    } else {
      S.nA = anchors.length; S.nE = edges.length; S.nQ = quads.length;
      S.nodes.forEach((n) => { n.glow *= 0.93; });
    }
    hudPhase.textContent = el < T.app ? "phase: dock" : el < T.anc ? "phase: anchors " + Math.round(100 * S.nA / anchors.length) + "%"
      : el < T.mesh ? "phase: mesh " + Math.round(100 * S.nE / edges.length) + "%" : el < T.fill ? "phase: fill (min → max) " + Math.round(100 * S.nQ / quads.length) + "%"
      : el < T.end ? "phase: retract" : "phase: done";
    // CRT scan every 5 s once docked and finished
    if (S.docked && el >= T.end && !reduce) {
      const now = performance.now() / 1000;
      if (S.scanT < 0 && now >= S.nextScan) { S.scanT = 0; S.nextScan = now + 5; }
      if (S.scanT >= 0) { S.scanT += dt / 1.3; if (S.scanT > 1.25) S.scanT = -1; }
    }
    stepParticles();
  }

  // ------------------------------------------------------------------ render
  function render() {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = S.docked ? "#020a0c" : "#03080a";
    ctx.fillRect(0, 0, W, H);
    const lw = S.docked ? 0.6 : 1;
    // bed + cage
    if (S.cage > 0.05) {
      const bed = [{ x: -CUBE, y: CUBE, z: -CUBE }, { x: CUBE, y: CUBE, z: -CUBE }, { x: CUBE, y: CUBE, z: CUBE }, { x: -CUBE, y: CUBE, z: CUBE }].map(project);
      ctx.globalAlpha = 0.7 * S.cage; ctx.fillStyle = P.bed;
      ctx.beginPath(); ctx.moveTo(bed[0].x, bed[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(bed[i].x, bed[i].y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = P.rim; ctx.lineWidth = 0.5; ctx.globalAlpha = 0.45 * S.cage;
      for (let i = 0; i <= 8; i++) {
        const t = -CUBE + (i / 8) * 2 * CUBE;
        let a = project({ x: t, y: CUBE, z: -CUBE }), b = project({ x: t, y: CUBE, z: CUBE });
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        a = project({ x: -CUBE, y: CUBE, z: t }); b = project({ x: CUBE, y: CUBE, z: t });
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.strokeStyle = P.cage;
      for (const [i, j] of [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]]) {
        const a = project(corners[i]), b = project(corners[j]);
        ctx.globalAlpha = 0.3 * S.cage; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 0.85 * S.cage; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    // filled quads, back to front
    const fillFrac = S.nQ / quads.length;
    if (S.nQ) {
      const items = [];
      for (let i = 0; i < S.nQ; i++) {
        const q = quads[i], pa = project(q.a), pb = project(q.b), pc = project(q.c), pd = project(q.d);
        items.push({ q, pa, pb, pc, pd, z: (pa.z + pb.z + pc.z + pd.z) / 4, fresh: S.nQ - i });
      }
      items.sort((a, b) => b.z - a.z);
      for (const it of items) {
        ctx.globalAlpha = 0.9; ctx.fillStyle = viridis(it.q.t);
        ctx.beginPath(); ctx.moveTo(it.pa.x, it.pa.y); ctx.lineTo(it.pb.x, it.pb.y); ctx.lineTo(it.pc.x, it.pc.y); ctx.lineTo(it.pd.x, it.pd.y); ctx.closePath(); ctx.fill();
        if (it.fresh < 10 && S.el < T.fill + 0.2) { ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = (10 - it.fresh) / 12; ctx.lineWidth = 1.2 * lw; ctx.stroke(); }
      }
    }
    // mesh
    if (S.nE) {
      ctx.strokeStyle = P.mesh; ctx.lineCap = "round";
      const dim = 1 - 0.55 * fillFrac;
      ctx.globalAlpha = 0.25 * dim; ctx.lineWidth = 2.4 * lw;
      ctx.beginPath();
      for (let i = 0; i < S.nE; i++) { const a = project(edges[i].a), b = project(edges[i].b); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
      ctx.globalAlpha = 0.9 * dim; ctx.lineWidth = 0.8 * lw; ctx.stroke();
    }
    // anchors
    if (S.nA) {
      const dim = 1 - 0.75 * fillFrac;
      for (let i = 0; i < S.nA; i++) {
        const p = project(anchors[i]);
        ctx.globalAlpha = 0.45 * dim; ctx.fillStyle = P.laserHot;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6 * p.s, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.9 * dim; ctx.fillStyle = P.laser;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.3 * p.s, 0, Math.PI * 2); ctx.fill();
      }
    }
    // beams + nodes while etching
    if (S.el >= T.app && S.el < T.fill) {
      const list = S.el < T.anc ? anchors : null;
      for (let i = 0; i < 8; i++) {
        let tgt;
        if (list) tgt = anchors[Math.min(anchors.length - 1, (S.nA + Math.floor(i / 8 * anchors.length)) % anchors.length)];
        else if (S.el < T.mesh) { const e = edges[(S.nE + Math.floor(i / 8 * edges.length)) % edges.length]; tgt = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, z: (e.a.z + e.b.z) / 2 }; }
        else { const q = quads[Math.min(quads.length - 1, S.nQ + (i % 4))]; tgt = [q.a, q.b, q.c, q.d][i % 4]; }
        const a = project(S.nodes[i].pos), b = project(tgt);
        ctx.strokeStyle = P.laserHot; ctx.globalAlpha = 0.28; ctx.lineWidth = 3 * lw;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = P.laser; ctx.globalAlpha = 0.95; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    if (S.el < T.end + 0.6) for (const n of S.nodes) {
      const p = project(n.pos), r = 4 * p.s;
      ctx.fillStyle = P.laserHot; ctx.globalAlpha = 0.2 + n.glow * 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P.node; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
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
      const col = p.k === "e" ? heat(p.heat) : p.col;
      ctx.strokeStyle = col; ctx.globalAlpha = life * (p.k === "e" ? 0.5 : 0.85);
      ctx.lineWidth = p.size * 1.4 * pr.s; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(pv.x, pv.y); ctx.lineTo(pr.x, pr.y); ctx.stroke();
    }
    // CRT laser scan
    if (S.scanT >= 0) {
      const y = -0.08 * H + S.scanT * 1.16 * H;
      const trail = ctx.createLinearGradient(0, y - H * 0.32, 0, y);
      trail.addColorStop(0, "rgba(34,227,255,0)"); trail.addColorStop(1, "rgba(34,227,255,0.16)");
      ctx.globalAlpha = 1; ctx.fillStyle = trail; ctx.fillRect(0, y - H * 0.32, W, H * 0.32);
      for (let i = 0; i < anchors.length; i++) {           // re-lit anchors under the beam
        const p = project(anchors[i]), d = Math.abs(p.y - y);
        if (d < H * 0.06) {
          const a = 1 - d / (H * 0.06);
          ctx.globalAlpha = a; ctx.fillStyle = "#ffffff";
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
  function slotRect() { return slot.getBoundingClientRect(); }
  function placeDocked() {               // the screen lives inside the (sticky) header slot from now on
    if (crt.parentNode !== slot) slot.appendChild(crt);
    Object.assign(crt.style, { left: "", top: "", width: "", height: "", transform: "", clipPath: "", transition: "" });
  }
  function finishDock() {
    crt.classList.remove("docking");
    crt.classList.add("docked");
    S.docked = true; S.docking = false;
    const z = S.zoom;
    placeDocked(); fit();
    S.zoom = z * dockScale; // continue from what was on screen, then ease to the docked framing
    S.nextScan = performance.now() / 1000 + (S.el >= T.end ? 0.8 : T.end - S.el + 0.8);
    veil.remove();
  }
  let dockScale = 1;
  function startDock(dur) {
    if (S.docked || S.docking) return;
    S.docking = true;
    document.documentElement.classList.remove("etch-lock");
    crt.classList.add("docking");
    const r = slotRect(), vw = W, vh = H;
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
  function dockNow() { // no splash: start inside the slot
    crt.classList.add("docked");
    S.docked = true;
    veil.remove();
    placeDocked(); fit(); S.zoom = S.zoomT;
    S.nextScan = performance.now() / 1000 + T.end + 0.8;
  }

  // ------------------------------------------------------------------ loop
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      if (!S.docked && !S.docking && S.el >= 2.6) startDock(1.3);
      // docked and idle between scans: ~30 fps is plenty
      acc += dt;
      const idle = S.docked && S.el >= T.end + 0.6 && S.scanT < 0 && !S.particles.length;
      if (!idle || acc >= 1 / 30) { update(idle ? acc : dt); render(); acc = 0; }
    }
    requestAnimationFrame(frame);
  }

  function skipAhead() {
    if (S.docked || S.docking) return;
    S.el = Math.max(S.el, T.end);
    startDock(0.7);
  }
  crt.addEventListener("click", () => {
    if (!S.docked) return skipAhead();
    if (S.el >= T.end) resetSim();      // re-etch in place
  });
  window.addEventListener("keydown", () => skipAhead(), { once: true });
  window.addEventListener("resize", () => { fit(); if (reduce) render(); });

  if (reduce) {
    dockNow(); S.cage = 0.22; S.el = T.end + 1; S.nA = anchors.length; S.nE = edges.length; S.nQ = quads.length;
    update(0); render();
    return;
  }
  if (deepLink) dockNow();
  else { document.documentElement.classList.add("etch-lock"); fit(); S.zoom = S.zoomT; }
  requestAnimationFrame(frame);
})();
