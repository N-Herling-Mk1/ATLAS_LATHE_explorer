"""Build the static site: copy lfp/site and write the run data next to it."""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

from .log import log
from .summary import json_safe, load_fingerprints, summarize

SITE_DIR = Path(__file__).resolve().parent / "site"


def build_site(fp_dirs, out="site_build", ledger=None, key="name", title="LATHE landscape fingerprints",
               extra_pairs=None, clean=False) -> int:
    """Aggregate fingerprints (+ optional ledger CSV of your run metrics) into a static site at `out`.

    Writes data/bundle.js (so index.html opens straight from disk), data/bundle.json and
    data/fp_summary.csv (one row per run). Returns 0 on success, 1 if nothing was found.
    """
    import pandas as pd

    docs, pairs = load_fingerprints(fp_dirs)
    for pf in extra_pairs or []:
        pairs.extend(json.loads(Path(pf).read_text()).get("pairs", []))
    if not docs:
        log("build-site: no fingerprint.json found; nothing to build")
        return 1
    led = pd.read_csv(ledger) if ledger else None
    df = summarize(docs, pairs, led, key)
    out = Path(out)
    if out.exists() and clean:
        shutil.rmtree(out)
    shutil.copytree(SITE_DIR, out, dirs_exist_ok=True)
    (out / "data").mkdir(parents=True, exist_ok=True)
    df.to_csv(out / "data" / "fp_summary.csv", index=False)
    for d in docs:  # drop bulky per-iteration histories from the web bundle
        for s in d.get("snapshots", []):
            if s.get("hessian"):
                s["hessian"].pop("history", None)
                s["hessian"].pop("history_shifted", None)
    ledger_rows = df[[c for c in df.columns if c == "run_id" or c.startswith("led_")]].to_dict("records")
    bundle = json_safe({
        "schema": "lfp-site/1", "title": title,
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "sources": [str(Path(p).resolve()) for p in fp_dirs],
        "ledger": str(Path(ledger).resolve()) if ledger else None,
        "runs": docs, "pairs": pairs, "ledger_rows": ledger_rows,
        "summary_columns": list(df.columns), "summary": df.where(df.notna(), None).to_dict("records"),
    })
    text = json.dumps(bundle)
    (out / "data" / "bundle.json").write_text(text)
    (out / "data" / "bundle.js").write_text("window.LFP_DATA = " + text + ";\n")
    log(f"build-site: {len(docs)} runs, {len(pairs)} pairs -> {out.resolve()} (open index.html)")
    return 0
