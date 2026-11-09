(async function () {
  "use strict";
  const D = window.LFP_DATA || (await fetch("data/bundle.json").then((r) => (r.ok ? r.json() : null)).catch(() => null));
  if (!D) {  // template opened without a build (e.g. lfp/site/ on the public site): say so instead of failing silently
    document.querySelector("nav.controls").style.display = "none";
    document.querySelector("main").innerHTML = `<div class="nodata"><h2>No fingerprint bundle here</h2>
      <p class="q">This is the explorer template. It shows measured panels only after a build writes <code>data/bundle.js</code> next to it:</p>
      <pre>python -m lfp build-site --fp fp\\stage1 --ledger runs\\stage1\\grade\\ledger.csv --key name --out explorer --clean</pre>
      <p class="q">Published builds live under <a href="https://n-herling-mk1.github.io/ATLAS_LATHE_explorer/explorer/">/explorer/</a>.
      The pre-registered sketches are on the <a href="https://n-herling-mk1.github.io/ATLAS_LATHE_explorer/#expect">home page</a>.</p></div>`;
    return;
  }
  const C = { bg: "#0a1016", line: "#14303a", ink: "#d8f6fb", ink2: "#8fb3bb", mute: "#5b7880",
              cyan: "#22e3ff", orange: "#ff8a2a", warn: "#fab219" };
  const DASH = ["solid", "dash", "dot", "dashdot", "longdash", "longdashdot"];
  const CONF = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] };
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" :
    (typeof v === "number" ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : +v.toPrecision(4)) : String(v)));
  const median = (a) => { const s = a.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)).sort((x, y) => x - y);
    if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  function layout(extra = {}) {
    const axis = { gridcolor: C.line, zerolinecolor: "#24505c", linecolor: C.line, tickfont: { size: 10 } };
    const base = {
      paper_bgcolor: C.bg, plot_bgcolor: C.bg,
      font: { family: "Share Tech Mono, JetBrains Mono, Consolas, Menlo, monospace", size: 11, color: C.ink2 },
      margin: { l: 58, r: 16, t: 30, b: 46 },
      legend: { orientation: "h", y: 1.14, x: 0, font: { size: 11 } },
      hoverlabel: { bgcolor: "#0f1a22", bordercolor: C.cyan, font: { color: C.ink, size: 11 } },
    };
    const out = Object.assign({}, base, extra);
    for (const k of Object.keys(out)) if (/^[xy]axis\d*$/.test(k)) out[k] = Object.assign({}, axis, out[k]);
    if (!out.xaxis) out.xaxis = Object.assign({}, axis);
    if (!out.yaxis) out.yaxis = Object.assign({}, axis);
    return out;
  }

  // ---------------------------------------------------------------- data helpers
  const runs = D.runs || [];
  const pairs = D.pairs || [];
  const summary = D.summary || [];
  const summaryById = Object.fromEntries(summary.map((r) => [r.run_id, r]));
  const finalSnap = (r) => { const s = r.snapshots || []; const f = s.filter((x) => x.epoch === "final"); return f.length ? f[f.length - 1] : s[s.length - 1]; };
  const metaKeys = [...new Set(runs.flatMap((r) => Object.keys(r.meta || {})))];
  const epochKey = (e) => (e === "final" ? Infinity : Number(e));
  const allEpochs = [...new Set(runs.flatMap((r) => (r.snapshots || []).map((s) => String(s.epoch))))]
    .sort((a, b) => epochKey(a) - epochKey(b));

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgba(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
  function ramp(i, n) {  // sequential cyan ramp: dim -> bright -> pale, ordered like the groups
    const stops = ["#2a9bb0", "#22e3ff", "#c9f7ff"].map(hexToRgb);
    if (n <= 1) return C.cyan;
    const t = i / (n - 1) * (stops.length - 1); const k = Math.min(Math.floor(t), stops.length - 2); const f = t - k;
    const c = stops[k].map((v, j) => Math.round(v + (stops[k + 1][j] - v) * f));
    return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  let groupKey = metaKeys.includes("cell") ? "cell" : metaKeys[0];
  function groupsOf(key) {
    const by = {};
    for (const r of runs) { const g = String((r.meta || {})[key]); (by[g] = by[g] || []).push(r); }
    let labels = Object.keys(by);
    if (labels.every((l) => l !== "" && !Number.isNaN(Number(l)))) labels.sort((a, b) => Number(a) - Number(b));
    else if (metaKeys.includes("alpha")) labels.sort((a, b) => mean(by[a].map((r) => Number(r.meta.alpha) || 0)) - mean(by[b].map((r) => Number(r.meta.alpha) || 0)) || a.localeCompare(b, undefined, { numeric: true }));
    else labels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const style = Object.fromEntries(labels.map((l, i) => [l, { color: ramp(i, labels.length), dash: DASH[i % DASH.length] }]));
    return { by, labels, style };
  }
  const groupOfRun = (r) => String((r.meta || {})[groupKey]);

  // ---------------------------------------------------------------- header + warnings
  const hashes = [...new Set(runs.map((r) => r.probe_batch_hash).filter(Boolean))];
  const hessErr = runs.filter((r) => (r.snapshots || []).some((s) => s.hessian && s.hessian.error)).length;
  const nonConv = runs.filter((r) => { const h = (finalSnap(r) || {}).hessian; return h && !h.error && h.converged === false; }).length;
  $("meta").innerHTML = `${D.title || ""}<br>${runs.length} runs · ${pairs.length} pairs · built ${D.generated || ""}`;
  const warns = [];
  if (hashes.length > 1) warns.push(`⚠ ${hashes.length} different probe batches across runs: comparisons are not on the same events`);
  if (hessErr) warns.push(`⚠ ${hessErr} runs with non-finite Hessian (see table)`);
  if (nonConv) warns.push(`${nonConv} runs: power iteration not converged (raise --hess-iters)`);
  $("warnings").textContent = warns.join("   ");
  $("footer").innerHTML = `schema ${D.schema || ""} · sources: ${(D.sources || []).join(", ")}${D.ledger ? " · ledger: " + D.ledger : ""}`
    + ` · probe batch hash: ${hashes.join(", ") || "n/a"}`;

  // ---------------------------------------------------------------- controls
  function fillSelect(el, opts, val) { el.innerHTML = opts.map((o) => `<option value="${o}">${o}</option>`).join(""); if (val !== undefined && opts.includes(val)) el.value = val; }
  fillSelect($("groupBy"), metaKeys, groupKey);
  const sliceTerms = ["total", ...new Set(runs.flatMap((r) => { const s = (finalSnap(r) || {}).slice; return s && s.terms && s.terms[0] ? Object.keys(s.terms[0]) : []; }))];
  fillSelect($("sliceTerm"), sliceTerms, "total");
  const cols = D.summary_columns || [];
  const featCols = cols.filter((c) => /^(geo_|traj_|loss_|dcor_)/.test(c));
  const metricCols = cols.filter((c) => /^led_/.test(c)).concat(cols.filter((c) => /^meta_/.test(c) && summary.some((r) => typeof r[c] === "number")));
  fillSelect($("xFeat"), featCols, featCols.includes("geo_lam_min") ? "geo_lam_min" : featCols[0]);
  fillSelect($("yMetric"), metricCols, metricCols[0]);

  // ---------------------------------------------------------------- H1 slices
  function drawSlices() {
    const G = groupsOf(groupKey); const term = $("sliceTerm").value; const traces = []; let alphas = null;
    for (const g of G.labels) {
      const curves = [];
      for (const r of G.by[g]) {
        const s = (finalSnap(r) || {}).slice; if (!s) continue; alphas = s.alphas;
        const dirs = term === "total" ? s.total : (s.terms || []).map((t) => t[term]).filter(Boolean);
        if (!dirs.length) continue;
        const c0 = Math.floor(s.alphas.length / 2);
        const avg = s.alphas.map((_, i) => mean(dirs.map((d) => d[i] - d[c0])));
        curves.push(avg);
      }
      if (!curves.length) continue;
      const st = G.style[g];
      const med = alphas.map((_, i) => median(curves.map((c) => c[i])));
      const lo = alphas.map((_, i) => Math.min(...curves.map((c) => c[i])));
      const hi = alphas.map((_, i) => Math.max(...curves.map((c) => c[i])));
      traces.push({ x: alphas, y: lo, mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false, legendgroup: g });
      traces.push({ x: alphas, y: hi, mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: rgba(st.color, 0.12), hoverinfo: "skip", showlegend: false, legendgroup: g });
      traces.push({ x: alphas, y: med, mode: "lines", name: `${g} (n=${curves.length})`, legendgroup: g,
        line: { color: st.color, width: 2, dash: st.dash }, hovertemplate: `${g}<br>a=%{x:.2f}<br>ΔL=%{y:.4g}<extra></extra>` });
    }
    Plotly.react("slices", traces, layout({ xaxis: { title: { text: "step a along filter-normalized direction" } },
      yaxis: { title: { text: `ΔL (${term})` } } }), CONF);

    const stats = [["rise", "rise ΔL(±span)"], ["width", "width |a| at +10%"], ["rough", "roughness"]];
    const tr = []; const ann = [];
    stats.forEach(([k, label], j) => {
      const ax = j === 0 ? "" : String(j + 1);
      for (const g of G.labels) {
        const ys = G.by[g].map((r) => { const s = (finalSnap(r) || {}).slice; return s ? s.summary[k] : null; }).filter((v) => v !== null);
        if (!ys.length) continue;
        tr.push({ type: "box", x: ys.map(() => g), y: ys, name: g, xaxis: "x" + ax, yaxis: "y" + ax, boxpoints: "all", jitter: 0.4, pointpos: 0,
          marker: { color: G.style[g].color, size: 6 }, line: { color: G.style[g].color, width: 1 }, fillcolor: rgba(G.style[g].color, 0.08),
          showlegend: false, text: G.by[g].map((r) => r.run_id), hovertemplate: "%{text}<br>%{y:.4g}<extra></extra>" });
      }
      ann.push({ text: label, xref: `x${ax} domain`, yref: "paper", x: 0, y: 1.12, showarrow: false, xanchor: "left", font: { size: 11, color: C.ink2 } });
    });
    Plotly.react("sliceStats", tr, layout({ grid: { rows: 1, columns: 3, pattern: "independent" }, annotations: ann,
      margin: { l: 50, r: 10, t: 30, b: 30 }, xaxis2: {}, yaxis2: {}, xaxis3: {}, yaxis3: {} }), CONF);
  }

  // ---------------------------------------------------------------- H2 conflict / balance / cancellation
  const KAPPA_STALL = 0.3, RHO_BAND = 3;  // provisional thresholds for the stall marker
  const H2 = {
    conflict: { field: "per_layer", zmin: -1, zmax: 1, z: (v) => v, label: (v) => v.toFixed(2),
      colorscale: [[0, C.orange], [0.5, "#26343a"], [1, C.cyan]], hover: "median cos %{customdata:.3f}" },
    balance: { field: "balance", zmin: -2, zmax: 2, z: (v) => (v > 0 ? Math.max(-2, Math.min(2, Math.log10(v))) : -2),
      label: (v) => (v === 0 ? "0" : String(Number(v.toPrecision(2)))),
      colorscale: [[0, "#17606c"], [0.5, "#3a4548"], [1, "#c0681f"]], hover: "median ρ %{customdata:.3g}" },
    cancel: { field: "cancel", zmin: 0, zmax: 1, z: (v) => v, label: (v) => v.toFixed(2),
      colorscale: [[0, C.orange], [0.35, "#6b4322"], [1, "#1c2a30"]], hover: "median κ %{customdata:.3f}" },
  };
  function drawLayerMaps(kind) {
    const spec = H2[kind]; const G = groupsOf(groupKey); const box = $(kind); box.innerHTML = "";
    const jobs = [];  // create every cell first so the grid settles before Plotly measures widths
    for (const g of G.labels) {
      let layers = null; const cell = {}; const rhoCell = {};
      for (const r of G.by[g]) for (const s of r.snapshots || []) {
        const c = s.conflict; if (!c || !c[spec.field]) continue; layers = layers || c.layer_order;
        for (const ln of c.layer_order) {
          const k = `${ln}|${s.epoch}`; (cell[k] = cell[k] || []).push(c[spec.field][ln]);
          if (c.balance) (rhoCell[k] = rhoCell[k] || []).push(c.balance[ln]);
        }
      }
      if (!layers) continue;
      const eps = allEpochs.filter((e) => layers.some((ln) => cell[`${ln}|${e}`]));
      const raw = layers.map((ln) => eps.map((e) => median(cell[`${ln}|${e}`] || [])));
      const z = raw.map((row) => row.map((v) => (v === null ? null : spec.z(v))));
      const text = raw.map((row, i) => row.map((v, j) => {
        if (v === null) return "";
        let t = spec.label(v);
        if (kind === "cancel") { const rho = median(rhoCell[`${layers[i]}|${eps[j]}`] || []);
          if (v < KAPPA_STALL && rho !== null && rho > 1 / RHO_BAND && rho < RHO_BAND) t += " ◆"; }
        return t; }));
      const div = document.createElement("div"); div.className = "cell"; box.appendChild(div);
      jobs.push([div, g, eps, layers, z, raw, text]);
    }
    for (const [div, g, eps, layers, z, raw, text] of jobs) {
      Plotly.react(div, [{ type: "heatmap", x: eps.map((e) => (e === "final" ? "final" : "ep " + e)), y: layers, z, zmin: spec.zmin, zmax: spec.zmax,
        colorscale: spec.colorscale, xgap: 2, ygap: 2, customdata: raw, text, texttemplate: "%{text}", textfont: { size: 10, color: "#e8f8fb" },
        showscale: false, hovertemplate: `%{y} · %{x}<br>${spec.hover}<extra></extra>` }],
        layout({ title: { text: `${groupKey} = ${g}`, font: { size: 12, color: C.ink }, x: 0.02 }, margin: { l: 70, r: 10, t: 34, b: 34 },
          yaxis: { autorange: "reversed", type: "category" }, xaxis: { type: "category" } }), CONF);
    }
    if (!box.children.length) box.innerHTML = `<p class="q">No data for this score (needs both loss terms; κ and ρ need lfp ≥ 0.2 fingerprints).</p>`;
  }
  function drawConflict() { for (const k of Object.keys(H2)) drawLayerMaps(k); }

  // ---------------------------------------------------------------- H3 curvature
  function drawCurv(id, key, label) {
    const G = groupsOf(groupKey); const traces = [];
    for (const g of G.labels) {
      const st = G.style[g]; const perEpoch = {};
      for (const r of G.by[g]) {
        const pts = (r.snapshots || []).filter((s) => s.hessian && s.hessian[key] !== null && s.hessian[key] !== undefined)
          .sort((a, b) => epochKey(String(a.epoch)) - epochKey(String(b.epoch)));
        pts.forEach((s) => { (perEpoch[String(s.epoch)] = perEpoch[String(s.epoch)] || []).push(s.hessian[key]); });
        if (pts.length) traces.push({ x: pts.map((s) => String(s.epoch)), y: pts.map((s) => s.hessian[key]), mode: pts.length > 1 ? "lines" : "markers",
          line: { color: rgba(st.color, 0.35), width: 1 }, marker: { color: rgba(st.color, 0.5), size: 5 }, showlegend: false, legendgroup: g,
          hovertemplate: `${r.run_id}<br>epoch %{x}<br>${label} %{y:.4g}<extra></extra>` });
      }
      const eps = allEpochs.filter((e) => perEpoch[e]);
      if (eps.length) traces.push({ x: eps, y: eps.map((e) => median(perEpoch[e])), mode: "lines+markers", name: g, legendgroup: g,
        line: { color: st.color, width: 3, dash: st.dash }, marker: { size: 7, color: st.color, line: { color: C.bg, width: 2 } },
        hovertemplate: `${g} median<br>epoch %{x}<br>${label} %{y:.4g}<extra></extra>` });
    }
    Plotly.react(id, traces, layout({ title: { text: label, font: { size: 12, color: C.ink }, x: 0.02 },
      xaxis: { type: "category", categoryorder: "array", categoryarray: allEpochs, title: { text: "epoch" } } }), CONF);
  }

  // ---------------------------------------------------------------- H4 barriers
  const pairGroupLabel = (p) => String((p.group || {})[groupKey] !== undefined ? p.group[groupKey] : Object.values(p.group || {}).join("/"));
  function drawPairs() {
    if (!pairs.length) {
      for (const id of ["barriers", "predDist", "pairCurves"]) $(id).innerHTML = "";
      $("barriers").innerHTML = `<p class="q">No seed pairs in this build. Run <code>python -m lfp pairs ...</code> and rebuild.</p>`;
      return;
    }
    const G = groupsOf(groupKey);
    const labels = [...new Set(pairs.map(pairGroupLabel))].sort((a, b) => G.labels.indexOf(a) - G.labels.indexOf(b));
    const style = (g) => G.style[g] || { color: C.cyan, dash: "solid" };
    const bt = labels.map((g) => { const ps = pairs.filter((p) => pairGroupLabel(p) === g); return {
      type: "box", name: g, x: ps.map(() => g), y: ps.map((p) => p.barrier), boxpoints: "all", jitter: 0.45, pointpos: 0,
      marker: { color: style(g).color, size: 6 }, line: { color: style(g).color, width: 1 }, fillcolor: rgba(style(g).color, 0.08),
      text: ps.map((p) => `${p.a} × ${p.b}`), hovertemplate: "%{text}<br>barrier %{y:.4g}<extra></extra>", showlegend: false }; });
    Plotly.react("barriers", bt, layout({ title: { text: "interpolation barrier", font: { size: 12, color: C.ink }, x: 0.02 },
      xaxis: { title: { text: groupKey } }, yaxis: { title: { text: "max (L(t) − chord)" } } }), CONF);
    const pt = labels.map((g) => { const ps = pairs.filter((p) => pairGroupLabel(p) === g && p.pred); return {
      type: "box", name: g, x: ps.map(() => g), y: ps.map((p) => 1 - p.pred.spearman), boxpoints: "all", jitter: 0.45, pointpos: 0,
      marker: { color: style(g).color, size: 6 }, line: { color: style(g).color, width: 1 }, fillcolor: rgba(style(g).color, 0.08),
      text: ps.map((p) => `${p.a} × ${p.b}`), hovertemplate: "%{text}<br>1 − ρ %{y:.4g}<extra></extra>", showlegend: false }; });
    Plotly.react("predDist", pt, layout({ title: { text: "prediction distance (1 − Spearman ρ)", font: { size: 12, color: C.ink }, x: 0.02 },
      xaxis: { title: { text: groupKey } } }), CONF);
    const sel = $("pairGroup"); const prev = sel.value; fillSelect(sel, labels, prev || labels[labels.length - 1]);
    drawPairCurves();
  }
  function drawPairCurves() {
    const g = $("pairGroup").value; const ps = pairs.filter((p) => pairGroupLabel(p) === g);
    const worst = ps.reduce((m, p) => (m === null || p.barrier > m.barrier ? p : m), null);
    const traces = ps.map((p) => { const y0 = p.curve[0], y1 = p.curve[p.curve.length - 1]; const top = p === worst;
      return { x: p.t, y: p.curve.map((y, j) => y - ((1 - p.t[j]) * y0 + p.t[j] * y1)), mode: "lines", name: top ? `highest: ${p.a} × ${p.b}` : `${p.a} × ${p.b}`,
        line: { color: top ? C.orange : rgba(C.cyan, 0.55), width: top ? 2.5 : 1.2 }, showlegend: top,
        hovertemplate: `${p.a} × ${p.b}<br>t=%{x:.2f}<br>L − chord %{y:.4g}<extra></extra>` }; });
    Plotly.react("pairCurves", traces, layout({ title: { text: `loss above chord along A→B · ${groupKey} = ${g}`, font: { size: 12, color: C.ink }, x: 0.02 },
      xaxis: { title: { text: "t (0 = seed A, 1 = seed B)" } }, yaxis: { title: { text: "L(t) − chord" } } }), CONF);
  }

  // ---------------------------------------------------------------- dCor gap
  function drawDcor() {
    const G = groupsOf(groupKey); const traces = []; let lo = Infinity, hi = -Infinity;
    for (const g of G.labels) {
      const pts = G.by[g].map((r) => [r, (finalSnap(r) || {}).dcor]).filter(([, d]) => d);
      if (!pts.length) continue;
      pts.forEach(([, d]) => { lo = Math.min(lo, d.full, d.mini_mean); hi = Math.max(hi, d.full, d.mini_mean); });
      traces.push({ x: pts.map(([, d]) => d.full), y: pts.map(([, d]) => d.mini_mean), mode: "markers", name: g,
        error_y: { type: "data", array: pts.map(([, d]) => d.mini_sd), color: rgba(G.style[g].color, 0.4), thickness: 1, width: 0 },
        marker: { color: G.style[g].color, size: 8, symbol: ["circle", "square", "diamond", "triangle-up", "x", "cross"][G.labels.indexOf(g) % 6], line: { color: C.bg, width: 1 } },
        text: pts.map(([r, d]) => `${r.run_id}<br>n_mini=${d.n_mini}, n_full=${d.n_full}`), hovertemplate: "%{text}<br>full %{x:.4g}<br>minibatch %{y:.4g}<extra></extra>" });
    }
    if (traces.length) traces.unshift({ x: [lo, hi], y: [lo, hi], mode: "lines", line: { color: C.mute, dash: "dot", width: 1 }, hoverinfo: "skip", showlegend: false });
    Plotly.react("dcor", traces, layout({ xaxis: { title: { text: "dCor², full sample" } }, yaxis: { title: { text: "dCor², mean over DisCo-sized minibatches" } } }), CONF);
  }

  // ---------------------------------------------------------------- scatter
  function drawScatter() {
    const G = groupsOf(groupKey); const xf = $("xFeat").value, ym = $("yMetric").value; const traces = [];
    for (const g of G.labels) {
      const rows = G.by[g].map((r) => summaryById[r.run_id]).filter((s) => s && s[xf] !== null && s[xf] !== undefined && s[ym] !== null && s[ym] !== undefined);
      if (!rows.length) continue;
      traces.push({ x: rows.map((s) => s[xf]), y: rows.map((s) => s[ym]), mode: "markers", name: g, text: rows.map((s) => s.run_id),
        marker: { color: G.style[g].color, size: 9, symbol: ["circle", "square", "diamond", "triangle-up", "x", "cross"][G.labels.indexOf(g) % 6], line: { color: C.bg, width: 1 } },
        hovertemplate: "%{text}<br>x %{x:.4g}<br>y %{y:.4g}<extra></extra>" });
    }
    Plotly.react("scatter", traces, layout({ xaxis: { title: { text: xf } }, yaxis: { title: { text: ym } } }), CONF);
  }

  // ---------------------------------------------------------------- table
  let sortCol = null, sortDir = 1;
  function drawTable() {
    const led = cols.filter((c) => /^led_/.test(c)).slice(0, 8);
    const head = ["run_id", groupKey, "source", "snaps", "geo_lam_max", "geo_lam_min", "geo_cos_global", "geo_slice_width", "geo_slice_rough", "geo_barrier_mean", "geo_dcor_gap", ...led, "flags"];
    let rows = runs.map((r) => { const s = summaryById[r.run_id] || {}; const fh = (finalSnap(r) || {}).hessian || {};
      const flags = [fh.error ? "hessian non-finite" : "", fh && fh.converged === false && !fh.error ? "not converged" : ""].filter(Boolean).join("; ");
      return Object.assign({}, s, { run_id: r.run_id, [groupKey]: groupOfRun(r), source: r.source, snaps: (r.snapshots || []).length, flags }); });
    if (sortCol) rows.sort((a, b) => { const x = a[sortCol], y = b[sortCol]; if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (x > y ? 1 : -1) * sortDir; });
    $("runs").innerHTML = `<thead><tr>${head.map((h) => `<th data-c="${h}">${h.replace(/^geo_|^led_/, "")}${sortCol === h ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>`
      + `<tbody>${rows.map((r) => `<tr>${head.map((h) => `<td class="${h === "flags" && r.flags ? "flag" : ""}">${fmt(r[h])}</td>`).join("")}</tr>`).join("")}</tbody>`;
    $("runs").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { const c = th.dataset.c; sortDir = sortCol === c ? -sortDir : 1; sortCol = c; drawTable(); }));
  }

  function drawAll() {
    drawSlices(); drawConflict(); drawCurv("lamMax", "lam_max", "λ<sub>max</sub>"); drawCurv("lamMin", "lam_min", "λ<sub>min</sub>");
    drawPairs(); drawDcor(); drawScatter(); drawTable();
  }
  $("groupBy").addEventListener("change", (e) => { groupKey = e.target.value; drawAll(); });
  $("sliceTerm").addEventListener("change", drawSlices);
  $("pairGroup").addEventListener("change", drawPairCurves);
  $("xFeat").addEventListener("change", drawScatter);
  $("yMetric").addEventListener("change", drawScatter);
  drawAll();
})();
