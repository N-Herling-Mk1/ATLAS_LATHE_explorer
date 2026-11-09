/* LATHE — hypothesis sketches.
 *
 * These are SCHEMATICS, drawn from closed-form shapes, not data. They record what we expected the
 * loss-landscape fingerprints to look like before any ATLAS run was probed (first drawn 2026-11-07),
 * and what the null outcome would look like. No axis carries numbers on purpose.
 * Each panel is draw(svg, s) with s in [0, 1]: 0 = hypothesis holds, 1 = null. Toggling tweens s.
 */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const C = { cyan: "#22e3ff", cyanD: "#1590a6", cyanP: "#9eefff", orange: "#ff8a2a", line: "#15303b",
              line2: "#1f4652", ink: "#dff7fb", ink2: "#94b6be", mute: "#58757d", bg: "#04070b", warn: "#fab219" };
  const W = 400, H = 236, P = { l: 40, r: 14, t: 18, b: 34 };
  const X0 = P.l, X1 = W - P.r, Y0 = H - P.b, Y1 = P.t;          // plot box (Y0 bottom, Y1 top)
  const lerp = (a, b, s) => a + (b - a) * s;
  const sx = (u) => X0 + u * (X1 - X0);                           // u in [0,1] -> px
  const sy = (v) => Y0 - v * (Y0 - Y1);                           // v in [0,1] -> px
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function el(tag, attrs, parent, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  const pathOf = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  function curve(g, f, n, style) {               // f: u in [0,1] -> v (plot units, may exceed [0,1]; clipped)
    const pts = []; for (let i = 0; i <= n; i++) { const u = i / n; pts.push([sx(u), sy(f(u))]); }
    return el("path", Object.assign({ d: pathOf(pts), fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round",
      "clip-path": "url(#" + g.dataset.clip + ")" }, style), g);
  }
  function frame(svg, xl, yl) {
    const g = el("g", {}, svg);
    el("line", { x1: X0, y1: Y0, x2: X1, y2: Y0, stroke: C.line2, "stroke-width": 1 }, g);
    el("line", { x1: X0, y1: Y0, x2: X0, y2: Y1, stroke: C.line2, "stroke-width": 1 }, g);
    el("path", { d: `M${X1 - 5} ${Y0 - 3}L${X1} ${Y0}L${X1 - 5} ${Y0 + 3}`, stroke: C.line2, fill: "none" }, g);
    el("path", { d: `M${X0 - 3} ${Y1 + 5}L${X0} ${Y1}L${X0 + 3} ${Y1 + 5}`, stroke: C.line2, fill: "none" }, g);
    if (xl) el("text", { x: (X0 + X1) / 2, y: H - 10, "text-anchor": "middle", class: "ax" }, g, xl);
    if (yl) el("text", { x: 13, y: (Y0 + Y1) / 2, "text-anchor": "middle", class: "ax", transform: `rotate(-90 13 ${(Y0 + Y1) / 2})` }, g, yl);
    el("text", { x: W - 4, y: Y1, "text-anchor": "end", class: "wm", transform: `rotate(-90 ${W - 4} ${Y1})` }, g, "SCHEMATIC");
  }
  function legend(g, items, x, y) {
    items.forEach((it, i) => {
      const yy = y + i * 15;
      el("line", { x1: x, y1: yy - 4, x2: x + 20, y2: yy - 4, stroke: it.color, "stroke-width": it.w || 2, "stroke-dasharray": it.dash || null, "stroke-linecap": "round" }, g);
      el("text", { x: x + 26, y: yy, class: "lab", fill: it.color }, g, it.label);
    });
  }
  function base(svg, xl, yl, clipTop) {         // clipTop: plot-units ceiling for curves (default: whole box)
    svg.innerHTML = "";
    const id = "clip" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs", {}, svg);
    const yc = clipTop === undefined ? Y1 - 2 : sy(clipTop);
    const cp = el("clipPath", { id }, defs); el("rect", { x: X0 + 1, y: yc, width: X1 - X0 - 1, height: Y0 - yc + 1 }, cp);
    frame(svg, xl, yl);
    const g = el("g", {}, svg); g.dataset.clip = id;
    return g;
  }
  // deterministic "roughness": a fixed sum of sines (same shape every load)
  const wobble = (u) => 0.55 * Math.sin(23 * u + 0.7) + 0.3 * Math.sin(41 * u + 2.1) + 0.15 * Math.sin(67 * u + 4.0);

  // ======================================================================= H1 basin shape
  function h1(svg, s) {
    const g = base(svg, "a  ·  filter-normalized step", "ΔL", 0.86);
    const cells = [
      { label: "α = 8", color: C.cyanD, dash: null, k: [1.0, 1.15], r: [0.0, 0.0] },
      { label: "α = 16", color: C.cyan, dash: "7 4", k: [2.0, 1.25], r: [0.025, 0.004] },
      { label: "α = 32", color: C.orange, dash: "2 4", k: [4.3, 1.35], r: [0.11, 0.008] },
    ];
    // centre line
    el("line", { x1: sx(0.5), y1: Y0, x2: sx(0.5), y2: Y1 + 10, stroke: C.line, "stroke-dasharray": "2 3" }, g);
    for (const c of cells) {
      const k = lerp(c.k[0], c.k[1], s), r = lerp(c.r[0], c.r[1], s);
      curve(g, (u) => { const a = 2 * u - 1; return 0.04 + 0.8 * k * a * a + r * wobble(u) * Math.min(1, 4 * a * a + 0.15); },
        240, { stroke: c.color, "stroke-width": 2.2, "stroke-dasharray": c.dash });
    }
    cells.forEach((c, i) => legend(g, [{ label: c.label, color: c.color, dash: c.dash }], X0 + 14 + i * 104, Y1 + 8));
    el("text", { x: sx(0.5), y: Y0 + 13, "text-anchor": "middle", class: "ax" }, g, "θ*");
  }

  // ======================================================================= H2 conflict heatmap
  const H2_EXP = [   // rows out, L2, L1 · cols ep1 ep5 ep10 ep20 final · value = cos(∇BCE, ∇DisCo)
    [0.45, 0.30, 0.10, 0.00, -0.82],
    [0.05, -0.72, -0.86, -0.80, -0.90],
    [0.55, 0.20, -0.10, -0.15, -0.84]];
  const H2_NULL = [
    [0.25, -0.35, 0.15, -0.25, -0.85],
    [0.10, 0.25, -0.30, 0.15, -0.88],
    [-0.20, 0.10, 0.30, -0.35, -0.84]];
  function divColor(v) {             // orange (−1) → slate (0) → cyan (+1)
    const stops = [[-1, [255, 138, 42]], [0, [38, 52, 58]], [1, [34, 227, 255]]];
    const t = Math.max(-1, Math.min(1, v));
    const [a, b] = t < 0 ? [stops[0], stops[1]] : [stops[1], stops[2]];
    const f = (t - a[0]) / (b[0] - a[0]);
    return "rgb(" + a[1].map((x, i) => Math.round(x + (b[1][i] - x) * f)).join(",") + ")";
  }
  function h2(svg, s) {
    svg.innerHTML = "";
    const rows = ["out", "L2", "L1"], cols = ["ep 1", "ep 5", "ep 10", "ep 20", "final"];
    const gx = 44, gy = 20, cw = 49, ch = 44, gap = 3;
    const g = el("g", {}, svg);
    rows.forEach((r, i) => el("text", { x: gx - 8, y: gy + i * (ch + gap) + ch / 2 + 4, "text-anchor": "end", class: "lab" }, g, r));
    cols.forEach((c, j) => el("text", { x: gx + j * (cw + gap) + cw / 2, y: gy + 3 * (ch + gap) + 12, "text-anchor": "middle", class: "ax" }, g, c));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) {
      const v = lerp(H2_EXP[i][j], H2_NULL[i][j], s);
      const x = gx + j * (cw + gap), y = gy + i * (ch + gap);
      el("rect", { x, y, width: cw, height: ch, rx: 2, fill: divColor(v) }, g);
      el("text", { x: x + cw / 2, y: y + ch / 2 + 4, "text-anchor": "middle", fill: Math.abs(v) > 0.55 ? "#04070b" : C.ink, "font-size": 11 }, g,
        (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1));
    }
    // equilibrium column note
    const fx = gx + 4 * (cw + gap);
    el("rect", { x: fx - 2, y: gy - 2, width: cw + 4, height: 3 * (ch + gap) + 1, fill: "none", stroke: C.mute, "stroke-dasharray": "2 3" }, g);
    el("text", { x: fx + cw + 8, y: gy + 10, class: "ax" }, g, "≈ −1 at any");
    el("text", { x: fx + cw + 8, y: gy + 23, class: "ax" }, g, "converged");
    el("text", { x: fx + cw + 8, y: gy + 36, class: "ax" }, g, "trade-off");
    // pinch bracket on L2, epochs 5–20 (fades out under the null)
    const bx = gx + 1 * (cw + gap) - 3, by = gy + 1 * (ch + gap) - 3, bw = 3 * (cw + gap) + 3, bh = ch + 6;
    el("rect", { x: bx, y: by, width: bw, height: bh, fill: "none", stroke: C.orange, "stroke-width": 2, opacity: (1 - s).toFixed(2) }, g);
    el("text", { x: bx + bw / 2, y: gy + 3 * (ch + gap) + 28, "text-anchor": "middle", fill: C.orange, "font-size": 10.5, opacity: (1 - s).toFixed(2) }, g, "▲ L2 · ep 5–20 · pinch-point candidate");
    // colour key
    const kx = fx + cw + 8, ky = gy + 70, kh = 70;
    for (let k = 0; k < 20; k++) el("rect", { x: kx, y: ky + k * kh / 20, width: 9, height: kh / 20 + 0.5, fill: divColor(1 - 2 * k / 19) }, g);
    el("text", { x: kx + 14, y: ky + 8, class: "ax" }, g, "aligned");
    el("text", { x: kx + 14, y: ky + kh, class: "ax" }, g, "opposed");
    el("text", { x: W - 4, y: 18, "text-anchor": "end", class: "wm", transform: `rotate(-90 ${W - 4} 18)` }, g, "SCHEMATIC");
  }

  // ======================================================================= H3 curvature over training
  function h3(svg, s) {
    const g = base(svg, "epoch", "λmax");
    // ramp window shading
    el("rect", { x: sx(0), y: Y1, width: sx(0.3) - sx(0), height: Y0 - Y1, fill: "rgba(34,227,255,0.05)" }, g);
    el("text", { x: sx(0.15), y: Y0 - 6, "text-anchor": "middle", class: "ax" }, g, "α ramp window (τ)");
    const spike = (u, A) => A * Math.exp(-Math.pow((u - 0.13) / 0.055, 2));
    const settle = (u) => 0.12 + 0.36 * (1 - Math.exp(-u / 0.35));
    curve(g, (u) => settle(u) + spike(u, 0.42), 200, { stroke: C.orange, "stroke-width": 2.4 });
    curve(g, (u) => settle(u) * (0.92 + 0.08 * Math.min(1, u / 0.3)) + spike(u, lerp(0.0, 0.40, s)), 200,
      { stroke: C.cyan, "stroke-width": 2.2, "stroke-dasharray": "7 4" });
    // spike marker
    el("text", { x: sx(0.13), y: sy(0.12 + 0.36 * (1 - Math.exp(-0.13 / 0.35)) + 0.42) - 8, "text-anchor": "middle", fill: C.orange, "font-size": 10.5 }, g, "early spike");
    legend(g, [{ label: "constant α = 32", color: C.orange, w: 2.4 }, { label: "ramped α → 32", color: C.cyan, dash: "7 4" }], sx(0.5), Y1 + 12);
  }

  // ======================================================================= H4 seed-pair barriers
  function h4(svg, s) {
    const g = base(svg, "t   (0 = seed A  ·  1 = seed B)", "L(t) − chord");
    const bump = (h, skew) => (u) => 0.06 + h * Math.sin(Math.PI * u) * (1 + skew * (u - 0.5));
    const healthy = [0.10, 0.13, 0.08, 0.15, 0.11, 0.12];
    // permutation floor band
    el("rect", { x: X0 + 1, y: sy(0.06 + 0.16), width: X1 - X0 - 1, height: sy(0.06) - sy(0.06 + 0.16), fill: "rgba(34,227,255,0.06)" }, g);
    healthy.forEach((h, i) => curve(g, bump(h, (i % 3 - 1) * 0.4), 80, { stroke: C.cyan, "stroke-width": 1.3, opacity: 0.7 }));
    const hd = lerp(0.68, 0.13, s);
    curve(g, bump(hd, 0.35), 120, { stroke: C.orange, "stroke-width": 2.6 });
    legend(g, [{ label: "healthy × healthy", color: C.cyan, w: 1.3 }, { label: "healthy × seed 8005", color: C.orange, w: 2.6 }], X0 + 12, Y1 + 12);
    el("rect", { x: X0 + 12, y: Y1 + 34, width: 20, height: 8, fill: "rgba(34,227,255,0.14)" }, g);
    el("text", { x: X0 + 38, y: Y1 + 42, class: "lab", fill: C.ink2 }, g, "permutation floor");
  }

  // ======================================================================= dCor gap
  function dcor(svg, s) {
    const g = base(svg, "full-sample dCor²", "minibatch dCor²");
    el("line", { x1: sx(0), y1: sy(0), x2: sx(1), y2: sy(1), stroke: C.mute, "stroke-dasharray": "3 4" }, g);
    el("text", { x: sx(0.86), y: sy(0.86) + 15, "text-anchor": "middle", class: "ax", transform: `rotate(${-Math.atan2(Y0 - Y1, X1 - X0) * 180 / Math.PI} ${sx(0.86)} ${sy(0.86) + 15})` }, g, "no bias");
    const xs = [0.12, 0.22, 0.33, 0.45, 0.58];
    const groups = [
      { label: "n_disco ¼×", color: C.orange, gap: 0.30, r: 4.5, sym: "c" },
      { label: "n_disco 1×", color: C.cyan, gap: 0.12, r: 4.5, sym: "s" },
      { label: "n_disco 4×", color: C.cyanP, gap: 0.035, r: 4.5, sym: "d" },
    ];
    groups.forEach((gr, gi) => xs.forEach((x0, i) => {
      const x = x0 + gi * 0.025, y = x + lerp(gr.gap * (1 - 0.35 * x), 0.0, s) + (i % 2 ? 0.012 : -0.008) * (1 - s);
      const px = sx(x), py = sy(y);
      if (gr.sym === "c") el("circle", { cx: px, cy: py, r: gr.r, fill: gr.color, stroke: C.bg }, g);
      else if (gr.sym === "s") el("rect", { x: px - 4, y: py - 4, width: 8, height: 8, fill: gr.color, stroke: C.bg }, g);
      else el("path", { d: `M${px} ${py - 5.5}L${px + 5} ${py}L${px} ${py + 5.5}L${px - 5} ${py}Z`, fill: gr.color, stroke: C.bg }, g);
    }));
    groups.forEach((gr, i) => {
      const y = Y1 + 12 + i * 15, x = X0 + 14;
      el("circle", { cx: x + 6, cy: y - 4, r: 4, fill: gr.color }, g);
      el("text", { x: x + 18, y, class: "lab", fill: gr.color }, g, gr.label);
    });
  }

  // ======================================================================= kill test
  function kill(svg, s) {
    const g = base(svg, null, "closure error  ↓ better");
    const bars = [
      { label: "φ only", exp: 0.80, nul: 0.80, color: C.mute },
      { label: "+ prediction", exp: 0.71, nul: 0.79, color: C.cyanD },
      { label: "+ represent.", exp: 0.66, nul: 0.81, color: C.cyan },
      { label: "+ landscape", exp: 0.42, nul: 0.78, color: C.orange },
    ];
    // permutation-null band around φ-only
    el("rect", { x: X0 + 1, y: sy(0.88), width: X1 - X0 - 1, height: sy(0.70) - sy(0.88), fill: "rgba(250,178,25,0.07)" }, g);
    el("line", { x1: X0 + 1, y1: sy(0.70), x2: X1, y2: sy(0.70), stroke: C.warn, "stroke-dasharray": "3 4", opacity: 0.7 }, g);
    el("text", { x: X1 - 4, y: sy(0.88) - 5, "text-anchor": "end", class: "ax", fill: C.warn }, g, "permutation-null band");
    const bw = 46, step = (X1 - X0) / bars.length;
    bars.forEach((b, i) => {
      const v = lerp(b.exp, b.nul, s), x = X0 + step * i + (step - bw) / 2;
      el("rect", { x, y: sy(v), width: bw, height: Y0 - sy(v), fill: b.color, opacity: 0.85 }, g);
      el("text", { x: x + bw / 2, y: Y0 + 14, "text-anchor": "middle", class: "ax" }, g, b.label);
    });
    el("text", { x: X0 + step * 3 + step / 2, y: sy(lerp(0.42, 0.78, s)) - 7, "text-anchor": "middle", fill: C.orange, "font-size": 10.5,
      opacity: (1 - s).toFixed(2) }, g, "beats the band");
  }

  // ======================================================================= registry + wiring
  const PANELS = {
    h1: { draw: h1, read: [
      "Slices narrow and roughen as α rises. The α = 32 instability has a mechanical cause: training sits in a sharp, bumpy basin.",
      "Slices overlap at every α. Basin shape does not explain the α = 32 instability; look at timing (H3) or at separate basins (H4)."] },
    h2: { draw: h2, read: [
      "Opposition pools in one layer (L2) during epochs 5–20 in most seeds: a pinch-point candidate. It counts only if balance ρ ≈ 1 and cancellation κ < 0.3 there too.",
      "Opposition is diffuse and wanders between layers. No single layer is the bottleneck. The final column is orange either way, because that is what an equilibrium looks like."] },
    h3: { draw: h3, read: [
      "Constant α = 32 hits an early sharpness spike and the ramp removes it: the problem is when α arrives, not how big it is.",
      "The spike survives the ramp: the problem is the size of α, so a schedule won't rescue α = 32."] },
    h4: { draw: h4, read: [
      "Pairs involving seed 8005 sit far above the healthy-pair floor, and their predictions differ too: 8005 converged into a separate basin.",
      "8005's barrier matches the healthy pairs: it is the same basin, at a poorly converged point. That makes it an optimization problem, not a landscape one."] },
    dcor: { draw: dcor, read: [
      "The minibatch dCor² sits above the full-sample value, most for small DisCo batches. DisCo is optimizing a biased target, so n_disco is a real knob.",
      "Points fall on the diagonal at every batch size, so minibatch DisCo is unbiased here and n_disco can drop out of the pilot."] },
    kill: { draw: kill, read: [
      "Adding landscape coordinates drops held-out closure error below the permutation band. Fingerprints earn a place as TRUSS surrogate inputs.",
      "No family beats hyperparameters beyond the permutation band. Record that the map adds nothing a metrics table does not, and stop."] },
  };
  const state = {};
  function render(id) { const p = PANELS[id]; p.draw(p.svg, state[id].s); }
  function setReading(id, v) {
    const r = PANELS[id].reading; if (!r) return;
    r.classList.toggle("null", v === 1);
    r.innerHTML = `<span class="lbl">${v === 1 ? "IF THE NULL HOLDS" : "IF THE HYPOTHESIS HOLDS"}</span>${PANELS[id].read[v]}`;
  }
  function go(id, target) {
    const st = state[id]; if (st.target === target && st.s === target) return;
    st.target = target; const s0 = st.s, t0 = performance.now(), dur = 650;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReading(id, target);
    PANELS[id].card.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", (b.dataset.v === "null") === (target === 1)));
    if (reduce) { st.s = target; render(id); return; }
    cancelAnimationFrame(st.raf);
    const tick = (now) => { const k = Math.min(1, (now - t0) / dur); st.s = lerp(s0, target, ease(k)); render(id); if (k < 1) st.raf = requestAnimationFrame(tick); };
    st.raf = requestAnimationFrame(tick);
  }
  function init() {
    document.querySelectorAll("[data-sketch]").forEach((card) => {
      const id = card.dataset.sketch; const p = PANELS[id]; if (!p) return;
      p.card = card; p.svg = card.querySelector("svg"); p.reading = card.querySelector(".reading");
      p.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      state[id] = { s: 0, target: 0, raf: 0 };
      render(id); setReading(id, 0);
      card.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => go(id, b.dataset.v === "null" ? 1 : 0)));
    });
    const all = document.getElementById("allToggle");
    if (all) all.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      all.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      Object.keys(state).forEach((id, i) => setTimeout(() => go(id, b.dataset.v === "null" ? 1 : 0), i * 70));
    }));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
