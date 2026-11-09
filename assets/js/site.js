/* LATHE public face — nav, section tracking, explorer status. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // mobile nav
  const nav = $(".nav"), tog = $(".navtoggle");
  if (tog) tog.addEventListener("click", () => nav.classList.toggle("open"));
  $$(".nav a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("open")));

  // active section in nav
  const links = $$(".nav a[href^='#']");
  const secs = links.map((a) => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
  if ("IntersectionObserver" in window && secs.length) {
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id)); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    secs.forEach((s) => io.observe(s));
  }

  // explorer status: is a built fingerprint site published under explorer/ ?
  const box = $("#explorerStatus");
  if (box) {
    fetch("explorer/data/bundle.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((D) => {
        const runs = (D.runs || []).length, pairs = (D.pairs || []).length;
        const metaKeys = [...new Set((D.runs || []).flatMap((r) => Object.keys(r.meta || {})))];
        box.querySelector(".big").className = "big live";
        box.querySelector(".big").textContent = "FINGERPRINTS PUBLISHED";
        box.querySelector(".msg").textContent = "A built explorer is live. Each panel there is the measured counterpart of a sketch above.";
        box.querySelector("dl").innerHTML =
          `<dt>runs</dt><dd>${runs}</dd><dt>seed pairs</dt><dd>${pairs}</dd>` +
          `<dt>built</dt><dd>${D.generated || "—"}</dd><dt>schema</dt><dd>${D.schema || "—"}</dd>` +
          `<dt>meta keys</dt><dd>${metaKeys.join(", ") || "—"}</dd>`;
        const b = $("#openExplorer"); b.classList.remove("off"); b.removeAttribute("aria-disabled");
      })
      .catch(() => { /* leave the waiting state that ships in the HTML */ });
  }

  // KaTeX
  window.addEventListener("load", () => {
    if (window.renderMathInElement) renderMathInElement(document.body, {
      delimiters: [{ left: "\\(", right: "\\)", display: false }, { left: "$$", right: "$$", display: true }], throwOnError: false });
  });
})();
